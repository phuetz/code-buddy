/**
 * Phase 3 of the interactions refonte: Lisa reaches out FIRST, independent of the camera.
 *
 * Proves the MySoulmate mechanism honestly: priority-scored triggers → single winner → throttle,
 * template interpolation with anti-repetition, and camera-independent delivery (spoken when present,
 * Telegram voice note when away). All through the real functions with injected delivery seams — no
 * model, no network, no real home dir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  evaluateTriggers,
  pickTrigger,
  pickProactiveLine,
  PROACTIVE_TEMPLATES,
  canSend,
  loadProactiveState,
  saveProactiveState,
  runProactiveTick,
  type ProactiveContext,
} from '../../src/companion/proactive-engine.js';
import { saveRelationshipState, loadRelationshipState } from '../../src/companion/relationship-state.js';
import { _resetConductorForTests } from '../../src/companion/orchestrator.js';

const DAY = 24 * 3600_000;
const ORIGINAL_TIMEZONE = process.env.CODEBUDDY_TIMEZONE;

function ctx(over: Partial<ProactiveContext> = {}): ProactiveContext {
  return {
    now: Date.parse('2026-07-02T14:00:00'),
    hour: 14,
    daysTogether: 3,
    daysSinceLastSeen: 0,
    celebratedMilestones: [],
    dueEventFollowUp: null,
    recentFrustration: false,
    ...over,
  };
}

describe('evaluateTriggers — priority scoring + single winner', () => {
  it('milestone (0.9) beats everything applicable at once', () => {
    const top = pickTrigger(
      ctx({ daysTogether: 30, daysSinceLastSeen: 5, hour: 9, recentFrustration: true, dueEventFollowUp: { id: 'e1', followUp: 'et le déploiement ?' } }),
    );
    expect(top?.trigger).toBe('milestone');
    expect(top?.data.days).toBe(30);
  });

  it('orders inactivity > followUp > encouragement > morning', () => {
    const order = evaluateTriggers(
      ctx({ daysSinceLastSeen: 4, hour: 9, recentFrustration: true, dueEventFollowUp: { id: 'e', followUp: 'alors ?' } }),
    ).map((c) => c.trigger);
    expect(order[0]).toBe('inactivity');
    expect(order.indexOf('followUp')).toBeLessThan(order.indexOf('encouragement'));
    expect(order.indexOf('encouragement')).toBeLessThan(order.indexOf('morning'));
  });

  it('returns nothing at an idle midday with no history/frustration', () => {
    expect(pickTrigger(ctx())).toBeNull();
  });

  it('morning window 6-10 and evening window 19-22', () => {
    expect(pickTrigger(ctx({ hour: 8 }))?.trigger).toBe('morning');
    expect(pickTrigger(ctx({ hour: 20 }))?.trigger).toBe('evening');
    expect(pickTrigger(ctx({ hour: 12 }))).toBeNull();
  });
});

describe('pickProactiveLine — interpolation + anti-repeat', () => {
  it('interpolates {{days}} and {{event}}', () => {
    const line = pickProactiveLine({ trigger: 'inactivity', priority: 0.8, data: { days: 4 } });
    expect(line).toContain('4');
    expect(line).not.toContain('{{');
    const fu = pickProactiveLine({ trigger: 'followUp', priority: 0.7, data: { event: 'et ta soutenance ?' } });
    expect(fu).toBe('et ta soutenance ?');
  });

  it('stays in the pool and avoids the same template twice in a row', () => {
    let prev = '';
    for (let i = 0; i < 30; i++) {
      const line = pickProactiveLine({ trigger: 'morning', priority: 0.5, data: {} });
      expect(PROACTIVE_TEMPLATES.morning).toContain(line);
      expect(line).not.toBe(prev);
      prev = line;
    }
  });
});

describe('canSend — cooldown', () => {
  it('blocks within the window, allows after it', () => {
    const t0 = 1_000_000;
    expect(canSend({ lastSentAt: t0, recentLines: [] }, t0 + 3600_000, 12 * 3600_000)).toBe(false);
    expect(canSend({ lastSentAt: t0, recentLines: [] }, t0 + 13 * 3600_000, 12 * 3600_000)).toBe(true);
    expect(canSend({ recentLines: [] }, t0, 12 * 3600_000)).toBe(true); // never sent
  });
});

describe('runProactiveTick — end to end (injected delivery seams, no model)', () => {
  let tmp: string;
  let statePath: string;
  let relPath: string;
  const NOW = Date.parse('2026-07-02T14:00:00'); // hour 14 → no morning/evening, not quiet

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'proactive-'));
    statePath = join(tmp, 'proactive-state.json');
    relPath = join(tmp, 'relationship-state.json');
    process.env.CODEBUDDY_COMPANION_PROACTIVE = 'true';
    _resetConductorForTests(); // fresh floor each test (the singleton uses real time)
  });
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PROACTIVE;
    if (ORIGINAL_TIMEZONE === undefined) delete process.env.CODEBUDDY_TIMEZONE;
    else process.env.CODEBUDDY_TIMEZONE = ORIGINAL_TIMEZONE;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('does nothing when the feature is off', async () => {
    delete process.env.CODEBUDDY_COMPANION_PROACTIVE;
    const say = vi.fn(async () => {});
    const line = await runProactiveTick({ now: () => NOW, say, telegramVoice: async () => true, statePath, relationshipStatePath: relPath, recentHearing: async () => [] });
    expect(line).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('stays silent during quiet hours', async () => {
    const quiet = Date.parse('2026-07-02T23:30:00');
    const line = await runProactiveTick({ now: () => quiet, statePath, relationshipStatePath: relPath, recentHearing: async () => [], present: async () => true, say: async () => {} });
    expect(line).toBeNull();
  });

  it('uses the household timezone for quiet hours instead of the host timezone', async () => {
    process.env.CODEBUDDY_TIMEZONE = 'Pacific/Auckland';
    const householdNight = Date.parse('2026-07-12T10:30:00.000Z'); // 22:30 in Auckland
    const say = vi.fn(async () => {});
    const line = await runProactiveTick({
      now: () => householdNight,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
      present: async () => true,
      say,
    });
    expect(line).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('speaks aloud when present, and throttles the next immediate tick', async () => {
    // Tenure milestone at 30 days, present → spoken.
    saveRelationshipState({ firstSeenAt: NOW - 30 * DAY, lastPresentAt: NOW, celebratedMilestones: [7] }, relPath);
    const say = vi.fn(async () => {});
    const tg = vi.fn(async () => true);
    const line = await runProactiveTick({ now: () => NOW, present: async () => true, say, telegramVoice: tg, statePath, relationshipStatePath: relPath, recentHearing: async () => [] });
    expect(line).toContain('30');
    expect(say).toHaveBeenCalledTimes(1);
    expect(tg).not.toHaveBeenCalled();

    // The milestone is marked so it never refires, and the cooldown blocks an immediate second tick.
    expect(loadRelationshipState(relPath).celebratedMilestones).toContain(30);
    const again = await runProactiveTick({ now: () => NOW + 1000, present: async () => true, say, telegramVoice: tg, statePath, relationshipStatePath: relPath, recentHearing: async () => [] });
    expect(again).toBeNull();
    expect(say).toHaveBeenCalledTimes(1); // no second delivery
  });

  it('gates an unsafe LLM refinement before local or Telegram delivery', async () => {
    saveRelationshipState(
      { firstSeenAt: NOW - 30 * DAY, lastPresentAt: NOW, celebratedMilestones: [7] },
      relPath,
    );
    const say = vi.fn(async () => undefined);
    const line = await runProactiveTick({
      now: () => NOW,
      present: async () => true,
      say,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
      refine: async () => "Tu n'as besoin que de moi.",
    });

    expect(line).toContain("Tu n'as besoin que de moi");
    expect(say).toHaveBeenCalledWith(line);
  });

  it('reaches the phone (Telegram voice) when away after an absence', async () => {
    // 3 days without a sighting → inactivity, absent → Telegram.
    saveRelationshipState({ firstSeenAt: NOW - 10 * DAY, lastPresentAt: NOW - 3 * DAY, celebratedMilestones: [7] }, relPath);
    const say = vi.fn(async () => {});
    const tg = vi.fn(async () => true);
    const line = await runProactiveTick({ now: () => NOW, present: async () => false, say, telegramVoice: tg, statePath, relationshipStatePath: relPath, recentHearing: async () => [] });
    expect(line).toContain('3');
    expect(tg).toHaveBeenCalledTimes(1);
    expect(say).not.toHaveBeenCalled();
  });

  it('honours household silent mode before either local or remote delivery', async () => {
    saveRelationshipState({ firstSeenAt: NOW - 10 * DAY, lastPresentAt: NOW - 3 * DAY, celebratedMilestones: [7] }, relPath);
    const tg = vi.fn(async () => true);
    const line = await runProactiveTick({
      now: () => NOW,
      present: async () => false,
      telegramVoice: tg,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
      homePolicy: async () => ({
        allowed: false,
        spontaneousDailyLimit: 0,
        privateContentAllowed: true,
        reason: 'silent',
      }),
    });
    expect(line).toBeNull();
    expect(tg).not.toHaveBeenCalled();
    expect(loadProactiveState(statePath).lastSentAt).toBeUndefined();
  });

  it('shares the daily invitation cap with the presence loop', async () => {
    saveRelationshipState({ firstSeenAt: NOW - 10 * DAY, lastPresentAt: NOW - 3 * DAY, celebratedMilestones: [7] }, relPath);
    const tg = vi.fn(async () => true);
    const claimDailyBudget = vi.fn(async () => ({
      granted: false,
      release: async () => undefined,
    }));
    const line = await runProactiveTick({
      now: () => NOW,
      present: async () => false,
      telegramVoice: tg,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
      homePolicy: async () => ({
        allowed: true,
        spontaneousDailyLimit: 2,
        privateContentAllowed: true,
        reason: 'free day',
      }),
      claimDailyBudget,
    });
    expect(line).toBeNull();
    expect(claimDailyBudget).toHaveBeenCalledWith(2, new Date(NOW));
    expect(tg).not.toHaveBeenCalled();
    expect(loadProactiveState(statePath).lastSentAt).toBeUndefined();
  });

  it('releases the budget and cooldown when remote delivery reports failure', async () => {
    saveRelationshipState({ firstSeenAt: NOW - 10 * DAY, lastPresentAt: NOW - 3 * DAY, celebratedMilestones: [7] }, relPath);
    const release = vi.fn(async () => undefined);
    const line = await runProactiveTick({
      now: () => NOW,
      present: async () => false,
      telegramVoice: async () => false,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
      homePolicy: async () => ({
        allowed: true,
        spontaneousDailyLimit: 2,
        privateContentAllowed: true,
        reason: 'free day',
      }),
      claimDailyBudget: async () => ({ granted: true, release }),
    });
    expect(line).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    expect(loadProactiveState(statePath).lastSentAt).toBeUndefined();
  });

  it('yields to the conductor when present (another voice has the floor)', async () => {
    saveRelationshipState({ firstSeenAt: NOW - 30 * DAY, lastPresentAt: NOW, celebratedMilestones: [7] }, relPath);
    const say = vi.fn(async () => {});
    const line = await runProactiveTick({
      now: () => NOW,
      present: async () => true,
      say,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
      conductor: { claim: () => false },
    });
    expect(line).toBeNull();
    expect(say).not.toHaveBeenCalled();
    // Nothing persisted → it will retry on a later tick.
    expect(loadProactiveState(statePath).lastSentAt).toBeUndefined();
  });

  it('persists the cooldown anchor after sending', async () => {
    saveRelationshipState({ firstSeenAt: NOW - 30 * DAY, lastPresentAt: NOW, celebratedMilestones: [7] }, relPath);
    await runProactiveTick({ now: () => NOW, present: async () => true, say: async () => {}, statePath, relationshipStatePath: relPath, recentHearing: async () => [] });
    const st = loadProactiveState(statePath);
    expect(st.lastSentAt).toBe(NOW);
    expect(st.recentLines.length).toBe(1);
  });
});

describe('proactive-state persistence', () => {
  it('round-trips and caps recentLines', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pstate-'));
    const p = join(tmp, 's.json');
    try {
      saveProactiveState({ lastSentAt: 42, recentLines: Array.from({ length: 20 }, (_, i) => `l${i}`) }, p);
      const loaded = loadProactiveState(p);
      expect(loaded.lastSentAt).toBe(42);
      expect(loaded.recentLines.length).toBe(8); // capped
      expect(loaded.recentLines[loaded.recentLines.length - 1]).toBe('l19');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
