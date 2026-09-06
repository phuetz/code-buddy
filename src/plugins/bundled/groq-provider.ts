/**
 * Groq Provider Plugin (Bundled)
 *
 * Wraps Groq as a plugin-based LLM provider.
 * Gated by GROQ_API_KEY environment variable.
 * Includes onboarding hooks for auth, discovery, and model picking.
 *
 * Groq provides ultra-fast inference via LPU hardware.
 * Base URL: https://api.groq.com/openai/v1
 * OpenAI-compatible API.
 *
 * Native Engine v2026.3.19 — Circuit breaker + new providers.
 */

import { logger } from '../../utils/logger.js';
import type { PluginProvider, DiscoveredModel, ProviderOnboardingHooks } from '../types.js';

export const GROQ_PROVIDER_ID = 'bundled-groq';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Known Groq models with context window sizes.
 */
const KNOWN_MODELS: Record<string, { name: string; contextWindow: number }> = {
  'qwen/qwen3.8-27b': { name: 'Qwen 3.8 27B', contextWindow: 131072 },
  'openai/gpt-oss-120b': { name: 'GPT OSS 120B', contextWindow: 131072 },
  'openai/gpt-oss-20b': { name: 'GPT OSS 20B', contextWindow: 131072 },
  'qwen/qwen3.6-27b': { name: 'Qwen 3.6 27B', contextWindow: 131072 },
  'groq/compound': { name: 'Compound', contextWindow: 128000 },
  'groq/compound-mini': { name: 'Compound Mini', contextWindow: 128000 },
  'whisper-large-v3': { name: 'Whisper Large v3', contextWindow: 8192 },
};

const DEFAULT_CONTEXT_WINDOW = 8192;

/**
 * OpenAI /v1/models response shape
 */
interface OpenAIModelsResponse {
  data?: Array<{
    id: string;
    object?: string;
    created?: number;
    owned_by?: string;
    context_window?: number;
  }>;
}

/**
 * Build onboarding hooks for Groq provider.
 */
function buildOnboardingHooks(apiKey: string): ProviderOnboardingHooks {
  return {
    async auth() {
      try {
        const response = await fetch(`${GROQ_BASE_URL}/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          return { valid: true };
        }
        return { valid: false, error: `Groq returned HTTP ${response.status}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { valid: false, error: `Cannot reach Groq API: ${msg}` };
      }
    },

    async 'discovery.run'() {
      const response = await fetch(`${GROQ_BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new Error(`Groq /models returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as OpenAIModelsResponse;
      const models: DiscoveredModel[] = (data.data ?? []).map((m) => {
        const known = KNOWN_MODELS[m.id];
        return {
          id: m.id,
          name: known?.name ?? m.id,
          contextWindow: m.context_window ?? known?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
          description: m.owned_by ? `${m.id} (by ${m.owned_by})` : m.id,
          capabilities: m.owned_by ? [m.owned_by] : [],
        };
      });

      return models;
    },

    async 'wizard.modelPicker'(models: DiscoveredModel[]) {
      // Default: prefer qwen/qwen3.8-27b if available
      const preferred = models.find(m => m.id === 'qwen/qwen3.8-27b');
      return preferred?.id ?? models[0]?.id ?? '';
    },

    async onModelSelected(modelId: string) {
      logger.debug(`Groq: model "${modelId}" selected`);
    },
  };
}

/**
 * Create the Groq bundled provider.
 * Returns null if GROQ_API_KEY is not set.
 */
export function createGroqProvider(): PluginProvider | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  return {
    id: GROQ_PROVIDER_ID,
    name: 'Groq',
    type: 'llm',
    priority: 4,
    config: {
      baseUrl: GROQ_BASE_URL,
      apiKeyEnv: 'GROQ_API_KEY',
    },
    onboarding: buildOnboardingHooks(apiKey),

    async initialize() {
      logger.debug('Groq bundled provider initialized');
    },

    async shutdown() {
      logger.debug('Groq bundled provider shutdown');
    },

    async chat(messages: Array<{ role: string; content: string }>) {
      const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          messages,
          max_tokens: 4096,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? '';
    },

    async complete(prompt: string) {
      return this.chat!([{ role: 'user', content: prompt }]);
    },
  };
}
