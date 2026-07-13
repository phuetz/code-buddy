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

function createProvider(): OpenAICompatProvider {
  return new OpenAICompatProvider({
    apiKey: 'test-key',
    baseURL: 'https://api.x.ai/v1',
    model: 'grok-code-fast-1',
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
});
