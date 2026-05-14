import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectProviderMock: vi.fn(),
  agentConstructorMock: vi.fn(),
}));

vi.mock('../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: mocks.detectProviderMock,
}));

vi.mock('../../src/agent/codebuddy-agent.js', () => {
  class MockCodeBuddyAgent {
    constructor(apiKey: string, baseURL?: string, model?: string) {
      mocks.agentConstructorMock(apiKey, baseURL, model);
    }
  }

  return { CodeBuddyAgent: MockCodeBuddyAgent };
});

const { detectProviderMock, agentConstructorMock } = mocks;

import {
  createDetectedAgent,
  getServerProvider,
  MISSING_PROVIDER_MESSAGE,
} from '../../src/server/agent-provider.js';

describe('server agent provider wiring', () => {
  beforeEach(() => {
    detectProviderMock.mockReset();
    agentConstructorMock.mockReset();
  });

  it('reports no server provider when auto-detection finds nothing', () => {
    detectProviderMock.mockReturnValue(null);

    expect(getServerProvider()).toBeNull();
  });

  it('throws a provider-agnostic setup message when no provider is configured', async () => {
    detectProviderMock.mockReturnValue(null);

    await expect(createDetectedAgent()).rejects.toThrow(MISSING_PROVIDER_MESSAGE);
  });

  it('constructs CodeBuddyAgent from ChatGPT Codex OAuth credentials', async () => {
    detectProviderMock.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });

    await createDetectedAgent();

    expect(agentConstructorMock).toHaveBeenCalledWith(
      'oauth-chatgpt',
      'https://chatgpt.com/backend-api/codex',
      'gpt-5.5'
    );
  });

  it('lets request-scoped model overrides keep the detected provider transport', async () => {
    detectProviderMock.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });

    const provider = getServerProvider('gpt-5.5-thinking');
    await createDetectedAgent('gpt-5.5-thinking');

    expect(provider).toEqual({
      provider: 'chatgpt',
      model: 'gpt-5.5-thinking',
      baseURL: 'https://chatgpt.com/backend-api/codex',
    });
    expect(agentConstructorMock).toHaveBeenCalledWith(
      'oauth-chatgpt',
      'https://chatgpt.com/backend-api/codex',
      'gpt-5.5-thinking'
    );
  });
});
