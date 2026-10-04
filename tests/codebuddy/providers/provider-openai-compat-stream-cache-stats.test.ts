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
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v4.1-flash',
    defaultMaxTokens: 8192,
    getCircuitBreakerConfig: () => undefined,
  });
}

/** Flux réel d'OpenRouter : un chunk de contenu puis un chunk `usage` sans choix. */
async function* streamWithUsage(usage: Record<string, unknown>) {
  yield {
    id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm',
    choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
  };
  yield { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage };
}

async function drain(provider: OpenAICompatProvider): Promise<void> {
  for await (const _chunk of provider.chatStream([{ role: 'user', content: 'x' }], [])) { /* drain */ }
}

beforeEach(() => {
  providerMocks.create.mockReset();
  providerMocks.getModelInfo.mockReset().mockReturnValue({ provider: 'xai' });
});

describe('OpenAICompatProvider.chatStream — jetons en cache', () => {
  it('compte les cached_tokens renvoyés dans le chunk usage du flux', async () => {
    providerMocks.create.mockResolvedValueOnce(streamWithUsage({
      prompt_tokens: 10_000,
      completion_tokens: 50,
      total_tokens: 10_050,
      prompt_tokens_details: { cached_tokens: 9_000 },
    }));
    const provider = createProvider();
    await drain(provider);
    const stats = provider.getPromptCacheStats();
    expect(stats.hits).toBe(9_000);
    expect(stats.misses).toBe(1_000);
    expect(stats.hitRatio).toBeCloseTo(0.9, 5);
  });

  it('cumule plusieurs requêtes et compte un échec complet comme manques', async () => {
    providerMocks.create
      .mockResolvedValueOnce(streamWithUsage({ prompt_tokens: 4_000, completion_tokens: 5, total_tokens: 4_005, prompt_tokens_details: { cached_tokens: 0 } }))
      .mockResolvedValueOnce(streamWithUsage({ prompt_tokens: 4_100, completion_tokens: 5, total_tokens: 4_105, prompt_tokens_details: { cached_tokens: 3_900 } }));
    const provider = createProvider();
    await drain(provider);
    await drain(provider);
    const stats = provider.getPromptCacheStats();
    expect(stats.hits).toBe(3_900);
    expect(stats.misses).toBe(4_000 + 200);
  });

  it('ne change rien quand le flux ne renvoie pas de usage', async () => {
    providerMocks.create.mockResolvedValueOnce((async function* () {
      yield { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] };
    })());
    const provider = createProvider();
    await drain(provider);
    expect(provider.getPromptCacheStats()).toEqual({ hits: 0, misses: 0, hitRatio: 0 });
  });
});
