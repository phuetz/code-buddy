/**
 * C2 — initiative Telegram « mode déplacement ».
 * Fixtures génériques ; pas de prénom, pas de nom d'animal, pas de donnée de santé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'path';
import {
  AWAY_TEMPLATES,
  angleForClock,
  awayMaxPerDay,
  canSendAway,
  inAwayWindow,
  isAwayPauseRequest,
  isAwayShameLine,
  isCompanionAway,
  observeInboundForAwayPause,
  parseAwayHours,
  pickAwayAngle,
  pickAwayLine,
  recordAwaySend,
  resolveAwayClock,
  rollAwayState,
} from '../../src/companion/away-mode.js';
import { runProactiveTick } from '../../src/companion/proactive-engine.js';
import { saveRelationshipState } from '../../src/companion/relationship-state.js';
import { _resetConductorForTests } from '../../src/companion/orchestrator.js';
import { COPINE_PERSONA } from '../../src/companion/personas/index.js';

const morning = new Date(2026, 6, 2, 9, 0, 0).getTime();
const tooEarly = new Date(2026, 6, 2, 8, 0, 0).getTime();
const afternoon = new Date(2026, 6, 2, 14, 30, 0).getTime();
const evening = new Date(2026, 6, 2, 20, 0, 0).getTime();
const night = new Date(2026, 6, 2, 23, 0, 0).getTime();
const DAY = 24 * 3600_000;

describe('C2 away detection + window', () => {
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_AWAY;
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    delete process.env.CODEBUDDY_COMPANION_AWAY_HOURS;
    delete process.env.CODEBUDDY_COMPANION_AWAY_MAX_PER_DAY;
  });

  it('default flag off is not away, even after 24 h without camera', () => {
    delete process.env.CODEBUDDY_COMPANION_AWAY;
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    expect(
      isCompanionAway({ now: morning, lastPresentAt: morning - 2 * DAY, present: false }),
    ).toBe(false);
  });

  it('CODEBUDDY_COMPANION_AWAY=true enables away when absent', () => {
    process.env.CODEBUDDY_COMPANION_AWAY = 'true';
    expect(isCompanionAway({ now: morning, present: false })).toBe(true);
    expect(isCompanionAway({ now: morning, present: true })).toBe(false);
  });

  it('copine persona + 24 h without camera detects away', () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    expect(
      isCompanionAway({ now: morning, lastPresentAt: morning - DAY, present: false }),
    ).toBe(true);
    expect(
      isCompanionAway({ now: morning, lastPresentAt: morning - DAY + 1, present: false }),
    ).toBe(false);
  });

  it('window defaults to 08:30-22:00 local', () => {
    expect(parseAwayHours('08:30-22:00')).toEqual({ startMin: 8 * 60 + 30, endMin: 22 * 60 });
    expect(inAwayWindow(8 * 60 + 29)).toBe(false);
    expect(inAwayWindow(8 * 60 + 30)).toBe(true);
    expect(inAwayWindow(21 * 60 + 59)).toBe(true);
    expect(inAwayWindow(22 * 60)).toBe(false);
  });

  it('max per day defaults to 3', () => {
    expect(awayMaxPerDay({})).toBe(3);
    expect(awayMaxPerDay({ CODEBUDDY_COMPANION_AWAY_MAX_PER_DAY: '1' })).toBe(1);
  });
});

describe('C2 angles — never the same twice, no shame', () => {
  it('maps morning / thought / evening and refuses a repeat', () => {
    expect(angleForClock({ hour: 9 })).toBe('morning');
    expect(angleForClock({ hour: 14 })).toBe('thought');
    expect(angleForClock({ hour: 20 })).toBe('evening');
    expect(pickAwayAngle({ hour: 9 }, [])).toBe('morning');
    expect(pickAwayAngle({ hour: 9 }, ['morning'])).toBeNull();
    expect(pickAwayAngle({ hour: 14 }, ['morning'])).toBe('thought');
  });

  it('cap of 3 blocks a fourth send the same civil day', () => {
    const clock = resolveAwayClock(evening);
    const state = {
      date: clock.localDate,
      sent: ['morning', 'thought', 'evening'] as const,
    };
    expect(canSendAway({ state: { ...state, sent: [...state.sent] }, clock }).ok).toBe(false);
  });

  it('rolls sent angles at civil midnight', () => {
    const next = rollAwayState({ date: '2026-07-01', sent: ['morning', 'thought'] }, '2026-07-02');
    expect(next.sent).toEqual([]);
    expect(next.date).toBe('2026-07-02');
  });

  it('templates never guilt, never « N jours sans te voir »', () => {
    for (const angle of ['morning', 'thought', 'evening'] as const) {
      for (const line of [...AWAY_TEMPLATES[angle], ...COPINE_PERSONA.away[angle]]) {
        expect(isAwayShameLine(line), line).toBe(false);
        expect(line).not.toMatch(/comment puis-je t['’]aider/i);
      }
    }
  });

  it('pickAwayLine stays in the pool and avoids the previous line', () => {
    const first = pickAwayLine('morning', { rng: () => 0 });
    const second = pickAwayLine('morning', { rng: () => 0, avoid: first });
    expect(AWAY_TEMPLATES.morning).toContain(first);
    expect(second).not.toBe(first);
  });
});

describe('C2 stop / pas maintenant', () => {
  it('recognises whole-message stop phrases only', () => {
    expect(isAwayPauseRequest('stop')).toBe(true);
    expect(isAwayPauseRequest('Stop !')).toBe(true);
    expect(isAwayPauseRequest('pas maintenant')).toBe(true);
    expect(isAwayPauseRequest('arrête')).toBe(true);
    expect(isAwayPauseRequest('stopper un bug')).toBe(false);
    expect(isAwayPauseRequest('une journée dure')).toBe(false);
  });

  it('observeInboundForAwayPause ignores non-telegram', () => {
    expect(() => observeInboundForAwayPause('discord', 'stop')).not.toThrow();
  });
});

describe('C2 runProactiveTick — Telegram away cadence', () => {
  let tmp: string;
  let statePath: string;
  let relPath: string;
  let awayPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'away-'));
    statePath = join(tmp, 'proactive-state.json');
    relPath = join(tmp, 'relationship-state.json');
    awayPath = join(tmp, 'away-state.json');
    process.env.CODEBUDDY_COMPANION_PROACTIVE = 'true';
    process.env.CODEBUDDY_COMPANION_AWAY = 'true';
    process.env.CODEBUDDY_COMPANION_AWAY_STATE_FILE = awayPath;
    _resetConductorForTests();
    saveRelationshipState(
      { firstSeenAt: morning - 10 * DAY, lastPresentAt: morning - 3 * DAY, celebratedMilestones: [7] },
      relPath,
    );
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PROACTIVE;
    delete process.env.CODEBUDDY_COMPANION_AWAY;
    delete process.env.CODEBUDDY_COMPANION_AWAY_STATE_FILE;
    delete process.env.CODEBUDDY_COMPANION_AWAY_MAX_PER_DAY;
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('does nothing when proactive is off (byte-identical)', async () => {
    delete process.env.CODEBUDDY_COMPANION_PROACTIVE;
    const tg = vi.fn(async () => true);
    const line = await runProactiveTick({
      now: () => morning,
      present: async () => false,
      telegramAlert: tg,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
    });
    expect(line).toBeNull();
    expect(tg).not.toHaveBeenCalled();
  });

  it('writes a morning thought on Telegram, not locally, without inactivity shaming', async () => {
    const say = vi.fn(async () => true);
    const voice = vi.fn(async () => true);
    const alert = vi.fn(async () => true);
    const line = await runProactiveTick({
      now: () => morning,
      present: async () => false,
      say,
      telegramVoice: voice,
      telegramAlert: alert,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
      rng: () => 0,
    });
    expect(line).toBeTruthy();
    expect(isAwayShameLine(line ?? '')).toBe(false);
    expect(line).not.toMatch(/jours/i);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(say).not.toHaveBeenCalled();
    expect(voice).not.toHaveBeenCalled();
  });

  it('never repeats the same angle, caps at 3, then stays silent', async () => {
    const alert = vi.fn(async () => true);
    const tick = (now: number) =>
      runProactiveTick({
        now: () => now,
        present: async () => false,
        telegramAlert: alert,
        statePath,
        relationshipStatePath: relPath,
        recentHearing: async () => [],
        rng: () => 0,
        cooldownMs: 0,
        conductor: { claim: () => true },
      });
    const a = await tick(morning);
    const a2 = await tick(morning + 60_000);
    const b = await tick(afternoon);
    const c = await tick(evening);
    const d = await tick(evening + 60_000);
    expect(a).toBeTruthy();
    expect(a2).toBeNull();
    expect(b).toBeTruthy();
    expect(c).toBeTruthy();
    expect(d).toBeNull();
    expect(alert).toHaveBeenCalledTimes(3);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('stays silent before 08:30 and after 22:00', async () => {
    const alert = vi.fn(async () => true);
    expect(
      await runProactiveTick({
        now: () => tooEarly,
        present: async () => false,
        telegramAlert: alert,
        statePath,
        relationshipStatePath: relPath,
        recentHearing: async () => [],
      }),
    ).toBeNull();
    expect(
      await runProactiveTick({
        now: () => night,
        present: async () => false,
        telegramAlert: alert,
        statePath,
        relationshipStatePath: relPath,
        recentHearing: async () => [],
      }),
    ).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it('stop / pas maintenant pauses away pushes for 24 h', async () => {
    const alert = vi.fn(async () => true);
    observeInboundForAwayPause('telegram', 'pas maintenant', morning);
    const line = await runProactiveTick({
      now: () => afternoon,
      present: async () => false,
      telegramAlert: alert,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
    });
    expect(line).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    const later = await runProactiveTick({
      now: () => afternoon + DAY + 1000,
      present: async () => false,
      telegramAlert: alert,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
      rng: () => 0,
      cooldownMs: 0,
    });
    expect(later).toBeTruthy();
  });

  it('does not send away Telegram while the camera sees someone', async () => {
    const alert = vi.fn(async () => true);
    const say = vi.fn(async () => true);
    await runProactiveTick({
      now: () => morning,
      present: async () => true,
      say,
      telegramAlert: alert,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
    });
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('C2 recordAwaySend', () => {
  it('appends an angle once', () => {
    const clock = resolveAwayClock(morning);
    const next = recordAwaySend({ sent: [] }, { angle: 'morning', clock, line: 'Bonjour.' });
    expect(next.sent).toEqual(['morning']);
    const again = recordAwaySend(next, { angle: 'morning', clock, line: 'Bonjour.' });
    expect(again.sent).toEqual(['morning']);
  });
});
