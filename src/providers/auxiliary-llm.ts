/**
 * Résolution du fournisseur des appels LLM auxiliaires
 * (leçons, mémoire, consolidation, classification, juge de rôle, etc.).
 *
 * Ordre :
 *  1. Réglage explicite du rôle, sinon réglage générique
 *     `CODEBUDDY_AUXILIARY_<ROLE>_PROVIDER|MODEL|BASE_URL|API_KEY`
 *     (alias `AUXILIARY_*`). Un nom de fournisseur inconnu ou non configuré
 *     échoue fermé : on ne retombe pas sur un autre compte connecté.
 *  2. Route publiée par la session (`setSessionLlmRoute`) : même clé, même
 *     modèle, même URL que le tour en cours.
 *  3. Détection ambiante (`detectProviderFromEnv`), uniquement si
 *     `allowAmbient` n'est pas faux. Un login ChatGPT peut donc encore servir
 *     quand c'est le seul fournisseur et qu'aucune session n'a été choisie.
 *
 * `CODEBUDDY_LOCAL_ONLY` ou `CODEBUDDY_LLM_LOCAL_ONLY` refuse ensuite toute
 * cible qui n'est pas un runtime local. Un modèle seul (`*_MODEL`) ne change
 * pas le fournisseur : il remplace le modèle de la session ou de l'ambiant.
 * Aucune clé n'est journalisée.
 */

import { CodeBuddyClient } from '../codebuddy/client.js';
import { hasCodexCredentials } from './codex-oauth.js';
import {
  findRuntimeProvider,
  resolveProviderFromCatalog,
  type ResolvedRuntimeProvider,
} from './provider-catalog.js';
import { isTruthyEnv } from './provider-failover-policy.js';
import { getSessionLlmRoute, type SessionLlmRoute } from './session-llm-route.js';
import { detectProviderFromEnv, type DetectedProvider } from '../utils/provider-detector.js';

type EnvLike = Record<string, string | undefined>;

export type AuxiliarySource = 'explicit' | 'session' | 'ambient';

export type AuxiliaryLlmDecision =
  | { status: 'resolved'; source: AuxiliarySource; provider: DetectedProvider }
  | { status: 'blocked' }
  | { status: 'absent' };

export interface ResolveAuxiliaryLlmOptions {
  role?: string;
  env?: EnvLike;
  /** Défaut : true. `false` laisse l'appelant appliquer son propre repli. */
  allowAmbient?: boolean;
  /** Modèle demandé par l'appelant, après le modèle explicite du rôle. */
  model?: string;
}

const LOCAL_PROVIDER_IDS = new Set(['ollama', 'lmstudio', 'lemonade', 'vllm']);

export function isAuxiliaryLocalOnly(env: EnvLike = process.env): boolean {
  return isTruthyEnv(env.CODEBUDDY_LOCAL_ONLY) || isTruthyEnv(env.CODEBUDDY_LLM_LOCAL_ONLY);
}

export function isAuxiliaryLocalEndpoint(
  providerId: string | undefined,
  baseURL: string | undefined,
): boolean {
  const id = (providerId ?? '').trim().toLowerCase();
  if (LOCAL_PROVIDER_IDS.has(id)) return true;
  if (!baseURL) return false;
  try {
    const host = new URL(baseURL).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
  } catch {
    return false;
  }
}

export function resolveAuxiliaryLlm(options: ResolveAuxiliaryLlmOptions = {}): AuxiliaryLlmDecision {
  const env = options.env ?? process.env;
  const allowAmbient = options.allowAmbient !== false;
  const roleConfig = readRoleConfig(options.role, env);
  const hintedModel = roleConfig.model || options.model?.trim() || undefined;
  const explicit = Boolean(roleConfig.provider || roleConfig.model || roleConfig.baseURL || roleConfig.apiKey);

  if (roleConfig.provider) {
    const named = resolveNamedProvider(roleConfig.provider, roleConfig, env);
    if (!named) return { status: 'blocked' };
    return guardLocal(applyOverlay(named, roleConfig, hintedModel), 'explicit', env);
  }

  if (roleConfig.apiKey && roleConfig.baseURL && !getSessionLlmRoute()) {
    const custom: DetectedProvider = {
      provider: 'custom',
      apiKey: roleConfig.apiKey,
      baseURL: stripSlash(roleConfig.baseURL),
      defaultModel: hintedModel || 'custom',
      source: 'override',
      authMode: isAuxiliaryLocalEndpoint('custom', roleConfig.baseURL) ? 'local' : 'api-key',
      apiMode: 'openai-compatible',
    };
    return guardLocal(custom, 'explicit', env);
  }

  const session = getSessionLlmRoute();
  if (session) {
    return guardLocal(applyOverlay(fromSession(session), roleConfig, hintedModel), explicit ? 'explicit' : 'session', env);
  }

  if (!allowAmbient) {
    return explicit ? { status: 'blocked' } : { status: 'absent' };
  }

  const ambient = detectProviderFromEnv();
  if (!ambient) return explicit ? { status: 'blocked' } : { status: 'absent' };
  return guardLocal(applyOverlay(ambient, roleConfig, hintedModel), explicit ? 'explicit' : 'ambient', env);
}

export function createAuxiliaryClient(role: string, modelOverride?: string): CodeBuddyClient | null {
  const decision = resolveAuxiliaryLlm({
    role,
    ...(modelOverride ? { model: modelOverride } : {}),
  });
  return clientFromDecision(decision);
}

export function hasAuxiliaryLlm(role: string): boolean {
  return resolveAuxiliaryLlm({ role }).status === 'resolved';
}

export function clientFromDecision(decision: AuxiliaryLlmDecision): CodeBuddyClient | null {
  if (decision.status !== 'resolved') return null;
  const { apiKey, defaultModel, baseURL } = decision.provider;
  if (!apiKey || !defaultModel || !baseURL) return null;
  return new CodeBuddyClient(apiKey, defaultModel, baseURL, { enableFallbacks: false });
}

/**
 * Choisit le client d'un appel auxiliaire.
 * Un client déjà construit (celui de la session, transmis au flush) ne gagne
 * ni contre un rôle explicite, ni contre `CODEBUDDY_LOCAL_ONLY`.
 * Un double de test sans URL reste utilisable : ce n'est pas un endpoint.
 */
export function selectAuxiliaryClient(
  role: string,
  injected?: CodeBuddyClient | null,
): CodeBuddyClient | null {
  const decision = resolveAuxiliaryLlm({ role });
  if (decision.status === 'blocked') return null;
  if (decision.status === 'resolved' && decision.source === 'explicit') {
    return clientFromDecision(decision);
  }
  if (injected) {
    if (isAuxiliaryLocalOnly() && !injectedClientIsLocal(injected)) return null;
    return injected;
  }
  return clientFromDecision(decision);
}

function injectedClientIsLocal(client: CodeBuddyClient): boolean {
  const read = (client as { getBaseURL?: () => string }).getBaseURL;
  if (typeof read !== 'function') return true;
  try {
    return isAuxiliaryLocalEndpoint(undefined, read.call(client));
  } catch {
    return false;
  }
}

/**
 * Préfère le rôle explicite ou la session. `absent` : l'appelant garde son
 * résolveur historique. `blocked` : ne pas appeler un autre fournisseur.
 */
export function overrideAuxiliaryCommandProvider<T extends {
  apiKey: string;
  baseURL?: string;
  model?: string;
  providerLabel: string;
}>(role: string, fallback: T | null, explicitModel?: string): T | null {
  const decision = resolveAuxiliaryLlm({
    role,
    allowAmbient: false,
    ...(explicitModel ? { model: explicitModel } : {}),
  });
  if (decision.status === 'blocked') return null;
  if (decision.status === 'resolved') {
    return {
      ...fallback,
      apiKey: decision.provider.apiKey,
      baseURL: decision.provider.baseURL,
      model: decision.provider.defaultModel,
      providerLabel: decision.provider.provider,
    } as T;
  }
  if (!fallback) return null;
  if (isAuxiliaryLocalOnly() && !isAuxiliaryLocalEndpoint(fallback.providerLabel, fallback.baseURL)) {
    return null;
  }
  return fallback;
}

export function sessionRouteAsRuntime(route: SessionLlmRoute): ResolvedRuntimeProvider {
  const entry = route.provider ? findRuntimeProvider(route.provider) : undefined;
  const local = isAuxiliaryLocalEndpoint(entry?.id ?? route.provider, route.baseURL);
  const chatgpt = route.baseURL.includes('chatgpt.com/backend-api/codex');
  return {
    provider: entry?.id ?? 'custom',
    label: entry?.label ?? 'session',
    apiMode: entry?.apiMode ?? (chatgpt ? 'chatgpt-responses' : 'openai-compatible'),
    authMode: entry?.authMode ?? (local ? 'local' : 'api-key'),
    apiKey: route.apiKey,
    baseURL: stripSlash(route.baseURL),
    defaultModel: route.model,
    source: 'override',
  };
}

interface RoleConfig {
  provider?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
}

function readRoleConfig(role: string | undefined, env: EnvLike): RoleConfig {
  const token = (role ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const specific = (suffix: string): string[] => token
    ? [`CODEBUDDY_AUXILIARY_${token}_${suffix}`, `AUXILIARY_${token}_${suffix}`]
    : [];
  return {
    ...(readEnv(env, [...specific('PROVIDER'), 'CODEBUDDY_AUXILIARY_PROVIDER', 'AUXILIARY_PROVIDER'])
      ? { provider: readEnv(env, [...specific('PROVIDER'), 'CODEBUDDY_AUXILIARY_PROVIDER', 'AUXILIARY_PROVIDER']) }
      : {}),
    ...(readEnv(env, [...specific('MODEL'), 'CODEBUDDY_AUXILIARY_MODEL', 'AUXILIARY_MODEL'])
      ? { model: readEnv(env, [...specific('MODEL'), 'CODEBUDDY_AUXILIARY_MODEL', 'AUXILIARY_MODEL']) }
      : {}),
    ...(readEnv(env, [...specific('BASE_URL'), 'CODEBUDDY_AUXILIARY_BASE_URL', 'AUXILIARY_BASE_URL'])
      ? { baseURL: readEnv(env, [...specific('BASE_URL'), 'CODEBUDDY_AUXILIARY_BASE_URL', 'AUXILIARY_BASE_URL']) }
      : {}),
    ...(readEnv(env, [...specific('API_KEY'), 'CODEBUDDY_AUXILIARY_API_KEY', 'AUXILIARY_API_KEY'])
      ? { apiKey: readEnv(env, [...specific('API_KEY'), 'CODEBUDDY_AUXILIARY_API_KEY', 'AUXILIARY_API_KEY']) }
      : {}),
  };
}

function resolveNamedProvider(providerName: string, config: RoleConfig, env: EnvLike): DetectedProvider | null {
  const entry = findRuntimeProvider(providerName);
  if (!entry || entry.runtimeSupport !== 'direct') return null;
  const overlay: EnvLike = { ...env };
  if (config.apiKey && entry.apiKeyEnvKeys[0]) overlay[entry.apiKeyEnvKeys[0]] = config.apiKey;
  if (config.baseURL && entry.baseUrlEnvKeys[0]) overlay[entry.baseUrlEnvKeys[0]] = config.baseURL;
  if (config.model && entry.modelEnvKeys[0]) overlay[entry.modelEnvKeys[0]] = config.model;
  const named = providerName.trim().toLowerCase();
  const chatgpt = named === 'chatgpt' || named === 'codex' || named === 'chatgpt-oauth' || named === 'openai-codex';
  const resolved = resolveProviderFromCatalog({
    providerOverride: providerName,
    env: overlay,
    hasChatGptOAuth: chatgpt ? hasCodexCredentials() : false,
    requireConfigured: true,
  });
  if (!resolved) return null;
  return {
    provider: resolved.provider,
    apiKey: resolved.apiKey,
    baseURL: resolved.baseURL,
    defaultModel: resolved.defaultModel,
    apiMode: resolved.apiMode,
    authMode: resolved.authMode,
    source: 'override',
  };
}

function fromSession(route: SessionLlmRoute): DetectedProvider {
  const runtime = sessionRouteAsRuntime(route);
  return {
    provider: runtime.provider,
    apiKey: runtime.apiKey,
    baseURL: runtime.baseURL,
    defaultModel: runtime.defaultModel,
    apiMode: runtime.apiMode,
    authMode: runtime.authMode,
    source: 'override',
  };
}

function applyOverlay(provider: DetectedProvider, config: RoleConfig, model: string | undefined): DetectedProvider {
  return {
    ...provider,
    apiKey: config.apiKey || provider.apiKey,
    baseURL: stripSlash(config.baseURL || provider.baseURL),
    defaultModel: model || provider.defaultModel,
  };
}

function guardLocal(provider: DetectedProvider, source: AuxiliarySource, env: EnvLike): AuxiliaryLlmDecision {
  if (isAuxiliaryLocalOnly(env) && !isAuxiliaryLocalEndpoint(provider.provider, provider.baseURL)) {
    return { status: 'blocked' };
  }
  if (!provider.apiKey || !provider.defaultModel || !provider.baseURL) return { status: 'blocked' };
  return { status: 'resolved', source, provider };
}

function readEnv(env: EnvLike, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function stripSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
