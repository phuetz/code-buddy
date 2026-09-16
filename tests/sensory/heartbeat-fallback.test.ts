/**
 * TypeScript heartbeat fallback — fake timers, real↔fallback hand-off, never two clocks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_HEARTBEAT_SOURCE,
  isHeartbeatFallbackEnabled,
  startHeartbeatFallback,
  type HeartbeatFallbackHandle,
} from '../../src/sensory/heartbeat-fallback.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import type { BaseEvent } from '../../src/events/types.js';

interface Beat {
  source: string | undefined;
  beat: number;
  at: number;
}

function collectBeats(): { beats: Beat[]; off: () => void } {
  const beats: Beat[] = [];
  const bus = getGlobalEventBus();
  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const m = evt.metadata as { modality?: string; kind?: string; payload?: { beat?: number } } | undefined;
    if (m?.modality !== 'vital' || m?.kind !== 'heartbeat') return;
    beats.push({ source: evt.source, beat: Number(m.payload?.beat ?? 0), at: Date.now() });
  });
  return { beats, off: () => bus.off(id) };
}

function emitReal(beat: number): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'buddy-sense',
    metadata: {
      modality: 'vital',
      kind: 'heartbeat',
      salience: 5,
      payload: { beat, uptime_ms: beat * 1000, load1: 0.1, interval_ms: 1000 },
    },
  });
}

describe('heartbeat fallback — opt-in TS pacemaker', () => {
  let handle: HeartbeatFallbackHandle | undefined;
  let off: (() => void) | undefined;

  beforeEach(() => {
    delete process.env.CODEBUDDY_HEARTBEAT_FALLBACK;
    delete process.env.CODEBUDDY_HEARTBEAT_FALLBACK_MS;
    delete process.env.CODEBUDDY_HEARTBEAT_FALLBACK_SILENCE_MS;
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    handle?.stop();
    handle = undefined;
    off?.();
    off = undefined;
    vi.useRealTimers();
    delete process.env.CODEBUDDY_HEARTBEAT_FALLBACK;
    delete process.env.CODEBUDDY_HEARTBEAT_FALLBACK_MS;
    delete process.env.CODEBUDDY_HEARTBEAT_FALLBACK_SILENCE_MS;
  });

  it('is disabled by default (byte-identical: no env ⇒ no beats after many intervals)', () => {
    expect(isHeartbeatFallbackEnabled()).toBe(false);
    const col = collectBeats();
    off = col.off;
    handle = startHeartbeatFallback();
    expect(handle.getSource()).toBe('none');
    vi.advanceTimersByTime(30_000);
    expect(col.beats).toEqual([]);
  });

  it('CODEBUDDY_HEARTBEAT_FALLBACK=true emits vital/heartbeat at the period', () => {
    process.env.CODEBUDDY_HEARTBEAT_FALLBACK = 'true';
    const col = collectBeats();
    off = col.off;
    handle = startHeartbeatFallback({ load1: () => 0.25 });
    expect(handle.getSource()).toBe('fallback');
    expect(col.beats).toHaveLength(1);
    expect(col.beats[0]).toMatchObject({ source: FALLBACK_HEARTBEAT_SOURCE, beat: 1 });
    vi.advanceTimersByTime(1000);
    expect(col.beats).toHaveLength(2);
    expect(col.beats[1]).toMatchObject({ source: FALLBACK_HEARTBEAT_SOURCE, beat: 2 });
    vi.advanceTimersByTime(1000);
    expect(col.beats).toHaveLength(3);
  });

  it('a real buddy-sense beat disables the fallback; silence re-arms it; never two clocks', () => {
    process.env.CODEBUDDY_HEARTBEAT_FALLBACK = 'true';
    process.env.CODEBUDDY_HEARTBEAT_FALLBACK_SILENCE_MS = '15000';
    const col = collectBeats();
    off = col.off;
    handle = startHeartbeatFallback({ load1: () => null });

    expect(col.beats.map((b) => b.source)).toEqual([FALLBACK_HEARTBEAT_SOURCE]);

    // Real pacemaker arrives on a later tick → fallback clock is cleared.
    vi.advanceTimersByTime(500);
    emitReal(7);
    expect(handle.getSource()).toBe('rust');
    expect(col.beats.map((b) => b.source)).toEqual([FALLBACK_HEARTBEAT_SOURCE, 'buddy-sense']);

    // While rust is fresh, advancing several periods must NOT add a fallback beat.
    vi.advanceTimersByTime(10_000);
    emitReal(8);
    vi.advanceTimersByTime(4_000);
    expect(col.beats.filter((b) => b.source === FALLBACK_HEARTBEAT_SOURCE)).toHaveLength(1);
    expect(col.beats.filter((b) => b.source === 'buddy-sense')).toHaveLength(2);

    // Last real beat was 4 s ago; silence is 15 s → fire exactly at +11 s, one resume beat.
    vi.advanceTimersByTime(11_000);
    expect(handle.getSource()).toBe('fallback');
    const afterSilence = col.beats.filter((b) => b.source === FALLBACK_HEARTBEAT_SOURCE);
    expect(afterSilence.length).toBe(2);

    // Real returns again → fallback stops; no pair of rust+fallback in the same ms.
    vi.advanceTimersByTime(1);
    const beforeReal = col.beats.length;
    emitReal(9);
    expect(handle.getSource()).toBe('rust');
    const atHandoff = col.beats.slice(beforeReal);
    expect(atHandoff).toHaveLength(1);
    expect(atHandoff[0]!.source).toBe('buddy-sense');
    vi.advanceTimersByTime(1000);
    expect(col.beats.slice(beforeReal).every((b) => b.source === 'buddy-sense')).toBe(true);

    // No timestamp is shared by a fallback beat and a real beat (never two clocks).
    for (const b of col.beats) {
      const window = col.beats.filter((o) => o.at === b.at);
      const sources = new Set(window.map((o) => o.source));
      expect(sources.has(FALLBACK_HEARTBEAT_SOURCE) && sources.has('buddy-sense')).toBe(false);
    }
  });

  it('stop() tears down the timer: no further beats, source none', () => {
    process.env.CODEBUDDY_HEARTBEAT_FALLBACK = 'true';
    const col = collectBeats();
    off = col.off;
    handle = startHeartbeatFallback({ load1: () => null });
    expect(col.beats).toHaveLength(1);
    handle.stop();
    expect(handle.getSource()).toBe('none');
    vi.advanceTimersByTime(20_000);
    expect(col.beats).toHaveLength(1);
  });

  it('CODEBUDDY_HEARTBEAT_FALLBACK_MS overrides the period', () => {
    process.env.CODEBUDDY_HEARTBEAT_FALLBACK = 'true';
    process.env.CODEBUDDY_HEARTBEAT_FALLBACK_MS = '250';
    const col = collectBeats();
    off = col.off;
    handle = startHeartbeatFallback({ load1: () => null });
    expect(col.beats).toHaveLength(1);
    vi.advanceTimersByTime(249);
    expect(col.beats).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(col.beats).toHaveLength(2);
  });
});
