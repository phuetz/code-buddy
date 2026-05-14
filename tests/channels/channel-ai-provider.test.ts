import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectProviderMock: vi.fn(),
  agentConstructorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: mocks.detectProviderMock,
}));

vi.mock('../../src/agent/codebuddy-agent.js', () => {
  class MockCodeBuddyAgent {
    constructor(apiKey: string, baseURL?: string, model?: string) {
      mocks.agentConstructorMock(apiKey, baseURL, model);
    }

    async processUserMessage() {
      return [{ content: 'channel response' }];
    }
  }

  return { CodeBuddyAgent: MockCodeBuddyAgent };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: mocks.loggerWarnMock,
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const { detectProviderMock, agentConstructorMock, loggerWarnMock } = mocks;

import { createChannelAIAgent } from '../../src/commands/handlers/channel-handlers.js';

describe('channel AI provider wiring', () => {
  beforeEach(() => {
    detectProviderMock.mockReset();
    agentConstructorMock.mockReset();
    loggerWarnMock.mockReset();
  });

  it('uses ChatGPT Codex OAuth for channel AI responses when detected', async () => {
    detectProviderMock.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });

    const agent = await createChannelAIAgent();

    expect(agent).not.toBeNull();
    expect(agentConstructorMock).toHaveBeenCalledWith(
      'oauth-chatgpt',
      'https://chatgpt.com/backend-api/codex',
      'gpt-5.5'
    );
  });

  it('skips channel AI responses with a provider-agnostic warning when unconfigured', async () => {
    detectProviderMock.mockReturnValue(null);

    await expect(createChannelAIAgent()).resolves.toBeNull();
    expect(loggerWarnMock).toHaveBeenCalledWith('No provider for channel AI responses');
  });
});
