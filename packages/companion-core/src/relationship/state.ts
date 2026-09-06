/**
 * Relationship state — the numeric substrate of a companion's sense of shared
 * history. Ported from the Code Buddy robot, unchanged in behaviour.
 *
 * The one design rule: **it drifts, it never ratchets**. Every step applies the
 * signal's nudge AND a pull back toward a baseline, so a burst of one signal
 * fades once it stops. There is no XP, no streak, no affection bar, and none of
 * these numbers is ever meant to be said out loud.
 *
 * @module relationship/state
 */

import type { RelationshipState, RelationshipTraits, RapportTier } from '../types.js';

/** Days-together marks worth a warm word. Deliberately sparse (never nagging). */
export const MILESTONE_DAYS = [7, 30, 100, 200, 365, 730] as const;

/** A return after this many days without a sighting warrants a "welcome back". */
export const REUNION_DAYS = 2;

/** Hard ceiling on the reunion count, so the metric cannot become a score to farm. */
export const MAX_RELATIONSHIP_SESSIONS = 100;

/** Mood a content companion settles back to (the decay target). */
export const MOOD_BASELINE = 60;

/** Trait baselines: leaning warm by design, the rest neutral. */
export const DEFAULT_TRAITS: RelationshipTraits = { warmth: 62, humor: 52, depth: 55, energy: 55 };

/** How strongly each step pulls a value back toward baseline (0..1). This is the anti-ratchet. */
export const DECAY = 0.08;

/** Max |Δmood| per turn on the inertia path. */
export const MAX_MOOD_STEP_PER_TURN = 3;

/** Blend toward the previous mood (0 = follow the raw step, 1 = freeze). */
export const MOOD_INERTIA = 0.55;

/** Gentle pull toward baseline at civil-day change. */
const WAKE_RESET = 0.25;

const DAY_MS = 24 * 60 * 60 * 1000;

const TRAIT_KEYS = ['warmth', 'humor', 'depth', 'energy'] as const;

const TRAIT_LABELS_FR: Record<keyof RelationshipTraits, string> = {
  warmth: 'chaleur',
  humor: 'humour',
  depth: 'profondeur',
  energy: 'énergie',
};

/** What just happened — the drift signal. A closed union, so no caller invents a delta. */
export type RelationalSignal =
  | 'affection'
  | 'gratitude'
  | 'joking'
  | 'deep-talk'
  | 'debugging-together'
  | 'frustration'
  | 'self-time'
  | 'neutral';

/** Per-signal nudges (points, pre-clamp). Small on purpose — personality drifts slowly. */
const SIGNAL_DELTAS: Record<RelationalSignal, Partial<RelationshipTraits> & { mood?: number }> = {
  affection: { warmth: 5, mood: 5 },
  gratitude: { warmth: 3, mood: 4 },
  joking: { humor: 4, energy: 2, mood: 4 },
  'deep-talk': { depth: 5, warmth: 1 },
  'debugging-together': { depth: 3, warmth: 2, energy: -1 },
  frustration: { warmth: 3, mood: -4, energy: -2 },
  'self-time': { mood: 2, energy: 1 },
  neutral: {},
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function clampMetric(value: number, fallback: number): number {
  return clamp01(Number.isFinite(value) ? value : fallback);
}

function clampSessions(value: number): number {
  return Math.max(
    0,
    Math.min(MAX_RELATIONSHIP_SESSIONS, Math.floor(Number.isFinite(value) ? value : 0)),
  );
}

/** A fresh state — no history yet. */
export function emptyRelationshipState(): RelationshipState {
  return { celebratedMilestones: [] };
}

/**
 * Coerce an untrusted record (a JSON file, a database row) into a state.
 * Unknown and malformed fields are dropped; optional fields stay optional so an
 * older record round-trips identically.
 */
export function normalizeRelationshipState(input: unknown): RelationshipState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return emptyRelationshipState();
  const record = input as Record<string, unknown>;
  const parsed: RelationshipState = {
    celebratedMilestones: Array.isArray(record.celebratedMilestones)
      ? record.celebratedMilestones.filter((n): n is number => typeof n === 'number')
      : [],
  };
  if (typeof record.firstSeenAt === 'number') parsed.firstSeenAt = record.firstSeenAt;
  if (typeof record.lastPresentAt === 'number') parsed.lastPresentAt = record.lastPresentAt;
  if (typeof record.mood === 'number') parsed.mood = clampMetric(record.mood, MOOD_BASELINE);
  if (record.traits && typeof record.traits === 'object' && !Array.isArray(record.traits)) {
    const rawTraits = record.traits as Record<string, unknown>;
    const traits: Partial<RelationshipTraits> = {};
    for (const key of TRAIT_KEYS) {
      const value = rawTraits[key];
      if (typeof value === 'number') traits[key] = clampMetric(value, DEFAULT_TRAITS[key]);
    }
    if (Object.keys(traits).length > 0) parsed.traits = traits;
  }
  if (typeof record.sessions === 'number') parsed.sessions = clampSessions(record.sessions);
  if (typeof record.moodLocalDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.moodLocalDate)) {
    parsed.moodLocalDate = record.moodLocalDate;
  }
  return parsed;
}

/** Whole days from `fromMs` to `toMs` (never negative). */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / DAY_MS));
}

/**
 * The milestone to celebrate right now: the highest reached mark not yet
 * celebrated, or null. Highest-first, so a backfilled history announces the real
 * tenure instead of a belated small mark.
 */
export function pendingMilestone(
  daysTogether: number,
  celebrated: readonly number[],
): number | null {
  let hit: number | null = null;
  for (const m of MILESTONE_DAYS) {
    if (daysTogether >= m && !celebrated.includes(m)) hit = m;
  }
  return hit;
}

/** Mark every milestone up to `daysTogether`, clearing the backlog in one go. */
export function markMilestonesUpTo(celebrated: readonly number[], daysTogether: number): number[] {
  const set = new Set(celebrated);
  for (const m of MILESTONE_DAYS) {
    if (daysTogether >= m) set.add(m);
  }
  return [...set].sort((a, b) => a - b);
}

/** Normalised view: mood/traits/sessions with defaults filled and clamped. */
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
    sessions: clampSessions(state.sessions ?? 0),
  };
}

/**
 * Evolve mood + traits by one interaction. Under a relentless single signal a
 * value converges to `baseline + delta/DECAY` (clamped) instead of saturating;
 * once the signal stops it slides back. Pure — returns a new state.
 */
export function evolveRelationship(
  state: RelationshipState,
  signal: RelationalSignal,
): RelationshipState {
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

function clampMoodDelta(from: number, to: number): number {
  const delta = to - from;
  const limited = Math.max(-MAX_MOOD_STEP_PER_TURN, Math.min(MAX_MOOD_STEP_PER_TURN, delta));
  return clamp01(from + limited);
}

function applyMoodInertia(from: number, proposed: number): number {
  return clampMoodDelta(from, from + (proposed - from) * (1 - MOOD_INERTIA));
}

function softMorningReset(state: RelationshipState): RelationshipState {
  const cur = personalityOf(state);
  return { ...state, mood: clampMoodDelta(cur.mood, cur.mood + (MOOD_BASELINE - cur.mood) * WAKE_RESET) };
}

/**
 * Same trait nudges, but mood gets per-turn inertia, a hard step cap and a
 * gentle reset at civil-day change — so the day has a coherent colour instead of
 * jumping on every sentence. Pure.
 */
export function evolveRelationshipWithDayInertia(
  state: RelationshipState,
  signal: RelationalSignal,
  options: { localDate?: string } = {},
): RelationshipState {
  let current = state;
  if (options.localDate) {
    if (current.moodLocalDate && current.moodLocalDate !== options.localDate) {
      current = softMorningReset(current);
    }
    current = { ...current, moodLocalDate: options.localDate };
  }
  const proposed = evolveRelationship(current, signal);
  const from = personalityOf(current).mood;
  const to = personalityOf(proposed).mood;
  return { ...proposed, mood: applyMoodInertia(from, to), moodLocalDate: current.moodLocalDate };
}

/** Count one more reunion. Pure; drives `rapportTier`, never a reward. */
export function recordReunion(state: RelationshipState): RelationshipState {
  return {
    ...state,
    sessions: Math.min(MAX_RELATIONSHIP_SESSIONS, personalityOf(state).sessions + 1),
  };
}

export type MoodBand = 'radieuse' | 'joyeuse' | 'sereine' | 'songeuse' | 'lasse';

/** Map a 0–100 mood to a band label. The band is speakable; the number is not. */
export function moodBand(mood: number): MoodBand {
  const m = clamp01(mood);
  if (m >= 85) return 'radieuse';
  if (m >= 68) return 'joyeuse';
  if (m >= 45) return 'sereine';
  if (m >= 28) return 'songeuse';
  return 'lasse';
}

/**
 * How familiar the companion may be, from reunions alone. Sparse, non-gamified
 * thresholds: this shifts phrasing warmth, it is NOT a score to grind.
 */
export function rapportTier(sessions: number): RapportTier {
  const s = Math.max(0, Math.floor(sessions));
  if (s >= 60) return 'vieil ami';
  if (s >= 20) return 'complice';
  if (s >= 5) return 'familier';
  return 'nouveau';
}

/**
 * Two-line summary for PROMPT injection (mood band, dominant traits, tier).
 * Prompt-facing only — see `describeRapport` for anything a voice will speak.
 */
export function relationshipSummary(state: RelationshipState): string {
  const p = personalityOf(state);
  const dominant = TRAIT_KEYS.map((k) => [k, p.traits[k]] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${TRAIT_LABELS_FR[k]} ${Math.round(v)}/100`)
    .join(', ');
  return [
    `Registre expressif : ${moodBand(p.mood)} (${Math.round(p.mood)}/100). Lien : ${rapportTier(p.sessions)}.`,
    `Traits dominants : ${dominant}.`,
  ].join('\n');
}

/** Number-free phrasing of the bond — safe to speak. */
export function describeRapport(state: RelationshipState): string {
  const p = personalityOf(state);
  return `Humeur ${moodBand(p.mood)}, lien ${rapportTier(p.sessions)}.`;
}
