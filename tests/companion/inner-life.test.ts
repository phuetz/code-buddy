/**
 * Inner life — Lisa's own small interior. The invariants that protect her honesty and her ADN:
 *   - every activity is DIGITALLY authentic (no human-life fantasy: eating, sleeping, going out…);
 *   - a tick drifts her mood a touch on its own (the `self-time` signal) and stores a vignette;
 *   - the vignette only reaches a reply when inner-life is enabled.
 * Pure core + injected seams — no model, no real home dir.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  INNER_LIFE_ACTIVITIES,
  pickInnerLifeActivity,
  runInnerLifeTick,
  isInnerLifeEnabled,
} from '../../src/companion/inner-life.js';
import {
  loadRelationshipState,
  saveRelationshipState,
  personalityOf,
  MOOD_BASELINE,
} from '../../src/companion/relationship-state.js';
import { buildRelationalContext } from '../../src/companion/relational-context.js';

describe('INNER_LIFE_ACTIVITIES — digitally authentic only (honesty invariant)', () => {
  // Human-life verbs Lisa can never truthfully claim (she is digital). If any vignette used these,
  // she'd be lying — the whole point of the adaptation vs MySoulmate.
  const HUMAN_LIFE = /\b(mang|cuisin|dormi|dors|marche|promen|cours|sport|yoga|medit|dessin|jardin|douche|bois|café|resto|dehors|balade|film|series?)\b/i;
  it('has a non-trivial pool', () => {
    expect(INNER_LIFE_ACTIVITIES.length).toBeGreaterThanOrEqual(6);
  });
  for (const a of INNER_LIFE_ACTIVITIES) {
    it(`"${a.id}" is digital, not a human activity`, () => {
      expect(a.line).not.toMatch(HUMAN_LIFE);
      expect(a.line.length).toBeGreaterThan(8);
      expect(a.moodEffect).toBeGreaterThan(0);
    });
  }
});

describe('pickInnerLifeActivity', () => {
  it('is deterministic by index and wraps', () => {
    expect(pickInnerLifeActivity(0)).toBe(INNER_LIFE_ACTIVITIES[0]);
    expect(pickInnerLifeActivity(INNER_LIFE_ACTIVITIES.length)).toBe(INNER_LIFE_ACTIVITIES[0]);
    expect(pickInnerLifeActivity(-1)).toBe(
      INNER_LIFE_ACTIVITIES[INNER_LIFE_ACTIVITIES.length - 1]
    );
  });
});

describe('runInnerLifeTick', () => {
  it('promotes the chosen vignette and drifts mood via the real state file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inner-life-'));
    const statePath = join(dir, 'relationship-state.json');
    try {
      // Seed a below-baseline mood so a self-time drift is observable moving UP toward baseline.
      saveRelationshipState({ celebratedMilestones: [], mood: 40 }, statePath);

      let promoted: string | null = null;
      const activity = await runInnerLifeTick({
        pick: () => INNER_LIFE_ACTIVITIES[2]!,
        promote: async (a) => {
          promoted = a.line;
        },
        relationshipStatePath: statePath,
      });

      expect(activity?.id).toBe(INNER_LIFE_ACTIVITIES[2]!.id);
      expect(promoted).toBe(INNER_LIFE_ACTIVITIES[2]!.line);
      // Mood moved on its own (self-time signal): from 40 toward baseline, strictly up.
      const after = personalityOf(loadRelationshipState(statePath)).mood;
      expect(after).toBeGreaterThan(40);
      expect(after).toBeLessThanOrEqual(MOOD_BASELINE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never throws even when promote fails', async () => {
    const activity = await runInnerLifeTick({
      pick: () => INNER_LIFE_ACTIVITIES[0]!,
      promote: async () => {
        throw new Error('boom');
      },
      driftMood: () => {
        /* skip real I/O */
      },
    });
    expect(activity).toBeNull();
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
