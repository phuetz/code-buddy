/**
 * Memory forgetting — Ebbinghaus retention curve with recall reinforcement.
 *
 * retention(t) = exp(−ageDays / stability), where stability grows with every
 * recall: stability = baseStabilityDays × (1 + accessCount). A memory that is
 * never recalled fades below the forget threshold in a few weeks; one the
 * agent actually uses keeps strengthening and survives — the spaced-repetition
 * shape, driven by the accessCount the store already tracks.
 *
 * Pure decision logic only: PersistentMemoryManager owns the recoverable
 * archive-then-delete, sensory/dreaming owns the cadence (sleep consolidates
 * AND prunes). Convergent priority from the MySoulmate mining + 2026 survey
 * (MemoryBank 2305.10250): a companion that never forgets drowns its own
 * char-budgeted memory file.
 */

/** Structural subset of persistent-memory's Memory (no import — keeps this module dependency-free). */
export interface ForgettableMemory {
  key: string;
  value: string;
  category: string;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date;
  accessCount: number;
  tags?: string[];
}

export interface ForgettingConfig {
  /** Stability (days) of a never-recalled memory — retention hits e⁻¹ at this age. */
  baseStabilityDays: number;
  /** Forget when retention falls below this (0..1). */
  retentionThreshold: number;
  /** Grace period: never forget a memory younger than this many days. */
  minAgeDays: number;
  /** Categories that never decay (durable by nature). */
  protectedCategories: ReadonlySet<string>;
  /** A memory carrying one of these tags never decays. */
  protectedTags: ReadonlySet<string>;
}

export const DEFAULT_FORGETTING_CONFIG: ForgettingConfig = {
  baseStabilityDays: 14,
  retentionThreshold: 0.05,
  minAgeDays: 7,
  protectedCategories: new Set(['preferences', 'decisions']),
  protectedTags: new Set(['pinned']),
};

/** Env overrides: CODEBUDDY_MEMORY_FORGET_BASE_DAYS / _THRESHOLD / _MIN_AGE_DAYS. */
export function resolveForgettingConfig(env: NodeJS.ProcessEnv = process.env): ForgettingConfig {
  const num = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const d = DEFAULT_FORGETTING_CONFIG;
  return {
    baseStabilityDays: num(env.CODEBUDDY_MEMORY_FORGET_BASE_DAYS, d.baseStabilityDays),
    // A threshold ≥1 would forget everything on sight — clamp to a sane ceiling.
    retentionThreshold: Math.min(num(env.CODEBUDDY_MEMORY_FORGET_THRESHOLD, d.retentionThreshold), 0.9),
    minAgeDays: num(env.CODEBUDDY_MEMORY_FORGET_MIN_AGE_DAYS, d.minAgeDays),
    protectedCategories: d.protectedCategories,
    protectedTags: d.protectedTags,
  };
}

const DAY_MS = 86_400_000;

export function stabilityDays(accessCount: number, baseStabilityDays: number): number {
  return baseStabilityDays * (1 + Math.max(0, accessCount));
}

export function retentionOf(ageDays: number, accessCount: number, config: ForgettingConfig): number {
  if (ageDays <= 0) return 1;
  return Math.exp(-ageDays / stabilityDays(accessCount, config.baseStabilityDays));
}

export interface ForgetCandidate {
  key: string;
  category: string;
  ageDays: number;
  accessCount: number;
  retention: number;
}

/**
 * Decide which memories have faded below the retention threshold. Age is
 * measured from the last recall (fallback: last update), so reinforcement
 * both restarts the clock AND raises stability.
 */
export function decideForgets(
  memories: Iterable<ForgettableMemory>,
  now: Date,
  config: Partial<ForgettingConfig> = {},
): ForgetCandidate[] {
  const cfg: ForgettingConfig = { ...DEFAULT_FORGETTING_CONFIG, ...config };
  const candidates: ForgetCandidate[] = [];

  for (const memory of memories) {
    if (cfg.protectedCategories.has(memory.category)) continue;
    if (memory.tags?.some((tag) => cfg.protectedTags.has(tag))) continue;

    const anchor = memory.lastAccessedAt ?? memory.updatedAt ?? memory.createdAt;
    const ageDays = (now.getTime() - anchor.getTime()) / DAY_MS;
    if (!Number.isFinite(ageDays) || ageDays < cfg.minAgeDays) continue;

    const retention = retentionOf(ageDays, memory.accessCount, cfg);
    if (retention < cfg.retentionThreshold) {
      candidates.push({
        key: memory.key,
        category: memory.category,
        ageDays,
        accessCount: memory.accessCount,
        retention,
      });
    }
  }

  return candidates;
}
