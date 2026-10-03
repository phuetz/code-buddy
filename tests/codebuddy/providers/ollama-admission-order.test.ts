import { afterEach, expect, it, vi } from 'vitest';
import type { OpenAiChatPayload } from '../../../src/codebuddy/providers/ollama-native-transport.js';
const admission = vi.hoisted(() => vi.fn());
vi.mock('../../../src/codebuddy/providers/ollama-native-token-count.js', () => ({ admitOllamaCompactRequest: admission }));
import { OpenAICompatProvider } from '../../../src/codebuddy/providers/provider-openai-compat.js';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); admission.mockReset(); });
it.each([false, true])('does not POST a rejected native request, streaming=%s', async stream => {
  vi.stubEnv('CODEBUDDY_HEADLESS', 'true'); vi.stubEnv('CODEBUDDY_PROMPT_COMPACT', 'true');
  admission.mockRejectedValue(new Error('native admission refused'));
  const transport = vi.fn(async () => new Response(JSON.stringify({ model: 'fixture', message: { role: 'assistant', content: 'unverified' }, done: true, prompt_eval_count: 1 })));
  vi.stubGlobal('fetch', transport);
  const provider = new OpenAICompatProvider({ apiKey: 'test-key', baseURL: 'http://localhost:11434/v1', model: 'fixture', defaultMaxTokens: 100, getCircuitBreakerConfig: () => undefined });
  const boundary = provider as unknown as { createOllamaNativeCompletion(payload: OpenAiChatPayload): Promise<unknown> };
  await expect(boundary.createOllamaNativeCompletion({ model: 'fixture', messages: [{ role: 'user', content: 'question' }], stream })).rejects.toThrow('native admission refused');
  expect(admission).toHaveBeenCalledOnce();
  expect(transport).not.toHaveBeenCalled();
});
