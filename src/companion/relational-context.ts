/**
 * Relational context — Lisa's felt sense of the person she's talking to, composed into one compact
 * block to prepend to a spoken reply or an arrival opener.
 *
 * This is the "wire, don't rewrite" seam of the interactions refonte: two rich engines were already
 * built but DISCONNECTED from the voice path —
 *   - `user-model.ts` — a privacy-screened, review-gated model of Patrice's working preferences
 *     (accepted observations only; sensitive content is refused at WRITE time, never a dossier);
 *   - `relationship-state.ts` — Lisa's own evolving mood/traits/rapport (Phase 1);
 * plus the live camera `presence` block. None were read by any `sensory`/`companion` surface. This
 * module composes them so a reply can KNOW something about him and REFLECT her own state, instead of
 * reasoning only over the last few raw percepts.
 *
 * Every piece is optional + best-effort: a failing/empty source contributes nothing, and the whole
 * thing never throws (a broken source degrades to a plainer prompt, never a crashed voice loop).
 * The call sites gate the actual injection behind `CODEBUDDY_COMPANION_RELATIONAL` (default off), so
 * turning it on is an explicit choice; this composer itself is env-free and unit-testable.
 *
 * @module companion/relational-context
 */
import { getUserModel } from '../memory/user-model.js';
import { injectPresenceBlock } from '../memory/presence-injector.js';
import { loadRelationshipState, getPersonalitySummary } from './relationship-state.js';
import { loadVoiceGuidance, formatVoiceGuidance } from './voice-guidance.js';
import { readInnerLifeVignette, isInnerLifeEnabled } from './inner-life.js';

export interface RelationalContextOptions {
  cwd?: string;
  /** Include the accepted user-model facts block. Default true. */
  includeFacts?: boolean;
  /** Include Lisa's personality/mood summary. Default true. */
  includePersonality?: boolean;
  /** Include the live camera-presence block. Default true. */
  includePresence?: boolean;
  /** Include the recent-episode block ("what we talked about"). Default true. */
  includeEpisode?: boolean;
  /** Include the learned voice-guidance block ("how to reply better"). Default true. */
  includeGuidance?: boolean;
  /** Include Lisa's own recent inner-life vignette ("what I did"). Default: `isInnerLifeEnabled()`. */
  includeInnerLife?: boolean;
  /** Injectable seams (tests) — each defaults to the real source above. */
  factsBlock?: () => string | null;
  personalitySummary?: () => string;
  presenceBlock?: () => Promise<string>;
  episodeBlock?: () => Promise<string | null>;
  guidanceBlock?: () => string | null;
  innerLifeBlock?: () => Promise<string | null>;
  /** Override the relationship-state file (tests). */
  relationshipStatePath?: string;
}

export const DEFAULT_RELATIONAL_CONTEXT_TTL_MS = 5_000;
export const DEFAULT_RELATIONAL_CONTEXT_COLD_BUDGET_MS = 75;

export interface RelationalContextCacheGetOptions {
  ttlMs?: number;
  coldBudgetMs?: number;
}

interface RelationalContextCacheEntry {
  value: string;
  at: number;
}

interface RelationalContextRefresh {
  generation: number;
  promise: Promise<string>;
}

/**
 * Small stale-while-revalidate cache for the latency-sensitive voice path.
 *
 * A warm or stale value is returned immediately while one background refresh updates it.
 * On the very first turn, the caller waits only `coldBudgetMs`; if the richer memory graph
 * needs longer, that turn stays emotionally aware through the local emotion guidance and
 * the completed relational context becomes available to the next turn.
 */
export class RelationalContextCache {
  private entry: RelationalContextCacheEntry | null = null;
  private refresh: RelationalContextRefresh | null = null;
  private generation = 0;

  constructor(
    private readonly build: () => Promise<string>,
    private readonly now: () => number = () => Date.now()
  ) {}

  async get(options: RelationalContextCacheGetOptions = {}): Promise<string> {
    const ttlMs = normalizeNonNegative(
      options.ttlMs,
      DEFAULT_RELATIONAL_CONTEXT_TTL_MS
    );
    const coldBudgetMs = normalizeNonNegative(
      options.coldBudgetMs,
      DEFAULT_RELATIONAL_CONTEXT_COLD_BUDGET_MS
    );
    const entry = this.entry;
    if (entry && this.now() - entry.at <= ttlMs) return entry.value;

    const refresh = this.startRefresh();
    // Stale-while-revalidate: relationship context should never block an ordinary warm turn.
    if (entry) return entry.value;
    if (coldBudgetMs === 0) return '';

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        refresh.promise,
        new Promise<string>((resolve) => {
          timeout = setTimeout(() => resolve(''), coldBudgetMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /** Start/return the single in-flight refresh without applying a cold-start deadline. */
  refreshNow(): Promise<string> {
    return this.startRefresh().promise;
  }

  invalidate(): void {
    this.generation += 1;
    // Keep the last value as an immediate fallback, but make it stale so the next read
    // refreshes it. This avoids turning every mood change into another cold-start wait.
    if (this.entry) this.entry = { ...this.entry, at: Number.NEGATIVE_INFINITY };
    // The old work may still finish, but its generation cannot repopulate this cache.
    this.refresh = null;
  }

  private startRefresh(): RelationalContextRefresh {
    if (this.refresh) return this.refresh;
    const generation = this.generation;
    const current: RelationalContextRefresh = {
      generation,
      promise: Promise.resolve(''),
    };
    current.promise = (async () => {
      try {
        const value = (await this.build()).trim();
        if (generation === this.generation) {
          this.entry = { value, at: this.now() };
        }
        return value;
      } catch {
        return '';
      } finally {
        if (this.refresh === current) this.refresh = null;
      }
    })();
    this.refresh = current;
    return current;
  }
}

function normalizeNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envNonNegative(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return normalizeNonNegative(Number(raw), fallback);
}

/** Read the consolidated recent conversation episode from persistent memory (see episodic-journal.ts). */
async function defaultReadEpisode(): Promise<string | null> {
  try {
    const { getMemoryManager } = await import('../memory/persistent-memory.js');
    const manager = getMemoryManager();
    await manager.initialize();
    return manager.recall('episode:recent', 'project');
  } catch {
    return null;
  }
}

/**
 * Compose the relational context string. Returns '' when nothing useful is available (caller can
 * splice unconditionally). Order: what she knows about him → what they talked about recently → her
 * own state → who's present now.
 */
export async function buildRelationalContext(
  options: RelationalContextOptions = {}
): Promise<string> {
  // Every source is independent. Start them together, then preserve the deliberate prompt
  // order when joining their results. One slow memory/presence source now costs max(source),
  // not the sum of all asynchronous sources.
  const facts = Promise.resolve().then(() => {
    if (options.includeFacts === false) return '';
    try {
      const value = options.factsBlock
        ? options.factsBlock()
        : getUserModel(options.cwd ?? process.cwd()).summarize();
      return value?.trim() ?? '';
    } catch {
      return '';
    }
  });
  const guidance = Promise.resolve().then(() => {
    if (options.includeGuidance === false) return '';
    try {
      const value = options.guidanceBlock
        ? options.guidanceBlock()
        : formatVoiceGuidance(loadVoiceGuidance());
      return value?.trim() ?? '';
    } catch {
      return '';
    }
  });
  const episode = Promise.resolve().then(async () => {
    if (options.includeEpisode === false) return '';
    try {
      const value = options.episodeBlock
        ? await options.episodeBlock()
        : await defaultReadEpisode();
      return value?.trim() ? `<recent_episode>\n${value.trim()}\n</recent_episode>` : '';
    } catch {
      return '';
    }
  });
  const innerLife = Promise.resolve().then(async () => {
    // Own opt-in (default off): only surfaced when inner-life is enabled, so a disabled companion
    // never references a life it isn't living. Tests pass `includeInnerLife` + `innerLifeBlock`.
    if ((options.includeInnerLife ?? isInnerLifeEnabled()) === false) return '';
    try {
      const value = options.innerLifeBlock
        ? await options.innerLifeBlock()
        : await readInnerLifeVignette();
      return value?.trim() ? `<lisa_activite>\n${value.trim()}\n</lisa_activite>` : '';
    } catch {
      return '';
    }
  });
  const personality = Promise.resolve().then(() => {
    if (options.includePersonality === false) return '';
    try {
      const value = options.personalitySummary
        ? options.personalitySummary()
        : getPersonalitySummary(loadRelationshipState(options.relationshipStatePath));
      return value.trim() ? `<lisa_state>\n${value.trim()}\n</lisa_state>` : '';
    } catch {
      return '';
    }
  });
  const presence = Promise.resolve().then(async () => {
    if (options.includePresence === false) return '';
    try {
      const value = options.presenceBlock
        ? await options.presenceBlock()
        : await injectPresenceBlock();
      return value.trim();
    } catch {
      return '';
    }
  });

  return (await Promise.all([facts, guidance, episode, innerLife, personality, presence]))
    .filter(Boolean)
    .join('\n\n');
}

const voiceRelationalContextCache = new RelationalContextCache(() => buildRelationalContext());

/** Latency-bounded relational context for spoken turns. */
export function getVoiceRelationalContext(): Promise<string> {
  return voiceRelationalContextCache.get({
    ttlMs: envNonNegative(
      'CODEBUDDY_COMPANION_RELATIONAL_TTL_MS',
      DEFAULT_RELATIONAL_CONTEXT_TTL_MS
    ),
    coldBudgetMs: envNonNegative(
      'CODEBUDDY_COMPANION_RELATIONAL_BUDGET_MS',
      DEFAULT_RELATIONAL_CONTEXT_COLD_BUDGET_MS
    ),
  });
}

/** Warm the relational graph at daemon startup without putting it on a user turn. */
export function prewarmVoiceRelationalContext(): Promise<string> {
  return voiceRelationalContextCache.refreshNow();
}

/** Call after mood/traits or accepted relationship inputs change. */
export function invalidateVoiceRelationalContext(): void {
  voiceRelationalContextCache.invalidate();
}

/** True when the relational-context injection is enabled (call sites gate on this). */
export function isRelationalContextEnabled(): boolean {
  return process.env.CODEBUDDY_COMPANION_RELATIONAL === 'true';
}
