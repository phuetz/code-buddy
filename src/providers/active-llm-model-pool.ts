/**
 * Active-LLM model pool — MULTIPLE models per active provider.
 *
 * `buildActiveLlmRegistry` deliberately exposes ONE resolved model per
 * provider (that is what failover and `buddy llm` need). The council's
 * capability routing, however, needs the real choice space: this module
 * expands each ACTIVE provider to its curated catalog models (cloud) or its
 * actually-installed models (local runtimes), inheriting the provider's
 * resolved auth/baseURL/cost. The registry and its consumers are untouched.
 *
 * Dedup rules (deliberate, see council scoreboard):
 *  - LOCAL models dedup on the bare model name across runtimes (Ollama
 *    preferred over LM Studio) — the scoreboard and the council's
 *    `displayName` are keyed on the model name, so seating the same model
 *    twice via two runtimes would merge their learning and confuse the panel.
 *  - CLOUD models dedup on `provider:model` (two providers may legitimately
 *    serve models with different names; identical names across providers are
 *    rare and acceptable — the scoreboard merges them by name).
 *
 * Cost note: expanded models inherit the provider-level approximate
 * $/Mtok (the registry doesn't know per-model prices) — good enough for the
 * council's cheap-bonus (which only needs "is it $0") and display.
 *
 * Kill-switch: `CODEBUDDY_COUNCIL_POOL=registry` reproduces the legacy
 * one-model-per-provider pool.
 *
 * @module providers/active-llm-model-pool
 */

import { buildActiveLlmRegistry, type ActiveLlm } from './active-llm-registry.js';
import { findRuntimeProvider } from './provider-catalog.js';
import { classifyProviderModelEgress, type ModelEgress } from './model-egress.js';

export { classifyModelEgress } from './model-egress.js';

export interface ActiveLlmModelPoolEntry {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  /** Real inference egress, not merely where a CLI process happens to run. */
  egress: ModelEgress;
  costInputUsdPerMtok: number;
}

export interface ListActiveLlmModelPoolOptions {
  env?: Record<string, string | undefined>;
  /** Cap on probed local models per runtime (an Ollama box can have dozens). */
  maxLocalPerProvider?: number;
}

const DEFAULT_MAX_LOCAL_PER_PROVIDER = 10;

function toEntry(c: ActiveLlm): ActiveLlmModelPoolEntry {
  return {
    provider: c.provider,
    model: c.model ?? '',
    ...(c.apiKey ? { apiKey: c.apiKey } : {}),
    ...(c.baseURL ? { baseURL: c.baseURL } : {}),
    egress: classifyProviderModelEgress(c.provider, c.baseURL, c.isLocal),
    costInputUsdPerMtok: c.costInputUsdPerMtok,
  };
}


function modelCost(active: ActiveLlm, model: string): number {
  if (
    active.provider === 'openrouter' &&
    (model === 'openrouter/free' || model.endsWith(':free'))
  ) {
    return 0;
  }
  return active.costInputUsdPerMtok;
}

/** Local runtimes report 'lm-studio' from the capability probe, 'lmstudio' in the catalog. */
function normalizeLocalProvider(provider: string): string {
  return provider === 'lm-studio' ? 'lmstudio' : provider;
}

async function probeSelectableModels(): Promise<Array<{ id: string; provider: string }>> {
  try {
    const { getLocalCapabilities } = await import('../fleet/capability-registry.js');
    const caps = await getLocalCapabilities({});
    return caps.models
      .filter((m) =>
        m.provider === 'ollama' ||
        m.provider === 'lm-studio' ||
        m.provider === 'lemonade' ||
        m.provider === 'agy-cli',
      )
      .map((m) => ({ id: m.id, provider: normalizeLocalProvider(m.provider) }));
  } catch {
    return [];
  }
}

export async function listActiveLlmModelPool(
  opts: ListActiveLlmModelPoolOptions = {},
): Promise<ActiveLlmModelPoolEntry[]> {
  const env = opts.env ?? process.env;
  const registry = await buildActiveLlmRegistry({ env });
  const base = registry.all.filter((c) => c.model);

  const poolMode = (env.CODEBUDDY_COUNCIL_POOL ?? 'full').toLowerCase();
  if (poolMode === 'registry') {
    return base.map(toEntry);
  }

  const cloud = base.filter((c) => !c.isLocal);
  // Ollama first so the bare-name dedup prefers it over LM Studio duplicates.
  const locals = base
    .filter((c) => c.isLocal)
    .sort((a, b) => Number(b.provider === 'ollama') - Number(a.provider === 'ollama'));

  const pool: ActiveLlmModelPoolEntry[] = [];
  const seenCloud = new Set<string>();
  const seenLocalNames = new Set<string>();
  const maxLocal = Math.max(1, opts.maxLocalPerProvider ?? DEFAULT_MAX_LOCAL_PER_PROVIDER);
  const discoveredModels = base.some((c) => c.isLocal || c.provider === 'agy-cli')
    ? await probeSelectableModels()
    : [];

  for (const active of cloud) {
    const defaultEntry = toEntry(active);
    // The registry's resolved default (env override included) always seats first.
    const catalogModels = active.provider === 'agy-cli'
      ? discoveredModels.filter((m) => m.provider === 'agy-cli').map((m) => m.id)
      : (findRuntimeProvider(active.provider)?.models ?? []);
    for (const model of [defaultEntry.model, ...catalogModels]) {
      const key = `${active.provider}:${model}`.toLowerCase();
      if (seenCloud.has(key)) continue;
      seenCloud.add(key);
      pool.push({
        ...defaultEntry,
        model,
        costInputUsdPerMtok: modelCost(active, model),
      });
    }
  }

  for (const active of locals) {
    const defaultEntry = toEntry(active);
    const providerId = normalizeLocalProvider(active.provider);
    let added = 0;
    for (const model of [
      defaultEntry.model,
      ...discoveredModels.filter((m) => m.provider === providerId).map((m) => m.id),
    ]) {
      if (added >= maxLocal) break;
      const name = model.toLowerCase();
      if (seenLocalNames.has(name)) continue;
      seenLocalNames.add(name);
      pool.push({ ...defaultEntry, model });
      added++;
    }
  }

  return pool;
}
