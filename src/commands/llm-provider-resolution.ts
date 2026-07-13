/**
 * Shared provider resolution for one-shot LLM CLI commands
 * (`buddy research`, `buddy flow`).
 *
 * Historically these commands resolved ONLY through the settings
 * provider + the `PROVIDERS` map (paid keys), so a machine running on
 * local Ollama (`CODEBUDDY_PROVIDER=ollama`, $0) hit the "no API key"
 * exit even though the rest of Code Buddy — including the autonomous
 * daemon — runs fine there. This resolver keeps the legacy path for
 * ambient paid-key defaults, but honors explicit local / ChatGPT
 * subscription model choices before a cloud key can hijack them. It
 * falls back to {@link detectProviderFromEnv} (ollama / chatgpt-oauth /
 * env-detected providers) when either:
 *   - `CODEBUDDY_PROVIDER` is explicitly set (operator intent wins), or
 *   - the legacy path found no key.
 */

import { getSettingsManager } from '../utils/settings-manager.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';
import { inferProvider } from '../config/resolve-model.js';
import { hasCodexCredentials } from '../providers/codex-oauth.js';
import {
  CHATGPT_OAUTH_DEFAULT_MODEL,
  isChatGptSubscriptionModel,
  normalizeChatGptOAuthModel,
} from '../providers/chatgpt-models.js';
import { resolveProviderFromCatalog } from '../providers/provider-catalog.js';
import { PROVIDERS, resolveProviderCommandKey } from './provider.js';

export interface ResolvedCommandProvider {
  apiKey: string;
  baseURL?: string;
  model?: string;
  /** Human-readable provider name for progress output. */
  providerLabel: string;
}

export function resolveCommandProvider(
  options: { explicitModel?: string } = {},
): ResolvedCommandProvider | null {
  const settingsManager = getSettingsManager();
  const settings = settingsManager.loadUserSettings();
  const configuredModel = options.explicitModel || settingsManager.getCurrentModel();
  const detectFirst = Boolean(process.env.CODEBUDDY_PROVIDER);
  if (detectFirst) {
    const detected = fromEnvDetection(options.explicitModel);
    if (detected) return detected;
  }

  const explicitLocal = resolveExplicitOllamaModel(configuredModel);
  if (explicitLocal) return explicitLocal;

  const explicitChatGpt = resolveExplicitChatGptModel(configuredModel);
  if (explicitChatGpt) return explicitChatGpt;

  const currentProviderKey = settings.provider || 'grok';
  const providerInfoKey = resolveProviderCommandKey(currentProviderKey) || currentProviderKey;
  const providerInfo = PROVIDERS[providerInfoKey];

  if (providerInfo) {
    const configuredProvider = resolveProviderFromCatalog({
      providerOverride: providerInfo.providerId,
      hasChatGptOAuth: hasCodexCredentials(),
      requireConfigured: providerInfo.authMode === 'api-key',
    });

    if (configuredProvider) {
      return {
        apiKey: configuredProvider.apiKey,
        baseURL: configuredProvider.baseURL,
        model: reconcileModelForBackend(
          configuredModel || configuredProvider.defaultModel,
          configuredProvider.baseURL,
          configuredProvider.defaultModel,
        ),
        providerLabel: configuredProvider.provider,
      };
    }
  }

  const ambientProvider = resolveProviderFromCatalog({
    hasChatGptOAuth: hasCodexCredentials(),
    requireConfigured: true,
  });
  if (ambientProvider) {
    return {
      apiKey: ambientProvider.apiKey,
      baseURL: ambientProvider.baseURL,
      model: reconcileModelForBackend(
        configuredModel || ambientProvider.defaultModel,
        ambientProvider.baseURL,
        ambientProvider.defaultModel,
      ),
      providerLabel: ambientProvider.provider,
    };
  }

  // Legacy path found nothing — fall back to env detection (local
  // Ollama, ChatGPT OAuth, …) so a $0 local machine can still run.
  return fromEnvDetection(configuredModel);
}

/**
 * Async companion used by commands that intentionally compare arbitrary
 * explicit models. xAI can publish a model before it appears in the static
 * catalog; in that case an existing subscription OAuth login must still win
 * over an unrelated ambient provider.
 */
export async function resolveCommandProviderWithOAuth(
  options: { explicitModel?: string } = {},
): Promise<ResolvedCommandProvider | null> {
  const explicitModel = options.explicitModel?.trim();
  if (explicitModel && inferProvider(explicitModel) === 'xai') {
    const catalogProvider = resolveProviderFromCatalog({
      providerOverride: 'grok',
      hasChatGptOAuth: hasCodexCredentials(),
      requireConfigured: true,
    });
    if (catalogProvider) {
      return {
        apiKey: catalogProvider.apiKey,
        baseURL: catalogProvider.baseURL,
        model: explicitModel,
        providerLabel: catalogProvider.provider,
      };
    }
    try {
      const { getValidXaiAccessToken, hasXaiCredentials, XAI_OAUTH_BASE_URL } = await import(
        '../providers/xai-oauth.js'
      );
      if (hasXaiCredentials()) {
        const token = await getValidXaiAccessToken();
        if (token) {
          return {
            apiKey: token,
            baseURL: XAI_OAUTH_BASE_URL,
            model: explicitModel,
            providerLabel: 'grok-oauth',
          };
        }
      }
    } catch {
      /* Fall through to the normal resolver and its existing diagnostics. */
    }
  }
  return resolveCommandProvider(options);
}

function fromEnvDetection(explicitModel?: string): ResolvedCommandProvider | null {
  const detected = detectProviderFromEnv();
  if (!detected) return null;
  return {
    apiKey: detected.apiKey,
    baseURL: detected.baseURL,
    model: reconcileModelForBackend(
      explicitModel || detected.defaultModel,
      detected.baseURL,
      detected.defaultModel,
    ),
    providerLabel: detected.provider,
  };
}

/**
 * The Codex / ChatGPT-OAuth backend (`chatgpt.com/backend-api/codex`) only
 * accepts Codex-family models. When provider resolution crosses over to that
 * backend — e.g. no Grok key, so the default `grok-code-fast-1` falls through
 * to ChatGPT OAuth — the mismatched model is rejected by the backend (400
 * "model … not supported when using Codex with a ChatGPT account"), breaking
 * every headless command (`goal`/`loop`/`flow`/`research`) out of the box for a
 * ChatGPT-authed user who never set a model. Coerce to the backend's own Codex
 * default, preserving an already-Codex model. No-op for non-Codex backends.
 */
export function reconcileModelForBackend(
  model: string | undefined,
  baseURL: string | undefined,
  backendDefaultModel: string | undefined,
): string | undefined {
  const isCodexBackend = !!baseURL && baseURL.includes('chatgpt.com/backend-api/codex');
  if (!isCodexBackend) return model;
  if (model && isChatGptSubscriptionModel(model)) return normalizeChatGptOAuthModel(model);
  if (backendDefaultModel && isChatGptSubscriptionModel(backendDefaultModel)) {
    return normalizeChatGptOAuthModel(backendDefaultModel);
  }
  return CHATGPT_OAUTH_DEFAULT_MODEL;
}

function resolveExplicitOllamaModel(explicitModel: string | undefined): ResolvedCommandProvider | null {
  const model = explicitModel?.trim();
  if (!model || !isLocalOllamaModel(model)) return null;

  let host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  if (!host.endsWith('/v1')) host = host.replace(/\/+$/, '') + '/v1';

  return {
    apiKey: 'ollama',
    baseURL: host,
    model,
    providerLabel: 'ollama',
  };
}

function isLocalOllamaModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return inferProvider(normalized) === 'ollama' || normalized.startsWith('devstral-small-2');
}

function resolveExplicitChatGptModel(explicitModel: string | undefined): ResolvedCommandProvider | null {
  const model = explicitModel?.trim();
  if (!model || !isChatGptSubscriptionModel(model)) return null;

  const detected = detectProviderFromEnv();
  if (detected?.provider !== 'chatgpt') return null;

  return {
    apiKey: detected.apiKey,
    baseURL: detected.baseURL,
    model: normalizeChatGptOAuthModel(model),
    providerLabel: detected.provider,
  };
}
