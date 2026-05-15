/**
 * Together AI Provider Plugin (Bundled)
 *
 * Wraps Together AI as a plugin-based LLM provider.
 * Gated by TOGETHER_API_KEY environment variable.
 * Includes onboarding hooks for auth, discovery, and model picking.
 *
 * Together AI provides serverless and dedicated inference.
 * Base URL: https://api.together.xyz/v1
 * OpenAI-compatible API.
 *
 * Native Engine v2026.3.19 — Circuit breaker + new providers.
 */

import { logger } from '../../utils/logger.js';
import type { PluginProvider, DiscoveredModel, ProviderOnboardingHooks } from '../types.js';
import { requireProviderText } from './response-content.js';

export const TOGETHER_PROVIDER_ID = 'bundled-together';

const TOGETHER_BASE_URL = 'https://api.together.xyz/v1';

const DEFAULT_CONTEXT_WINDOW = 4096;

/**
 * OpenAI /v1/models response shape
 */
interface OpenAIModelsResponse {
  data?: Array<{
    id: string;
    object?: string;
    created?: number;
    owned_by?: string;
    context_length?: number;
  }>;
}

/**
 * Build onboarding hooks for Together AI provider.
 */
function buildOnboardingHooks(apiKey: string): ProviderOnboardingHooks {
  return {
    async auth() {
      try {
        const response = await fetch(`${TOGETHER_BASE_URL}/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          return { valid: true };
        }
        return { valid: false, error: `Together AI returned HTTP ${response.status}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { valid: false, error: `Cannot reach Together AI API: ${msg}` };
      }
    },

    async 'discovery.run'() {
      const response = await fetch(`${TOGETHER_BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new Error(`Together AI /models returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as OpenAIModelsResponse;
      const models: DiscoveredModel[] = (data.data ?? []).map((m) => {
        const capabilities: string[] = [];
        if (m.owned_by) capabilities.push(m.owned_by);

        return {
          id: m.id,
          name: m.id,
          contextWindow: m.context_length ?? DEFAULT_CONTEXT_WINDOW,
          description: m.owned_by ? `${m.id} (by ${m.owned_by})` : m.id,
          capabilities,
        };
      });

      return models;
    },

    async 'wizard.modelPicker'(models: DiscoveredModel[]) {
      // Default: pick the first model available
      return models[0]?.id ?? '';
    },

    async onModelSelected(modelId: string) {
      logger.debug(`Together AI: model "${modelId}" selected`);
    },
  };
}

/**
 * Create the Together AI bundled provider.
 * Returns null if TOGETHER_API_KEY is not set.
 */
export function createTogetherProvider(): PluginProvider | null {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return null;

  return {
    id: TOGETHER_PROVIDER_ID,
    name: 'Together AI',
    type: 'llm',
    priority: 3,
    config: {
      baseUrl: TOGETHER_BASE_URL,
      apiKeyEnv: 'TOGETHER_API_KEY',
    },
    onboarding: buildOnboardingHooks(apiKey),

    async initialize() {
      logger.debug('Together AI bundled provider initialized');
    },

    async shutdown() {
      logger.debug('Together AI bundled provider shutdown');
    },

    async chat(messages: Array<{ role: string; content: string }>) {
      const response = await fetch(`${TOGETHER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messages,
          max_tokens: 4096,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Together AI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return requireProviderText('Together AI', data.choices?.[0]?.message?.content);
    },

    async complete(prompt: string) {
      return this.chat!([{ role: 'user', content: prompt }]);
    },
  };
}
