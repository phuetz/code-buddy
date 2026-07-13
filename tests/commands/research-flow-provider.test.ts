/**
 * Provider resolution for `buddy research` / `buddy flow` — the shared
 * resolver must keep the legacy paid-key path first, but fall back to
 * env detection (local Ollama, $0) instead of exiting, and let
 * CODEBUDDY_PROVIDER express explicit operator intent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settingsState = vi.hoisted(() => ({
  provider: 'grok' as string | undefined,
  model: undefined as string | undefined,
}));

const detectedState = vi.hoisted(() => ({
  chatgptCredentials: false,
}));

const xaiState = vi.hoisted(() => ({
  credentials: false,
  token: null as string | null,
}));

vi.mock('../../src/utils/settings-manager.js', () => ({
  getSettingsManager: () => ({
    loadUserSettings: () => ({ provider: settingsState.provider }),
    getCurrentModel: () => settingsState.model,
  }),
}));

vi.mock('../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: () => {
    const override = process.env.CODEBUDDY_PROVIDER?.toLowerCase();
    if ((override === 'chatgpt' || !override) && detectedState.chatgptCredentials) {
      return {
        provider: 'chatgpt',
        apiKey: 'oauth-chatgpt',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        defaultModel: process.env.CHATGPT_MODEL || 'gpt-5.5',
      };
    }

    if (override === 'ollama' || (!override && process.env.OLLAMA_HOST)) {
      let host = process.env.OLLAMA_HOST || 'http://localhost:11434';
      if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
      if (!host.endsWith('/v1')) host = host.replace(/\/+$/, '') + '/v1';
      return {
        provider: 'ollama',
        apiKey: 'ollama',
        baseURL: host,
        defaultModel: process.env.GROK_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
      };
    }

    return null;
  },
}));

vi.mock('../../src/providers/xai-oauth.js', () => ({
  XAI_OAUTH_BASE_URL: 'https://api.x.ai/v1',
  hasXaiCredentials: () => xaiState.credentials,
  getValidXaiAccessToken: async () => xaiState.token,
}));

import {
  resolveCommandProvider,
  resolveCommandProviderWithOAuth,
} from '../../src/commands/llm-provider-resolution';

const PROVIDER_ENV_KEYS = [
  'CODEBUDDY_PROVIDER',
  'OLLAMA_HOST',
  'GROK_API_KEY',
  'XAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GROK_BASE_URL',
  'GROK_MODEL',
  'OLLAMA_MODEL',
  'CHATGPT_MODEL',
  'MISTRAL_API_KEY',
];

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of PROVIDER_ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  // Keep the chatgpt-oauth branch of detectProviderFromEnv inert even if
  // this machine has a codex-auth.json: only exercised when CODEBUDDY_PROVIDER
  // is unset AND no other branch matches first — our tests always set an
  // explicit provider or an API key, so ordering keeps this deterministic.
  settingsState.provider = 'grok';
  settingsState.model = undefined;
  detectedState.chatgptCredentials = false;
  xaiState.credentials = false;
  xaiState.token = null;
});

afterEach(() => {
  for (const key of PROVIDER_ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('resolveCommandProvider', () => {
  it('keeps the legacy paid-key path first (backward compatible)', () => {
    process.env.GROK_API_KEY = 'xai-test-key';
    settingsState.model = 'grok-4';

    const resolved = resolveCommandProvider();

    expect(resolved).not.toBeNull();
    expect(resolved!.apiKey).toBe('xai-test-key');
    expect(resolved!.model).toBe('grok-4');
  });

  it('falls back to local Ollama instead of failing when no paid key exists', () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://localhost:11434';

    const resolved = resolveCommandProvider();

    expect(resolved).not.toBeNull();
    expect(resolved!.apiKey).toBe('ollama');
    expect(resolved!.baseURL).toBe('http://localhost:11434/v1');
    expect(resolved!.providerLabel).toBe('ollama');
  });

  it('CODEBUDDY_PROVIDER expresses operator intent: ollama wins even when a paid key exists', () => {
    process.env.GROK_API_KEY = 'xai-test-key';
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://darkstar:11434';

    const resolved = resolveCommandProvider();

    expect(resolved!.apiKey).toBe('ollama');
    expect(resolved!.baseURL).toBe('http://darkstar:11434/v1');
  });

  it('routes an explicit Ollama model to local Ollama even when a cloud key exists', () => {
    process.env.GROK_API_KEY = 'xai-test-key';
    process.env.OLLAMA_HOST = 'http://darkstar:11434';

    const resolved = resolveCommandProvider({ explicitModel: 'gemma4:12b' });

    expect(resolved).toMatchObject({
      apiKey: 'ollama',
      baseURL: 'http://darkstar:11434/v1',
      model: 'gemma4:12b',
      providerLabel: 'ollama',
    });
  });

  it('uses localhost Ollama for explicit local models when OLLAMA_HOST is unset', () => {
    process.env.GROK_API_KEY = 'xai-test-key';

    const resolved = resolveCommandProvider({ explicitModel: 'qwen3.5-ctx32k:latest' });

    expect(resolved).toMatchObject({
      apiKey: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      model: 'qwen3.5-ctx32k:latest',
      providerLabel: 'ollama',
    });
  });

  it('routes explicit local Devstral Small 2 tags to Ollama instead of the saved cloud provider', () => {
    detectedState.chatgptCredentials = true;
    settingsState.provider = 'openai';
    settingsState.model = 'gpt-5.5';

    const resolved = resolveCommandProvider({
      explicitModel: 'devstral-small-2:24b-instruct-2512-q4_K_M',
    });

    expect(resolved).toMatchObject({
      apiKey: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      model: 'devstral-small-2:24b-instruct-2512-q4_K_M',
      providerLabel: 'ollama',
    });
  });

  it('routes a configured local model to Ollama even when no --model flag is passed', () => {
    detectedState.chatgptCredentials = true;
    settingsState.provider = 'openai';
    settingsState.model = 'qwen3.5-ctx32k:latest';

    const resolved = resolveCommandProvider();

    expect(resolved).toMatchObject({
      apiKey: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      model: 'qwen3.5-ctx32k:latest',
      providerLabel: 'ollama',
    });
  });

  it('routes explicit ChatGPT subscription models to ChatGPT OAuth when credentials exist', () => {
    detectedState.chatgptCredentials = true;
    process.env.GROK_API_KEY = 'xai-test-key';

    const resolved = resolveCommandProvider({ explicitModel: 'gpt-5.5' });

    expect(resolved).toMatchObject({
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-5.5',
      providerLabel: 'chatgpt',
    });
  });

  it('routes a newly published explicit Grok model through xAI OAuth before catalog updates', async () => {
    settingsState.provider = 'openai';
    xaiState.credentials = true;
    xaiState.token = 'xai-oauth-token';

    const resolved = await resolveCommandProviderWithOAuth({ explicitModel: 'grok-4.5-preview' });

    expect(resolved).toEqual({
      apiKey: 'xai-oauth-token',
      baseURL: 'https://api.x.ai/v1',
      model: 'grok-4.5-preview',
      providerLabel: 'grok-oauth',
    });
  });

  it('an explicit --model override wins on both paths', () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    expect(resolveCommandProvider({ explicitModel: 'qwen3.6:27b' })!.model).toBe('qwen3.6:27b');

    delete process.env.CODEBUDDY_PROVIDER;
    delete process.env.OLLAMA_HOST;
    process.env.GROK_API_KEY = 'xai-test-key';
    settingsState.model = 'grok-4';
    expect(resolveCommandProvider({ explicitModel: 'grok-4-mini' })!.model).toBe('grok-4-mini');
  });

  it('the detected path ignores the settings model (a paid default would 404 on Ollama)', () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    process.env.OLLAMA_MODEL = 'qwen2.5:7b-instruct';
    settingsState.model = 'gpt-5.5';

    const resolved = resolveCommandProvider();

    expect(resolved!.model).toBe('qwen2.5:7b-instruct');
  });
});

describe('research --wide gate', () => {
  it('the research command exposes --wide and --model options', async () => {
    const { createResearchCommand } = await import('../../src/commands/research/index');
    const cmd = createResearchCommand();
    const optionNames = cmd.options.map((o) => o.long);

    expect(optionNames).toContain('--wide');
    expect(optionNames).toContain('--model');
  });

  it('the flow command exposes --model', async () => {
    const { createFlowCommand } = await import('../../src/commands/flow');
    const cmd = createFlowCommand();
    const optionNames = cmd.options.map((o) => o.long);

    expect(optionNames).toContain('--model');
  });
});
