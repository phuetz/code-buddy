import { resolveCommandProvider } from '../commands/llm-provider-resolution.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';

/** Share the user's saved CLI target; binary presence alone is not a choice. */
export function resolveServerProvider(): { provider: string; apiKey?: string; baseURL?: string; model?: string } | null {
  const selected = resolveCommandProvider();
  if (selected) return { provider: selected.providerLabel, apiKey: selected.apiKey, baseURL: selected.baseURL, model: selected.model };
  return detectProviderFromEnv();
}
