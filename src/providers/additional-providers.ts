/**
 * Additional Model Provider Configurations
 *
 * Extends the model provider ecosystem with support for providers
 * that OpenClaw supports but Code Buddy was missing.
 *
 * Providers: Mistral, Deepgram, MiniMax, Moonshot, Venice AI, Z.AI
 *
 * All providers use OpenAI-compatible API format where possible.
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  models: string[];
  defaultModel: string;
  maxOutputTokens: number;
  contextWindow: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  openaiCompatible: boolean;
}

// ============================================================================
// Provider Registry
// ============================================================================

export const ADDITIONAL_PROVIDERS: ProviderConfig[] = [
  {
    id: 'mistral',
    name: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    models: [
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
      'codestral-latest',
      'mistral-embed',
    ],
    defaultModel: 'mistral-large-latest',
    maxOutputTokens: 8192,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    openaiCompatible: true,
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    baseUrl: 'https://api.deepgram.com/v1',
    apiKeyEnv: 'DEEPGRAM_API_KEY',
    models: [
      'nova-2',
      'nova-2-general',
      'nova-2-meeting',
      'nova-2-phonecall',
      'whisper-large',
    ],
    defaultModel: 'nova-2',
    maxOutputTokens: 4096,
    contextWindow: 32000,
    supportsStreaming: true,
    supportsTools: false,
    supportsVision: false,
    openaiCompatible: false,
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
    models: [
      'abab6.5s-chat',
      'abab6.5-chat',
      'abab5.5-chat',
    ],
    defaultModel: 'abab6.5s-chat',
    maxOutputTokens: 8192,
    contextWindow: 245760,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    openaiCompatible: true,
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    models: [
      'moonshot-v1-128k',
      'moonshot-v1-32k',
      'moonshot-v1-8k',
    ],
    defaultModel: 'moonshot-v1-128k',
    maxOutputTokens: 8192,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    openaiCompatible: true,
  },
  {
    id: 'venice',
    name: 'Venice AI',
    baseUrl: 'https://api.venice.ai/api/v1',
    apiKeyEnv: 'VENICE_API_KEY',
    models: [
      'llama-3.1-405b',
      'llama-3.3-70b',
      'mistral-large',
      'dolphin-2.9.1',
    ],
    defaultModel: 'llama-3.3-70b',
    maxOutputTokens: 8192,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    openaiCompatible: true,
  },
  {
    id: 'zai',
    name: 'Z.AI',
    baseUrl: 'https://api.z.ai/v1',
    apiKeyEnv: 'ZAI_API_KEY',
    models: [
      'z1-large',
      'z1-medium',
      'z1-mini',
    ],
    defaultModel: 'z1-large',
    maxOutputTokens: 16384,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    openaiCompatible: true,
  },
];

// ============================================================================
// Provider Resolution
// ============================================================================

export function getAdditionalProvider(id: string): ProviderConfig | undefined {
  return ADDITIONAL_PROVIDERS.find(p => p.id === id);
}

export function getProviderForModel(modelName: string): ProviderConfig | undefined {
  return ADDITIONAL_PROVIDERS.find(p =>
    p.models.some(m => modelName.startsWith(m) || modelName.includes(p.id))
  );
}

export function listAvailableProviders(): ProviderConfig[] {
  return ADDITIONAL_PROVIDERS.filter(p => {
    const key = process.env[p.apiKeyEnv];
    return key && key.length > 0;
  });
}

export function listAllProviders(): ProviderConfig[] {
  return [...ADDITIONAL_PROVIDERS];
}

/**
 * Detect provider from environment and return config for OpenAI-compatible client.
 */
export function resolveProviderConfig(
  modelOrProvider: string
): { baseUrl: string; apiKey: string; model: string } | null {
  const provider = getAdditionalProvider(modelOrProvider)
    || getProviderForModel(modelOrProvider);

  if (!provider) return null;

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    logger.debug(`Provider ${provider.name}: no API key (${provider.apiKeyEnv})`);
    return null;
  }

  return {
    baseUrl: provider.baseUrl,
    apiKey,
    model: provider.defaultModel,
  };
}
