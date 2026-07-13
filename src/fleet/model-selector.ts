/**
 * Latency-aware LLM selector — picks the LLM best suited to a task, with a
 * latency objective for real-time use (the voice loop, where a 16s reply kills
 * the illusion of a companion). It REUSES the council's "which LLM is best"
 * system rather than reinventing it:
 *
 *   - candidate LLMs  ← buildActiveLlmRegistry (cloud / subscription, one model each)
 *                       + getLocalCapabilities (EVERY probed local model — the registry
 *                         collapses each local provider to a single model, which would
 *                         hide qwen2.5:7b vs gemma vs the 27Bs from the ranking)
 *   - capability floor ← council inferStrengths / inferTaskType (drop embed/vision-only)
 *   - learned latency  ← ModelScoreboard.avgLatencyMs (measured on real council runs)
 *   - cold-start       ← size / "fast"-name heuristic until the scoreboard has data
 *
 * Latency-first, but GATED by a capability floor: the globally-fastest model
 * (a 1B vision model) is useless for a French chat, so we pick min-latency
 * AMONG models that clear the floor. Cost is only a tie-break (the user asked
 * for *latency*) — a flat-fee subscription model like grok-3-fast can be both
 * the fastest AND $0-marginal, so we must not exclude it on the registry's
 * nominal $/Mtok. `localOnly` is the privacy escape hatch.
 *
 * Never-throws: any failure → null, and the caller falls back to its own
 * default. Stateless (no singleton) so it stays deterministically testable —
 * inject `candidates` + `scoreboard` to rank without touching the network.
 *
 * @module fleet/model-selector
 */

import type { ModelStrength } from './types.js';
import { getModelScoreboard, type ModelScoreboard } from './model-scoreboard.js';
import { inferStrengths, inferTaskType } from './model-capability-heuristics.js';
import { logger } from '../utils/logger.js';

/** One LLM the selector can choose, normalised across cloud + local sources. */
export interface LlmCandidate {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  /** On-box runtime (Ollama / LM Studio) — eligible under `localOnly`. */
  isLocal: boolean;
  /** Nominal input $/Mtok (0 for local + OAuth subscriptions). Tie-break only. */
  costInputUsdPerMtok: number;
  strengths: ModelStrength[];
}

/** The chosen model, ready to drop into `new CodeBuddyClient(apiKey, model, baseURL)`. */
export interface ModelSelection {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  isLocal: boolean;
  /** Latency (ms) used to rank — measured when available, else heuristic. */
  estLatencyMs: number;
  /** True when `estLatencyMs` came from the scoreboard (measured), false = guessed. */
  measured: boolean;
  /** Human-readable rationale, for logs. */
  reason: string;
}

export interface SelectFastestOptions {
  /** Task type override; else inferred from the task text. */
  taskType?: string;
  /** Only consider on-box ($0, never-leaves-the-machine) models — privacy. */
  localOnly?: boolean;
  /** Only consider $0-nominal models. Default false (a flat-fee cloud model can be fastest). */
  freeOnly?: boolean;
  /** Require reliable structured tool calls (the future spoken-command agent turn). */
  requireToolCalling?: boolean;
  /**
   * Prefer a specific model (case-insensitive substring of its id) when it is
   * among the qualifying candidates — used to pin the council triage model via
   * `CODEBUDDY_COUNCIL_TRIAGE_MODEL`. Falls through to latency ranking when the
   * pin matches nothing active (we can't select a model that isn't there).
   */
  preferModel?: string;
  /** Inject candidates for tests (skips the registry + local probe). */
  candidates?: LlmCandidate[];
  /** Inject a scoreboard for tests. */
  scoreboard?: ModelScoreboard;
  env?: NodeJS.ProcessEnv;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ollamaBaseURL(env: NodeJS.ProcessEnv): string {
  return `${env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/v1`;
}

/**
 * Enumerate every selectable LLM: the active cloud/subscription providers
 * (from the registry) PLUS every probed local model (the registry keeps only
 * the first local model per provider, so we must enumerate locals ourselves).
 */
async function listCandidates(env: NodeJS.ProcessEnv): Promise<LlmCandidate[]> {
  const out: LlmCandidate[] = [];
  const seen = new Set<string>();

  // Cloud / subscription LLMs the user is actually authenticated to.
  try {
    const { buildActiveLlmRegistry } = await import('../providers/active-llm-registry.js');
    const reg = await buildActiveLlmRegistry({ env });
    for (const c of reg.all) {
      if (!c.model) continue;
      const key = c.model.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        provider: c.provider,
        model: c.model,
        ...(c.apiKey ? { apiKey: c.apiKey } : {}),
        ...(c.baseURL ? { baseURL: c.baseURL } : {}),
        isLocal: c.isLocal,
        costInputUsdPerMtok: c.costInputUsdPerMtok,
        strengths: inferStrengths(c.model),
      });
    }
  } catch (err) {
    logger.debug?.(`[model-selector] registry probe skipped: ${msg(err)}`);
  }

  // EVERY local model (the differentiator vs the registry).
  try {
    const { getLocalCapabilities } = await import('./capability-registry.js');
    const caps = await getLocalCapabilities({});
    for (const m of caps.models) {
      if (m.provider !== 'ollama' && m.provider !== 'lm-studio') continue;
      const key = m.id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const isLmStudio = m.provider === 'lm-studio';
      out.push({
        provider: isLmStudio ? 'lmstudio' : 'ollama',
        model: m.id,
        apiKey: env.OLLAMA_API_KEY || 'ollama',
        baseURL: isLmStudio
          ? `${env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234'}/v1`
          : ollamaBaseURL(env),
        isLocal: true,
        costInputUsdPerMtok: 0,
        strengths: m.strengths,
      });
    }
  } catch (err) {
    logger.debug?.(`[model-selector] local probe skipped: ${msg(err)}`);
  }

  return out;
}

/** Models that can't hold a spoken conversation — never pick these for chat. */
function passesChatFloor(c: LlmCandidate): boolean {
  const m = c.model.toLowerCase();
  if (/embed|rerank|\bbge\b|nomic|\be5-|\bgte-/.test(m)) return false; // embeddings / rerankers
  if (/moondream|llava|bakllava/.test(m)) return false; // vision-only, can't carry French chat
  return true;
}

/** Parse a parameter count in billions from an Ollama-style model id (':7b', '24b-instruct'). */
function paramBillions(model: string): number | null {
  const m = model.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/);
  return m ? parseFloat(m[1]!) : null;
}

/**
 * Cold-start latency estimate (ms) when the scoreboard has no data for a model.
 * Tuned to the observed local profile (qwen2.5:7b ≈ 4.2s here) and cloud tiers.
 * It only needs to ORDER candidates correctly, not be exact — the scoreboard
 * supersedes it the moment a real measurement exists.
 */
function heuristicLatencyMs(c: LlmCandidate): number {
  const m = c.model.toLowerCase();
  if (!c.isLocal) {
    if (/fast|flash|mini|nano|haiku|lite|turbo|\bsmall\b/.test(m)) return 3000;
    if (/opus|gpt-5|grok-4|sonnet|-pro\b|ultra|large|\bo1\b|\bo3\b/.test(m)) return 12000;
    return 8000;
  }
  const b = paramBillions(c.model);
  if (b !== null) return Math.round(1000 + b * 500); // 7B→4500, 24B→13000, 35B→18500
  if (c.strengths.includes('fast')) return 4000;
  return 9000;
}

/**
 * Latency learned for a model: prefer this task type, else aggregate across all
 * task types (latency is mostly model-intrinsic, so cross-task data is a fine
 * estimate and gives more signal than one task type alone).
 */
function measuredLatencyMs(
  scoped: ReadonlyMap<string, number>,
  global: ReadonlyMap<string, number>,
  model: string,
): number | null {
  return scoped.get(model) ?? global.get(model) ?? null;
}

/**
 * Pick the lowest-latency LLM that can do the task. Returns null when nothing
 * qualifies (no active LLMs, all filtered out, or any failure) — the caller
 * should fall back to its own default.
 */
export async function selectFastestModel(
  task: string,
  opts: SelectFastestOptions = {},
): Promise<ModelSelection | null> {
  try {
    const env = opts.env ?? process.env;
    const taskType = (opts.taskType || inferTaskType(task)).toLowerCase();
    const sb = opts.scoreboard ?? getModelScoreboard();

    let candidates = opts.candidates ?? (await listCandidates(env));
    candidates = candidates.filter((c) => c.apiKey && passesChatFloor(c));
    if (opts.localOnly) candidates = candidates.filter((c) => c.isLocal);
    if (opts.freeOnly) candidates = candidates.filter((c) => c.costInputUsdPerMtok === 0);
    if (opts.requireToolCalling) {
      candidates = candidates.filter((c) => c.strengths.includes('tool-calling'));
    }
    if (candidates.length === 0) return null;

    const scopedLatencies = new Map(sb.ranking(taskType).map((stat) => [stat.model, stat.avgLatencyMs]));
    const globalLatencies = new Map(sb.ranking().map((stat) => [stat.model, stat.avgLatencyMs]));
    const ranked = candidates
      .map((c) => {
        const measured = measuredLatencyMs(scopedLatencies, globalLatencies, c.model);
        return { c, estLatencyMs: measured ?? heuristicLatencyMs(c), measured: measured !== null };
      })
      .sort(
        (a, b) =>
          a.estLatencyMs - b.estLatencyMs || // 1. fastest
          Number(b.measured) - Number(a.measured) || // 2. trust measured over guessed
          a.c.costInputUsdPerMtok - b.c.costInputUsdPerMtok || // 3. cheaper
          Number(b.c.isLocal) - Number(a.c.isLocal) || // 4. on-box (privacy) when tied
          a.c.model.localeCompare(b.c.model), // 5. stable
      );

    // Honour an explicit pin (CODEBUDDY_COUNCIL_TRIAGE_MODEL) when it matches a
    // qualifying candidate; otherwise fall through to the latency winner.
    const pin = opts.preferModel?.trim().toLowerCase();
    const pinned = pin ? ranked.find((r) => r.c.model.toLowerCase().includes(pin)) : undefined;
    const top = pinned ?? ranked[0]!;
    const src = top.measured ? 'measured' : 'est';
    return {
      provider: top.c.provider,
      model: top.c.model,
      ...(top.c.apiKey ? { apiKey: top.c.apiKey } : {}),
      ...(top.c.baseURL ? { baseURL: top.c.baseURL } : {}),
      isLocal: top.c.isLocal,
      estLatencyMs: top.estLatencyMs,
      measured: top.measured,
      reason: `${taskType} → ${top.c.model} (${src} ${(top.estLatencyMs / 1000).toFixed(1)}s, ${
        top.c.isLocal ? 'local' : top.c.provider
      }, $${top.c.costInputUsdPerMtok}/Mtok)`,
    };
  } catch (err) {
    logger.warn(`[model-selector] selection failed: ${msg(err)}`);
    return null;
  }
}
