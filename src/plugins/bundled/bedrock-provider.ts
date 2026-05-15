/**
 * AWS Bedrock Provider Plugin (Bundled)
 *
 * Wraps AWS Bedrock as a plugin-based LLM provider via OpenAI-compatible API.
 * Gated by AWS_BEDROCK_REGION or AWS_REGION environment variable.
 * Auth via AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY or default credential chain.
 * Includes onboarding hooks for auth, discovery, and model picking.
 *
 * Native Engine v2026.3.19 — AWS Bedrock provider plugin.
 */

import { logger } from '../../utils/logger.js';
import type { PluginProvider, DiscoveredModel, ProviderOnboardingHooks } from '../types.js';
import { requireProviderText } from './response-content.js';

export const BEDROCK_PROVIDER_ID = 'bundled-bedrock';

/**
 * Resolve the AWS region from environment.
 */
function getBedrockRegion(): string {
  return process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || '';
}

/**
 * Get AWS credentials from environment.
 */
function getAwsCredentials(): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
}

/**
 * Build the Bedrock runtime base URL for the given region.
 */
function getBedrockBaseUrl(region: string): string {
  return `https://bedrock-runtime.${region}.amazonaws.com`;
}

/**
 * Build the Bedrock management base URL for the given region (used for model listing).
 */
function getBedrockManagementUrl(region: string): string {
  return `https://bedrock.${region}.amazonaws.com`;
}

/**
 * Known Bedrock foundation models with context windows and descriptions.
 */
const KNOWN_BEDROCK_MODELS: Array<{
  id: string;
  name: string;
  contextWindow: number;
  description: string;
  capabilities: string[];
}> = [
  {
    id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    name: 'Claude 3.5 Sonnet v2',
    contextWindow: 200000,
    description: 'Anthropic Claude 3.5 Sonnet v2 — fast, intelligent',
    capabilities: ['anthropic', 'claude', 'chat', 'code'],
  },
  {
    id: 'anthropic.claude-3-opus-20240229-v1:0',
    name: 'Claude 3 Opus',
    contextWindow: 200000,
    description: 'Anthropic Claude 3 Opus — most capable',
    capabilities: ['anthropic', 'claude', 'chat', 'code', 'reasoning'],
  },
  {
    id: 'anthropic.claude-3-sonnet-20240229-v1:0',
    name: 'Claude 3 Sonnet',
    contextWindow: 200000,
    description: 'Anthropic Claude 3 Sonnet — balanced performance',
    capabilities: ['anthropic', 'claude', 'chat', 'code'],
  },
  {
    id: 'anthropic.claude-3-haiku-20240307-v1:0',
    name: 'Claude 3 Haiku',
    contextWindow: 200000,
    description: 'Anthropic Claude 3 Haiku — fast and compact',
    capabilities: ['anthropic', 'claude', 'chat'],
  },
  {
    id: 'amazon.titan-text-express-v1',
    name: 'Titan Text Express',
    contextWindow: 8192,
    description: 'Amazon Titan Text Express — general purpose',
    capabilities: ['amazon', 'titan', 'chat'],
  },
  {
    id: 'amazon.titan-text-premier-v1:0',
    name: 'Titan Text Premier',
    contextWindow: 32768,
    description: 'Amazon Titan Text Premier — advanced',
    capabilities: ['amazon', 'titan', 'chat', 'code'],
  },
  {
    id: 'meta.llama3-1-70b-instruct-v1:0',
    name: 'Llama 3.1 70B Instruct',
    contextWindow: 131072,
    description: 'Meta Llama 3.1 70B Instruct',
    capabilities: ['meta', 'llama', 'chat', 'code'],
  },
  {
    id: 'meta.llama3-1-8b-instruct-v1:0',
    name: 'Llama 3.1 8B Instruct',
    contextWindow: 131072,
    description: 'Meta Llama 3.1 8B Instruct — compact',
    capabilities: ['meta', 'llama', 'chat'],
  },
  {
    id: 'mistral.mistral-large-2407-v1:0',
    name: 'Mistral Large',
    contextWindow: 131072,
    description: 'Mistral Large — high capability',
    capabilities: ['mistral', 'chat', 'code'],
  },
  {
    id: 'cohere.command-r-plus-v1:0',
    name: 'Command R+',
    contextWindow: 131072,
    description: 'Cohere Command R+ — retrieval-augmented',
    capabilities: ['cohere', 'chat', 'rag'],
  },
];

/**
 * Bedrock ListFoundationModels response shape
 */
interface BedrockListModelsResponse {
  modelSummaries?: Array<{
    modelId: string;
    modelName?: string;
    providerName?: string;
    inputModalities?: string[];
    outputModalities?: string[];
    responseStreamingSupported?: boolean;
    modelLifecycle?: { status?: string };
  }>;
}

/**
 * Create AWS Signature V4 authorization headers (simplified).
 * For a production-grade implementation, use the full AWS SDK.
 * This implementation covers basic signing for fetch-based calls.
 */
async function createAwsAuthHeaders(
  method: string,
  url: string,
  body: string,
  region: string,
  service: string,
): Promise<Record<string, string>> {
  const creds = getAwsCredentials();
  if (!creds) {
    throw new Error('AWS credentials not available (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY required)');
  }

  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateOnly = dateStamp.slice(0, 8);

  const parsedUrl = new URL(url);
  const host = parsedUrl.host;

  // Compute payload hash
  const encoder = new TextEncoder();
  const payloadHash = await hashSHA256(encoder.encode(body));

  // Build canonical request
  const canonicalHeaders = `host:${host}\nx-amz-date:${dateStamp}\n`;
  const signedHeaders = 'host;x-amz-date';
  const canonicalRequest = [
    method,
    parsedUrl.pathname,
    parsedUrl.search.replace(/^\?/, ''),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // Build string to sign
  const scope = `${dateOnly}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await hashSHA256(encoder.encode(canonicalRequest));
  const stringToSign = `AWS4-HMAC-SHA256\n${dateStamp}\n${scope}\n${canonicalRequestHash}`;

  // Calculate signing key
  const kDate = await hmacSHA256(encoder.encode(`AWS4${creds.secretAccessKey}`), dateOnly);
  const kRegion = await hmacSHA256(kDate, region);
  const kService = await hmacSHA256(kRegion, service);
  const kSigning = await hmacSHA256(kService, 'aws4_request');

  // Calculate signature
  const signature = await hmacSHA256Hex(kSigning, stringToSign);

  const authHeader = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'Host': host,
    'X-Amz-Date': dateStamp,
    'Authorization': authHeader,
    'Content-Type': 'application/json',
  };

  if (creds.sessionToken) {
    headers['X-Amz-Security-Token'] = creds.sessionToken;
  }

  return headers;
}

/**
 * SHA-256 hash helper (returns hex string).
 */
async function hashSHA256(data: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * HMAC-SHA256 helper (returns raw bytes).
 */
async function hmacSHA256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw', key as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data) as unknown as BufferSource);
  return new Uint8Array(sig);
}

/**
 * HMAC-SHA256 helper (returns hex string).
 */
async function hmacSHA256Hex(key: Uint8Array, data: string): Promise<string> {
  const raw = await hmacSHA256(key, data);
  return Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build onboarding hooks for Bedrock provider.
 */
function buildOnboardingHooks(): ProviderOnboardingHooks {
  const region = getBedrockRegion();

  return {
    async auth() {
      const creds = getAwsCredentials();
      if (!creds) {
        return {
          valid: false,
          error: 'AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
        };
      }

      try {
        // Verify credentials by listing foundation models
        const url = `${getBedrockManagementUrl(region)}/foundation-models`;
        const headers = await createAwsAuthHeaders('GET', url, '', region, 'bedrock');

        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          return { valid: true };
        }
        return { valid: false, error: `Bedrock returned HTTP ${response.status}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { valid: false, error: `Cannot reach Bedrock in region ${region}: ${msg}` };
      }
    },

    async 'discovery.run'() {
      try {
        const url = `${getBedrockManagementUrl(region)}/foundation-models`;
        const headers = await createAwsAuthHeaders('GET', url, '', region, 'bedrock');

        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(15000),
        });

        if (response.ok) {
          const data = (await response.json()) as BedrockListModelsResponse;
          const activeModels = (data.modelSummaries ?? []).filter(
            m => m.modelLifecycle?.status !== 'LEGACY' &&
              m.inputModalities?.includes('TEXT') &&
              m.outputModalities?.includes('TEXT'),
          );

          if (activeModels.length > 0) {
            return activeModels.map(m => {
              // Try to find known model info
              const known = KNOWN_BEDROCK_MODELS.find(k => k.id === m.modelId);
              return {
                id: m.modelId,
                name: known?.name ?? m.modelName ?? m.modelId,
                contextWindow: known?.contextWindow ?? 4096,
                description: known?.description ?? `${m.providerName ?? ''} ${m.modelName ?? m.modelId}`.trim(),
                capabilities: known?.capabilities ?? [m.providerName ?? 'unknown'],
              };
            });
          }
        }
      } catch (err) {
        logger.debug(`Bedrock model discovery failed, using known models: ${err instanceof Error ? err.message : err}`);
      }

      // Fall back to known models list
      return KNOWN_BEDROCK_MODELS.map(m => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
        description: m.description,
        capabilities: [...m.capabilities],
      }));
    },

    async 'wizard.modelPicker'(models: DiscoveredModel[]) {
      // Default: prefer Claude 3.5 Sonnet, then first available
      const preferred = models.find(m => m.id.includes('claude-3-5-sonnet'));
      return preferred?.id ?? models[0]?.id ?? '';
    },

    async onModelSelected(modelId: string) {
      logger.debug(`Bedrock: model "${modelId}" selected`);
    },
  };
}

/**
 * Create the AWS Bedrock bundled provider.
 * Returns null if AWS_BEDROCK_REGION (or AWS_REGION) is not set.
 */
export function createBedrockProvider(): PluginProvider | null {
  const region = getBedrockRegion();
  if (!region) return null;

  const baseUrl = getBedrockBaseUrl(region);

  return {
    id: BEDROCK_PROVIDER_ID,
    name: 'AWS Bedrock',
    type: 'llm',
    priority: 4,
    config: {
      baseUrl,
      region,
    },
    onboarding: buildOnboardingHooks(),

    async initialize() {
      logger.debug(`AWS Bedrock bundled provider initialized (region: ${region})`);
    },

    async shutdown() {
      logger.debug('AWS Bedrock bundled provider shutdown');
    },

    async chat(messages: Array<{ role: string; content: string }>) {
      // Use Bedrock's Converse API for a unified interface
      const url = `${baseUrl}/model/anthropic.claude-3-5-sonnet-20241022-v2:0/converse`;
      const body = JSON.stringify({
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: [{ text: m.content }],
        })),
        inferenceConfig: {
          maxTokens: 4096,
        },
      });

      const headers = await createAwsAuthHeaders('POST', url, body, region, 'bedrock');

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        throw new Error(`Bedrock API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        output?: { message?: { content?: Array<{ text?: string }> } };
      };
      return requireProviderText('AWS Bedrock', data.output?.message?.content?.[0]?.text);
    },

    async complete(prompt: string) {
      return this.chat!([{ role: 'user', content: prompt }]);
    },
  };
}
