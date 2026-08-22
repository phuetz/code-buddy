import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate, openAIConstructorCalls } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  openAIConstructorCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };

    constructor(options: Record<string, unknown>) {
      openAIConstructorCalls.push(options);
    }
  }

  return {
    __esModule: true,
    default: MockOpenAI,
  };
});

vi.mock('../../src/utils/model-utils', () => ({
  validateModel: vi.fn(),
  getModelInfo: vi.fn().mockReturnValue({
    maxTokens: 8192,
    provider: 'xai',
    isSupported: true,
  }),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/utils/retry.js', () => ({
  retry: vi.fn((fn: () => Promise<unknown>) => fn()),
  RetryStrategies: {
    llmApi: { maxRetries: 1, baseDelay: 1 },
  },
  RetryPredicates: {
    llmApiError: vi.fn().mockReturnValue(true),
  },
}));

import { CodeBuddyClient } from '../../src/codebuddy/client.js';

const fallbackEnvKeys = [
  'CODEBUDDY_FALLBACK_PROVIDERS',
  'CODEBUDDY_FALLBACK_PROVIDER',
  'CODEBUDDY_FALLBACK_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_BASE_URL',
];

describe('CodeBuddyClient provider fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openAIConstructorCalls.length = 0;
    for (const key of fallbackEnvKeys) {
      delete process.env[key];
    }
  });

  it('tries the configured fallback provider when the primary chat call throws', async () => {
    process.env.CODEBUDDY_FALLBACK_PROVIDERS = 'openai:gpt-4o';
    process.env.OPENAI_API_KEY = 'fallback-openai-key';

    mockCreate
      .mockRejectedValueOnce(new Error('primary rate limited'))
      .mockResolvedValueOnce({
        choices: [
          { message: { role: 'assistant', content: 'fallback ok' }, finish_reason: 'stop' },
        ],
      });

    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1');
    const response = await client.chat([{ role: 'user', content: 'hello' }], []);

    expect(response.choices[0]?.message.content).toBe('fallback ok');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ model: 'grok-code-fast-1' });
    expect(mockCreate.mock.calls[1][0]).toMatchObject({ model: 'gpt-4o' });
    expect(openAIConstructorCalls).toEqual([
      expect.objectContaining({
        apiKey: 'primary-key',
        baseURL: 'https://api.x.ai/v1',
      }),
      expect.objectContaining({
        apiKey: 'fallback-openai-key',
        baseURL: 'https://api.openai.com/v1',
      }),
    ]);
  });

  it('does not recurse into fallback when the request disables provider fallback', async () => {
    process.env.CODEBUDDY_FALLBACK_PROVIDERS = 'openai:gpt-4o';
    process.env.OPENAI_API_KEY = 'fallback-openai-key';
    mockCreate.mockRejectedValueOnce(new Error('primary failed'));

    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1');

    await expect(client.chat(
      [{ role: 'user', content: 'hello' }],
      [],
      { disableProviderFallback: true },
    )).rejects.toThrow('primary failed');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('does not start a chat fallback after caller cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new Error('aborted');
    error.name = 'AbortError';
    mockCreate.mockRejectedValueOnce(error);

    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [
        {
          provider: 'openai',
          label: 'OpenAI',
          apiMode: 'openai-compatible',
          authMode: 'api-key',
          apiKey: 'fallback-openai-key',
          baseURL: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4o',
          source: 'override',
          model: 'gpt-4o',
          rawSpec: 'openai:gpt-4o',
          fallbackSource: 'environment',
        },
      ],
    });

    await expect(client.chat(
      [{ role: 'user', content: 'hello' }],
      [],
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('tries same-provider credential pools before cross-provider fallbacks', async () => {
    const markFailed = vi.fn();
    const markSuccess = vi.fn();

    mockCreate
      .mockRejectedValueOnce(new Error('primary rate limited'))
      .mockRejectedValueOnce(new Error('pool key rate limited'))
      .mockResolvedValueOnce({
        choices: [
          { message: { role: 'assistant', content: 'cross-provider ok' }, finish_reason: 'stop' },
        ],
      });

    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      credentialPoolProviders: [
        {
          provider: 'grok',
          label: 'Grok (xAI)',
          apiMode: 'openai-compatible',
          authMode: 'api-key',
          apiKey: 'pool-key',
          baseURL: 'https://api.x.ai/v1',
          defaultModel: 'grok-code-fast-1',
          source: 'override',
          model: 'grok-code-fast-1',
          rawSpec: 'auth-profile:xai-pool-key',
          fallbackSource: 'auth-profile',
          profileId: 'xai-pool-key',
          profileManager: {
            getHealthyProfiles: vi.fn().mockReturnValue([]),
            markFailed,
            markSuccess,
          },
        },
      ],
      fallbackProviders: [
        {
          provider: 'openai',
          label: 'OpenAI',
          apiMode: 'openai-compatible',
          authMode: 'api-key',
          apiKey: 'fallback-openai-key',
          baseURL: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4o',
          source: 'override',
          model: 'gpt-4o',
          rawSpec: 'openai:gpt-4o',
          fallbackSource: 'environment',
        },
      ],
    });

    const response = await client.chat([{ role: 'user', content: 'hello' }], []);

    expect(response.choices[0]?.message.content).toBe('cross-provider ok');
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockCreate.mock.calls.map((call) => call[0].model)).toEqual([
      'grok-code-fast-1',
      'grok-code-fast-1',
      'gpt-4o',
    ]);
    expect(markFailed).toHaveBeenCalledWith(
      'xai-pool-key',
      expect.stringContaining('pool key rate limited'),
      false,
    );
    expect(markSuccess).not.toHaveBeenCalled();
  });

  it('streams from a fallback provider when the primary stream fails before first chunk', async () => {
    async function* fallbackStream() {
      yield { choices: [{ delta: { content: 'stream fallback' }, index: 0 }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] };
    }

    mockCreate
      .mockRejectedValueOnce(new Error('primary stream unavailable'))
      .mockResolvedValueOnce(fallbackStream());

    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [
        {
          provider: 'openai',
          label: 'OpenAI',
          apiMode: 'openai-compatible',
          authMode: 'api-key',
          apiKey: 'fallback-openai-key',
          baseURL: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4o',
          source: 'override',
          model: 'gpt-4o',
          rawSpec: 'openai:gpt-4o',
          fallbackSource: 'environment',
        },
      ],
    });

    const chunks = [];
    for await (const chunk of client.chatStream([{ role: 'user', content: 'hello' }], [])) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.choices[0]?.delta.content).toBe('stream fallback');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls.map((call) => call[0].model)).toEqual([
      'grok-code-fast-1',
      'gpt-4o',
    ]);
  });

  it('does not restart on fallback after a partial primary stream', async () => {
    async function* partialPrimaryStream() {
      yield { choices: [{ delta: { content: 'partial' }, index: 0 }] };
      throw new Error('stream broke after first chunk');
    }

    mockCreate.mockResolvedValueOnce(partialPrimaryStream());

    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [
        {
          provider: 'openai',
          label: 'OpenAI',
          apiMode: 'openai-compatible',
          authMode: 'api-key',
          apiKey: 'fallback-openai-key',
          baseURL: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4o',
          source: 'override',
          model: 'gpt-4o',
          rawSpec: 'openai:gpt-4o',
          fallbackSource: 'environment',
        },
      ],
    });

    const chunks = [];
    await expect(async () => {
      for await (const chunk of client.chatStream([{ role: 'user', content: 'hello' }], [])) {
        chunks.push(chunk);
      }
    }).rejects.toThrow('stream broke after first chunk');

    expect(chunks).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('does not start a stream fallback after caller cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new Error('aborted');
    error.name = 'AbortError';
    mockCreate.mockRejectedValueOnce(error);

    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [
        {
          provider: 'openai',
          label: 'OpenAI',
          apiMode: 'openai-compatible',
          authMode: 'api-key',
          apiKey: 'fallback-openai-key',
          baseURL: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4o',
          source: 'override',
          model: 'gpt-4o',
          rawSpec: 'openai:gpt-4o',
          fallbackSource: 'environment',
        },
      ],
    });

    await expect(async () => {
      for await (const _chunk of client.chatStream(
        [{ role: 'user', content: 'hello' }],
        [],
        { signal: controller.signal },
      )) { /* drain */ }
    }).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockCreate).toHaveBeenCalledOnce();
  });
});
