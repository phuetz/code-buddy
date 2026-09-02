import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/main/config/config-store';
import { resolveEngineRuntimeConfig } from '../src/main/config/engine-runtime-config';

function createConfig(overrides: Partial<AppConfig>): AppConfig {
  return {
    provider: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    customProtocol: 'openai',
    model: 'gpt-5.4',
    activeProfileKey: 'openai',
    profiles: {
      openai: {
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4',
      },
    },
    activeConfigSetId: 'default',
    configSets: [],
    claudeCodePath: '',
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: false,
    theme: 'light',
    sandboxEnabled: false,
    enableThinking: false,
    isConfigured: true,
    onboardingCompleted: true,
    memoryProvider: 'local',
    ...overrides,
  };
}

describe('resolveEngineRuntimeConfig', () => {
  it('preserves ChatGPT OAuth sentinel routing', () => {
    const runtime = resolveEngineRuntimeConfig(
      createConfig({
        provider: 'chatgpt',
        activeProfileKey: 'chatgpt',
        profiles: {
          chatgpt: {
            apiKey: 'oauth-chatgpt',
            baseUrl: 'https://chatgpt.com/backend-api/codex',
            model: 'gpt-5.5',
          },
        },
      })
    );

    expect(runtime).toMatchObject({
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-5.5',
    });
  });

  it('supplies an Ollama placeholder API key for the embedded engine', () => {
    const runtime = resolveEngineRuntimeConfig(
      createConfig({
        provider: 'ollama',
        activeProfileKey: 'ollama',
        profiles: {
          ollama: {
            apiKey: '',
            baseUrl: 'http://localhost:11434',
            model: 'qwen3.5:0.8b',
          },
        },
      })
    );

    expect(runtime).toMatchObject({
      apiKey: 'sk-ollama-local-proxy',
      baseURL: 'http://localhost:11434/v1',
      model: 'qwen3.5:0.8b',
    });
  });

  it('supplies an LM Studio placeholder API key for the embedded engine', () => {
    const runtime = resolveEngineRuntimeConfig(
      createConfig({
        provider: 'lmstudio',
        activeProfileKey: 'lmstudio',
        profiles: {
          lmstudio: {
            apiKey: '',
            baseUrl: 'http://localhost:1234',
            model: 'local-model',
          },
        },
      })
    );

    expect(runtime).toMatchObject({
      apiKey: 'sk-lmstudio-local-proxy',
      baseURL: 'http://localhost:1234/v1',
      model: 'local-model',
    });
  });

  it('supplies a vLLM placeholder API key for the embedded engine', () => {
    const runtime = resolveEngineRuntimeConfig(
      createConfig({
        provider: 'vllm',
        activeProfileKey: 'vllm',
        apiKey: '',
        baseUrl: 'http://127.0.0.1:8000/v1',
        model: 'local-vllm-model',
        profiles: {
          vllm: {
            apiKey: '',
            baseUrl: 'http://127.0.0.1:8000/v1',
            model: 'local-vllm-model',
          },
        },
      })
    );

    expect(runtime).toMatchObject({
      apiKey: 'sk-vllm-local-proxy',
      baseURL: 'http://127.0.0.1:8000/v1',
      model: 'local-vllm-model',
    });
  });

  it('supplies a Gemini placeholder only for loopback custom Gemini gateways', () => {
    const runtime = resolveEngineRuntimeConfig(
      createConfig({
        provider: 'custom',
        customProtocol: 'gemini',
        activeProfileKey: 'custom:gemini',
        profiles: {
          'custom:gemini': {
            apiKey: '',
            baseUrl: 'http://127.0.0.1:8088',
            model: 'gemini-local',
          },
        },
      })
    );

    expect(runtime).toMatchObject({
      apiKey: 'sk-gemini-local-proxy',
      baseURL: 'http://127.0.0.1:8088',
      model: 'gemini-local',
    });
  });
});
