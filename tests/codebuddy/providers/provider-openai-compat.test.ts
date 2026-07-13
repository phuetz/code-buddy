import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerMocks = vi.hoisted(() => ({
  create: vi.fn(),
  getModelInfo: vi.fn(() => ({ provider: 'xai' })),
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: providerMocks.create } };
  }

  return { default: MockOpenAI };
});

vi.mock('../../../src/utils/model-utils.js', () => ({
  getModelInfo: providerMocks.getModelInfo,
}));

vi.mock('../../../src/utils/retry.js', () => ({
  retry: vi.fn((fn: () => Promise<unknown>) => fn()),
  RetryStrategies: { llmApi: {} },
  RetryPredicates: { llmApiError: vi.fn(() => false) },
}));

vi.mock('../../../src/agent/extended-thinking.js', () => ({
  getExtendedThinking: () => ({ getThinkingConfig: () => ({}) }),
}));

import { OpenAICompatProvider } from '../../../src/codebuddy/providers/provider-openai-compat.js';

function createProvider(
  baseURL = 'https://api.x.ai/v1',
  model = 'grok-code-fast-1',
): OpenAICompatProvider {
  return new OpenAICompatProvider({
    apiKey: 'test-key',
    baseURL,
    model,
    defaultMaxTokens: 8192,
    getCircuitBreakerConfig: () => undefined,
  });
}

function successResponse() {
  return {
    choices: [{
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop',
    }],
  };
}

async function* successStream() {
  yield {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'grok-code-fast-1',
    choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
  };
}

beforeEach(() => {
  providerMocks.create.mockReset();
  providerMocks.getModelInfo.mockReset().mockReturnValue({ provider: 'xai' });
});

describe('OpenAICompatProvider request payloads', () => {
  it('omits tools and tool_choice from non-streaming requests without tools', async () => {
    providerMocks.create.mockResolvedValueOnce(successResponse());

    await createProvider().chat([{ role: 'user', content: 'hello' }], []);

    const payload = providerMocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('tools');
    expect(payload).not.toHaveProperty('tool_choice');
  });

  it('omits tools and tool_choice from streaming requests without tools', async () => {
    providerMocks.create.mockResolvedValueOnce(successStream());

    for await (const _chunk of createProvider().chatStream(
      [{ role: 'user', content: 'hello' }],
      [],
    )) { /* drain */ }

    const payload = providerMocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('tools');
    expect(payload).not.toHaveProperty('tool_choice');
  });

  it('uses reasoning-compatible token parameters for OpenAI o-series chat', async () => {
    providerMocks.create.mockResolvedValueOnce(successResponse());

    await createProvider('https://api.openai.com/v1', 'o3').chat(
      [{ role: 'user', content: 'solve this' }],
      [],
      { maxTokens: 4096 },
    );

    const payload = providerMocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.max_completion_tokens).toBe(4096);
    expect(payload).not.toHaveProperty('max_tokens');
    expect(payload).not.toHaveProperty('temperature');
  });

  it('uses reasoning-compatible token parameters for OpenAI o-series streams', async () => {
    providerMocks.create.mockResolvedValueOnce(successStream());

    for await (const _chunk of createProvider('https://api.openai.com/v1', 'o3-mini').chatStream(
      [{ role: 'user', content: 'solve this' }],
      [],
      { maxTokens: 2048 },
    )) { /* drain */ }

    const payload = providerMocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.max_completion_tokens).toBe(2048);
    expect(payload).not.toHaveProperty('max_tokens');
    expect(payload).not.toHaveProperty('temperature');
  });

  it('keeps standard parameters for non-reasoning OpenAI models', async () => {
    providerMocks.create.mockResolvedValueOnce(successResponse());

    await createProvider('https://api.openai.com/v1', 'gpt-4.1').chat(
      [{ role: 'user', content: 'hello' }],
      [],
      { maxTokens: 1024, temperature: 0.2 },
    );

    const payload = providerMocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.max_tokens).toBe(1024);
    expect(payload.temperature).toBe(0.2);
    expect(payload).not.toHaveProperty('max_completion_tokens');
  });

  it('does not rewrite reasoning-like model names on non-OpenAI backends', async () => {
    providerMocks.create.mockResolvedValueOnce(successResponse());

    await createProvider('https://api.x.ai/v1', 'o3-compatible').chat(
      [{ role: 'user', content: 'hello' }],
      [],
      { maxTokens: 512, temperature: 0.4 },
    );

    const payload = providerMocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.max_tokens).toBe(512);
    expect(payload.temperature).toBe(0.4);
    expect(payload).not.toHaveProperty('max_completion_tokens');
  });
});

describe('OpenAICompatProvider tool-support probe', () => {
  it('re-probes after a transient failure instead of caching false', async () => {
    providerMocks.getModelInfo.mockReturnValue({ provider: 'unknown' });
    const networkError = new Error('socket hang up');
    Object.assign(networkError, { code: 'ECONNRESET' });
    providerMocks.create
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({
        choices: [{
          message: {
            tool_calls: [{ id: 'call-1', function: { name: 'get_current_time', arguments: '{}' } }],
          },
        }],
      });
    const provider = createProvider('https://example.test/v1', 'plain-model-a');

    await expect(provider.probeToolSupport()).resolves.toBe(false);
    await expect(provider.probeToolSupport()).resolves.toBe(true);

    expect(providerMocks.create).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cached result when the model changes', async () => {
    providerMocks.getModelInfo.mockReturnValue({ provider: 'unknown' });
    providerMocks.create
      .mockResolvedValueOnce({ choices: [{ message: { content: 'no tool call' } }] })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            tool_calls: [{ id: 'call-2', function: { name: 'get_current_time', arguments: '{}' } }],
          },
        }],
      });
    const provider = createProvider('https://example.test/v1', 'plain-model-a');

    await expect(provider.probeToolSupport()).resolves.toBe(false);
    provider.setModel('plain-model-b');
    await expect(provider.probeToolSupport()).resolves.toBe(true);

    expect(providerMocks.create).toHaveBeenCalledTimes(2);
    expect((providerMocks.create.mock.calls[1]?.[0] as Record<string, unknown>).model)
      .toBe('plain-model-b');
  });
});

describe('OpenAICompatProvider local transcript conversion', () => {
  it('normalizes tool messages in non-streaming chat requests', async () => {
    providerMocks.getModelInfo.mockReturnValue({ provider: 'lmstudio' });
    providerMocks.create.mockResolvedValueOnce(successResponse());
    const messages = [
      { role: 'user', content: 'read the file' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call-1', name: 'read_file', content: 'file contents' },
    ];

    await createProvider('http://127.0.0.1:1234/v1', 'plain-local').chat(
      messages as Parameters<OpenAICompatProvider['chat']>[0],
      [],
    );

    const payload = providerMocks.create.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string | null; tool_calls?: unknown[] }>;
    };
    expect(payload.messages.every(message => message.role !== 'tool')).toBe(true);
    expect(payload.messages[1]).toMatchObject({
      role: 'assistant',
      content: '[Tools Used]\nCalled read_file({"path":"a.ts"})',
    });
    expect(payload.messages[1]).not.toHaveProperty('tool_calls');
    expect(payload.messages[2]).toEqual({
      role: 'user',
      content: '[Tool Result]\nfile contents',
    });
  });
});
