/**
 * Fleet freshness — pure rules and the shared clock behind "last seen" labels.
 *
 * The bridge stamps `lastSeenAt` with the local receipt time of every
 * `fleet:*` event, heartbeats included. Silence is only claimed for an
 * authenticated peer, after the same three missed heartbeats `/fleet status`
 * uses; it never implies a disconnection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

import {
  FLEET_CLOCK_SKEW_TOLERANCE_MS,
  FLEET_HEARTBEAT_INTERVAL_MS,
  FLEET_SILENCE_THRESHOLD_MS,
  describePeerFreshness,
  toSeenAge,
} from '../src/renderer/utils/fleet-freshness';
import { createSharedClock } from '../src/renderer/hooks/use-shared-now';
import type { FleetPeerStatus } from '../src/renderer/types';

const NOW = Date.UTC(2026, 8, 14, 8, 0, 0);

function readRepoFile(relativeToCoworkTests: string): string {
  return readFileSync(fileURLToPath(new URL(relativeToCoworkTests, import.meta.url)), 'utf-8');
}

describe('fleet freshness thresholds', () => {
  it('follows the core heartbeat cadence and the /fleet status stale threshold', () => {
    const broadcaster = readRepoFile('../../src/fleet/heartbeat-broadcaster.ts');
    const fleetHandler = readRepoFile('../../src/commands/handlers/fleet-handler.ts');

    expect(broadcaster).toContain(
      `const DEFAULT_INTERVAL_MS = ${formatMs(FLEET_HEARTBEAT_INTERVAL_MS)};`
    );
    expect(fleetHandler).toContain(
      `const STALE_THRESHOLD_MS = ${formatMs(FLEET_SILENCE_THRESHOLD_MS)};`
    );
    expect(FLEET_SILENCE_THRESHOLD_MS).toBe(3 * FLEET_HEARTBEAT_INTERVAL_MS);
  });
});

function formatMs(value: number): string {
  return value.toLocaleString('en-US').replace(/,/g, '_');
}

describe('describePeerFreshness', () => {
  const authenticated = (lastSeenAt?: number) => ({ status: 'authenticated' as const, lastSeenAt });

  it('has no baseline before the first event', () => {
    expect(describePeerFreshness(authenticated(undefined), NOW)).toEqual({ kind: 'never' });
  });

  it('reports the age of a recent event', () => {
    expect(describePeerFreshness(authenticated(NOW - 25_000), NOW)).toEqual({
      kind: 'seen',
      ageMs: 25_000,
    });
  });

  it('calls an authenticated peer silent only past three missed heartbeats', () => {
    expect(describePeerFreshness(authenticated(NOW - FLEET_SILENCE_THRESHOLD_MS), NOW)).toEqual({
      kind: 'seen',
      ageMs: FLEET_SILENCE_THRESHOLD_MS,
    });
    expect(describePeerFreshness(authenticated(NOW - FLEET_SILENCE_THRESHOLD_MS - 1), NOW)).toEqual(
      {
        kind: 'silent',
        ageMs: FLEET_SILENCE_THRESHOLD_MS + 1,
      }
    );
  });

  it.each<FleetPeerStatus>(['connecting', 'connected', 'reconnecting', 'disconnected', 'error'])(
    'never claims silence for a %s peer, whose status already says why nothing arrives',
    (status) => {
      expect(describePeerFreshness({ status, lastSeenAt: NOW - 600_000 }, NOW)).toEqual({
        kind: 'seen',
        ageMs: 600_000,
      });
    }
  );

  it('treats a receipt slightly ahead of the clock snapshot as just seen', () => {
    expect(describePeerFreshness(authenticated(NOW + FLEET_CLOCK_SKEW_TOLERANCE_MS), NOW)).toEqual({
      kind: 'seen',
      ageMs: 0,
    });
  });

  it.each([
    ['far in the future', NOW + FLEET_CLOCK_SKEW_TOLERANCE_MS + 1],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['negative', -1],
  ])('does not trust a last-seen time that is %s', (_label, lastSeenAt) => {
    expect(describePeerFreshness(authenticated(lastSeenAt), NOW)).toEqual({ kind: 'invalid' });
  });

  it('does not trust a non-numeric last-seen value coming from IPC', () => {
    const peer = {
      status: 'authenticated' as const,
      lastSeenAt: '1789400000000' as unknown as number,
    };
    expect(describePeerFreshness(peer, NOW)).toEqual({ kind: 'invalid' });
  });
});

describe('toSeenAge', () => {
  it.each([
    [0, { unit: 'justNow' }],
    [9_999, { unit: 'justNow' }],
    [10_000, { unit: 'seconds', count: 10 }],
    [59_999, { unit: 'seconds', count: 59 }],
    [60_000, { unit: 'minutes', count: 1 }],
    [3_599_999, { unit: 'minutes', count: 59 }],
    [3_600_000, { unit: 'hours', count: 1 }],
    [86_400_000, { unit: 'days', count: 1 }],
  ])('%i ms → %o', (ageMs, expected) => {
    expect(toSeenAge(ageMs)).toEqual(expected);
  });
});

describe('createSharedClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts no timer until something subscribes', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const clock = createSharedClock(5_000);

    clock.getSnapshot();

    expect(vi.getTimerCount()).toBe(0);
    expect(clock.subscriberCount()).toBe(0);
  });

  it('shares one interval between subscribers and stops it when the last one leaves', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const clock = createSharedClock(5_000);

    const unsubscribers = [
      clock.subscribe(() => {}),
      clock.subscribe(() => {}),
      clock.subscribe(() => {}),
    ];
    expect(vi.getTimerCount()).toBe(1);
    expect(clock.subscriberCount()).toBe(3);

    unsubscribers[0]();
    unsubscribers[1]();
    expect(vi.getTimerCount()).toBe(1);
    unsubscribers[2]();
    expect(vi.getTimerCount()).toBe(0);
    expect(clock.subscriberCount()).toBe(0);
  });

  it('keeps the snapshot stable between ticks and advances it on each tick', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
    const clock = createSharedClock(5_000);
    const listener = vi.fn();
    const unsubscribe = clock.subscribe(listener);
    const first = clock.getSnapshot();

    vi.advanceTimersByTime(4_999);
    expect(clock.getSnapshot()).toBe(first);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(clock.getSnapshot()).toBe(NOW + 5_000);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('refreshes an idle snapshot after a tick has elapsed or the system clock went back', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
    const clock = createSharedClock(5_000);
    expect(clock.getSnapshot()).toBe(NOW);

    vi.setSystemTime(NOW + 60_000);
    expect(clock.getSnapshot()).toBe(NOW + 60_000);

    vi.setSystemTime(NOW - 3_600_000);
    expect(clock.getSnapshot()).toBe(NOW - 3_600_000);
  });
});

describe('fleet freshness translations', () => {
  const keys = [
    'justNow',
    'secondsAgo',
    'minutesAgo',
    'hoursAgo',
    'daysAgo',
    'noEventsYet',
    'noEventsHint',
    'unknownTime',
    'unknownHint',
    'silent',
    'silentHint',
  ];

  it.each(['en', 'fr', 'zh'])('are all present in the %s locale', (locale) => {
    const messages = JSON.parse(readRepoFile(`../src/renderer/i18n/locales/${locale}.json`)) as {
      fleet?: { freshness?: Record<string, unknown> };
    };
    for (const key of keys) {
      expect(messages.fleet?.freshness?.[key], `${locale}: fleet.freshness.${key}`).toEqual(
        expect.any(String)
      );
    }
  });
});
