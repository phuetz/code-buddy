import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatProvider } from '../../src/codebuddy/providers/provider-openai-compat.js';
import { withLlmStreamRetry } from '../../src/codebuddy/llm-retry.js';
import { classifyProviderError } from '../../src/codebuddy/provider-error-classifier.js';
import { mapProviderError } from '../../src/errors/index.js';
import type { ChatOptions } from '../../src/codebuddy/client.js';

function provider() {
  vi.stubEnv('CODEBUDDY_PROVIDER', 'ollama');
  return new OpenAICompatProvider({ apiKey: 'ollama', model: 'qwen3.8:27b', baseURL: 'http://127.0.0.1:11436/v1', defaultMaxTokens: 128, getCircuitBreakerConfig: () => undefined });
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function exhaust(status: number, body: string) {
  const fetchImpl = vi.fn(async () => new Response(body, { status })); vi.stubGlobal('fetch', fetchImpl);
  const client = provider();
  let error: unknown;
  try {
    for await (const _ of withLlmStreamRetry(() => client.chatStream([{ role: 'user', content: 'mission' }], [], { retryOwner: 'caller' } as ChatOptions), { maxRetries: 2, baseDelayMs: 0 })) { /* drain */ }
  } catch (failure) { error = failure; }
  return { error, calls: fetchImpl.mock.calls.length };
}

describe('replay des erreurs HTTP et du flux interrompu du banc', () => {
  it('classe le 500 no user query found comme payload, une seule requête et cause conservée', async () => {
    const detail = '{"error":"no user query found in messages"}';
    const { error, calls } = await exhaust(500, detail);
    expect(calls).toBe(1);
    expect(classifyProviderError(error)).toMatchObject({ fatal: true, retryable: false, reason: 'context_payload', status: 500 });
    expect(error).toHaveProperty('cause');
    expect(String(error)).toMatch(/context|payload/i);
    expect(mapProviderError('Ollama API error: 500 — ' + detail)).not.toContain('service is currently unavailable');
  }, 30000);
  it('borne une panne transitoire à trois requêtes pour toute la pile', async () => {
    const { error, calls } = await exhaust(503, '{"error":"overloaded"}');
    expect(calls).toBe(3);
    expect(error).toHaveProperty('status', 503);
  }, 30000);
  it('conserve cause et état partiel, sans seconde réponse concaténée', async () => {
    let calls = 0;
    const cause = Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }) });
    const values: string[] = []; let failure: unknown;
    try {
      for await (const event of withLlmStreamRetry(() => (async function* () {
        calls++; yield 'fragment'; throw cause;
      })(), { baseDelayMs: 0 })) if (event.type === 'value') values.push(event.value);
    } catch (error) { failure = error; }
    expect(calls).toBe(1);
    expect(values).toEqual(['fragment']);
    expect(failure).toMatchObject({ cause, partialOutput: true });
    expect(String(failure)).toContain('terminated');
  });
});
