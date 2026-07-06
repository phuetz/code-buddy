import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiTestResult } from '../src/renderer/types';
import type { AppConfig } from '../src/main/config/config-store';

const mocks = vi.hoisted(() => ({
  probeWithClaudeSdk: vi.fn(),
}));

const coreMocks = vi.hoisted(() => {
  const chat = vi.fn();
  const ctor = vi.fn();
  class FakeCodeBuddyClient {
    constructor(apiKey: string, model?: string, baseURL?: string) {
      ctor(apiKey, model, baseURL);
    }
    chat(...args: unknown[]) {
      return chat(...args);
    }
  }
  return { chat, ctor, FakeCodeBuddyClient };
});

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (rel: string) =>
    rel === 'codebuddy/client.js'
      ? { CHATGPT_OAUTH_SENTINEL: 'oauth-chatgpt', CodeBuddyClient: coreMocks.FakeCodeBuddyClient }
      : null
  ),
}));

vi.mock('../src/main/claude/claude-sdk-one-shot', () => ({
  probeWithClaudeSdk: mocks.probeWithClaudeSdk,
}));

import { runConfigApiTest } from '../src/main/config/config-test-routing';

function createConfig(): AppConfig {
  return {
    provider: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    customProtocol: 'openai',
    model: 'gpt-4.1',
    activeProfileKey: 'openai',
    profiles: {},
    activeConfigSetId: 'default',
    configSets: [],
    claudeCodePath: '',
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: true,
    sandboxEnabled: false,
    enableThinking: false,
    isConfigured: true,
  };
}

describe('runConfigApiTest', () => {
  beforeEach(() => {
    mocks.probeWithClaudeSdk.mockReset();
  });

  it('routes all providers through probeWithClaudeSdk', async () => {
    const expected: ApiTestResult = { ok: true, latencyMs: 12 };
    mocks.probeWithClaudeSdk.mockResolvedValue(expected);

    const result = await runConfigApiTest(
      {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4.1',
      },
      createConfig()
    );

    expect(result).toEqual(expected);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('routes ollama through probeWithClaudeSdk', async () => {
    const expected: ApiTestResult = { ok: true, latencyMs: 9 };
    mocks.probeWithClaudeSdk.mockResolvedValue(expected);

    const result = await runConfigApiTest(
      {
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3.5:0.8b',
      },
      {
        ...createConfig(),
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3.5:0.8b',
        activeProfileKey: 'ollama',
      }
    );

    expect(result).toEqual(expected);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('routes lmstudio through probeWithClaudeSdk', async () => {
    const expected: ApiTestResult = { ok: true, latencyMs: 7 };
    mocks.probeWithClaudeSdk.mockResolvedValue(expected);

    const result = await runConfigApiTest(
      {
        provider: 'lmstudio',
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
      },
      {
        ...createConfig(),
        provider: 'lmstudio',
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        activeProfileKey: 'lmstudio',
      }
    );

    expect(result).toEqual(expected);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('routes gemini through probeWithClaudeSdk', async () => {
    const expected: ApiTestResult = { ok: true, latencyMs: 18 };
    mocks.probeWithClaudeSdk.mockResolvedValue(expected);

    const result = await runConfigApiTest(
      {
        provider: 'gemini',
        customProtocol: 'gemini',
        apiKey: 'AIza-test',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini/gemini-2.5-flash',
      },
      {
        ...createConfig(),
        provider: 'gemini',
        customProtocol: 'gemini',
        activeProfileKey: 'gemini',
        apiKey: 'AIza-test',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini/gemini-2.5-flash',
      }
    );

    expect(result).toEqual(expected);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('returns failure when Native Engine executable is not found', async () => {
    const probeFailure: ApiTestResult = {
      ok: false,
      errorType: 'unknown',
      details: 'Native Engine executable not found. Please install @anthropic-ai/claude-code',
    };
    mocks.probeWithClaudeSdk.mockResolvedValue(probeFailure);

    const result = await runConfigApiTest(
      {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4.1',
      },
      createConfig()
    );

    expect(result).toEqual(probeFailure);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('returns failure on protocol-level mismatch', async () => {
    const probeFailure: ApiTestResult = {
      ok: false,
      errorType: 'unknown',
      details: 'probe_response_mismatch:pong',
    };
    mocks.probeWithClaudeSdk.mockResolvedValue(probeFailure);

    const result = await runConfigApiTest(
      {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4.1',
      },
      createConfig()
    );

    expect(result).toEqual(probeFailure);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });

  it('returns unauthorized without retry for explicit key', async () => {
    const probeFailure: ApiTestResult = {
      ok: false,
      errorType: 'unauthorized',
      details: '401 Unauthorized',
    };
    mocks.probeWithClaudeSdk.mockResolvedValue(probeFailure);

    const result = await runConfigApiTest(
      {
        provider: 'openai',
        apiKey: 'sk-explicit',
        model: 'gpt-4.1',
      },
      createConfig()
    );

    expect(result).toEqual(probeFailure);
    expect(mocks.probeWithClaudeSdk).toHaveBeenCalledTimes(1);
  });
});

describe('runConfigApiTest — chatgpt OAuth routing', () => {
  it('routes the chatgpt provider through the CORE client (Codex Responses), not the generic probe', async () => {
    coreMocks.chat.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });

    const result = await runConfigApiTest(
      { provider: 'chatgpt', apiKey: '', model: 'gpt-5.5' },
      { ...createConfig(), provider: 'chatgpt' }
    );

    expect(result.ok).toBe(true);
    expect(mocks.probeWithClaudeSdk).not.toHaveBeenCalled();
    expect(coreMocks.ctor).toHaveBeenCalledWith('oauth-chatgpt', 'gpt-5.5', undefined);
  });

  it('maps an empty Codex body to a server_error (the historical false negative, now explicit)', async () => {
    coreMocks.chat.mockResolvedValue({ choices: [{ message: { content: '' } }] });

    const result = await runConfigApiTest(
      { provider: 'chatgpt', apiKey: '', model: 'gpt-5.5' },
      { ...createConfig(), provider: 'chatgpt' }
    );

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('server_error');
  });

  it('maps OAuth failures to unauthorized', async () => {
    coreMocks.chat.mockRejectedValue(new Error('401 unauthorized: token expired'));

    const result = await runConfigApiTest(
      { provider: 'chatgpt', apiKey: '', model: 'gpt-5.5' },
      { ...createConfig(), provider: 'chatgpt' }
    );

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('unauthorized');
  });
});
