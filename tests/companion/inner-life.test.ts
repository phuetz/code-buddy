import { createIsolatedHome } from '../helpers/isolated-home.js';
/**
 * Inner life — Lisa's own small interior. The invariants that protect her honesty and her ADN:
 *   - « j'ai … » only comes out of an activity the tick REALLY performed, carrying what it found;
 *     everything else is a thought, phrased as one (charter: never say you did what you did not do);
 *   - a tick drifts her mood a touch on its own (the `self-time` signal) and stores a vignette;
 *   - the vignette only reaches a reply when inner-life is enabled.
 * Pure core + injected seams — no model, no real home dir.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  INNER_LIFE_THOUGHTS,
  VERIFIED_ACTIVITIES,
  chooseInnerLifeMoment,
  remindersLeftToday,
  runInnerLifeTick,
  isInnerLifeEnabled,
  type InnerLifeSources,
} from '../../src/companion/inner-life.js';
import type { Reminder } from '../../src/companion/reminders.js';
import {
  loadRelationshipState,
  saveRelationshipState,
  personalityOf,
  MOOD_BASELINE,
} from '../../src/companion/relationship-state.js';
import { buildRelationalContext } from '../../src/companion/relational-context.js';

const isolatedHome = createIsolatedHome('inner-life-home-');
beforeAll(() => { isolatedHome.enter(); });
afterAll(async () => {
  const { getMemoryManager, resetMemoryManagerForTests } = await import('../../src/memory/persistent-memory.js');
  try {
    await getMemoryManager().initialize();
  } finally {
    resetMemoryManagerForTests();
    isolatedHome.leave();
  }
});

function sources(overrides: Partial<InnerLifeSources> = {}): InnerLifeSources {
  return {
    now: () => new Date(2026, 8, 24, 14, 30),
    reminders: async () => [],
    recentCommitCount: async () => null,
    recentEpisode: async () => null,
    ...overrides,
  };
}

function reminder(time: string, extra: Partial<Reminder> = {}): Reminder {
  return { id: time, label: 'secret-label', time, enabled: true, createdAt: '2026-09-01T00:00:00Z', ...extra };
}

// A claimed past act in French: « j'ai … » (both apostrophes).
const CLAIMED_ACT = /\bj[’']ai\b/i;
// Human-life verbs Lisa can never truthfully claim (she is digital).
const HUMAN_LIFE = /\b(mang|cuisin|dormi|dors|marche|promen|cours|sport|yoga|medit|dessin|jardin|douche|bois|café|resto|dehors|balade|film|series?)\b/i;

describe('honesty invariant', () => {
  it('a thought never claims an act', () => {
    expect(INNER_LIFE_THOUGHTS.length).toBeGreaterThanOrEqual(3);
    for (const thought of INNER_LIFE_THOUGHTS) {
      expect(thought.line, thought.id).not.toMatch(CLAIMED_ACT);
      expect(thought.line, thought.id).not.toMatch(HUMAN_LIFE);
    }
  });

  it('a claimed act only comes out of an activity that really ran, with what it found', async () => {
    const seen: string[] = [];
    for (let i = 0; i < VERIFIED_ACTIVITIES.length; i++) {
      const moment = await chooseInnerLifeMoment(sources(), i);
      seen.push(moment.kind);
      if (moment.kind === 'thought') expect(moment.line).not.toMatch(CLAIMED_ACT);
    }
    // With nothing to read (no repo, no episode), only the reminders check can honestly say something.
    expect(seen).toEqual(['done', 'thought', 'thought']);
  });
});

describe('verified activities', () => {
  it('check-reminders counts what is really left today and never says the label', async () => {
    const moment = await chooseInnerLifeMoment(sources({
      reminders: async () => [
        reminder('09:00'),
        reminder('18:00'),
        reminder('20:15'),
        reminder('19:00', { enabled: false }),
        reminder('21:00', { date: '2026-09-25' }),
      ],
    }), 0);
    expect(moment).toMatchObject({ id: 'check-reminders', kind: 'done' });
    expect(moment.line).toBe('j’ai regardé tes rappels : il en reste 2 aujourd’hui, le prochain à 18 h');
    expect(moment.line).not.toContain('secret-label');
  });

  it('check-reminders drops one already fired today', () => {
    const now = new Date(2026, 8, 24, 14, 30);
    const fired = reminder('16:00', { lastFiredAt: new Date(2026, 8, 24, 16, 0).toISOString() });
    expect(remindersLeftToday([fired, reminder('17:30')], now).map((r) => r.time)).toEqual(['17:30']);
  });

  it('look-at-repo reports the real commit count, and nothing without a repo', async () => {
    expect((await chooseInnerLifeMoment(sources({ recentCommitCount: async () => 7 }), 1)).line)
      .toBe('j’ai jeté un œil au dépôt : 7 commits depuis hier');
    expect((await chooseInnerLifeMoment(sources({ recentCommitCount: async () => null }), 1)).kind)
      .toBe('thought');
  });

  it('reread-episode claims a reread only when there is an episode to read', async () => {
    expect((await chooseInnerLifeMoment(sources({ recentEpisode: async () => 'on a parlé du train' }), 2)))
      .toMatchObject({ kind: 'done', line: 'j’ai relu ce qu’on s’est dit la dernière fois' });
    expect((await chooseInnerLifeMoment(sources(), 2)).kind).toBe('thought');
  });

  it('a failing source falls back to a thought instead of throwing', async () => {
    const moment = await chooseInnerLifeMoment(sources({
      reminders: async () => {
        throw new Error('store unreadable');
      },
    }), 0);
    expect(moment.kind).toBe('thought');
  });
});

describe('runInnerLifeTick', () => {
  it('promotes the moment and drifts mood via the real state file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inner-life-'));
    const statePath = join(dir, 'relationship-state.json');
    try {
      // Seed a below-baseline mood so a self-time drift is observable moving UP toward baseline.
      saveRelationshipState({ celebratedMilestones: [], mood: 40 }, statePath);

      let promoted: string | null = null;
      const moment = await runInnerLifeTick({
        sources: sources({ recentCommitCount: async () => 3 }),
        index: 1,
        promote: async (m) => {
          promoted = m.line;
        },
        relationshipStatePath: statePath,
      });

      expect(moment).toMatchObject({ id: 'look-at-repo', kind: 'done' });
      expect(promoted).toBe('j’ai jeté un œil au dépôt : 3 commits depuis hier');
      // Mood moved on its own (self-time signal): from 40 toward baseline, strictly up.
      const after = personalityOf(loadRelationshipState(statePath)).mood;
      expect(after).toBeGreaterThan(40);
      expect(after).toBeLessThanOrEqual(MOOD_BASELINE);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('never throws even when promote fails', async () => {
    const moment = await runInnerLifeTick({
      sources: sources(),
      index: 0,
      promote: async () => {
        throw new Error('boom');
      },
      driftMood: () => {
        /* skip real I/O */
      },
    });
    expect(moment).toBeNull();
  });
});

describe('relational context surfaces the vignette only when included', () => {
  it('includes <lisa_activite> when includeInnerLife + block provided', async () => {
    const ctx = await buildRelationalContext({
      includeFacts: false,
      includeGuidance: false,
      includeEpisode: false,
      includePersonality: false,
      includePresence: false,
      includeInnerLife: true,
      innerLifeBlock: async () => 'j’ai relu tes notes de la semaine',
    });
    expect(ctx).toContain('<lisa_activite>');
    expect(ctx).toContain('relu tes notes');
  });

  it('omits the vignette when includeInnerLife is false', async () => {
    const ctx = await buildRelationalContext({
      includeFacts: false,
      includeGuidance: false,
      includeEpisode: false,
      includePersonality: false,
      includePresence: false,
      includeInnerLife: false,
      innerLifeBlock: async () => 'j’ai relu tes notes',
    });
    expect(ctx).not.toContain('lisa_activite');
  });
});

describe('isInnerLifeEnabled', () => {
  it('reflects the env flag', () => {
    const prev = process.env.CODEBUDDY_COMPANION_INNER_LIFE;
    try {
      process.env.CODEBUDDY_COMPANION_INNER_LIFE = 'true';
      expect(isInnerLifeEnabled()).toBe(true);
      process.env.CODEBUDDY_COMPANION_INNER_LIFE = 'false';
      expect(isInnerLifeEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CODEBUDDY_COMPANION_INNER_LIFE;
      else process.env.CODEBUDDY_COMPANION_INNER_LIFE = prev;
    }
  });
});
