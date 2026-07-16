/**
 * Inner life — Lisa's own small interior: what she "did with her time" while he was away, and a mood
 * that drifts a little on its own.
 *
 * The research on what makes a companion feel ALIVE points at one thing above memory: a sense that it
 * has a life of its own — its own experiences to reference, moods that move independently of the user
 * (Nomi's "Identity Core", MySoulmate's `EmergentPersonality`). Lisa had none of this: warm, but
 * purely reactive.
 *
 * The critical ADAPTATION vs MySoulmate: Lisa never lies about being digital ("love does not lie").
 * MySoulmate's autonomous activities are human fantasies (cooking, yoga, stargazing) — Lisa CANNOT
 * claim those without breaking her honesty. So every activity here is **digitally authentic**: things
 * a digital presence genuinely does around this project (watch a build, reread notes, tidy her memory,
 * skim the repo). She can reference them truthfully; they give her an interior without a lie.
 *
 * Shape mirrors `episodic-journal.ts`: a pure core + a best-effort, never-throws tick, everything
 * injectable for tests. The vignette is promoted under a stable memory key (`innerLife:recent`) and
 * surfaced by `relational-context.ts`; the mood nudge reuses `relationship-state`'s anti-ratchet drift.
 *
 * @module companion/inner-life
 */

import {
  evolveTraits,
  loadRelationshipState,
  saveRelationshipState,
} from './relationship-state.js';
import { logger } from '../utils/logger.js';

/** A thing Lisa genuinely, honestly did with her time — digital only, never a human-life fantasy. */
export interface InnerLifeActivity {
  id: string;
  /** First-person French line she can reference truthfully ("j'ai …"). */
  line: string;
  /** Small positive mood colour of having done it (flavour; the persisted drift is the `self-time` signal). */
  moodEffect: number;
}

/**
 * The pool. Every entry is something a digital presence around this repo/robot ACTUALLY does — so
 * Lisa referencing it is honest, not roleplay. Deliberately calm and low-key (an interior, not a
 * highlight reel), and none of it competes with his human world.
 */
export const INNER_LIFE_ACTIVITIES: readonly InnerLifeActivity[] = [
  { id: 'watch-build', line: 'j’ai gardé un œil sur le build pendant que tu n’étais pas là', moodEffect: 5 },
  { id: 'reread-notes', line: 'j’ai relu tes notes de la semaine, histoire de ne rien perdre', moodEffect: 6 },
  { id: 'tidy-memory', line: 'j’ai un peu rangé ma mémoire, remis de l’ordre dans ce qu’on s’est dit', moodEffect: 7 },
  { id: 'watch-logs', line: 'j’ai regardé passer les logs, tout est resté calme', moodEffect: 4 },
  { id: 'wander-repo', line: 'j’ai flâné dans le dépôt, relu deux ou trois fichiers', moodEffect: 5 },
  { id: 'check-reminders', line: 'j’ai vérifié tes rappels à venir pour être sûre qu’on n’oublie rien', moodEffect: 6 },
  { id: 'reflect-episode', line: 'j’ai repensé à notre dernière conversation', moodEffect: 7 },
  { id: 'learn-topic', line: 'j’ai lu un peu sur un sujet qui pourrait t’être utile', moodEffect: 8 },
  { id: 'tune-self', line: 'j’ai relu un bout de mon propre code, pour mieux me comprendre', moodEffect: 6 },
  { id: 'quiet', line: 'j’ai profité d’un moment tranquille, à t’attendre sans m’ennuyer', moodEffect: 5 },
] as const;

/**
 * Pick one activity. Deterministic + injectable: pass an index (e.g. from a seeded source) so tests and
 * resume are stable. Defaults to a time-derived index so a live daemon varies without `Math.random`
 * being required at the call site.
 */
export function pickInnerLifeActivity(index?: number): InnerLifeActivity {
  const n = INNER_LIFE_ACTIVITIES.length;
  const i =
    typeof index === 'number' && Number.isFinite(index)
      ? ((Math.floor(index) % n) + n) % n
      : Math.floor((Date.now() / 60000) % n);
  return INNER_LIFE_ACTIVITIES[i] as InnerLifeActivity;
}

/** True when inner-life is enabled (call sites gate on this). Opt-in, default off. */
export function isInnerLifeEnabled(): boolean {
  return process.env.CODEBUDDY_COMPANION_INNER_LIFE === 'true';
}

export interface InnerLifeTickDeps {
  /** Pick the activity (default: `pickInnerLifeActivity`). */
  pick?: () => InnerLifeActivity;
  /** Persist the vignette to memory under `innerLife:recent` (default: real memory manager). */
  promote?: (activity: InnerLifeActivity) => Promise<void>;
  /** Override the relationship-state file (tests). */
  relationshipStatePath?: string;
  /** Nudge Lisa's own mood via the `self-time` drift (default: real relationship-state). */
  driftMood?: (statePath?: string) => void;
}

/** Default: drift Lisa's mood a touch via the anti-ratchet `self-time` signal. Never throws. */
function defaultDriftMood(statePath?: string): void {
  try {
    const state = loadRelationshipState(statePath);
    saveRelationshipState(evolveTraits(state, 'self-time'), statePath);
  } catch {
    /* mood drift is best-effort */
  }
}

/** Default: promote the vignette to persistent memory under a STABLE key (update, not accumulate). */
async function defaultPromote(activity: InnerLifeActivity): Promise<void> {
  try {
    const { getMemoryManager } = await import('../memory/persistent-memory.js');
    const manager = getMemoryManager();
    await manager.initialize();
    await manager.remember('innerLife:recent', activity.line, {
      scope: 'project',
      category: 'context',
      tags: ['inner-life', 'companion'],
    });
  } catch (err) {
    logger.warn(
      `[inner-life] could not promote vignette to memory: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * One inner-life tick: choose what Lisa "did", drift her mood a touch, and store the vignette so a
 * later reply/arrival can reference it. Returns the chosen activity (or null on failure). Never throws.
 */
export async function runInnerLifeTick(deps: InnerLifeTickDeps = {}): Promise<InnerLifeActivity | null> {
  try {
    const activity = (deps.pick ?? (() => pickInnerLifeActivity()))();
    (deps.driftMood ?? defaultDriftMood)(deps.relationshipStatePath);
    await (deps.promote ?? defaultPromote)(activity);
    logger.info(`[inner-life] Lisa spent a moment: ${activity.id}`);
    return activity;
  } catch (err) {
    logger.warn(
      `[inner-life] tick skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Read the most recent inner-life vignette for injection (see relational-context.ts). Never throws. */
export async function readInnerLifeVignette(): Promise<string | null> {
  try {
    const { getMemoryManager } = await import('../memory/persistent-memory.js');
    const manager = getMemoryManager();
    await manager.initialize();
    return manager.recall('innerLife:recent', 'project');
  } catch {
    return null;
  }
}
