import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatProvider } from '../../../src/codebuddy/providers/provider-openai-compat.js';

function makeProvider(baseURL: string, model: string): OpenAICompatProvider {
  return new OpenAICompatProvider({
    apiKey: 'test-key',
    baseURL,
    model,
    defaultMaxTokens: 128,
    getCircuitBreakerConfig: () => undefined,
  });
}

function stubChat(provider: OpenAICompatProvider): ReturnType<typeof vi.fn> {
  const create = vi.fn().mockResolvedValue({
    id: 'response-id',
    choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  (provider as unknown as { client: unknown }).client = {
    chat: { completions: { create } },
  };
  return create;
}

describe('OpenAI reasoning request parameters', () => {
  it('uses max_completion_tokens and omits temperature for o-series chat', async () => {
    const provider = makeProvider('https://api.openai.com/v1', 'o3');
    const create = stubChat(provider);

    await provider.chat([{ role: 'user', content: 'Solve this' }], [], {
      maxTokens: 4_096,
      temperature: 0.2,
    });

    const payload = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.max_completion_tokens).toBe(4_096);
    expect(payload).not.toHaveProperty('max_tokens');
    expect(payload).not.toHaveProperty('temperature');
  });

  it('adapts GPT-5 streaming requests', async () => {
    const provider = makeProvider('https://api.openai.com/v1', 'gpt-5.6');
    const create = vi.fn().mockResolvedValue(
      (async function* () {
        yield {
          id: 'response-id',
          choices: [{ delta: { content: 'ok' }, finish_reason: 'stop', index: 0 }],
        };
      })()
    );
    (provider as unknown as { client: unknown }).client = {
      chat: { completions: { create } },
    };

    for await (const _chunk of provider.chatStream(
      [{ role: 'user', content: 'Solve this' }],
      [],
      { maxTokens: 2_048, temperature: 0.4 }
    )) {
      // Drain the generator so the request is issued.
    }

    const payload = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.max_completion_tokens).toBe(2_048);
    expect(payload).not.toHaveProperty('max_tokens');
    expect(payload).not.toHaveProperty('temperature');
  });

  it('keeps standard parameters for non-reasoning OpenAI models', async () => {
    const provider = makeProvider('https://api.openai.com/v1', 'gpt-4.1');
    const create = stubChat(provider);

    await provider.chat([{ role: 'user', content: 'Hello' }], [], {
      maxTokens: 1_024,
      temperature: 0.3,
    });

    const payload = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.max_tokens).toBe(1_024);
    expect(payload.temperature).toBe(0.3);
    expect(payload).not.toHaveProperty('max_completion_tokens');
  });

  it('does not rewrite reasoning-like model names on other backends', async () => {
    const provider = makeProvider('https://api.x.ai/v1', 'o3-compatible');
    const create = stubChat(provider);

    await provider.chat([{ role: 'user', content: 'Hello' }], [], {
      maxTokens: 512,
      temperature: 0.5,
    });

    const payload = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.max_tokens).toBe(512);
    expect(payload.temperature).toBe(0.5);
    expect(payload).not.toHaveProperty('max_completion_tokens');
  });
});
