/**
 * Translation between the OpenAI-compatible payload Code Buddy builds and
 * Ollama's native `/api/chat`. Two shapes genuinely differ and both carry an
 * agent loop: assistant tool-call arguments (JSON string vs object) and tool
 * results (bound by `tool_call_id` vs `tool_name`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fromOllamaNativeResponse,
  isOllamaEndpoint,
  isOllamaNativeChatEnabled,
  ollamaNativeChatUrl,
  resetOllamaEndpointCache,
  resolveOllamaEndpoint,
  streamOllamaNative,
  toOllamaNativeMessages,
  toOllamaNativeRequest,
  type FetchLike,
  type OpenAiChatPayload,
} from '../../../src/codebuddy/providers/ollama-native-transport.js';

function payload(extra: Partial<OpenAiChatPayload> = {}): OpenAiChatPayload {
  return {
    model: 'qwen3:4b-instruct',
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 512,
    temperature: 0.3,
    ...extra,
  };
}

function ndjsonBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

describe('isOllamaEndpoint', () => {
  afterEach(() => {
    resetOllamaEndpointCache();
  });

  it('is true when CODEBUDDY_PROVIDER=ollama, including a non-11434 port', () => {
    const env = { CODEBUDDY_PROVIDER: 'ollama' };
    expect(isOllamaEndpoint('http://127.0.0.1:11435/v1', env)).toBe(true);
    expect(isOllamaEndpoint('http://localhost:11434/v1', env)).toBe(true);
  });

  it('matches the origin of OLLAMA_HOST regardless of /v1 suffix', () => {
    const env = { OLLAMA_HOST: 'http://127.0.0.1:11435' };
    expect(isOllamaEndpoint('http://127.0.0.1:11435/v1', env)).toBe(true);
    expect(isOllamaEndpoint('http://127.0.0.1:11435', env)).toBe(true);
    expect(isOllamaEndpoint('http://127.0.0.1:1234/v1', env)).toBe(false);
  });

  it('treats localhost and 127.0.0.1 as the same OLLAMA_HOST origin', () => {
    expect(isOllamaEndpoint('http://127.0.0.1:11435/v1', { OLLAMA_HOST: 'http://localhost:11435' })).toBe(true);
  });

  it('is false for LM Studio / vLLM even on a loopback port', () => {
    expect(isOllamaEndpoint('http://127.0.0.1:11435/v1', { CODEBUDDY_PROVIDER: 'lmstudio' })).toBe(false);
    expect(isOllamaEndpoint('http://127.0.0.1:11435/v1', { CODEBUDDY_PROVIDER: 'vllm' })).toBe(false);
    expect(isOllamaEndpoint('http://127.0.0.1:1234/v1', {})).toBe(false);
    expect(isOllamaEndpoint('https://api.openai.com/v1', {})).toBe(false);
    expect(isOllamaEndpoint('http://ollama.lan:8080/v1', {})).toBe(false);
  });

  it('does not treat :11434 as Ollama without a provider, host, or probe', () => {
    expect(isOllamaEndpoint('http://localhost:11434/v1', {})).toBe(false);
  });
});

describe('resolveOllamaEndpoint', () => {
  afterEach(() => {
    resetOllamaEndpointCache();
  });

  it('probes loopback GET /api/tags (200, ≤ 300 ms) and memos the origin', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    }));
    const url = 'http://127.0.0.1:11435/v1';
    expect(isOllamaEndpoint(url, {})).toBe(false);
    expect(await resolveOllamaEndpoint(url, {}, fetchImpl as FetchLike)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('http://127.0.0.1:11435/api/tags');
    expect(isOllamaEndpoint(url, {})).toBe(true);
    expect(await resolveOllamaEndpoint(url, {}, fetchImpl as FetchLike)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not probe when CODEBUDDY_PROVIDER names another local runtime', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    }));
    expect(await resolveOllamaEndpoint(
      'http://127.0.0.1:11435/v1',
      { CODEBUDDY_PROVIDER: 'lmstudio' },
      fetchImpl as FetchLike,
    )).toBe(false);
    expect(await resolveOllamaEndpoint(
      'http://127.0.0.1:11435/v1',
      { CODEBUDDY_PROVIDER: 'vllm' },
      fetchImpl as FetchLike,
    )).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns false when the tags probe is not 200', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));
    expect(await resolveOllamaEndpoint('http://127.0.0.1:1234/v1', {}, fetchImpl as FetchLike)).toBe(false);
    expect(isOllamaEndpoint('http://127.0.0.1:1234/v1', {})).toBe(false);
  });

  it('returns false when a loopback 200 is not an Ollama tags catalogue', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-mock',
        choices: [{ message: { content: 'bonjour' } }],
      }),
    }));
    expect(await resolveOllamaEndpoint('http://127.0.0.1:4410/v1', {}, fetchImpl as FetchLike)).toBe(false);
  });

  it('does not probe a non-loopback host', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    }));
    expect(await resolveOllamaEndpoint('http://gpu.example:11435/v1', {}, fetchImpl as FetchLike)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('isOllamaNativeChatEnabled', () => {
  it('is on by default and off only for an explicit refusal', () => {
    expect(isOllamaNativeChatEnabled({})).toBe(true);
    expect(isOllamaNativeChatEnabled({ CODEBUDDY_OLLAMA_NATIVE_CHAT: 'false' })).toBe(false);
    expect(isOllamaNativeChatEnabled({ CODEBUDDY_OLLAMA_NATIVE_CHAT: 'OFF' })).toBe(false);
    expect(isOllamaNativeChatEnabled({ CODEBUDDY_OLLAMA_NATIVE_CHAT: 'true' })).toBe(true);
  });
});

describe('ollamaNativeChatUrl', () => {
  it('replaces the OpenAI-compat suffix with the native path', () => {
    expect(ollamaNativeChatUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/api/chat');
    expect(ollamaNativeChatUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/api/chat');
    expect(ollamaNativeChatUrl('http://localhost:11434')).toBe('http://localhost:11434/api/chat');
  });
});

describe('toOllamaNativeRequest', () => {
  it('carries num_ctx and the sampling options the compat endpoint dropped', () => {
    const body = toOllamaNativeRequest(payload(), 32000);

    expect(body).toMatchObject({
      model: 'qwen3:4b-instruct',
      stream: false,
      options: { num_ctx: 32000, num_predict: 512, temperature: 0.3 },
    });
  });

  it('omits num_ctx entirely when no window could be resolved', () => {
    const options = toOllamaNativeRequest(payload(), undefined).options as Record<string, unknown>;
    expect(options.num_ctx).toBeUndefined();
    expect(options.num_predict).toBe(512);
  });

  it('maps JSON mode and the reasoning effort Ollama understands', () => {
    expect(toOllamaNativeRequest(payload({ response_format: { type: 'json_object' } }), 8192).format)
      .toBe('json');
    expect(toOllamaNativeRequest(payload({ reasoning_effort: 'none' }), 8192).think).toBe(false);
    expect(toOllamaNativeRequest(payload({ reasoning_effort: 'high' }), 8192).think).toBe('high');
  });

  it('forces think:false for a thinking model on a one-shot call without tools', () => {
    expect(toOllamaNativeRequest(payload({ model: 'qwen3.8-ctx32k:latest' }), 8192).think).toBe(false);
    expect(toOllamaNativeRequest(payload({ model: 'qwen3:4b-instruct' }), 8192).think).toBe(false);
  });

  it('keeps an explicit thinking level when the operator asked for it', () => {
    expect(toOllamaNativeRequest(
      payload({ model: 'qwen3.8-ctx32k:latest', reasoning_effort: 'high' }),
      8192,
    ).think).toBe('high');
  });

  it('does not force think:false when tools are present outside headless', () => {
    const previous = process.env.CODEBUDDY_HEADLESS;
    delete process.env.CODEBUDDY_HEADLESS;
    try {
      expect(toOllamaNativeRequest(
        payload({ model: 'qwen3.8-ctx32k:latest', tools: [{ type: 'function' }] }),
        8192,
      ).think).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_HEADLESS;
      else process.env.CODEBUDDY_HEADLESS = previous;
    }
  });

  it('keeps tools only when there are any', () => {
    expect(toOllamaNativeRequest(payload(), 8192).tools).toBeUndefined();
    expect(toOllamaNativeRequest(payload({ tools: [{ type: 'function' }] }), 8192).tools).toHaveLength(1);
  });
});

describe('toOllamaNativeMessages', () => {
  it('parses tool-call arguments and re-binds the tool result by name', () => {
    const converted = toOllamaNativeMessages([
      { role: 'user', content: 'read it' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'view_file', arguments: '{"path":"a.ts"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'file body' },
    ]);

    expect(converted[1]?.tool_calls).toEqual([
      { id: 'call_1', function: { name: 'view_file', arguments: { path: 'a.ts' } } },
    ]);
    expect(converted[2]).toMatchObject({ role: 'tool', content: 'file body', tool_name: 'view_file' });
    expect(converted[2]?.tool_call_id).toBeUndefined();
  });

  it('never throws on unparsable arguments or an unmatched tool result', () => {
    const converted = toOllamaNativeMessages([
      { role: 'assistant', tool_calls: [{ id: 'x', function: { name: 'f', arguments: 'not json' } }] },
      { role: 'tool', tool_call_id: 'unknown', content: 'orphan' },
    ]);

    expect(converted[0]?.tool_calls).toEqual([{ id: 'x', function: { name: 'f', arguments: {} } }]);
    expect(converted[1]?.tool_name).toBeUndefined();
  });
});

describe('fromOllamaNativeResponse', () => {
  it('rebuilds the OpenAI chat completion, with arguments back as a string', () => {
    const out = fromOllamaNativeResponse({
      model: 'qwen3:4b-instruct',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'search', arguments: { q: 'x' } } }],
      },
      done: true,
      prompt_eval_count: 12,
      eval_count: 4,
    }, 'fallback') as {
      choices: Array<{ message: { tool_calls?: Array<{ function: { arguments: string } }> }; finish_reason: string }>;
      usage: Record<string, number>;
    };

    expect(out.choices[0]?.finish_reason).toBe('tool_calls');
    expect(out.choices[0]?.message.tool_calls?.[0]?.function.arguments).toBe('{"q":"x"}');
    expect(out.usage).toEqual({ prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 });
  });

  it('maps a truncated answer to the length finish reason and omits absent usage', () => {
    const out = fromOllamaNativeResponse(
      { message: { role: 'assistant', content: 'cut' }, done: true, done_reason: 'length' },
      'qwen3:4b-instruct',
    ) as { model: string; choices: Array<{ finish_reason: string }>; usage?: unknown };

    expect(out.model).toBe('qwen3:4b-instruct');
    expect(out.choices[0]?.finish_reason).toBe('length');
    expect(out.usage).toBeUndefined();
  });
});

describe('streamOllamaNative', () => {
  it('splits NDJSON across reads and only the last chunk finishes', async () => {
    const body = ndjsonBody([
      '{"message":{"role":"assistant","content":"he"}}\n{"message":{"content":"llo"}}\n',
      '{"message":{"content":"!"},"done":true,"done_reason":"stop","prompt_eval_count":2,"eval_count":3}\n',
    ]);

    const chunks = [];
    for await (const chunk of streamOllamaNative(body, 'qwen3:4b-instruct')) chunks.push(chunk);

    expect(chunks.map((c) => c.choices[0]?.delta.content)).toEqual(['he', 'llo', '!']);
    expect(chunks[0]?.choices[0]?.delta.role).toBe('assistant');
    expect(chunks[0]?.choices[0]?.finish_reason).toBeNull();
    expect(chunks[2]?.choices[0]?.finish_reason).toBe('stop');
    expect((chunks[2] as unknown as { usage?: Record<string, number> }).usage?.total_tokens).toBe(5);
  });

  it('handles a final line with no trailing newline and skips a malformed one', async () => {
    const body = ndjsonBody([
      '{"message":{"content":"a"}}\nnot-json\n{"message":{"content":"b"},"done":true}',
    ]);

    const chunks = [];
    for await (const chunk of streamOllamaNative(body, 'qwen3:4b-instruct')) chunks.push(chunk);

    expect(chunks.map((c) => c.choices[0]?.delta.content)).toEqual(['a', 'b']);
  });

  it('refuses an empty body rather than yielding nothing silently', async () => {
    await expect(async () => {
      for await (const _ of streamOllamaNative(null, 'qwen3:4b-instruct')) { /* unreachable */ }
    }).rejects.toThrow(/empty response body/);
  });
});
