/**
 * Active-LLM registry — the set of providers/models the user is actually
 * authenticated to (and that are reachable), used to drive auto-failover and
 * "together" (ensemble) execution.
 *
 * This does NOT add new failover logic: it produces a `RuntimeFallbackProvider[]`
 * that drops straight into `CodeBuddyClient`'s existing `fallbackProviders` slot
 * (see `src/codebuddy/client.ts` `chatWithProviderFallback`). It joins existing
 * resolvers — the provider catalog (`resolveProviderFromCatalog`), the ChatGPT /
 * xAI OAuth credential checks, and the env-configured fallback list — rather than
 * reinventing detection. The primary provider is passed in by the caller (the
 * session bootstrap already resolved it) to avoid a circular import on
 * `getDetectedProvider` in `src/index.ts`.
 */
import {
  getDirectRuntimeProviderCatalog,
  findRuntimeProvider,
  resolveProviderFromCatalog,
  type ResolvedRuntimeProvider,
  type RuntimeProviderCatalogEntry,
} from './provider-catalog.js';
import {
  resolveRuntimeFallbackProviders,
  type RuntimeFallbackProvider,
} from './provider-fallback.js';
import { hasCodexCredentials } from './codex-oauth.js';
import { logger } from '../utils/logger.js';

export type FailoverOrderPolicy = 'resilience' | 'free-first' | 'manual';

export interface ActiveLlm extends RuntimeFallbackProvider {
  /** Local runtime (Ollama / LM Studio) — pushed last under the resilience policy. */
  isLocal: boolean;
  /** Best-effort: cloud-keyed/OAuth providers are assumed reachable; the reactive
   * failover loop is the final arbiter, so this is advisory only. */
  reachable: boolean;
  /** Catalog priority (lower = preferred). */
  priority: number;
  /** Rough $/Mtok input cost for free-first ordering + the `/llm list` display. */
  costInputUsdPerMtok: number;
}

export interface ActiveLlmRegistry {
  /** Canonical id of the detected primary (never appears in `fallbacks`). */
  primaryProvider: string | null;
  /** Other active LLMs, ordered by policy — ready for `fallbackProviders`. */
  fallbacks: ActiveLlm[];
  /** Primary + fallbacks, for the `/llm list` surface. */
  all: ActiveLlm[];
}

export interface BuildActiveLlmRegistryOptions {
  /** The already-resolved session primary (from the index.ts bootstrap). */
  primary?: { provider?: string; apiKey?: string; baseURL?: string; model?: string };
  policy?: FailoverOrderPolicy;
  manualOrder?: string[];
  localOnly?: boolean;
  env?: Record<string, string | undefined>;
  force?: boolean;
}

/** Rough input $/Mtok for ordering + display. 0 for local runtimes and
 * subscription-OAuth backends (no per-token metering). */
const APPROX_COST_USD_PER_MTOK: Record<string, number> = {
  chatgpt: 0,
  'agy-cli': 0,
  ollama: 0,
  lemonade: 0,
  lmstudio: 0,
  'gemini-cli': 0,
  grok: 0.5,
  gemini: 0.3,
  groq: 0.3,
  mistral: 1,
  anthropic: 3,
  openai: 5,
};

function canonicalProviderId(provider: string | undefined | null): string | undefined {
  if (!provider) return undefined;
  return findRuntimeProvider(provider)?.id ?? provider.trim().toLowerCase();
}

/** Local runtimes that actually responded to a probe → their first real
 * installed model (reuses the fleet capability registry's Ollama/LM Studio
 * HTTP probes; `probeOllama` sets `id` to the actual model name). */
async function getReachableRuntimeModels(force?: boolean): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { getLocalCapabilities } = await import('../fleet/capability-registry.js');
    const caps = await getLocalCapabilities({ force });
    for (const m of caps.models) {
      const id = canonicalProviderId(m.provider);
      if (
        (id === 'ollama' || id === 'lmstudio' || id === 'lemonade' || id === 'agy-cli') &&
        !map.has(id)
      ) {
        map.set(id, m.id);
      }
    }
  } catch {
    /* no local runtimes reachable */
  }
  return map;
}

/** Resolve the xAI subscription-login bearer when there's no GROK_API_KEY,
 * mirroring `getDetectedProvider` in src/index.ts. */
async function resolveXaiOAuthProvider(
  entry: RuntimeProviderCatalogEntry,
  env: Record<string, string | undefined>,
): Promise<ResolvedRuntimeProvider | null> {
  try {
    const { hasXaiCredentials, getValidXaiAccessToken } = await import('./xai-oauth.js');
    if (!hasXaiCredentials()) return null;
    const token = await getValidXaiAccessToken();
    if (!token) return null;
    return {
      provider: 'grok',
      label: entry.label,
      apiMode: entry.apiMode,
      authMode: entry.authMode,
      apiKey: token,
      baseURL: 'https://api.x.ai/v1',
      defaultModel: env.GROK_MODEL || 'grok-4-latest',
      source: 'override',
    };
  } catch (err) {
    logger.debug('xAI OAuth resolution skipped in active-llm-registry', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function toActiveLlm(
  resolved: ResolvedRuntimeProvider,
  entry: RuntimeProviderCatalogEntry | undefined,
): ActiveLlm {
  const isLocal = (entry?.authMode ?? resolved.authMode) === 'local';
  const resolvedModel = resolved.defaultModel;
  const isFreeOpenRouterModel =
    resolved.provider === 'openrouter' &&
    (resolvedModel === 'openrouter/free' || resolvedModel.endsWith(':free'));
  return {
    ...resolved,
    model: resolvedModel,
    rawSpec: `active:${resolved.provider}`,
    fallbackSource: 'environment',
    isLocal,
    reachable: true,
    priority: entry?.priority ?? 500,
    costInputUsdPerMtok: isFreeOpenRouterModel
      ? 0
      : APPROX_COST_USD_PER_MTOK[resolved.provider] ?? 1,
  };
}

export function orderFallbacks(
  list: ActiveLlm[],
  policy: FailoverOrderPolicy,
  manualOrder?: string[],
): ActiveLlm[] {
  const sorted = [...list];
  if (policy === 'free-first') {
    sorted.sort(
      (a, b) => a.costInputUsdPerMtok - b.costInputUsdPerMtok || a.priority - b.priority,
    );
  } else if (policy === 'manual' && manualOrder && manualOrder.length > 0) {
    const rank = (p: ActiveLlm): number => {
      const i = manualOrder.findIndex((m) => canonicalProviderId(m) === canonicalProviderId(p.provider));
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    sorted.sort((a, b) => rank(a) - rank(b));
  } else {
    // resilience (default): capable cloud/subscription first (by catalog
    // priority), local runtimes LAST as a free safety net.
    sorted.sort(
      (a, b) => Number(a.isLocal) - Number(b.isLocal) || a.priority - b.priority,
    );
  }
  return sorted;
}

export async function buildActiveLlmRegistry(
  opts: BuildActiveLlmRegistryOptions = {},
): Promise<ActiveLlmRegistry> {
  const env = opts.env ?? process.env;
  const policy = opts.policy ?? 'resilience';
  const hasOAuth = hasCodexCredentials();
  const primaryProvider = canonicalProviderId(opts.primary?.provider) ?? null;

  const catalog = getDirectRuntimeProviderCatalog();
  const reachableRuntimeModels = await getReachableRuntimeModels(opts.force);
  const all: ActiveLlm[] = [];
  const seen = new Set<string>();

  for (const entry of catalog) {
    let resolved = resolveProviderFromCatalog({
      providerOverride: entry.id,
      env,
      hasChatGptOAuth: hasOAuth,
      requireConfigured: true,
    });

    // xAI subscription login (no GROK_API_KEY) — the catalog can't see the
    // OAuth token, so resolve it directly.
    if (!resolved && entry.id === 'grok') {
      resolved = await resolveXaiOAuthProvider(entry, env);
    }
    if (!resolved) continue;

    // Antigravity is represented in the catalog so every provider surface can
    // name it, but it is only active when the CLI probe actually returned a
    // model. This prevents a stale PATH/config entry from occupying a council
    // seat and failing on every deliberation.
    if (entry.id === 'agy-cli') {
      const realModel = reachableRuntimeModels.get('agy-cli');
      if (!realModel) continue;
      resolved = { ...resolved, defaultModel: realModel };
    }

    const isLocal = (entry.authMode ?? resolved.authMode) === 'local';
    if (opts.localOnly && !isLocal) continue;
    // The catalog reports a local provider as "configured" even when it isn't
    // running — only keep locals we actually probed as reachable, and use their
    // real installed model (not the catalog default, which may not be pulled).
    if (isLocal) {
      const realModel = reachableRuntimeModels.get(canonicalProviderId(resolved.provider) ?? '');
      if (!realModel) continue;
      resolved = { ...resolved, defaultModel: realModel };
    }

    const key = `${canonicalProviderId(resolved.provider)}:${resolved.baseURL.replace(/\/+$/, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    all.push(toActiveLlm(resolved, entry));
  }

  // Fallbacks = active set minus the primary provider.
  const fallbacks = all.filter((p) => canonicalProviderId(p.provider) !== primaryProvider);

  // Preserve any explicit env-configured fallbacks (CODEBUDDY_FALLBACK_PROVIDERS)
  // — concat + dedupe so setting the env var never regresses.
  for (const f of resolveRuntimeFallbackProviders({
    env,
    hasChatGptOAuth: hasOAuth,
    active: opts.primary,
  })) {
    const key = `${canonicalProviderId(f.provider)}:${f.baseURL.replace(/\/+$/, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fallbacks.push({
      ...f,
      isLocal: false,
      reachable: true,
      priority: 900,
      costInputUsdPerMtok: APPROX_COST_USD_PER_MTOK[f.provider] ?? 1,
    });
  }

  return {
    primaryProvider,
    fallbacks: orderFallbacks(fallbacks, policy, opts.manualOrder),
    all,
  };
}
