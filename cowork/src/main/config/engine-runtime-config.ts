import type { AppConfig } from './config-store';
import {
  resolveLmStudioCredentials,
  resolveOllamaCredentials,
  resolveOpenAICredentials,
  resolveVllmCredentials,
  shouldAllowEmptyAnthropicApiKey,
  shouldAllowEmptyGeminiApiKey,
} from './auth-utils';

export interface EngineRuntimeConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

const LOCAL_GEMINI_PLACEHOLDER_KEY = 'sk-gemini-local-proxy';
const LOCAL_ANTHROPIC_PLACEHOLDER_KEY = 'sk-ant-local-proxy';

function projectActiveProfile(config: AppConfig): AppConfig {
  const profile = config.profiles?.[config.activeProfileKey];
  return {
    ...config,
    apiKey: profile?.apiKey ?? config.apiKey ?? '',
    baseUrl: profile?.baseUrl ?? config.baseUrl,
    model: profile?.model ?? config.model,
  };
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function resolveEngineRuntimeConfig(config: AppConfig): EngineRuntimeConfig {
  const projected = projectActiveProfile(config);

  if (projected.provider === 'ollama') {
    const resolved = resolveOllamaCredentials(projected);
    return {
      apiKey: resolved?.apiKey ?? '',
      baseURL: resolved?.baseUrl,
      model: projected.model,
    };
  }

  if (projected.provider === 'lmstudio') {
    const resolved = resolveLmStudioCredentials(projected);
    return {
      apiKey: resolved?.apiKey ?? '',
      baseURL: resolved?.baseUrl,
      model: projected.model,
    };
  }

  if (projected.provider === 'vllm') {
    const resolved = resolveVllmCredentials(projected);
    return {
      apiKey: resolved?.apiKey ?? '',
      baseURL: resolved?.baseUrl,
      model: projected.model,
    };
  }

  const isGemini =
    projected.provider === 'gemini' ||
    (projected.provider === 'custom' && projected.customProtocol === 'gemini');
  if (isGemini) {
    const apiKey =
      projected.apiKey?.trim() ||
      (shouldAllowEmptyGeminiApiKey(projected) ? LOCAL_GEMINI_PLACEHOLDER_KEY : '');
    return {
      apiKey,
      baseURL: trimOptional(projected.baseUrl),
      model: projected.model,
    };
  }

  const isOpenAICompatible =
    projected.provider === 'chatgpt' ||
    projected.provider === 'openai' ||
    projected.provider === 'openrouter' ||
    projected.provider === 'grok' ||
    projected.provider === 'groq' ||
    projected.provider === 'together' ||
    projected.provider === 'fireworks' ||
    projected.provider === 'mistral' ||
    (projected.provider === 'custom' && projected.customProtocol === 'openai');
  if (isOpenAICompatible) {
    const resolved = resolveOpenAICredentials(projected);
    return {
      apiKey: resolved?.apiKey ?? '',
      baseURL: resolved?.baseUrl ?? trimOptional(projected.baseUrl),
      model: projected.model,
    };
  }

  const apiKey =
    projected.apiKey?.trim() ||
    (shouldAllowEmptyAnthropicApiKey(projected) ? LOCAL_ANTHROPIC_PLACEHOLDER_KEY : '');
  return {
    apiKey,
    baseURL: trimOptional(projected.baseUrl),
    model: projected.model,
  };
}
