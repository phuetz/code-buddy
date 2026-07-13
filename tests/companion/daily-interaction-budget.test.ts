import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimDailyInteraction,
  reserveDailyInteraction,
} from '../../src/companion/daily-interaction-budget.js';

describe('daily spontaneous interaction budget', () => {
  let dir: string;
  let statePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daily-interactions-'));
    statePath = join(dir, 'budget.json');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('shares one persisted cap across presence and proactive surfaces', async () => {
    const base = {
      limit: 2,
      timeZone: 'Europe/Paris',
      statePath,
      now: new Date('2026-07-12T08:00:00.000Z'),
    } as const;

    expect((await claimDailyInteraction({ ...base, surface: 'presence' })).granted).toBe(true);
    expect((await claimDailyInteraction({ ...base, surface: 'proactive' })).granted).toBe(true);
    const denied = await claimDailyInteraction({ ...base, surface: 'presence' });

    expect(denied).toMatchObject({ granted: false, used: 2, remaining: 0, reason: 'limit_reached' });
    expect(JSON.parse(readFileSync(statePath, 'utf8')).days['2026-07-12'].events).toHaveLength(2);
  });

  it('resets at the household date boundary rather than UTC midnight', async () => {
    const common = { limit: 1, timeZone: 'Europe/Paris', statePath, surface: 'presence' as const };
    const first = await claimDailyInteraction({
      ...common,
      now: new Date('2026-07-11T21:59:00.000Z'),
    });
    const nextLocalDay = await claimDailyInteraction({
      ...common,
      now: new Date('2026-07-11T22:01:00.000Z'),
    });

    expect(first.localDate).toBe('2026-07-11');
    expect(nextLocalDay.localDate).toBe('2026-07-12');
    expect(nextLocalDay.granted).toBe(true);
  });

  it('fails closed when the persisted ledger is corrupt', async () => {
    writeFileSync(statePath, '{not-json', 'utf8');

    const claim = await claimDailyInteraction({
      limit: 2,
      surface: 'presence',
      statePath,
      timeZone: 'Europe/Paris',
    });

    expect(claim).toMatchObject({ granted: false, reason: 'state_unavailable' });
  });

  it('does not grant when the configured limit is zero', async () => {
    const claim = await claimDailyInteraction({
      limit: 0,
      surface: 'presence',
      statePath,
      timeZone: 'Europe/Paris',
    });
    expect(claim).toMatchObject({ granted: false, reason: 'limit_reached' });
  });

  it('serializes concurrent claims so a limit of one grants exactly once', async () => {
    const claims = await Promise.all(Array.from({ length: 10 }, () => claimDailyInteraction({
      limit: 1,
      surface: 'presence',
      statePath,
      timeZone: 'Europe/Paris',
      now: new Date('2026-07-12T08:00:00.000Z'),
    })));

    expect(claims.filter((claim) => claim.granted)).toHaveLength(1);
    expect(claims.filter((claim) => claim.reason === 'limit_reached')).toHaveLength(9);
  });

  it('drops future ledger keys without repeatedly deleting today', async () => {
    const futureDays = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [
      `2027-01-${String(index + 1).padStart(2, '0')}`,
      { events: [] },
    ]));
    writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, days: futureDays }), 'utf8');
    const options = {
      limit: 1,
      surface: 'presence' as const,
      statePath,
      timeZone: 'Europe/Paris',
      now: new Date('2026-07-12T08:00:00.000Z'),
    };

    expect((await claimDailyInteraction(options)).granted).toBe(true);
    expect((await claimDailyInteraction(options))).toMatchObject({
      granted: false,
      reason: 'limit_reached',
    });
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { days: Record<string, unknown> };
    expect(Object.keys(state.days)).toEqual(['2026-07-12']);
  });

  it('can release an uncommitted delivery reservation', async () => {
    const options = {
      limit: 1,
      surface: 'presence' as const,
      statePath,
      timeZone: 'Europe/Paris',
      now: new Date('2026-07-12T08:00:00.000Z'),
    };
    const reservation = await reserveDailyInteraction(options);
    expect(reservation.granted).toBe(true);
    await reservation.release();
    expect((await claimDailyInteraction(options)).granted).toBe(true);
  });
});
