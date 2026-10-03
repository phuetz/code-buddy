import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  OpenAICompatProvider,
  mergeSystemMessagesToFront,
} from '../../../src/codebuddy/providers/provider-openai-compat.js';
import { resetOllamaEndpointCache } from '../../../src/codebuddy/providers/ollama-native-transport.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import { withLlmStreamRetry } from '../../../src/codebuddy/llm-retry.js';

/**
 * Regression: Qwen3 (and other strict Jinja chat templates served by Ollama /
 * LM Studio / vLLM) raise "System message must be at the beginning" — surfaced
 * as HTTP 400 "Unable to generate parser for this template" — whenever a second
 * or late `system` message appears. Code Buddy injects per-turn `<todo_context>`
 * etc. as `system` messages appended AFTER the conversation, which tripped it.
 *
 * The provider must normalize the payload for local runtimes so exactly one
 * `system` message is emitted, in position 0.
 */
describe('mergeSystemMessagesToFront (pure)', () => {
  it('leaves a single leading system message and folds a late one into the preceding user turn', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'base system prompt' },
      { role: 'user', content: 'Reply PONG' },
      { role: 'system', content: '<todo_context>none</todo_context>' },
    ];

    const out = mergeSystemMessagesToFront(messages);

    const systemCount = out.filter((m) => m.role === 'system').length;
    expect(systemCount).toBe(1);
    expect(out[0]?.role).toBe('system');
    expect(out[0]?.content).toBe('base system prompt');
    // Non-system messages keep their relative order.
    expect(out.slice(1).map((m) => m.role)).toEqual(['user']);
    expect(out[1]?.content).toBe('Reply PONG\n\n<system_note>\n<todo_context>none</todo_context>\n</system_note>');
    // The caller's history is not mutated.
    expect(messages[1]?.content).toBe('Reply PONG');
  });

  it('folds a late system message into the preceding user turn (no system left)', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'late system' },
    ];
    const out = mergeSystemMessagesToFront(messages);
    expect(out.map((m) => m.role)).toEqual(['user']);
    expect(out[0]?.content).toBe('hi\n\n<system_note>\nlate system\n</system_note>');
  });

  it('still merges into the head a late system message that follows an assistant turn', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yo' },
      { role: 'system', content: 'late' },
    ];
    const out = mergeSystemMessagesToFront(messages);
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(out[0]?.content).toBe('sys\n\nlate');
  });

  // Banc harnais 03/10 (qwen3.5:4b, Ollama): a context-warning note whose
  // percentage changed every request rewrote message 0 → full prompt re-eval.
  it('keeps the head byte-identical across requests when only the per-turn note changes', () => {
    const conversation = (note: string): CodeBuddyMessage[] => [
      { role: 'system', content: 'base system prompt' },
      { role: 'user', content: 'Corrige le bug' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'view_file', arguments: '{}' } }] } as CodeBuddyMessage,
      { role: 'tool', content: 'file body', tool_call_id: 'c1' } as CodeBuddyMessage,
      { role: 'system', content: note },
    ];
    const first = mergeSystemMessagesToFront(conversation('<context type="middleware-hint">86.9% used</context>'));
    const second = mergeSystemMessagesToFront(conversation('<context type="middleware-hint">105.9% used</context>'));
    expect(JSON.stringify(second.slice(0, 3))).toBe(JSON.stringify(first.slice(0, 3)));
    expect(second[3]?.content).toContain('105.9% used');
  });

  it('is a no-op (same reference) when already compliant', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yo' },
    ];
    expect(mergeSystemMessagesToFront(messages)).toBe(messages);
  });

  it('is a no-op when there is no system message', () => {
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'hi' }];
    expect(mergeSystemMessagesToFront(messages)).toBe(messages);
  });

  it('flattens array-part system content when merging', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'part-a' }] },
      { role: 'system', content: 'part-b' },
      { role: 'user', content: 'hi' },
    ];
    const out = mergeSystemMessagesToFront(messages);
    expect(out[0]?.content).toBe('part-a\n\npart-b');
  });
});

describe('OpenAICompatProvider — system-message normalization by runtime', () => {
  afterEach(() => {
    resetOllamaEndpointCache();
    vi.unstubAllGlobals();
    delete process.env.CODEBUDDY_PROVIDER;
  });

  function makeProvider(baseURL: string, model: string): OpenAICompatProvider {
    return new OpenAICompatProvider({
      apiKey: 'test-key',
      baseURL,
      model,
      defaultMaxTokens: 128,
      getCircuitBreakerConfig: () => undefined,
    });
  }

  function stubClient(provider: OpenAICompatProvider): { create: ReturnType<typeof vi.fn> } {
    const create = vi.fn().mockResolvedValue({
      id: 'x',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    // Replace the OpenAI SDK client on the instance so no network call happens.
    (provider as unknown as { client: unknown }).client = {
      chat: { completions: { create } },
    };
    return { create };
  }

  /**
   * Ollama is served over its NATIVE `/api/chat` (that is the only endpoint
   * that honours `options.num_ctx`), so for that runtime the normalized
   * payload must be read off the wire, not off the SDK stub. The assertion
   * itself is unchanged: exactly one `system` message, in position 0.
   */
  function stubOllamaWire(): { seen: () => Array<Record<string, unknown>>; urls: () => string[] } {
    const bodies: Array<Record<string, unknown>> = [];
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      urls.push(String(url));
      if (init?.body) bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ message: { role: 'assistant', content: 'ok' }, done: true }),
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(
              '{"message":{"role":"assistant","content":"ok"},"done":true,"done_reason":"stop"}\n',
            ));
            controller.close();
          },
        }),
      };
    }));
    return { seen: () => bodies, urls: () => urls };
  }

  const scattered: CodeBuddyMessage[] = [
    { role: 'system', content: 'base system prompt' },
    { role: 'user', content: 'Reply PONG' },
    { role: 'system', content: '<todo_context>none</todo_context>' },
  ];

  it('retries an incomplete native stream through the provider when the caller owns retries', async () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    const provider = makeProvider('http://127.0.0.1:11434/v1', 'qwen3.8:27b');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"message":{"thinking":"unfinished"},"done":false}\n'))
      .mockResolvedValueOnce(new Response('{"message":{"content":"recovered"},"done":true}\n'));
    vi.stubGlobal('fetch', fetchMock);
    const chunks = [];
    for await (const chunk of withLlmStreamRetry(
      () => provider.chatStream(structuredClone(scattered), undefined, { retryOwner: 'caller', streamRetry: false }),
      { maxRetries: 1, baseDelayMs: 1 },
    )) chunks.push(chunk);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks.some(chunk => chunk.type === 'retry')).toBe(true);
    expect(chunks.some(chunk => chunk.type === 'value' && chunk.value.choices?.[0]?.delta.content === 'recovered')).toBe(true);
  });

  it.each([['', undefined], ['none', false], ['high', 'high']])(
    'Ollama agentic headless: effort opérateur %s conservé sans défaut none', async (effort, expected) => {
      vi.stubEnv('CODEBUDDY_PROVIDER', 'ollama');
      vi.stubEnv('CODEBUDDY_HEADLESS', 'true');
      vi.stubEnv('CODEBUDDY_OLLAMA_REASONING_EFFORT', effort as string);
      const provider = makeProvider('http://127.0.0.1:11434/v1', 'qwen3.6:35b-a3b-q4_K_M');
      const { seen } = stubOllamaWire();
      const tools = [{ type: 'function' as const, function: { name: 'bash', description: 'Shell', parameters: { type: 'object', properties: { command: { type: 'string' } } } } }];
      try {
        for await (const _ of provider.chatStream([{ role: 'user', content: 'Fix and test the regression' }], tools)) { /* consume */ }
        const body = seen().find(request => Array.isArray(request.tools) && request.tools.length > 0);
        expect(body).toBeDefined();
        expect(body?.think).toBe(expected);
      } finally { vi.unstubAllEnvs(); }
    },
  );

  it('LOCAL (Ollama): emits exactly one system message in position 0', async () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    const provider = makeProvider('http://127.0.0.1:11434/v1', 'qwen3.8:27b');
    const { seen } = stubOllamaWire();

    try {
      await provider.chat(structuredClone(scattered));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(seen()).toHaveLength(1);
    const sent = seen()[0]!.messages as CodeBuddyMessage[];
    const systemMsgs = sent.filter((m) => m.role === 'system');
    expect(systemMsgs).toHaveLength(1);
    expect(sent[0]?.role).toBe('system');
  });

  it('LOCAL (Ollama): also normalizes on the streaming path', async () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    const provider = makeProvider('http://127.0.0.1:11434/v1', 'qwen3.8:27b');
    const { seen } = stubOllamaWire();

    try {
      const gen = provider.chatStream(structuredClone(scattered));
      // Drain the generator so the request is actually issued.

      for await (const _ of gen) { /* consume */ }
    } finally {
      vi.unstubAllGlobals();
    }

    expect(seen()).toHaveLength(1);
    expect(seen()[0]).toMatchObject({ stream: true });
    const sent = seen()[0]!.messages as CodeBuddyMessage[];
    expect(sent.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(sent[0]?.role).toBe('system');
  });

  it('LOCAL (Ollama on 11435): CODEBUDDY_PROVIDER=ollama routes to native /api/chat', async () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    const { urls } = stubOllamaWire();
    const provider = makeProvider('http://127.0.0.1:11435/v1', 'qwen3.8-ctx32k:latest');
    try {
      await provider.chat([{ role: 'user', content: 'haiku' }]);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(urls().some((url) => url.endsWith('/api/chat'))).toBe(true);
    expect(urls().some((url) => url.includes('/v1/chat/completions'))).toBe(false);
  });

  it('LOCAL (Ollama multimodal): uses the bounded native endpoint with image parts', async () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    const { urls, seen } = stubOllamaWire();
    const provider = makeProvider('http://127.0.0.1:11435/v1', 'moondream');
    const { create } = stubClient(provider);
    try {
      await provider.chat([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aGVsbG8=' } },
          ],
        } as never,
      ]);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(create).not.toHaveBeenCalled();
    expect(urls().some(url => url.endsWith('/api/chat'))).toBe(true);
    expect(seen().at(-1)).toMatchObject({
      messages: [{ role: 'user', content: 'describe', images: ['aGVsbG8='] }],
      options: { num_ctx: expect.any(Number), num_predict: expect.any(Number) },
    });
  });

  it('LOCAL (LM Studio on 11435): stays on the OpenAI-compat /v1 SDK path', async () => {
    process.env.CODEBUDDY_PROVIDER = 'lmstudio';
    const { urls } = stubOllamaWire();
    const provider = makeProvider('http://127.0.0.1:11435/v1', 'qwen3.8-ctx32k:latest');
    const { create } = stubClient(provider);
    try {
      await provider.chat([{ role: 'user', content: 'haiku' }]);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(create).toHaveBeenCalledTimes(1);
    expect(urls()).toEqual([]);
  });

  it('LOCAL (vLLM on 11435): stays on the OpenAI-compat /v1 SDK path', async () => {
    process.env.CODEBUDDY_PROVIDER = 'vllm';
    const { urls } = stubOllamaWire();
    const provider = makeProvider('http://127.0.0.1:11435/v1', 'qwen3.8-ctx32k:latest');
    const { create } = stubClient(provider);
    try {
      await provider.chat([{ role: 'user', content: 'haiku' }]);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(create).toHaveBeenCalledTimes(1);
    expect(urls()).toEqual([]);
  });

  it('CLOUD (xAI/Grok): leaves the scattered system order untouched', async () => {
    const provider = makeProvider('https://api.x.ai/v1', 'grok-3');
    const { create } = stubClient(provider);

    await provider.chat(structuredClone(scattered));

    const sent = (create.mock.calls[0]![0] as { messages: CodeBuddyMessage[] }).messages;
    // Byte-identical ordering: two system messages, the second still last.
    expect(sent.filter((m) => m.role === 'system')).toHaveLength(2);
    expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'system']);
  });
});
