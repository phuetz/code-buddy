/**
 * Ollama Provider Plugin (Bundled)
 *
 * Wraps a local Ollama instance as a plugin-based LLM provider.
 * Gated by OLLAMA_HOST environment variable (defaults to http://localhost:11434).
 * Includes onboarding hooks for auth, discovery, and model picking.
 *
 * Native Engine v2026.3.19 — Provider Plugin Onboarding Architecture.
 */

import { logger } from '../../utils/logger.js';
import type { PluginProvider, DiscoveredModel, ProviderOnboardingHooks } from '../types.js';
import { requireProviderText } from './response-content.js';

export const OLLAMA_PROVIDER_ID = 'bundled-ollama';

/** Default Ollama API endpoint */
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

/**
 * Resolve the Ollama base URL from environment or default.
 */
function getOllamaHost(): string {
  return process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
}

/**
 * Known context-window sizes for popular Ollama models.
 * Falls back to 4096 for unknown models.
 */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  'llama3': 8192,
  'llama3:70b': 8192,
  'llama3.1': 131072,
  'llama3.2': 131072,
  'mistral': 32768,
  'mixtral': 32768,
  'codellama': 16384,
  'phi3': 128000,
  'gemma': 8192,
  'gemma2': 8192,
  'qwen2': 32768,
  'deepseek-coder': 16384,
  'deepseek-coder-v2': 131072,
  'command-r': 131072,
};

const DEFAULT_CONTEXT_WINDOW = 4096;

/**
 * Ollama /api/tags response shape
 */
interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    model?: string;
    size?: number;
    digest?: string;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

/**
 * Infer context window for an Ollama model name.
 */
function inferContextWindow(modelName: string): number {
  // Try exact match first
  if (KNOWN_CONTEXT_WINDOWS[modelName]) {
    return KNOWN_CONTEXT_WINDOWS[modelName];
  }
  // Try base name (strip tag)
  const baseName = modelName.split(':')[0];
  if (KNOWN_CONTEXT_WINDOWS[baseName]) {
    return KNOWN_CONTEXT_WINDOWS[baseName];
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * Build onboarding hooks for Ollama provider.
 */
function buildOnboardingHooks(): ProviderOnboardingHooks {
  const host = getOllamaHost();

  return {
    async auth() {
      try {
        const response = await fetch(host, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          return { valid: true };
        }
        return { valid: false, error: `Ollama returned HTTP ${response.status}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { valid: false, error: `Cannot reach Ollama at ${host}: ${msg}` };
      }
    },

    async 'discovery.run'() {
      const url = `${host}/api/tags`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        throw new Error(`Ollama /api/tags returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as OllamaTagsResponse;
      const models: DiscoveredModel[] = (data.models ?? []).map((m) => {
        const name = m.name || m.model || 'unknown';
        const details = m.details;
        const capabilities: string[] = [];
        if (details?.family) capabilities.push(details.family);
        if (details?.parameter_size) capabilities.push(details.parameter_size);
        if (details?.quantization_level) capabilities.push(details.quantization_level);

        return {
          id: name,
          name,
          contextWindow: inferContextWindow(name),
          description: details?.parameter_size
            ? `${name} (${details.parameter_size})`
            : name,
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
      logger.debug(`Ollama: model "${modelId}" selected`);
    },
  };
}

/**
 * Create the Ollama bundled provider.
 * Returns null if OLLAMA_HOST is not set (provider not activated).
 */
export function createOllamaProvider(): PluginProvider | null {
  const host = getOllamaHost();

  // Only auto-activate when OLLAMA_HOST is explicitly set
  // (local development may have Ollama running but user may not want it as a provider)
  if (!process.env.OLLAMA_HOST) return null;

  return {
    id: OLLAMA_PROVIDER_ID,
    name: 'Ollama',
    type: 'llm',
    priority: 2,
    config: {
      baseUrl: host,
    },
    onboarding: buildOnboardingHooks(),

    async initialize() {
      logger.debug(`Ollama bundled provider initialized (host: ${host})`);
    },

    async shutdown() {
      logger.debug('Ollama bundled provider shutdown');
    },

    async chat(messages: Array<{ role: string; content: string }>) {
      const response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3',
          messages,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        message?: { content?: string };
      };
      return requireProviderText('Ollama', data.message?.content);
    },

    async complete(prompt: string) {
      return this.chat!([{ role: 'user', content: prompt }]);
    },
  };
}
