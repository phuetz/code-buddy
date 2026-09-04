import { describe, it, expect, vi } from 'vitest';
import {
  OpenAICompatProvider,
  mergeSystemMessagesToFront,
} from '../../../src/codebuddy/providers/provider-openai-compat.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';

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
  it('merges multiple system messages into a single leading one', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'base system prompt' },
      { role: 'user', content: 'Reply PONG' },
      { role: 'system', content: '<todo_context>none</todo_context>' },
    ];

    const out = mergeSystemMessagesToFront(messages);

    const systemCount = out.filter((m) => m.role === 'system').length;
    expect(systemCount).toBe(1);
    expect(out[0]?.role).toBe('system');
    expect(out[0]?.content).toBe('base system prompt\n\n<todo_context>none</todo_context>');
    // Non-system messages keep their relative order.
    expect(out.slice(1).map((m) => m.role)).toEqual(['user']);
    expect(out[1]?.content).toBe('Reply PONG');
  });

  it('moves a single non-leading system message to the front', () => {
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'late system' },
    ];
    const out = mergeSystemMessagesToFront(messages);
    expect(out.map((m) => m.role)).toEqual(['system', 'user']);
    expect(out[0]?.content).toBe('late system');
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
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'part-b' },
    ];
    const out = mergeSystemMessagesToFront(messages);
    expect(out[0]?.content).toBe('part-a\n\npart-b');
  });
});

describe('OpenAICompatProvider — system-message normalization by runtime', () => {
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
  function stubOllamaWire(): { seen: () => Array<Record<string, unknown>> } {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
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
    return { seen: () => bodies };
  }

  const scattered: CodeBuddyMessage[] = [
    { role: 'system', content: 'base system prompt' },
    { role: 'user', content: 'Reply PONG' },
    { role: 'system', content: '<todo_context>none</todo_context>' },
  ];

  it('LOCAL (Ollama): emits exactly one system message in position 0', async () => {
    const provider = makeProvider('http://localhost:11434/v1', 'qwen3.8:27b');
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
