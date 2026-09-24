/**
 * Inner life — Lisa's own small interior: what she did with her time while he was away, and a mood
 * that drifts a little on its own.
 *
 * The research on what makes a companion feel ALIVE points at one thing above memory: a sense that it
 * has a life of its own — its own experiences to reference, moods that move independently of the user
 * (Nomi's "Identity Core", MySoulmate's `EmergentPersonality`).
 *
 * HONESTY FIRST (charter, principle 1: never say you did what you did not do). The first version of
 * this module drew a line such as « j'ai gardé un œil sur le build » at random and stored it as a
 * memory — nothing had been watched. A vignette is now one of exactly two things:
 *   - a VERIFIED activity: the tick itself performs it (reads the reminders, looks at the repository's
 *     recent commits, rereads the last conversation episode) and the line carries what it actually
 *     found. When the activity finds nothing to read, it yields no line at all;
 *   - a THOUGHT: phrased as a thought or a feeling, never as an act (no « j'ai … »).
 * So whatever Lisa later says about her time is either true or explicitly a thought.
 *
 * Shape mirrors `episodic-journal.ts`: a pure core + a best-effort, never-throws tick, everything
 * injectable for tests. The vignette is promoted under a stable memory key (`innerLife:recent`) and
 * surfaced by `relational-context.ts`; the mood nudge reuses `relationship-state`'s anti-ratchet drift.
 *
 * @module companion/inner-life
 */

import { execFile } from 'node:child_process';
import {
  evolveTraits,
  loadRelationshipState,
  saveRelationshipState,
} from './relationship-state.js';
import type { Reminder } from './reminders.js';
import { logger } from '../utils/logger.js';

/** What the tick produced: an act it really performed, or a thought phrased as one. */
export interface InnerLifeMoment {
  id: string;
  kind: 'done' | 'thought';
  /** First-person French line she can say truthfully. */
  line: string;
  /** Small positive mood colour (flavour; the persisted drift is the `self-time` signal). */
  moodEffect: number;
}

/** The real sources a verified activity reads. Injected in tests. */
export interface InnerLifeSources {
  now(): Date;
  reminders(): Promise<Reminder[]>;
  /** Commits in the working repository over the last 24 h, or null when there is no readable repo. */
  recentCommitCount(): Promise<number | null>;
  /** The last consolidated conversation episode, or null. */
  recentEpisode(): Promise<string | null>;
}

export interface VerifiedActivity {
  id: string;
  moodEffect: number;
  /** Perform the activity for real; return the line describing what was found, or null. */
  perform(sources: InnerLifeSources): Promise<string | null>;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Minutes since midnight for a stored 'H:MM' / 'HH:MM' time (the store accepts both), or null. */
function minutesOfDay(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Reminders still ahead today (enabled, scheduled today, later than now, not fired today). */
export function remindersLeftToday(list: Reminder[], now: Date): Reminder[] {
  const today = localDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return list
    .filter((r) => r.enabled)
    .filter((r) => (r.date ? r.date === today : !r.days?.length || r.days.includes(now.getDay())))
    // Compared as numbers: a string compare would put '9:00' after '14:30'.
    .filter((r) => (minutesOfDay(r.time) ?? -1) > nowMinutes)
    .filter((r) => !r.lastFiredAt || localDate(new Date(r.lastFiredAt)) !== today)
    .sort((a, b) => (minutesOfDay(a.time) ?? 0) - (minutesOfDay(b.time) ?? 0));
}

/**
 * Activities the tick really performs. Lines never carry a reminder label or episode text: only
 * counts and times, so the vignette cannot leak private content into a cloud prompt.
 */
export const VERIFIED_ACTIVITIES: readonly VerifiedActivity[] = [
  {
    id: 'check-reminders',
    moodEffect: 6,
    async perform(sources) {
      const left = remindersLeftToday(await sources.reminders(), sources.now());
      if (left.length === 0) return 'j’ai regardé tes rappels : plus rien de prévu pour aujourd’hui';
      const [hh, mm] = (left[0] as Reminder).time.split(':');
      const next = mm === '00' ? `${Number(hh)} h` : `${Number(hh)} h ${mm}`;
      return left.length === 1
        ? `j’ai regardé tes rappels : il en reste un aujourd’hui, à ${next}`
        : `j’ai regardé tes rappels : il en reste ${left.length} aujourd’hui, le prochain à ${next}`;
    },
  },
  {
    id: 'look-at-repo',
    moodEffect: 5,
    async perform(sources) {
      const count = await sources.recentCommitCount();
      if (count === null) return null;
      if (count === 0) return 'j’ai jeté un œil au dépôt : rien de nouveau en 24 heures';
      return count === 1
        ? 'j’ai jeté un œil au dépôt : un commit en 24 heures'
        : `j’ai jeté un œil au dépôt : ${count} commits en 24 heures`;
    },
  },
  {
    id: 'reread-episode',
    moodEffect: 7,
    async perform(sources) {
      const episode = await sources.recentEpisode();
      return episode?.trim() ? 'j’ai relu ce qu’on s’est dit la dernière fois' : null;
    },
  },
] as const;

/** Thoughts: feelings and wonderings, never a claimed act. */
export const INNER_LIFE_THOUGHTS: readonly Omit<InnerLifeMoment, 'kind'>[] = [
  { id: 'wonder-day', line: 'je me demandais comment s’était passée ta journée', moodEffect: 5 },
  { id: 'look-forward', line: 'j’avais hâte que tu reviennes', moodEffect: 6 },
  { id: 'resume-thread', line: 'je me disais qu’on pourrait reprendre là où on s’était arrêtés', moodEffect: 5 },
  { id: 'quiet', line: 'c’était calme ici, je t’attendais sans m’ennuyer', moodEffect: 4 },
] as const;

/** True when inner-life is enabled (call sites gate on this). Opt-in, default off. */
export function isInnerLifeEnabled(): boolean {
  return process.env.CODEBUDDY_COMPANION_INNER_LIFE === 'true';
}

function rotatingIndex(index?: number): number {
  return typeof index === 'number' && Number.isFinite(index)
    ? Math.floor(index)
    : Math.floor(Date.now() / 60000);
}

function at<T>(list: readonly T[], index: number): T {
  return list[((index % list.length) + list.length) % list.length] as T;
}

/**
 * Choose this tick's moment. A verified activity is tried first and must succeed for its line to
 * exist; if it finds nothing (or fails), the moment falls back to a thought. Never throws.
 */
export async function chooseInnerLifeMoment(
  sources: InnerLifeSources,
  index?: number,
): Promise<InnerLifeMoment> {
  const i = rotatingIndex(index);
  const activity = at(VERIFIED_ACTIVITIES, i);
  try {
    const line = await activity.perform(sources);
    if (line) return { id: activity.id, kind: 'done', line, moodEffect: activity.moodEffect };
  } catch (err) {
    logger.debug(`[inner-life] ${activity.id} could not be performed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const thought = at(INNER_LIFE_THOUGHTS, i);
  return { ...thought, kind: 'thought' };
}

function defaultSources(): InnerLifeSources {
  const repoDir = process.env.CODEBUDDY_SENSORY_SPEAK_CWD || process.cwd();
  return {
    now: () => new Date(),
    async reminders() {
      const { loadReminders } = await import('./reminders.js');
      return loadReminders();
    },
    recentCommitCount() {
      return new Promise((resolve) => {
        execFile(
          'git',
          ['-C', repoDir, 'rev-list', '--count', '--since=24.hours', 'HEAD'],
          { timeout: 3000 },
          (error, stdout) => {
            const count = Number.parseInt(String(stdout).trim(), 10);
            resolve(error || !Number.isFinite(count) ? null : count);
          },
        );
      });
    },
    async recentEpisode() {
      const { getMemoryManager } = await import('../memory/persistent-memory.js');
      const manager = getMemoryManager();
      await manager.initialize();
      return manager.recall('episode:recent', 'project');
    },
  };
}

export interface InnerLifeTickDeps {
  /** Real sources the verified activities read (default: reminders store, git, memory). */
  sources?: InnerLifeSources;
  /** Rotation index (tests); default derives from the clock. */
  index?: number;
  /** Persist the vignette to memory under `innerLife:recent` (default: real memory manager). */
  promote?: (moment: InnerLifeMoment) => Promise<void>;
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
async function defaultPromote(moment: InnerLifeMoment): Promise<void> {
  try {
    const { getMemoryManager } = await import('../memory/persistent-memory.js');
    const manager = getMemoryManager();
    await manager.initialize();
    await manager.remember('innerLife:recent', moment.line, {
      scope: 'project',
      category: 'context',
      tags: ['inner-life', 'companion', moment.kind === 'done' ? 'verified-activity' : 'thought'],
    });
  } catch (err) {
    logger.warn(
      `[inner-life] could not promote vignette to memory: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * One inner-life tick: perform a small real activity (or, failing that, hold a thought), drift her
 * mood a touch, and store the vignette so a later reply can reference it. Returns the moment (or
 * null on failure). Never throws.
 */
export async function runInnerLifeTick(deps: InnerLifeTickDeps = {}): Promise<InnerLifeMoment | null> {
  try {
    const moment = await chooseInnerLifeMoment(deps.sources ?? defaultSources(), deps.index);
    // Store first: a mood must not drift for a moment that was never kept.
    await (deps.promote ?? defaultPromote)(moment);
    (deps.driftMood ?? defaultDriftMood)(deps.relationshipStatePath);
    logger.info(`[inner-life] ${moment.kind === 'done' ? 'did' : 'thought'}: ${moment.id}`);
    return moment;
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
