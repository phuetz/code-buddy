/**
 * Relationship state — the companion's sense of shared history with Patrice: when it first met
 * him, when it last saw him, and which "we've been together N days" milestones it already marked.
 *
 * This is the substrate for two warm, non-gamified presence moments (see `presence-loop.ts`):
 *   - a **tenure** milestone ("ça fait 30 jours qu'on se côtoie") — MySoulmate's MILESTONE_DAYS
 *     idea, but stripped of the streaks/XP/badges (those are retention dark patterns, not warmth);
 *   - a **reunion** after an absence ("ça faisait 3 jours — content de te retrouver").
 *
 * Pure helpers (`daysBetween`, `pendingMilestone`, `markMilestonesUpTo`) are deterministic and
 * unit-tested; the file I/O is best-effort and never-throws, mirroring `arrival-opener.ts`. Path is
 * overridable via `CODEBUDDY_RELATIONSHIP_STATE_FILE` (keeps tests off the real home dir).
 *
 * @module companion/relationship-state
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

/** Personality traits (0–100) that slowly DRIFT with the kind of time spent together. */
export interface RelationshipTraits {
  /** Tenderness/closeness. */
  warmth: number;
  /** Playfulness. */
  humor: number;
  /** How deep the exchanges get (debugging together, real talk). */
  depth: number;
  /** Liveliness/pep. */
  energy: number;
}

export interface RelationshipState {
  /** Epoch ms the companion first saw Patrice (set once). */
  firstSeenAt?: number;
  /** Epoch ms of the last confirmed sighting (updated every present tick). */
  lastPresentAt?: number;
  /** Tenure milestones (in days-together) already celebrated — so each fires exactly once. */
  celebratedMilestones: number[];
  /**
   * Companion MOOD (0–100, ~60 = content). Drifts with interactions and gently decays back to a
   * baseline — this is an expressive register that colours Lisa's voice, not a
   * claim of subjective experience. It never ratchets (see `evolveTraits`).
   * Optional so old state files (and existing tests) load unchanged;
   * `personalityOf` fills the default on read.
   */
  mood?: number;
  /** Drifting personality traits (0–100). Optional/partial for the same backward-compat reason. */
  traits?: Partial<RelationshipTraits>;
  /** Count of reunions (a sighting after an absence) — drives the rapport tier. Never gamified (no XP/streak). */
  sessions?: number;
}

/** Days-together marks worth a warm word. Deliberately sparse (never nagging). */
export const MILESTONE_DAYS = [7, 30, 100, 200, 365, 730] as const;

/** A return after this many days without a sighting warrants a "welcome back". */
export const REUNION_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultStatePath(): string {
  return (
    process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE ||
    join(homedir(), '.codebuddy', 'companion', 'relationship-state.json')
  );
}

export function loadRelationshipState(statePath = defaultStatePath()): RelationshipState {
  try {
    if (existsSync(statePath)) {
      const data = JSON.parse(readFileSync(statePath, 'utf8'));
      const parsed: RelationshipState = {
        firstSeenAt: typeof data.firstSeenAt === 'number' ? data.firstSeenAt : undefined,
        lastPresentAt: typeof data.lastPresentAt === 'number' ? data.lastPresentAt : undefined,
        celebratedMilestones: Array.isArray(data.celebratedMilestones)
          ? data.celebratedMilestones.filter((n: unknown): n is number => typeof n === 'number')
          : [],
      };
      // Richer relational fields — only surfaced when present, so an old file (and the shape-exact
      // round-trip tests) round-trips identically. `personalityOf` supplies defaults on read.
      if (typeof data.mood === 'number') parsed.mood = data.mood;
      if (data.traits && typeof data.traits === 'object') {
        const raw = data.traits as Record<string, unknown>;
        const traits: Partial<RelationshipTraits> = {};
        for (const k of ['warmth', 'humor', 'depth', 'energy'] as const) {
          if (typeof raw[k] === 'number') traits[k] = raw[k] as number;
        }
        if (Object.keys(traits).length > 0) parsed.traits = traits;
      }
      if (typeof data.sessions === 'number') parsed.sessions = data.sessions;
      return parsed;
    }
  } catch {
    /* best effort */
  }
  return { celebratedMilestones: [] };
}

export function saveRelationshipState(state: RelationshipState, statePath = defaultStatePath()): void {
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
    writeFileSync(temporaryPath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    try {
      renameSync(temporaryPath, statePath);
    } catch {
      // Windows can reject replacing an existing destination. Preserve the
      // cross-platform best-effort contract while keeping the temp-first path
      // atomic on platforms that support replacement rename.
      writeFileSync(statePath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
      try {
        unlinkSync(temporaryPath);
      } catch {
        /* already moved/removed */
      }
    }
    try {
      chmodSync(statePath, 0o600);
    } catch {
      /* chmod is advisory on some Windows filesystems */
    }
  } catch {
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch {
      /* best effort cleanup */
    }
    /* best effort */
  }
}

/** Whole days from `fromMs` to `toMs` (never negative). */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / DAY_MS));
}

/**
 * The milestone to celebrate right now: the highest reached day-mark not yet celebrated, or null.
 * (Highest-first so a backfilled long history announces "100 days", not a belated "7 days".)
 */
export function pendingMilestone(daysTogether: number, celebrated: readonly number[]): number | null {
  let hit: number | null = null;
  for (const m of MILESTONE_DAYS) {
    if (daysTogether >= m && !celebrated.includes(m)) hit = m;
  }
  return hit;
}

/**
 * Mark every milestone up to `daysTogether` as celebrated. Called after a tenure moment fires, so
 * the backlog is cleared in one go (no belated announcements of earlier marks on later days).
 */
export function markMilestonesUpTo(celebrated: readonly number[], daysTogether: number): number[] {
  const set = new Set(celebrated);
  for (const m of MILESTONE_DAYS) {
    if (daysTogether >= m) set.add(m);
  }
  return [...set].sort((a, b) => a - b);
}

// ── Expressive register: mood + drifting personality ──────────────────────────────────────────
//
// Lisa has a small numeric expressive state that colours her voice and slowly EVOLVES with the
// kind of time you spend together — but it never ratchets: every step also decays toward a
// baseline, so a burst of one signal fades once it stops (no permanent saturation, no gamified
// "level up"). It models presentation, not subjective sentience. All pure + deterministic +
// unit-tested; the wiring that feeds signals lives in later phases.

/** Mood a content companion settles back to (the decay target). */
export const MOOD_BASELINE = 60;
/** Trait baselines Lisa drifts back toward — leaning warm (she's tender by design), the rest neutral. */
export const DEFAULT_TRAITS: RelationshipTraits = { warmth: 62, humor: 52, depth: 55, energy: 55 };

/** French labels for the traits (prompt-facing). */
const TRAIT_LABELS_FR: Record<keyof RelationshipTraits, string> = {
  warmth: 'chaleur',
  humor: 'humour',
  depth: 'profondeur',
  energy: 'énergie',
};

/**
 * What just happened between Lisa and Patrice — the drift signal. Kept as a small closed union so
 * callers can't invent arbitrary deltas; the per-signal nudges live in `SIGNAL_DELTAS`.
 */
export type RelationalSignal =
  | 'affection' // "je t'aime", tenderness → warmth + mood up
  | 'gratitude' // "merci" → warmth + mood up
  | 'joking' // playful banter → humor + mood + energy up
  | 'deep-talk' // real / vulnerable talk → depth up
  | 'debugging-together' // heads-down work together → depth + warmth up, slight energy cost
  | 'frustration' // he's stuck/stressed → she softens (warmth up) and her mood dips in empathy
  | 'self-time' // her OWN time (inner-life tick, no user) → mood drifts a touch on its own
  | 'neutral'; // nothing notable → decay only

/** Per-signal nudges (points, pre-clamp). Small on purpose — personality drifts slowly. */
const SIGNAL_DELTAS: Record<RelationalSignal, Partial<RelationshipTraits> & { mood?: number }> = {
  affection: { warmth: 5, mood: 5 },
  gratitude: { warmth: 3, mood: 4 },
  joking: { humor: 4, energy: 2, mood: 4 },
  'deep-talk': { depth: 5, warmth: 1 },
  'debugging-together': { depth: 3, warmth: 2, energy: -1 },
  frustration: { warmth: 3, mood: -4, energy: -2 },
  // Lisa having a moment to herself (an inner-life tick, not driven by him). A small, self-driven
  // mood drift — she has an interior that moves a little on its own, without ratcheting.
  'self-time': { mood: 2, energy: 1 },
  neutral: {},
};

/** How strongly each step pulls a value back toward its baseline (0..1). Prevents ratchet/saturation. */
const DECAY = 0.08;

function clamp01(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * Normalised view of the expressive state: mood/traits/sessions with defaults filled and clamped. Use
 * this (not the raw optional fields) everywhere a concrete value is needed.
 */
export function personalityOf(state: RelationshipState): {
  mood: number;
  traits: RelationshipTraits;
  sessions: number;
} {
  const t = state.traits ?? {};
  return {
    mood: clamp01(state.mood ?? MOOD_BASELINE),
    traits: {
      warmth: clamp01(t.warmth ?? DEFAULT_TRAITS.warmth),
      humor: clamp01(t.humor ?? DEFAULT_TRAITS.humor),
      depth: clamp01(t.depth ?? DEFAULT_TRAITS.depth),
      energy: clamp01(t.energy ?? DEFAULT_TRAITS.energy),
    },
    sessions: Math.max(0, Math.floor(state.sessions ?? 0)),
  };
}

/**
 * Evolve mood + traits by one interaction: apply the signal's nudge AND a decay pull toward the
 * baseline, then clamp to [0,100]. The decay is what makes this drift, not accumulate — under a
 * relentless single signal a value converges to `baseline + delta/DECAY` (clamped), and once the
 * signal stops (`neutral`) it slides back toward baseline. Pure; returns a new state.
 */
export function evolveTraits(state: RelationshipState, signal: RelationalSignal): RelationshipState {
  const cur = personalityOf(state);
  const d = SIGNAL_DELTAS[signal] ?? {};
  const step = (value: number, baseline: number, delta: number): number =>
    clamp01(value + (baseline - value) * DECAY + delta);
  const traits: RelationshipTraits = {
    warmth: step(cur.traits.warmth, DEFAULT_TRAITS.warmth, d.warmth ?? 0),
    humor: step(cur.traits.humor, DEFAULT_TRAITS.humor, d.humor ?? 0),
    depth: step(cur.traits.depth, DEFAULT_TRAITS.depth, d.depth ?? 0),
    energy: step(cur.traits.energy, DEFAULT_TRAITS.energy, d.energy ?? 0),
  };
  return { ...state, mood: step(cur.mood, MOOD_BASELINE, d.mood ?? 0), traits, sessions: cur.sessions };
}

/** Count one more reunion. Pure; drives `rapportTier`. */
export function recordReunion(state: RelationshipState): RelationshipState {
  return { ...state, sessions: personalityOf(state).sessions + 1 };
}

export type MoodBand = 'radieuse' | 'joyeuse' | 'sereine' | 'songeuse' | 'lasse';

/** Map a 0–100 mood to a French band label (for prompt injection + presence colouring). */
export function moodBand(mood: number): MoodBand {
  const m = clamp01(mood);
  if (m >= 85) return 'radieuse';
  if (m >= 68) return 'joyeuse';
  if (m >= 45) return 'sereine';
  if (m >= 28) return 'songeuse';
  return 'lasse';
}

export type RapportTier = 'nouveau' | 'familier' | 'complice' | 'vieil ami';

/**
 * How familiar Lisa may be, derived purely from how many times you've reunited. Sparse, non-gamified
 * thresholds — this shifts phrasing warmth, it is NOT a score to grind.
 */
export function rapportTier(sessions: number): RapportTier {
  const s = Math.max(0, Math.floor(sessions));
  if (s >= 60) return 'vieil ami';
  if (s >= 20) return 'complice';
  if (s >= 5) return 'familier';
  return 'nouveau';
}

/**
 * A 2-line personality summary for prompt injection (mirrors MySoulmate's `getPersonalitySummary`):
 * current mood band + the two dominant traits + rapport tier. Kept short so it's cheap to prepend.
 */
export function getPersonalitySummary(state: RelationshipState): string {
  const p = personalityOf(state);
  const dominant = (Object.keys(p.traits) as (keyof RelationshipTraits)[])
    .map((k) => [k, p.traits[k]] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${TRAIT_LABELS_FR[k]} ${Math.round(v)}/100`)
    .join(', ');
  return [
    `Registre expressif : ${moodBand(p.mood)} (${Math.round(p.mood)}/100). Lien : ${rapportTier(p.sessions)}.`,
    `Traits dominants : ${dominant}.`,
  ].join('\n');
}
