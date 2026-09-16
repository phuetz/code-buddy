/**
 * Guard: never send a model name to a provider that does not serve it.
 *
 * `CODEBUDDY_PEER_MODEL` / `CODEBUDDY_MODEL` are global leftovers that used
 * to leak a ChatGPT id onto Ollama (404 model not found). Validate against
 * the runtime catalog and name-family inference; ignore with a warning.
 */

import { inferProvider } from '../config/resolve-model.js';
import type { ProviderKey } from '../config/model-defaults.js';
import {
  findRuntimeProvider,
  RUNTIME_PROVIDER_CATALOG,
} from '../providers/provider-catalog.js';
import { logger } from '../utils/logger.js';
import type { PeerChatProviderId } from './peer-chat-client-factory.js';

const LOCAL_PROVIDERS = new Set<string>(['ollama', 'lmstudio', 'lemonade', 'vllm']);

/** ChatGPT OAuth and the OpenAI API share the gpt-/o-family. */
const GPT_FAMILY = new Set(['chatgpt', 'chatgpt-oauth', 'openai']);
/** Gemini CLI / API / Antigravity share Gemini names. */
const GEMINI_FAMILY = new Set(['gemini', 'gemini-cli', 'agy-cli']);

export interface CompatibleModelPick {
  model: string;
  ignored: Array<{ key: string; value: string; servedBy: string }>;
}

export function peerProviderToCatalogId(provider: PeerChatProviderId): string {
  if (provider === 'chatgpt-oauth') return 'chatgpt';
  return provider;
}

function inferredKeyMatchesProvider(inferred: ProviderKey, provider: PeerChatProviderId): boolean {
  switch (inferred) {
    case 'openai':
      return GPT_FAMILY.has(provider) || GPT_FAMILY.has(peerProviderToCatalogId(provider));
    case 'xai':
      return provider === 'grok';
    case 'google':
      return GEMINI_FAMILY.has(provider);
    case 'anthropic':
      return provider === 'anthropic';
    case 'mistral':
      return provider === 'mistral' || LOCAL_PROVIDERS.has(provider);
    case 'deepseek':
      return LOCAL_PROVIDERS.has(provider) || provider === 'openrouter';
    case 'ollama':
      return LOCAL_PROVIDERS.has(provider);
    case 'lmstudio':
      return provider === 'lmstudio' || LOCAL_PROVIDERS.has(provider);
    default:
      return false;
  }
}

function catalogOwnersOfModel(model: string): string[] {
  const needle = model.trim().toLowerCase();
  if (!needle) return [];
  const owners: string[] = [];
  for (const entry of RUNTIME_PROVIDER_CATALOG) {
    if (entry.models.some((candidate) => candidate.toLowerCase() === needle)) {
      owners.push(entry.id);
    }
  }
  return owners;
}

function familiesOverlap(ownerId: string, provider: PeerChatProviderId): boolean {
  const catalogId = peerProviderToCatalogId(provider);
  if (ownerId === catalogId || ownerId === provider) return true;
  if (GPT_FAMILY.has(ownerId) && GPT_FAMILY.has(catalogId)) return true;
  if (GEMINI_FAMILY.has(ownerId) && GEMINI_FAMILY.has(provider)) return true;
  if (LOCAL_PROVIDERS.has(ownerId) && LOCAL_PROVIDERS.has(provider)) return true;
  return false;
}

/**
 * True when `model` can reasonably be sent to `provider`.
 * Rejects only on positive evidence that another provider owns the name.
 */
export function isModelCompatibleWithProvider(
  model: string,
  provider: PeerChatProviderId,
): boolean {
  const trimmed = model.trim();
  if (!trimmed) return false;
  const owners = catalogOwnersOfModel(trimmed);
  if (owners.length > 0 && owners.some((owner) => familiesOverlap(owner, provider))) {
    return true;
  }
  const inferred = inferProvider(trimmed);
  if (inferred && inferredKeyMatchesProvider(inferred, provider)) {
    return true;
  }
  if (owners.length > 0 && !owners.some((owner) => familiesOverlap(owner, provider))) {
    return false;
  }
  if (inferred && !inferredKeyMatchesProvider(inferred, provider)) {
    return false;
  }
  // Unlisted, uninferred names: local runtimes accept arbitrary tags; cloud
  // custom deployments may too. No evidence of a foreign owner → keep.
  return true;
}

function servedByLabel(model: string): string {
  const owners = catalogOwnersOfModel(model);
  if (owners.length > 0) return owners.join(',');
  const inferred = inferProvider(model);
  return inferred ?? 'unknown';
}

function considerCandidate(
  key: string,
  value: string | undefined,
  provider: PeerChatProviderId,
  ignored: CompatibleModelPick['ignored'],
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (isModelCompatibleWithProvider(trimmed, provider)) return trimmed;
  ignored.push({ key, value: trimmed, servedBy: servedByLabel(trimmed) });
  logger.warn(
    `Ignoring ${key}="${trimmed}" for provider ${provider} (served by ${servedByLabel(trimmed)}); using that provider's default model`,
  );
  return undefined;
}

/**
 * Resolve the model id to send to `provider`.
 *
 * Order: explicit argument → compatible `CODEBUDDY_PEER_MODEL` → compatible
 * `CODEBUDDY_MODEL` → provider-specific env (`OLLAMA_MODEL`, …) → catalog
 * `modelEnvKeys` (Ollama also lists `GROK_MODEL`) → spec default.
 */
export function pickCompatibleModelForProvider(options: {
  provider: PeerChatProviderId;
  explicitModel?: string;
  allowGlobalModel?: boolean;
  /** Apply catalog `modelEnvKeys` (e.g. Ollama also lists GROK_MODEL). Default: same as allowGlobalModel. */
  useCatalogEnv?: boolean;
  providerEnvModel?: string;
  specDefaultModel: string;
  env?: NodeJS.ProcessEnv;
}): CompatibleModelPick {
  const env = options.env ?? process.env;
  const ignored: CompatibleModelPick['ignored'] = [];
  const explicit = options.explicitModel?.trim();
  if (explicit) {
    return { model: explicit, ignored };
  }

  const allowGlobal = options.allowGlobalModel !== false;
  const useCatalogEnv = options.useCatalogEnv ?? allowGlobal;

  if (allowGlobal) {
    const peer = considerCandidate(
      'CODEBUDDY_PEER_MODEL',
      env.CODEBUDDY_PEER_MODEL,
      options.provider,
      ignored,
    );
    if (peer) return { model: peer, ignored };
    const globalModel = considerCandidate(
      'CODEBUDDY_MODEL',
      env.CODEBUDDY_MODEL,
      options.provider,
      ignored,
    );
    if (globalModel) return { model: globalModel, ignored };
  }

  const providerEnv = considerCandidate(
    'provider-env',
    options.providerEnvModel,
    options.provider,
    ignored,
  );
  if (providerEnv) return { model: providerEnv, ignored };

  if (useCatalogEnv) {
    const catalogId = peerProviderToCatalogId(options.provider);
    const entry = findRuntimeProvider(catalogId);
    for (const key of entry?.modelEnvKeys ?? []) {
      const fromCatalogEnv = considerCandidate(key, env[key], options.provider, ignored);
      if (fromCatalogEnv) return { model: fromCatalogEnv, ignored };
    }
  }

  return { model: options.specDefaultModel, ignored };
}
