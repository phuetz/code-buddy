/**
 * Opt-in declared provider failover (`CODEBUDDY_PROVIDER_FALLBACK=true`).
 *
 * Default OFF: `CodeBuddyClient` keeps the Hermes env-list path byte-identical.
 * When ON, a `>` chain (or the authenticated registry) is walked after a
 * classified outage, never after a 401, never toward an unauthenticated
 * or (when LOCAL_ONLY) cloud provider.
 */
import { hasCodexCredentials } from './codex-oauth.js';
import {
  resolveRuntimeFallbackProviders,
  type RuntimeFallbackProvider,
  type RuntimeFallbackResolveOptions,
} from './provider-fallback.js';
import { isProviderUnavailable } from './provider-health.js';
import { findRuntimeProvider, resolveProviderFromCatalog } from './provider-catalog.js';

type EnvLike = Record<string, string | undefined>;

export function isTruthyEnv(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

export function isDeclaredProviderFallbackEnabled(env: EnvLike = process.env): boolean {
  return isTruthyEnv(env.CODEBUDDY_PROVIDER_FALLBACK);
}

export function isFailoverLocalOnly(env: EnvLike = process.env): boolean {
  return (
    isTruthyEnv(env.CODEBUDDY_LOCAL_ONLY) ||
    isTruthyEnv(env.CODEBUDDY_PROVIDER_FALLBACK_LOCAL_ONLY) ||
    isTruthyEnv(env.CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY) ||
    isTruthyEnv(env.CODEBUDDY_LLM_LOCAL_ONLY)
  );
}

export interface ParsedChainSpec {
  provider: string;
  model?: string;
  rawSpec: string;
}

/** `chatgpt-oauth>xai>gemini>ollama:qwen3.8-ctx32k:latest` */
export function parseFallbackChain(raw: string | undefined): ParsedChainSpec[] {
  if (!raw || !raw.trim()) return [];
  const parts = raw.split(/>|,/).map((part) => part.trim()).filter(Boolean);
  const specs: ParsedChainSpec[] = [];
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon === -1) {
      specs.push({ provider: part, rawSpec: part });
      continue;
    }
    const provider = part.slice(0, colon).trim();
    const model = part.slice(colon + 1).trim();
    if (!provider) continue;
    specs.push({ provider, model: model || undefined, rawSpec: part });
  }
  return specs;
}

export function isLocalFailoverCandidate(fallback: RuntimeFallbackProvider): boolean {
  if (fallback.provider === 'omniroute') return false;
  return fallback.authMode === 'local';
}

function canonicalId(provider: string | undefined | null): string | undefined {
  if (!provider) return undefined;
  return findRuntimeProvider(provider)?.id ?? provider.trim().toLowerCase();
}

export function resolveDeclaredFallbackProviders(
  options: RuntimeFallbackResolveOptions & { localOnly?: boolean } = {},
): RuntimeFallbackProvider[] {
  const env = options.env ?? process.env;
  const chain = parseFallbackChain(env.CODEBUDDY_FALLBACK_CHAIN);
  const localOnly = options.localOnly ?? isFailoverLocalOnly(env);
  const hasOAuth = options.hasChatGptOAuth ?? hasCodexCredentials();
  const activeBaseURL = options.active?.baseURL?.replace(/\/+$/, '');
  const activeModel = options.active?.model;
  const activeProvider = canonicalId(options.active?.provider);
  const seen = new Set<string>();
  const resolved: RuntimeFallbackProvider[] = [];

  const specs = chain.length > 0
    ? chain
    : resolveRuntimeFallbackProviders({ env, hasChatGptOAuth: hasOAuth, active: options.active })
      .map((item) => ({ provider: item.provider, model: item.model, rawSpec: item.rawSpec }));

  for (const spec of specs) {
    const provider = resolveProviderFromCatalog({
      providerOverride: spec.provider,
      env,
      hasChatGptOAuth: hasOAuth,
      requireConfigured: true,
    });
    if (!provider) continue;
    if (!provider.apiKey) continue;
    const model = spec.model || provider.defaultModel;
    const baseURL = provider.baseURL.replace(/\/+$/, '');
    if (activeBaseURL === baseURL && (activeModel === model || !spec.model)) continue;
    if (activeProvider && canonicalId(provider.provider) === activeProvider && !spec.model) continue;

    const candidate: RuntimeFallbackProvider = {
      ...provider,
      model,
      rawSpec: spec.rawSpec,
      fallbackSource: 'environment',
    };
    if (localOnly && !isLocalFailoverCandidate(candidate)) continue;
    const key = `${provider.provider}:${baseURL}:${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(candidate);
  }

  return resolved;
}

export async function resolveDefaultFailoverProviders(
  options: RuntimeFallbackResolveOptions & { localOnly?: boolean } = {},
): Promise<RuntimeFallbackProvider[]> {
  const declared = resolveDeclaredFallbackProviders(options);
  if (declared.length > 0) return declared;
  try {
    const { buildActiveLlmRegistry } = await import('./active-llm-registry.js');
    const registry = await buildActiveLlmRegistry({
      primary: options.active,
      env: options.env,
      localOnly: options.localOnly ?? isFailoverLocalOnly(options.env ?? process.env),
    });
    return registry.fallbacks.filter((item) => Boolean(item.apiKey));
  } catch {
    return [];
  }
}

export function filterHealthyFallbacks(
  candidates: RuntimeFallbackProvider[],
  nowMs: number = Date.now(),
): RuntimeFallbackProvider[] {
  return candidates.filter((item) => !isProviderUnavailable(item.provider, nowMs));
}
