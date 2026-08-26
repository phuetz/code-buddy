import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLocalRuntimeURL,
  primeLocalRuntimeModelConfig,
  probeLocalRuntimeContext,
  resetLocalRuntimeContextProbeCache,
} from '../../src/config/local-runtime-context.js';
import {
  cacheRuntimeModelContextWindow,
  getModelToolConfig,
  resetRuntimeModelContextCache,
} from '../../src/config/model-tools.js';

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

function routedFetch(
  route: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    route(String(input), init)) as unknown as typeof fetch;
}

afterEach(() => {
  resetLocalRuntimeContextProbeCache();
  resetRuntimeModelContextCache();
});

describe('Ollama local runtime context discovery', () => {
  it('finds the architecture-suffixed context key and clamps to the loaded num_ctx', async () => {
    const fetchImpl = routedFetch((url, init) => {
      if (url.endsWith('/api/show')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'qwen3.8:27b' });
        return response({
          model_info: {
            'general.architecture': 'qwen35',
            'qwen35.context_length': 262144,
          },
          parameters: 'temperature 1',
        });
      }
      if (url.endsWith('/api/ps')) {
        return response({
          models: [{ name: 'qwen3.8:27b', context_length: 32768 }],
        });
      }
      return response({}, false);
    });

    await expect(probeLocalRuntimeContext({
      model: 'qwen3.8:27b',
      baseURL: 'http://darkstar:11434/v1',
      fetchImpl,
    })).resolves.toEqual({
      runtime: 'ollama',
      advertisedContextWindow: 262144,
      servedContextWindow: 32768,
      contextWindow: 32768,
    });
  });

  it('supports an unknown GGUF architecture without a family allowlist', async () => {
    const fetchImpl = routedFetch((url) => url.endsWith('/api/show')
      ? response({
        model_info: {
          'general.architecture': 'future_family',
          'future_family.context_length': 196608,
        },
      })
      : response({ models: [] }));

    const result = await probeLocalRuntimeContext({
      model: 'future-local:latest',
      baseURL: 'http://127.0.0.1:11434/v1',
      fetchImpl,
    });
    expect(result?.contextWindow).toBe(196608);
  });

  it('uses a Modelfile num_ctx when the model is not currently loaded', async () => {
    const fetchImpl = routedFetch((url) => url.endsWith('/api/show')
      ? response({
        model_info: { 'llama.context_length': 131072 },
        parameters: 'temperature 0.2\nnum_ctx 65536\nstop "x"',
      })
      : response({ models: [] }));

    const result = await probeLocalRuntimeContext({
      model: 'llama-local:latest',
      baseURL: 'http://localhost:11434',
      fetchImpl,
    });
    expect(result).toMatchObject({
      advertisedContextWindow: 131072,
      servedContextWindow: 65536,
      contextWindow: 65536,
    });
  });

  it('returns null for missing or unreadable model metadata', async () => {
    const missing = routedFetch(() => response({ model_info: { 'general.architecture': 'qwen' } }));
    await expect(probeLocalRuntimeContext({
      model: 'broken-local',
      baseURL: 'http://localhost:11434',
      fetchImpl: missing,
    })).resolves.toBeNull();
  });
});

describe('other local runtime metadata', () => {
  it('uses LM Studio native max context and a lower loaded instance context', async () => {
    const fetchImpl = routedFetch((url) => {
      if (url.endsWith('/api/v1/models')) {
        return response({
          models: [{
            key: 'ornith-local',
            max_context_length: 262144,
            loaded_instances: [{
              id: 'ornith-local',
              config: { context_length: 131072 },
            }],
          }],
        });
      }
      return response({ data: [] });
    });
    await expect(probeLocalRuntimeContext({
      model: 'ornith-local',
      baseURL: 'http://localhost:1234/v1',
      fetchImpl,
    })).resolves.toEqual({
      runtime: 'lmstudio',
      advertisedContextWindow: 262144,
      servedContextWindow: 131072,
      contextWindow: 131072,
    });
  });

  it('reads vLLM max_model_len only after matching the served model', async () => {
    const fetchImpl = routedFetch((url) => {
      if (url.includes('/v1/models')) return response({ data: [{ id: 'served-model' }] });
      if (url.includes('/server_info')) {
        return response({ vllm_config: { model_config: { max_model_len: 98304 } } });
      }
      return response({}, false);
    });
    await expect(probeLocalRuntimeContext({
      model: 'served-model',
      baseURL: 'http://127.0.0.1:8000/v1',
      runtimeHint: 'vllm',
      fetchImpl,
    })).resolves.toEqual({
      runtime: 'vllm',
      servedContextWindow: 98304,
      contextWindow: 98304,
    });
  });
});

describe('synchronous config cache priming', () => {
  it('replaces the hard-coded fallback for an undeclared local model', () => {
    expect(getModelToolConfig('x7-unregistered-local:35b').contextWindow).toBe(32768);
    cacheRuntimeModelContextWindow('x7-unregistered-local:35b', 262144);
    expect(getModelToolConfig('x7-unregistered-local:35b')).toMatchObject({
      contextWindow: 262144,
      maxOutputTokens: 4096,
    });
  });

  it('keeps an explicit declaration as a ceiling', () => {
    cacheRuntimeModelContextWindow('qwen3.8:27b', 524288);
    expect(getModelToolConfig('qwen3.8:27b').contextWindow).toBe(262144);
  });

  it('accepts a lower served limit for an explicitly declared model', () => {
    cacheRuntimeModelContextWindow('qwen3.8:27b', 32768);
    expect(getModelToolConfig('qwen3.8:27b').contextWindow).toBe(32768);
  });

  it('declares Ornith from its measured Ollama metadata', () => {
    expect(getModelToolConfig('ornith-1.5:35b')).toMatchObject({
      supportsReasoning: true,
      supportsToolCalls: true,
      supportsVision: true,
      contextWindow: 262144,
      maxOutputTokens: 16384,
    });
  });

  it('is fail-open when the local runtime is unreachable', async () => {
    const fetchImpl = routedFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const model = 'x7-offline-local:35b';
    await expect(primeLocalRuntimeModelConfig({
      model,
      baseURL: 'http://127.0.0.1:11434/v1',
      fetchImpl,
      timeoutMs: 10,
    })).resolves.toBeNull();
    expect(getModelToolConfig(model)).toMatchObject({
      contextWindow: 32768,
      maxOutputTokens: 4096,
    });
  });

  it('primes only once per runtime/model during one process startup', async () => {
    const fetchImpl = routedFetch((url) => url.endsWith('/api/show')
      ? response({ model_info: { 'unknown.context_length': 65536 } })
      : response({ models: [] }));
    const options = {
      model: 'x7-probe-once',
      baseURL: 'http://localhost:11434/v1',
      fetchImpl,
    };
    await primeLocalRuntimeModelConfig(options);
    await primeLocalRuntimeModelConfig(options);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // `/api/show` + `/api/ps`, once each
    expect(getModelToolConfig(options.model).contextWindow).toBe(65536);
  });
});

describe('probe scope', () => {
  it('does not send startup probes to a cloud endpoint', async () => {
    const fetchImpl = routedFetch(() => response({}));
    expect(isLocalRuntimeURL('https://api.openai.com/v1')).toBe(false);
    await expect(probeLocalRuntimeContext({
      model: 'cloud-model',
      baseURL: 'https://api.openai.com/v1',
      fetchImpl,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
