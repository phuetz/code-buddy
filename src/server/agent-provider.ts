import type { CodeBuddyAgent } from '../agent/codebuddy-agent.js';
import { detectProviderFromEnv, type DetectedProvider } from '../utils/provider-detector.js';

export const MISSING_PROVIDER_MESSAGE =
  'Provider credentials not configured (run `buddy login chatgpt` or set a provider API key)';

export interface ServerProviderInfo {
  provider: DetectedProvider['provider'];
  model: string;
  baseURL: string;
}

export function getServerProvider(modelOverride?: string): ServerProviderInfo | null {
  const provider = detectProviderFromEnv();
  if (!provider) return null;

  return {
    provider: provider.provider,
    model: modelOverride || provider.defaultModel,
    baseURL: provider.baseURL,
  };
}

export async function createDetectedAgent(modelOverride?: string): Promise<CodeBuddyAgent> {
  const provider = detectProviderFromEnv();
  if (!provider) {
    throw new Error(MISSING_PROVIDER_MESSAGE);
  }

  const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
  return new CodeBuddyAgent(
    provider.apiKey,
    provider.baseURL,
    modelOverride || provider.defaultModel
  );
}
