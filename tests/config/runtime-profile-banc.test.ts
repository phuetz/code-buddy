import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheRuntimeModelContextWindow, getModelToolConfig, resetRuntimeModelContextCache } from '../../src/config/model-tools.js';
import { primeLocalRuntimeModelConfig, resetLocalRuntimeContextProbeCache } from '../../src/config/local-runtime-context.js';
import { toOllamaNativeRequest } from '../../src/codebuddy/providers/ollama-native-transport.js';

afterEach(() => { vi.unstubAllEnvs(); resetRuntimeModelContextCache(); resetLocalRuntimeContextProbeCache(); });
describe('profil cohérent après résolution runtime et override', () => {
  it.each([8192, 32768, 65536])('borne la sortie et garde une réserve entrée à %i', (window) => {
    cacheRuntimeModelContextWindow('qwen3.8:27b', window);
    const config = getModelToolConfig('qwen3.8:27b');
    expect(config.maxOutputTokens).toBeLessThanOrEqual(window / 4);
    vi.stubEnv('CODEBUDDY_MAX_CONTEXT', '4096');
    expect(getModelToolConfig('qwen3.8:27b').maxOutputTokens).toBeLessThanOrEqual(1024);
  });
  it('borne num_predict même pour un appel natif direct avec une sortie excessive', () => {
    const result = toOllamaNativeRequest({ model: 'qwen3.8:27b', messages: [{ role: 'user', content: 'mission' }], max_tokens: 16384 }, 8192);
    expect((result.options as { num_predict: number }).num_predict).toBeLessThanOrEqual(2048);
  });
  it('limite la fenêtre Ollama automatique du 4B et respecte le choix explicite 64K', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => ({ ok: true, json: async () => String(url).endsWith('/api/show')
      ? { model_info: { 'qwen35.context_length': 262144 } }
      : { models: [{ name: 'qwen3.5:4b', context_length: 262144 }] } })) as unknown as typeof fetch;
    const options = { model: 'qwen3.5:4b', baseURL: 'http://127.0.0.1:11434/v1', fetchImpl };
    await primeLocalRuntimeModelConfig(options);
    expect(getModelToolConfig(options.model).contextWindow).toBe(32768);
    expect(getModelToolConfig(options.model).maxOutputTokens).toBeLessThanOrEqual(8192);
    vi.stubEnv('CODEBUDDY_MAX_CONTEXT', '65536');
    await primeLocalRuntimeModelConfig(options);
    expect(getModelToolConfig(options.model).contextWindow).toBe(65536);
  });
});

it('rend le profil et les réserves visibles avant la première requête', async () => {
  const { OpenAICompatProvider } = await import('../../src/codebuddy/providers/provider-openai-compat.js');
  const { logger } = await import('../../src/utils/logger.js');
  vi.stubEnv('CODEBUDDY_PROVIDER', 'ollama');
  cacheRuntimeModelContextWindow('qwen3.8:27b', 8192);
  const info = vi.spyOn(logger, 'info');
  const fetchImpl = vi.fn(async () => {
    expect(info.mock.calls.some(([message]) => message === 'Resolved runtime profile')).toBe(true);
    const profile = info.mock.calls.find(([message]) => message === 'Resolved runtime profile')?.[1];
    expect(profile).toMatchObject({ contextWindow: 8192, outputReserveTokens: 2048, safetyReserveTokens: 512 });
    expect(profile).toHaveProperty('toolSchemaTokens');
    return new Response(JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchImpl);
  try {
    const provider = new OpenAICompatProvider({ model: 'qwen3.8:27b', apiKey: 'ollama', baseURL: 'http://127.0.0.1:11436/v1', defaultMaxTokens: 16384, getCircuitBreakerConfig: () => undefined });
    await provider.chat([{ role: 'user', content: 'mission' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); info.mockRestore(); }
});
