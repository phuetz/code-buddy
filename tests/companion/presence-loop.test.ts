import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hasConfirmedPresence,
  runPresenceTick,
  resetPresenceState,
  type Moment,
  type PresenceDeps,
} from '../../src/companion/presence-loop.js';
import { addFollowUp, dueFollowUp } from '../../src/companion/event-followups.js';

const AFTERNOON = new Date('2026-06-26T14:00:00');
const EVENING = new Date('2026-06-26T20:00:00');
const NIGHT = new Date('2026-06-26T23:30:00');
const ORIGINAL_TIMEZONE = process.env.CODEBUDDY_TIMEZONE;

let stateDir: string;

function baseDeps(over: Partial<PresenceDeps> = {}): PresenceDeps {
  return {
    say: vi.fn(async () => {}),
    now: () => AFTERNOON,
    isPersonPresent: () => true,
    inConversation: () => false,
    recentHearing: async () => [],
    drowsy: () => false,
    projectThread: async () => null,
    // Isolate relationship-state I/O to a temp file so tests never touch the real home dir.
    relationshipStatePath: path.join(stateDir, 'relationship-state.json'),
    // These tests exercise the presence LOGIC (rails/cooldown/cap), not the shared conductor — a
    // permissive conductor keeps them decoupled from the real-time singleton. Arbitration has its own test.
    conductor: { claim: () => true },
    ...over,
  };
}

beforeEach(() => {
  resetPresenceState();
  process.env.CODEBUDDY_COMPANION_PRESENCE = 'true';
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'presence-'));
});
afterEach(() => {
  delete process.env.CODEBUDDY_COMPANION_PRESENCE;
  delete process.env.CODEBUDDY_COMPANION_QUIET;
  if (ORIGINAL_TIMEZONE === undefined) delete process.env.CODEBUDDY_TIMEZONE;
  else process.env.CODEBUDDY_TIMEZONE = ORIGINAL_TIMEZONE;
  rmSync(stateDir, { recursive: true, force: true });
});

describe('presence loop — the conductor speaks only when it warms (rails)', () => {
  it('requires a confirmed face match instead of treating any fresh record as presence', () => {
    expect(hasConfirmedPresence({ hasMatch: true })).toBe(true);
    expect(hasConfirmedPresence({ hasMatch: false })).toBe(false);
    expect(hasConfirmedPresence({})).toBe(false);
    expect(hasConfirmedPresence(null)).toBe(false);
  });

  it('is silent when not opted in (default OFF)', async () => {
    delete process.env.CODEBUDDY_COMPANION_PRESENCE;
    const say = vi.fn(async () => {});
    expect(await runPresenceTick(baseDeps({ say, recentHearing: async () => ["j'en peux plus"] }))).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('speaks an encouragement when it hears frustration (warranted)', async () => {
    const say = vi.fn(async () => {});
    const line = await runPresenceTick(baseDeps({ say, recentHearing: async () => ["franchement j'en peux plus de ce bug"] }));
    expect(line).toBeTruthy();
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0]![0]).toBe(line);
  });

  it('stays silent during sleep/quiet hours', async () => {
    const say = vi.fn(async () => {});
    expect(await runPresenceTick(baseDeps({ say, now: () => NIGHT, recentHearing: async () => ["j'en peux plus"] }))).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('uses the household timezone for quiet hours instead of the host timezone', async () => {
    process.env.CODEBUDDY_TIMEZONE = 'Pacific/Auckland';
    const say = vi.fn(async () => {});
    const householdNight = new Date('2026-07-12T10:30:00.000Z'); // 22:30 in Auckland
    expect(await runPresenceTick(baseDeps({
      say,
      now: () => householdNight,
      recentHearing: async () => ["j'en peux plus"],
    }))).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('never speaks to an empty room', async () => {
    const say = vi.fn(async () => {});
    expect(await runPresenceTick(baseDeps({ say, isPersonPresent: () => false, recentHearing: async () => ["j'en peux plus"] }))).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('honours an explicit silent/focus household policy', async () => {
    const say = vi.fn(async () => {});
    const line = await runPresenceTick(baseDeps({
      say,
      recentHearing: async () => ["j'en peux plus"],
      homePolicy: async () => ({
        allowed: false,
        spontaneousDailyLimit: 0,
        privateContentAllowed: true,
        reason: 'silent',
      }),
    }));
    expect(line).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('stays silent when the shared daily household budget is exhausted', async () => {
    const say = vi.fn(async () => {});
    const claimDailyBudget = vi.fn(async () => ({
      granted: false,
      release: async () => undefined,
    }));
    const line = await runPresenceTick(baseDeps({
      say,
      recentHearing: async () => ["j'en peux plus"],
      homePolicy: async () => ({
        allowed: true,
        spontaneousDailyLimit: 2,
        privateContentAllowed: true,
        reason: 'free day',
      }),
      claimDailyBudget,
    }));
    expect(line).toBeNull();
    expect(claimDailyBudget).toHaveBeenCalledWith(2, AFTERNOON);
    expect(say).not.toHaveBeenCalled();
  });

  it('releases a reserved budget slot when the conductor denies the voice floor', async () => {
    const release = vi.fn(async () => undefined);
    const line = await runPresenceTick(baseDeps({
      recentHearing: async () => ["j'en peux plus"],
      homePolicy: async () => ({
        allowed: true,
        spontaneousDailyLimit: 2,
        privateContentAllowed: true,
        reason: 'free day',
      }),
      claimDailyBudget: async () => ({ granted: true, release }),
      conductor: { claim: () => false },
    }));
    expect(line).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('never talks over a live conversation', async () => {
    const say = vi.fn(async () => {});
    expect(await runPresenceTick(baseDeps({ say, inConversation: () => true, recentHearing: async () => ["j'en peux plus"] }))).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('asks how the day went in the evening, and opens the conversation window', async () => {
    const say = vi.fn(async () => {});
    const onEngage = vi.fn();
    const line = await runPresenceTick(baseDeps({ say, now: () => EVENING, onEngage }));
    expect(line).toMatch(/journ[ée]e/i);
    expect(onEngage).toHaveBeenCalledTimes(1); // it asked → window opens so he can answer
  });

  it('respects the per-moment cooldown', async () => {
    let t = AFTERNOON.getTime();
    const m: Moment = { id: 'x', cooldownMs: 10 * 60_000, generate: () => 'coucou' };
    const deps = baseDeps({ moments: [m], now: () => new Date(t) });
    expect(await runPresenceTick(deps)).toBe('coucou');
    t += 60_000; // 1 min later, within the 10-min cooldown
    expect(await runPresenceTick(deps)).toBeNull();
    t += 11 * 60_000; // past cooldown
    expect(await runPresenceTick(deps)).toBe('coucou');
  });

  it('enforces the hourly cap', async () => {
    let t = AFTERNOON.getTime();
    const m: Moment = { id: 'y', cooldownMs: 0, generate: () => 'hop' };
    const deps = baseDeps({ moments: [m], hourlyCap: 2, now: () => new Date(t) });
    expect(await runPresenceTick(deps)).toBe('hop');
    t += 1000;
    expect(await runPresenceTick(deps)).toBe('hop');
    t += 1000;
    expect(await runPresenceTick(deps)).toBeNull(); // cap reached
  });

  it('never throws (a moment that explodes → silent)', async () => {
    const m: Moment = { id: 'boom', cooldownMs: 0, generate: () => { throw new Error('nope'); } };
    await expect(runPresenceTick(baseDeps({ moments: [m] }))).resolves.toBeNull();
  });

  it('yields to the conductor — stays silent when another surface has the floor', async () => {
    const say = vi.fn(async () => {});
    // A warranted moment (frustration) that WOULD speak, but the conductor denies the floor.
    const line = await runPresenceTick(
      baseDeps({ say, recentHearing: async () => ["j'en peux plus"], conductor: { claim: () => false } }),
    );
    expect(line).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('asks how a due event went (follow-up), opens the window, and marks it asked once', async () => {
    const efPath = path.join(stateDir, 'event-followups.json');
    const nowMs = AFTERNOON.getTime();
    addFollowUp({ event: 'le déploiement', eventDayAt: nowMs - 2 * 86_400_000, followUp: 'Alors, ce déploiement, ça a donné quoi ?' }, nowMs, efPath);
    const say = vi.fn(async () => {});
    const onEngage = vi.fn();
    const line = await runPresenceTick(baseDeps({ say, onEngage, eventFollowUpsPath: efPath }));
    expect(line).toBe('Alors, ce déploiement, ça a donné quoi ?');
    expect(onEngage).toHaveBeenCalledTimes(1);
    expect(dueFollowUp(nowMs, efPath)).toBeNull(); // marked asked → never repeats
  });
});
