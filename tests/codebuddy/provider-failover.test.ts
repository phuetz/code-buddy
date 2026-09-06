import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

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

vi.mock('../../src/providers/provider-failover-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers/provider-failover-policy.js')>();
  return {
    ...actual,
    resolveDefaultFailoverProviders: vi.fn(async () => []),
  };
});

import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import { logger } from '../../src/utils/logger.js';
import type { RuntimeFallbackProvider } from '../../src/providers/provider-fallback.js';
import {
  isProviderUnavailable,
  readProviderHealthSnapshot,
  resetProviderHealthStoreForTests,
  setProviderHealthPathForTests,
} from '../../src/providers/provider-health.js';
import { getGlobalEventBus, resetEventBus } from '../../src/events/event-bus.js';

function quotaError(): Error {
  const err = new Error(
    'ChatGPT Responses backend error (429): {"type":"usage_limit_reached","resets_in_seconds":68400}',
  ) as Error & { status: number; type: string; resets_in_seconds: number };
  err.status = 429;
  err.type = 'usage_limit_reached';
  err.resets_in_seconds = 68400;
  return err;
}

function overloadError(): Error {
  const err = new Error('service unavailable') as Error & { status: number };
  err.status = 503;
  return err;
}

function authError(): Error {
  const err = new Error('401 Unauthorized') as Error & { status: number };
  err.status = 401;
  return err;
}

function okResponse(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

function openaiFallback(model = 'gpt-4o'): RuntimeFallbackProvider {
  return {
    provider: 'openai',
    label: 'OpenAI',
    apiMode: 'openai-compatible',
    authMode: 'api-key',
    apiKey: 'fallback-openai-key',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: model,
    source: 'override',
    model,
    rawSpec: `openai:${model}`,
    fallbackSource: 'environment',
  };
}

const envKeys = [
  'CODEBUDDY_PROVIDER_FALLBACK',
  'CODEBUDDY_FALLBACK_CHAIN',
  'CODEBUDDY_FALLBACK_PROVIDERS',
  'CODEBUDDY_LOCAL_ONLY',
  'OPENAI_API_KEY',
];

describe('declared provider failover (CODEBUDDY_PROVIDER_FALLBACK)', () => {
  let tmp: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    openAIConstructorCalls.length = 0;
    tmp = makeTmpDir('fb-client-');
    previousHome = process.env.HOME;
    process.env.HOME = tmp;
    setProviderHealthPathForTests(path.join(tmp, '.codebuddy', 'provider-health.json'));
    resetProviderHealthStoreForTests();
    resetEventBus();
    for (const key of envKeys) delete process.env[key];
  });

  afterEach(() => {
    resetProviderHealthStoreForTests();
    setProviderHealthPathForTests(undefined);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    for (const key of envKeys) delete process.env[key];
    resetEventBus();
    removeTmpDir(tmp);
  });

  it('flag OFF: Hermes list still switches, but no health file and no resume note', async () => {
    mockCreate.mockRejectedValueOnce(quotaError()).mockResolvedValueOnce(okResponse('hermes ok'));
    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [openaiFallback()],
    });
    const response = await client.chat([{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }], []);
    expect(response.choices[0]?.message.content).toBe('hermes ok');
    expect(isProviderUnavailable('grok')).toBe(false);
    const fallbackMessages = mockCreate.mock.calls[1]?.[0]?.messages as Array<{ content?: string }>;
    expect(fallbackMessages.some((m) => m.content?.includes('conversation reprise'))).toBe(false);
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\[fallback]/),
      expect.any(Object),
    );
    expect(fs.existsSync(path.join(tmp, '.codebuddy', 'provider-health.json'))).toBe(false);
  });

  it('429 quota → switch, resume note, persisted health, no retry of the benched provider', async () => {
    process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
    mockCreate
      .mockRejectedValueOnce(quotaError())
      .mockResolvedValueOnce(okResponse('fallback ok'))
      .mockResolvedValueOnce(okResponse('still on backup'));

    const busEvents: Array<{ fromProvider?: string; toProvider?: string }> = [];
    getGlobalEventBus().on('provider:fallback', (evt) => {
      busEvents.push(evt);
    });

    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [openaiFallback()],
    });
    const first = await client.chat(
      [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }],
      [],
    );
    expect(first.choices[0]?.message.content).toBe('fallback ok');
    expect(mockCreate).toHaveBeenCalledTimes(2);

    const fallbackMessages = mockCreate.mock.calls[1]?.[0]?.messages as Array<{ role: string; content: string }>;
    expect(fallbackMessages.some((m) => m.content?.includes('conversation reprise par openai:gpt-4o'))).toBe(true);

    expect(isProviderUnavailable('grok')).toBe(true);
    const snapshot = readProviderHealthSnapshot();
    expect(snapshot.providers.grok?.kind).toBe('quota_exhausted');
    expect(snapshot.providers.grok?.resetsAt).toBeGreaterThan(Date.now());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[fallback] grok → openai:gpt-4o \(quota_exhausted/),
      expect.any(Object),
    );
    expect(busEvents.some((e) => e.fromProvider === 'grok' && e.toProvider === 'openai')).toBe(true);

    const second = await client.chat([{ role: 'user', content: 'again' }], []);
    expect(second.choices[0]?.message.content).toBe('still on backup');
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockCreate.mock.calls[2]?.[0]?.model).toBe('gpt-4o');
  });

  it('503 → benches the primary then switches', async () => {
    process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
    mockCreate.mockRejectedValueOnce(overloadError()).mockResolvedValueOnce(okResponse('via backup'));
    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [openaiFallback()],
    });
    await client.chat([{ role: 'user', content: 'hello' }], []);
    expect(readProviderHealthSnapshot().providers.grok?.kind).toBe('overloaded');
    expect(isProviderUnavailable('grok')).toBe(true);
  });

  it('401 → no switch, original error, auth log', async () => {
    process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
    mockCreate.mockRejectedValueOnce(authError());
    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [openaiFallback()],
    });
    await expect(client.chat([{ role: 'user', content: 'hello' }], [])).rejects.toThrow('401');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('no silent failover'),
      expect.any(Object),
    );
  });

  it('empty chain → original error unchanged', async () => {
    process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
    mockCreate.mockRejectedValueOnce(quotaError());
    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [],
      credentialPoolProviders: [],
    });
    await expect(client.chat([{ role: 'user', content: 'hello' }], [])).rejects.toThrow('usage_limit_reached');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns to the original provider on the next turn after reset', async () => {
    process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
    mockCreate
      .mockRejectedValueOnce(quotaError())
      .mockResolvedValueOnce(okResponse('backup'))
      .mockResolvedValueOnce(okResponse('primary again'));
    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [openaiFallback()],
    });
    await client.chat([{ role: 'user', content: 'hello' }], []);
    resetProviderHealthStoreForTests();
    const again = await client.chat([{ role: 'user', content: 'hello' }], []);
    expect(again.choices[0]?.message.content).toBe('primary again');
    expect(mockCreate.mock.calls[2]?.[0]?.model).toBe('grok-code-fast-1');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[fallback] return grok'),
      expect.any(Object),
    );
  });

  it('LOCAL_ONLY skips a cloud backup', async () => {
    process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
    process.env.CODEBUDDY_LOCAL_ONLY = 'true';
    mockCreate.mockRejectedValueOnce(quotaError());
    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [openaiFallback()],
    });
    await expect(client.chat([{ role: 'user', content: 'hello' }], [])).rejects.toThrow('usage_limit_reached');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('compact/retruncate happens when the backup context is smaller', async () => {
    process.env.CODEBUDDY_PROVIDER_FALLBACK = 'true';
    mockCreate.mockRejectedValueOnce(quotaError()).mockResolvedValueOnce(okResponse('ok'));
    const client = new CodeBuddyClient('primary-key', 'grok-code-fast-1', 'https://api.x.ai/v1', {
      fallbackProviders: [openaiFallback('qwen3:4b')],
    });
    const huge = 'H'.repeat(180_000);
    await client.chat(
      [{ role: 'system', content: huge }, { role: 'user', content: 'hello' }],
      [],
    );
    const sent = mockCreate.mock.calls[1]?.[0]?.messages as Array<{ role: string; content: string }>;
    const system = sent.find((m) => m.role === 'system' && !m.content.includes('provider_resume'));
    expect(system?.content.length).toBeLessThan(huge.length);
    expect(sent.some((m) => m.content?.includes('conversation reprise par'))).toBe(true);
  });
});
