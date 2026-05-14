import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class MockCodeBuddyClient {
    chat = mocks.chat;

    constructor(apiKey: string, model?: string, baseURL?: string) {
      mocks.constructor(apiKey, model, baseURL);
    }
  },
}));

import { AgentSDK } from '../../src/sdk/agent-sdk.js';

describe('AgentSDK provider routing', () => {
  const envKeys = ['CODEBUDDY_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_MODEL'] as const;
  const previousEnv: Record<(typeof envKeys)[number], string | undefined> = {
    CODEBUDDY_PROVIDER: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of envKeys) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
  });

  it('builds its client from the detected provider instead of GROK_API_KEY only', async () => {
    process.env.CODEBUDDY_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.OPENAI_MODEL = 'gpt-5.1-codex';
    mocks.chat.mockResolvedValueOnce({
      choices: [{ message: { content: 'provider ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const sdk = new AgentSDK();
    const result = await sdk.run('hello');

    expect(mocks.constructor).toHaveBeenCalledWith(
      'openai-key',
      'gpt-5.1-codex',
      'https://api.openai.com/v1',
    );
    expect(result.output).toBe('provider ok');
  });
});
