/**
 * Azure OpenAI Provider Plugin (Bundled)
 *
 * Wraps Azure OpenAI Service as a plugin-based LLM provider.
 * Gated by AZURE_OPENAI_ENDPOINT environment variable.
 * Auth via AZURE_OPENAI_API_KEY or Azure AD token (AZURE_OPENAI_AD_TOKEN).
 * Includes onboarding hooks for auth, discovery, and model picking.
 *
 * Native Engine v2026.3.19 — Azure OpenAI provider plugin.
 */

import { logger } from '../../utils/logger.js';
import type { PluginProvider, DiscoveredModel, ProviderOnboardingHooks } from '../types.js';
import { requireProviderText } from './response-content.js';

export const AZURE_PROVIDER_ID = 'bundled-azure-openai';

/** Default Azure OpenAI API version */
const DEFAULT_API_VERSION = '2024-02-01';

/**
 * Resolve Azure OpenAI endpoint from environment.
 * Expected format: https://<resource-name>.openai.azure.com
 */
function getAzureEndpoint(): string {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || '';
  // Strip trailing slash for consistency
  return endpoint.replace(/\/+$/, '');
}

/**
 * Get Azure API version from environment or default.
 */
function getApiVersion(): string {
  return process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION;
}

/**
 * Get Azure auth headers.
 * Supports both API key and Azure AD token authentication.
 */
function getAuthHeaders(): Record<string, string> {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (apiKey) {
    return { 'api-key': apiKey };
  }

  const adToken = process.env.AZURE_OPENAI_AD_TOKEN;
  if (adToken) {
    return { 'Authorization': `Bearer ${adToken}` };
  }

  return {};
}

/**
 * Check if Azure auth credentials are available.
 */
function hasAuthCredentials(): boolean {
  return !!(process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_AD_TOKEN);
}

/**
 * Known Azure OpenAI model deployments with context windows.
 * Users typically deploy these models under custom deployment names,
 * but these serve as fallback context window info.
 */
const KNOWN_AZURE_MODELS: Record<string, { contextWindow: number; description: string }> = {
  'gpt-4o': { contextWindow: 128000, description: 'GPT-4o — multimodal, fast' },
  'gpt-4o-mini': { contextWindow: 128000, description: 'GPT-4o Mini — compact, affordable' },
  'gpt-4': { contextWindow: 128000, description: 'GPT-4 — high capability' },
  'gpt-4-turbo': { contextWindow: 128000, description: 'GPT-4 Turbo — fast, large context' },
  'gpt-4-32k': { contextWindow: 32768, description: 'GPT-4 32K — extended context' },
  'gpt-35-turbo': { contextWindow: 16384, description: 'GPT-3.5 Turbo — fast and efficient' },
  'gpt-35-turbo-16k': { contextWindow: 16384, description: 'GPT-3.5 Turbo 16K' },
  'o1-preview': { contextWindow: 128000, description: 'o1 Preview — reasoning model' },
  'o1-mini': { contextWindow: 128000, description: 'o1 Mini — compact reasoning' },
};

const DEFAULT_CONTEXT_WINDOW = 4096;

/**
 * Azure OpenAI List Deployments response shape.
 */
interface AzureDeploymentsResponse {
  data?: Array<{
    id: string;
    model?: string;
    owner?: string;
    status?: string;
    scale_settings?: {
      scale_type?: string;
    };
  }>;
}

/**
 * Infer context window for an Azure deployment based on its model name.
 */
function inferContextWindow(modelOrDeployment: string): number {
  // Try exact match
  if (KNOWN_AZURE_MODELS[modelOrDeployment]) {
    return KNOWN_AZURE_MODELS[modelOrDeployment].contextWindow;
  }
  // Try prefix matching (deployment names often include version suffixes)
  for (const [key, value] of Object.entries(KNOWN_AZURE_MODELS)) {
    if (modelOrDeployment.startsWith(key) || modelOrDeployment.includes(key)) {
      return value.contextWindow;
    }
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * Get description for a model.
 */
function getModelDescription(modelOrDeployment: string): string {
  if (KNOWN_AZURE_MODELS[modelOrDeployment]) {
    return KNOWN_AZURE_MODELS[modelOrDeployment].description;
  }
  for (const [key, value] of Object.entries(KNOWN_AZURE_MODELS)) {
    if (modelOrDeployment.startsWith(key) || modelOrDeployment.includes(key)) {
      return value.description;
    }
  }
  return `Azure OpenAI deployment: ${modelOrDeployment}`;
}

/**
 * Build onboarding hooks for Azure OpenAI provider.
 */
function buildOnboardingHooks(): ProviderOnboardingHooks {
  const endpoint = getAzureEndpoint();
  const apiVersion = getApiVersion();

  return {
    async auth() {
      if (!hasAuthCredentials()) {
        return {
          valid: false,
          error: 'Azure OpenAI credentials not found. Set AZURE_OPENAI_API_KEY or AZURE_OPENAI_AD_TOKEN.',
        };
      }

      try {
        // Verify credentials by listing deployments
        const url = `${endpoint}/openai/deployments?api-version=${apiVersion}`;
        const headers = getAuthHeaders();

        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          return { valid: true };
        }

        if (response.status === 401 || response.status === 403) {
          return { valid: false, error: 'Azure OpenAI authentication failed — check your API key or AD token' };
        }

        return { valid: false, error: `Azure OpenAI returned HTTP ${response.status}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { valid: false, error: `Cannot reach Azure OpenAI at ${endpoint}: ${msg}` };
      }
    },

    async 'discovery.run'() {
      try {
        const url = `${endpoint}/openai/deployments?api-version=${apiVersion}`;
        const headers = getAuthHeaders();

        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(15000),
        });

        if (response.ok) {
          const data = (await response.json()) as AzureDeploymentsResponse;
          const deployments = data.data ?? [];

          if (deployments.length > 0) {
            return deployments
              .filter(d => d.status !== 'failed' && d.status !== 'deleting')
              .map(d => {
                const modelName = d.model ?? d.id;
                return {
                  id: d.id,
                  name: modelName,
                  contextWindow: inferContextWindow(modelName),
                  description: getModelDescription(modelName),
                  capabilities: d.model ? ['azure', d.model] : ['azure'],
                };
              });
          }
        }
      } catch (err) {
        logger.debug(`Azure OpenAI deployment discovery failed, using known models: ${err instanceof Error ? err.message : err}`);
      }

      // Fall back to known models as suggestions
      return Object.entries(KNOWN_AZURE_MODELS).map(([id, info]) => ({
        id,
        name: id,
        contextWindow: info.contextWindow,
        description: info.description,
        capabilities: ['azure', 'openai'],
      }));
    },

    async 'wizard.modelPicker'(models: DiscoveredModel[]) {
      // Default: prefer gpt-4o, then gpt-4, then first available
      const preferred = models.find(m => m.id === 'gpt-4o' || m.name === 'gpt-4o');
      if (preferred) return preferred.id;

      const gpt4 = models.find(m => m.id.includes('gpt-4') || m.name?.includes('gpt-4'));
      if (gpt4) return gpt4.id;

      return models[0]?.id ?? '';
    },

    async onModelSelected(modelId: string) {
      logger.debug(`Azure OpenAI: deployment "${modelId}" selected`);
    },
  };
}

/**
 * Create the Azure OpenAI bundled provider.
 * Returns null if AZURE_OPENAI_ENDPOINT is not set.
 */
export function createAzureProvider(): PluginProvider | null {
  const endpoint = getAzureEndpoint();
  if (!endpoint) return null;

  const apiVersion = getApiVersion();

  return {
    id: AZURE_PROVIDER_ID,
    name: 'Azure OpenAI',
    type: 'llm',
    priority: 4,
    config: {
      baseUrl: endpoint,
      apiVersion,
    },
    onboarding: buildOnboardingHooks(),

    async initialize() {
      logger.debug(`Azure OpenAI bundled provider initialized (endpoint: ${endpoint})`);
    },

    async shutdown() {
      logger.debug('Azure OpenAI bundled provider shutdown');
    },

    async chat(messages: Array<{ role: string; content: string }>) {
      // Use the first available deployment or fallback to 'gpt-4o'
      const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
      const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
      const authHeaders = getAuthHeaders();

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          messages,
          max_tokens: 4096,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Azure OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return requireProviderText('Azure OpenAI', data.choices?.[0]?.message?.content);
    },

    async complete(prompt: string) {
      return this.chat!([{ role: 'user', content: prompt }]);
    },
  };
}
