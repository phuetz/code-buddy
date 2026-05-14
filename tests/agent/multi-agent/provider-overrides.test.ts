import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildMultiAgentProviderOverrides } from '../../../src/agent/multi-agent/provider-overrides.js';
import type { MultiAgentSystemConfig } from '../../../src/config/toml-config.js';

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GROK_API_KEY',
  'XAI_API_KEY',
  'GROK_MODEL',
  'OLLAMA_HOST',
  'OLLAMA_MODEL',
  'CHATGPT_MODEL',
] as const;

const envBackup: Partial<Record<typeof ENV_KEYS[number], string>> = {};

describe('multi-agent provider overrides from TOML config', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (envBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
  });

  it('builds per-role provider overrides without leaking providers across roles', () => {
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.GOOGLE_API_KEY = 'gemini-key';
    process.env.OLLAMA_HOST = 'localhost:11434';

    const config: MultiAgentSystemConfig = {
      agents: {
        orchestrator: { provider: 'chatgpt', model: 'gpt-5.5' },
        coder: { provider: 'openai', model: 'gpt-5.1-codex' },
        reviewer: { provider: 'gemini', model: 'gemini-2.5-pro' },
        tester: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
      },
    };

    const overrides = buildMultiAgentProviderOverrides(config);

    expect(overrides?.orchestrator?.providerOverride).toEqual({
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-5.5',
    });
    expect(overrides?.coder?.providerOverride).toEqual({
      apiKey: 'openai-key',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5.1-codex',
    });
    expect(overrides?.reviewer?.providerOverride).toEqual({
      apiKey: 'gemini-key',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-pro',
    });
    expect(overrides?.tester?.providerOverride).toEqual({
      apiKey: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      model: 'qwen2.5-coder:7b',
    });
  });

  it('keeps model-only overrides inheriting the system provider', () => {
    const overrides = buildMultiAgentProviderOverrides({
      agents: {
        coder: { model: 'custom-coder-model' },
      },
    });

    expect(overrides?.coder).toEqual({ model: 'custom-coder-model' });
  });

  it('skips a provider override when the required API key env is absent', () => {
    const overrides = buildMultiAgentProviderOverrides({
      agents: {
        reviewer: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      },
    });

    expect(overrides?.reviewer).toEqual({ model: 'claude-sonnet-4-20250514' });
  });
});
