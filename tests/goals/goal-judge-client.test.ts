import { describe, expect, it, vi } from 'vitest';
import { hasCodexCredentials } from '../../src/providers/codex-oauth.js';
import {
  isChatGptJudgeModel,
  isChatGptProvider,
  resolveGoalJudgeClient,
  resolveGoalJudgeClientFailOpen,
  shouldUseStandaloneChatGptJudge,
} from '../../src/goals/goal-judge-client.js';

vi.mock('../../src/providers/codex-oauth.js', () => ({
  hasCodexCredentials: vi.fn(() => true),
}));

describe('goal judge client routing', () => {
  it('recognizes ChatGPT judge models and providers', () => {
    expect(isChatGptJudgeModel('gpt-5.5')).toBe(true);
    expect(isChatGptJudgeModel('gpt-6.1-sol')).toBe(true);
    expect(isChatGptJudgeModel('gpt-5.5-thinking')).toBe(true);
    expect(isChatGptJudgeModel('qwen3:8b')).toBe(false);

    expect(
      isChatGptProvider({
        apiKey: 'oauth-chatgpt',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        providerLabel: 'chatgpt',
      })
    ).toBe(true);
    expect(
      isChatGptProvider({
        apiKey: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        providerLabel: 'ollama',
      })
    ).toBe(false);
  });

  it('uses a standalone ChatGPT judge only when the agent is not already ChatGPT', () => {
    expect(
      shouldUseStandaloneChatGptJudge('gpt-5.5', {
        apiKey: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        providerLabel: 'ollama',
      })
    ).toBe(true);

    expect(
      shouldUseStandaloneChatGptJudge('gpt-5.5', {
        apiKey: 'oauth-chatgpt',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        providerLabel: 'chatgpt',
      })
    ).toBe(false);

    expect(
      shouldUseStandaloneChatGptJudge('qwen3:8b', {
        apiKey: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        providerLabel: 'ollama',
      })
    ).toBe(false);
  });

  it('keeps the current client when it already appears to be ChatGPT', async () => {
    const currentClient = {
      getCurrentModel: vi.fn(() => 'gpt-5.5'),
    };

    const resolved = await resolveGoalJudgeClient(currentClient, 'gpt-5.5');
    expect(resolved).toBe(currentClient);
  });

  it('creates a ChatGPT OAuth client when a local client is asked to judge with gpt-5.5', async () => {
    const currentClient = {
      getCurrentModel: vi.fn(() => 'qwen3.5-ctx32k'),
    };

    const resolved = await resolveGoalJudgeClient(currentClient, 'gpt-5.5', {
      apiKey: 'ollama',
      baseURL: 'http://127.0.0.1:11434/v1',
      providerLabel: 'ollama',
    });

    expect(resolved).not.toBe(currentClient);
    expect(resolved.getCurrentModel?.()).toBe('gpt-5.5');
  });

  it('fails open when a standalone ChatGPT judge is requested without credentials', async () => {
    vi.mocked(hasCodexCredentials).mockReturnValueOnce(false);
    const currentClient = {
      getCurrentModel: vi.fn(() => 'qwen3.5-ctx32k'),
    };

    const resolved = await resolveGoalJudgeClientFailOpen(currentClient, 'gpt-5.5', {
      apiKey: 'ollama',
      baseURL: 'http://127.0.0.1:11434/v1',
      providerLabel: 'ollama',
    });

    expect(resolved).toBeNull();
  });
});
