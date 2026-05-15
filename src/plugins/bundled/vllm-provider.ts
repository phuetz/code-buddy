/**
 * vLLM Provider Plugin (Bundled)
 *
 * Wraps a vLLM instance (OpenAI-compatible API) as a plugin-based LLM provider.
 * Gated by VLLM_BASE_URL environment variable.
 * Includes onboarding hooks for auth, discovery, and model picking.
 *
 * Native Engine v2026.3.19 — Provider Plugin Onboarding Architecture.
 */

import { logger } from '../../utils/logger.js';
import type { PluginProvider, DiscoveredModel, ProviderOnboardingHooks } from '../types.js';
import { requireProviderText } from './response-content.js';

export const VLLM_PROVIDER_ID = 'bundled-vllm';

/**
 * Resolve the vLLM base URL from environment.
 */
function getVllmBaseUrl(): string {
  return process.env.VLLM_BASE_URL || '';
}

/**
 * OpenAI /v1/models response shape
 */
interface OpenAIModelsResponse {
  data?: Array<{
    id: string;
    object?: string;
    created?: number;
    owned_by?: string;
    max_model_len?: number;
    root?: string;
    permission?: unknown[];
  }>;
}

const DEFAULT_CONTEXT_WINDOW = 4096;

/**
 * Build onboarding hooks for vLLM provider.
 */
function buildOnboardingHooks(): ProviderOnboardingHooks {
  const baseUrl = getVllmBaseUrl();

  return {
    async auth() {
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          return { valid: true };
        }
        return { valid: false, error: `vLLM returned HTTP ${response.status}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { valid: false, error: `Cannot reach vLLM at ${baseUrl}: ${msg}` };
      }
    },

    async 'discovery.run'() {
      const url = `${baseUrl}/v1/models`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        throw new Error(`vLLM /v1/models returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as OpenAIModelsResponse;
      const models: DiscoveredModel[] = (data.data ?? []).map((m) => {
        const capabilities: string[] = [];
        if (m.owned_by) capabilities.push(m.owned_by);

        return {
          id: m.id,
          name: m.id,
          contextWindow: m.max_model_len ?? DEFAULT_CONTEXT_WINDOW,
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
      logger.debug(`vLLM: model "${modelId}" selected`);
    },
  };
}

/**
 * Create the vLLM bundled provider.
 * Returns null if VLLM_BASE_URL is not set.
 */
export function createVllmProvider(): PluginProvider | null {
  const baseUrl = getVllmBaseUrl();
  if (!baseUrl) return null;

  return {
    id: VLLM_PROVIDER_ID,
    name: 'vLLM',
    type: 'llm',
    priority: 2,
    config: {
      baseUrl,
    },
    onboarding: buildOnboardingHooks(),

    async initialize() {
      logger.debug(`vLLM bundled provider initialized (baseUrl: ${baseUrl})`);
    },

    async shutdown() {
      logger.debug('vLLM bundled provider shutdown');
    },

    async chat(messages: Array<{ role: string; content: string }>) {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          max_tokens: 4096,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`vLLM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return requireProviderText('vLLM', data.choices?.[0]?.message?.content);
    },

    async complete(prompt: string) {
      return this.chat!([{ role: 'user', content: prompt }]);
    },
  };
}
