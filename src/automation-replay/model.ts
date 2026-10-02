import { assertUiModelTrust } from './model-trust.js';
import type { ReplayModel } from './types.js';

/** UI credentials are dedicated; never forward general provider API keys. */
export const defaultReplayModel: ReplayModel = async (system, input) => {
  assertUiModelTrust();
  const model = process.env.CODEBUDDY_UI_MODEL;
  if (!model) throw new Error('Set CODEBUDDY_UI_MODEL on the host to enable natural-language UI actions/assertions');
  const { CodeBuddyClient } = await import('../codebuddy/client.js');
  const client = new CodeBuddyClient(
    process.env.CODEBUDDY_UI_API_KEY ?? 'ollama',
    model,
    process.env.CODEBUDDY_UI_BASE_URL ?? 'http://127.0.0.1:11434/v1',
  );
  const response = await client.chat([
    { role: 'system', content: system }, { role: 'user', content: input },
  ], [], { temperature: 0, maxTokens: 512, disableProviderFallback: true });
  return { content: response.choices[0]?.message.content ?? '', tokens: response.usage?.total_tokens };
};
