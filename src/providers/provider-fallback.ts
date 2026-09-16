import { hasCodexCredentials } from './codex-oauth.js';
import {
  findRuntimeProvider,
  getDirectRuntimeProviderCatalog,
  resolveProviderFromCatalog,
  type RuntimeProviderCatalogEntry,
  type ResolvedRuntimeProvider,
} from './provider-catalog.js';
import { getAuthProfileManager } from '../auth/profile-manager.js';
import type { AuthProfile } from '../auth/profile-manager.js';

type EnvLike = Record<string, string | undefined>;

export type RuntimeFallbackSource = 'environment' | 'auth-profile';

export interface RuntimeAuthProfilePool {
  getHealthyProfiles(): AuthProfile[];
  markFailed(profileId: string, error: string, isBilling?: boolean): void;
  markSuccess(profileId: string): void;
}

export interface RuntimeFallbackProvider extends ResolvedRuntimeProvider {
  model: string;
  rawSpec: string;
  fallbackSource: RuntimeFallbackSource;
  profileId?: string;
  profileManager?: RuntimeAuthProfilePool;
}

export interface RuntimeFallbackResolveOptions {
  env?: EnvLike;
  hasChatGptOAuth?: boolean;
  active?: {
    provider?: string;
    apiKey?: string;
    baseURL?: string;
    model?: string;
  };
}

export interface RuntimeCredentialPoolResolveOptions {
  active?: RuntimeFallbackResolveOptions['active'];
  authProfileManager?: RuntimeAuthProfilePool;
}

interface ParsedFallbackSpec {
  provider: string;
  model?: string;
  rawSpec: string;
}

export function resolveRuntimeFallbackProviders(
  options: RuntimeFallbackResolveOptions = {},
): RuntimeFallbackProvider[] {
  const env = options.env ?? process.env;
  const specs = parseFallbackSpecs(env);
  if (specs.length === 0) return [];

  const hasOAuth = options.hasChatGptOAuth ?? hasCodexCredentials();
  const activeBaseURL = options.active?.baseURL?.replace(/\/+$/, '');
  const activeModel = options.active?.model;
  const seen = new Set<string>();
  const resolved: RuntimeFallbackProvider[] = [];

  for (const spec of specs) {
    const provider = resolveProviderFromCatalog({
      providerOverride: spec.provider,
      env,
      hasChatGptOAuth: hasOAuth,
      requireConfigured: true,
    });
    if (!provider) continue;

    const model = spec.model || provider.defaultModel;
    const baseURL = provider.baseURL.replace(/\/+$/, '');
    if (activeBaseURL === baseURL && activeModel === model) continue;

    const key = `${provider.provider}:${baseURL}:${model}`;
    if (seen.has(key)) continue;
    seen.add(key);

    resolved.push({
      ...provider,
      model,
      rawSpec: spec.rawSpec,
      fallbackSource: 'environment',
    });
  }

  return resolved;
}

export function resolveRuntimeCredentialPoolProviders(
  options: RuntimeCredentialPoolResolveOptions = {},
): RuntimeFallbackProvider[] {
  const manager = options.authProfileManager ?? getAuthProfileManager();

  const activeProvider = canonicalProviderId(
    options.active?.provider ?? inferRuntimeProviderIdFromBaseURL(options.active?.baseURL),
  );
  if (!activeProvider) return [];

  const activeApiKey = options.active?.apiKey;
  const seen = new Set<string>();
  const resolved: RuntimeFallbackProvider[] = [];

  for (const profile of manager.getHealthyProfiles()) {
    const profileProvider = canonicalProviderId(profile.provider);
    if (profileProvider !== activeProvider) continue;

    const provider = resolveProfileProvider(profile);
    if (!provider) continue;

    const model = profile.metadata.model || provider.defaultModel;
    const baseURL = (profile.metadata.baseURL || provider.baseURL).replace(/\/+$/, '');
    const apiKey = profile.credentials.apiKey || profile.credentials.accessToken || provider.apiKey;
    if (!apiKey) continue;
    if (activeApiKey && apiKey === activeApiKey) continue;

    const key = `${provider.provider}:${baseURL}:${model}:${profile.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    resolved.push({
      ...provider,
      apiKey,
      baseURL,
      defaultModel: model,
      model,
      rawSpec: `auth-profile:${profile.id}`,
      fallbackSource: 'auth-profile',
      profileId: profile.id,
      profileManager: manager,
    });
  }

  return resolved;
}

export function recordRuntimeFallbackSuccess(fallback: RuntimeFallbackProvider): void {
  if (fallback.fallbackSource !== 'auth-profile' || !fallback.profileId) return;
  fallback.profileManager?.markSuccess(fallback.profileId);
}

export function recordRuntimeFallbackFailure(fallback: RuntimeFallbackProvider, error: unknown): void {
  if (fallback.fallbackSource !== 'auth-profile' || !fallback.profileId) return;
  fallback.profileManager?.markFailed(
    fallback.profileId,
    error instanceof Error ? error.message : String(error),
    isBillingLikeProviderError(error),
  );
}

function parseFallbackSpecs(env: EnvLike): ParsedFallbackSpec[] {
  const specs: string[] = [];
  const list = env.CODEBUDDY_FALLBACK_PROVIDERS?.trim();
  if (list) {
    specs.push(...list.split(','));
  }

  const singleProvider = env.CODEBUDDY_FALLBACK_PROVIDER?.trim();
  if (singleProvider) {
    const singleModel = env.CODEBUDDY_FALLBACK_MODEL?.trim();
    specs.push(singleModel ? `${singleProvider}:${singleModel}` : singleProvider);
  }

  return specs
    .map(parseFallbackSpec)
    .filter((spec): spec is ParsedFallbackSpec => spec !== null);
}

function parseFallbackSpec(spec: string): ParsedFallbackSpec | null {
  const rawSpec = spec.trim();
  if (!rawSpec) return null;

  const separator = rawSpec.indexOf(':');
  if (separator === -1) {
    return { provider: rawSpec, rawSpec };
  }

  const provider = rawSpec.slice(0, separator).trim();
  const model = rawSpec.slice(separator + 1).trim();
  if (!provider) return null;
  return {
    provider,
    model: model || undefined,
    rawSpec,
  };
}

function resolveProfileProvider(profile: AuthProfile): ResolvedRuntimeProvider | null {
  const entry = findRuntimeProvider(profile.provider);
  if (!entry || entry.runtimeSupport !== 'direct') return null;

  return {
    provider: entry.id,
    label: entry.label,
    apiMode: entry.apiMode,
    authMode: entry.authMode,
    apiKey: profile.credentials.apiKey || profile.credentials.accessToken || entry.apiKeyPlaceholder || '',
    baseURL: profile.metadata.baseURL || entry.defaultBaseURL,
    defaultModel: profile.metadata.model || entry.defaultModel,
    source: 'override',
  };
}

function canonicalProviderId(provider: string | undefined | null): string | undefined {
  if (!provider) return undefined;
  return findRuntimeProvider(provider)?.id ?? provider.trim().toLowerCase();
}

export function inferRuntimeProviderIdFromBaseURL(baseURL: string | undefined): string | undefined {
  if (!baseURL) return undefined;
  const normalized = baseURL.replace(/\/+$/, '').toLowerCase();

  const directCatalog = getDirectRuntimeProviderCatalog();
  const exact = directCatalog.find((entry) => normalizeEntryBaseURL(entry) === normalized);
  if (exact) return exact.id;

  const host = safeHost(normalized);
  if (!host) return undefined;
  return directCatalog.find((entry) => safeHost(normalizeEntryBaseURL(entry)) === host)?.id;
}

function normalizeEntryBaseURL(entry: RuntimeProviderCatalogEntry): string {
  return entry.defaultBaseURL.replace(/\/+$/, '').toLowerCase();
}

function safeHost(value: string): string | undefined {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function isBillingLikeProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(billing|quota|insufficient[_\s-]?credits?|payment|required balance)\b/i.test(message);
}
