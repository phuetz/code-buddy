import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ClientArgs {
  apiKey: string;
  model: string;
  baseURL?: string;
}

const mocks = vi.hoisted(() => ({
  constructorCalls: [] as ClientArgs[],
  detectProviderMock: vi.fn(),
}));

vi.mock('../../../src/codebuddy/client.js', () => {
  class MockCodeBuddyClient {
    constructor(apiKey: string, model: string, baseURL?: string) {
      mocks.constructorCalls.push({ apiKey, model, baseURL });
    }
  }

  return { CodeBuddyClient: MockCodeBuddyClient };
});

vi.mock('../../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: mocks.detectProviderMock,
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const { constructorCalls, detectProviderMock } = mocks;

import { MultiAgentSystem } from '../../../src/agent/multi-agent/multi-agent-system.js';

describe('MultiAgentSystem provider auto-detection', () => {
  beforeEach(() => {
    constructorCalls.length = 0;
    detectProviderMock.mockReset();
  });

  it('uses detected ChatGPT transport and model when no API key is passed', () => {
    detectProviderMock.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });

    new MultiAgentSystem('');

    expect(constructorCalls).toHaveLength(4);
    expect(constructorCalls).toEqual(
      expect.arrayContaining([
        {
          apiKey: 'oauth-chatgpt',
          baseURL: 'https://chatgpt.com/backend-api/codex',
          model: 'gpt-5.5',
        },
      ])
    );
    expect(constructorCalls.every((call) => call.model === 'gpt-5.5')).toBe(true);
  });

  it('does not override explicit heterogeneous per-agent providers', () => {
    detectProviderMock.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });

    new MultiAgentSystem('', undefined, undefined, {
      reviewer: {
        providerOverride: {
          apiKey: 'review-key',
          baseURL: 'https://review.example/v1',
          model: 'review-model',
        },
      },
    });

    expect(constructorCalls.find((call) => call.model === 'review-model')).toMatchObject({
      apiKey: 'review-key',
      baseURL: 'https://review.example/v1',
      model: 'review-model',
    });
  });
});
