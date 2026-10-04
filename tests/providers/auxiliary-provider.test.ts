import { afterEach, describe, expect, it } from 'vitest';
import {
  createAuxiliaryChatOptions,
  createAuxiliaryCodeBuddyClient,
  resolveRuntimeAuxiliaryProvider,
} from '../../src/providers/auxiliary-provider.js';
import { resolveProviderFromCatalog } from '../../src/providers/provider-catalog.js';
import { setSessionLlmRoute } from '../../src/providers/session-llm-route.js';

afterEach(() => {
  setSessionLlmRoute(null);
});

describe('runtime auxiliary provider resolution', () => {
  it('uses the main provider for auto auxiliary tasks by default', () => {
    const mainProvider = resolveProviderFromCatalog({
      env: {
        OPENAI_API_KEY: 'main-openai-key',
        OPENAI_MODEL: 'gpt-4o-mini',
      },
      hasChatGptOAuth: false,
    });
    expect(mainProvider).not.toBeNull();

    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'compression',
      mainProvider,
      hasChatGptOAuth: false,
      env: {},
    });

    expect(resolved).toMatchObject({
      task: 'compression',
      provider: 'openai',
      providerSetting: 'auto',
      apiKey: 'main-openai-key',
      model: 'gpt-4o-mini',
      timeoutMs: 120_000,
    });
  });

  it('keeps auto vision on the session instead of a connected OpenRouter key', () => {
    setSessionLlmRoute({
      apiKey: 'sk-session',
      model: 'deepseek/deepseek-v4.1-flash',
      baseURL: 'https://openrouter.ai/api/v1',
      provider: 'grok',
    });

    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'vision',
      hasChatGptOAuth: true,
      env: { OPENROUTER_API_KEY: 'openrouter-key' },
    });

    expect(resolved).toMatchObject({
      provider: 'grok',
      apiKey: 'sk-session',
      model: 'deepseek/deepseek-v4.1-flash',
      baseURL: 'https://openrouter.ai/api/v1',
    });
  });

  it('does not send auto compression to ChatGPT when local-only is set', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'compression',
      hasChatGptOAuth: true,
      env: { CODEBUDDY_LOCAL_ONLY: 'true' },
    });

    expect(resolved).toBeNull();
  });

  it('prefers OpenRouter for auto vision when OpenRouter is configured', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'vision',
      hasChatGptOAuth: false,
      env: {
        OPENROUTER_API_KEY: 'openrouter-key',
      },
    });

    expect(resolved).toMatchObject({
      task: 'vision',
      provider: 'openrouter',
      apiKey: 'openrouter-key',
      model: 'google/gemini-2.5-flash',
      timeoutMs: 120_000,
    });
  });

  it('honors Hermes-style task-specific model env vars', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'vision',
      hasChatGptOAuth: false,
      env: {
        OPENROUTER_API_KEY: 'openrouter-key',
        AUXILIARY_VISION_MODEL: 'openai/gpt-4o',
      },
    });

    expect(resolved).toMatchObject({
      provider: 'openrouter',
      model: 'openai/gpt-4o',
    });
  });

  it('resolves catalog aliases with task-specific credentials', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'approval',
      hasChatGptOAuth: false,
      env: {
        CODEBUDDY_AUXILIARY_APPROVAL_PROVIDER: 'glm',
        CODEBUDDY_AUXILIARY_APPROVAL_API_KEY: 'glm-aux-key',
        CODEBUDDY_AUXILIARY_APPROVAL_MODEL: 'glm-5-code',
        CODEBUDDY_AUXILIARY_APPROVAL_TIMEOUT_MS: '45000',
      },
    });

    expect(resolved).toMatchObject({
      task: 'approval',
      provider: 'zai',
      providerSetting: 'glm',
      apiKey: 'glm-aux-key',
      model: 'glm-5-code',
      timeoutMs: 45_000,
    });
  });

  it('supports provider=main with per-task overrides', () => {
    const mainProvider = resolveProviderFromCatalog({
      env: {
        OPENAI_API_KEY: 'main-openai-key',
      },
      hasChatGptOAuth: false,
    });
    expect(mainProvider).not.toBeNull();

    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'web_extract',
      mainProvider,
      hasChatGptOAuth: false,
      env: {
        AUXILIARY_WEB_EXTRACT_PROVIDER: 'main',
        AUXILIARY_WEB_EXTRACT_MODEL: 'gpt-4o-mini',
        AUXILIARY_WEB_EXTRACT_TIMEOUT: '360',
      },
    });

    expect(resolved).toMatchObject({
      task: 'web_extract',
      provider: 'openai',
      providerSetting: 'main',
      model: 'gpt-4o-mini',
      timeoutMs: 360_000,
    });
  });

  it('routes semantic review to an independently configured cheap model', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'semantic_review',
      hasChatGptOAuth: false,
      env: {
        CODEBUDDY_AUXILIARY_SEMANTIC_REVIEW_PROVIDER: 'openrouter',
        CODEBUDDY_AUXILIARY_SEMANTIC_REVIEW_API_KEY: 'openrouter-review-key',
        CODEBUDDY_AUXILIARY_SEMANTIC_REVIEW_MODEL: 'openrouter/free',
      },
    });

    expect(resolved).toMatchObject({
      task: 'semantic_review',
      provider: 'openrouter',
      providerSetting: 'openrouter',
      apiKey: 'openrouter-review-key',
      model: 'openrouter/free',
      timeoutMs: 30_000,
    });
  });

  it('keeps semantic review on the main provider unless remote review is explicit', () => {
    const mainProvider = resolveProviderFromCatalog({
      env: { OPENAI_API_KEY: 'main-openai-key' },
      hasChatGptOAuth: false,
    });
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'semantic_review',
      hasChatGptOAuth: false,
      env: { OPENROUTER_API_KEY: 'shared-openrouter-key' },
      mainProvider,
    });

    expect(resolved).toMatchObject({
      provider: 'openai',
      providerSetting: 'auto',
      apiKey: 'main-openai-key',
    });
  });

  it('disables auto semantic review when the caller does not identify its main route', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'semantic_review',
      hasChatGptOAuth: false,
      env: {
        OPENROUTER_API_KEY: 'configured-but-not-consented',
        OPENAI_API_KEY: 'another-configured-provider',
      },
    });

    expect(resolved).toBeNull();
  });

  it('ignores legacy global auxiliary routing overrides for semantic review', () => {
    const mainProvider = resolveProviderFromCatalog({
      env: { OPENAI_API_KEY: 'main-openai-key', OPENAI_MODEL: 'main-model' },
      hasChatGptOAuth: false,
    });
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'semantic_review',
      hasChatGptOAuth: false,
      mainProvider,
      env: {
        CODEBUDDY_AUXILIARY_PROVIDER: 'openrouter',
        CODEBUDDY_AUXILIARY_API_KEY: 'legacy-global-key',
        CODEBUDDY_AUXILIARY_BASE_URL: 'https://legacy.example/v1',
        CODEBUDDY_AUXILIARY_MODEL: 'legacy/global-model',
        OPENROUTER_API_KEY: 'configured-but-not-consented',
      },
    });

    expect(resolved).toMatchObject({
      provider: 'openai',
      providerSetting: 'auto',
      apiKey: 'main-openai-key',
      model: 'main-model',
    });
    expect(resolved?.baseURL).not.toBe('https://legacy.example/v1');
  });

  it('passes per-task OpenRouter extra body through the resolved provider', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'compression',
      hasChatGptOAuth: false,
      env: {
        CODEBUDDY_AUXILIARY_COMPRESSION_PROVIDER: 'openrouter',
        CODEBUDDY_AUXILIARY_COMPRESSION_API_KEY: 'openrouter-key',
        CODEBUDDY_AUXILIARY_COMPRESSION_MODEL: 'openrouter/pareto-code',
        CODEBUDDY_AUXILIARY_COMPRESSION_EXTRA_BODY: '{"provider":{"sort":"throughput"},"plugins":[{"id":"pareto-router"}]}',
      },
    });

    expect(resolved?.extraBody).toEqual({
      provider: { sort: 'throughput' },
      plugins: [{ id: 'pareto-router' }],
    });
  });

  it('creates a CodeBuddy client and chat options from a resolved auxiliary provider', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'compression',
      hasChatGptOAuth: false,
      env: {
        CODEBUDDY_AUXILIARY_COMPRESSION_PROVIDER: 'openai',
        CODEBUDDY_AUXILIARY_COMPRESSION_API_KEY: 'openai-aux-key',
        CODEBUDDY_AUXILIARY_COMPRESSION_MODEL: 'gpt-4o-mini',
      },
    });
    expect(resolved).not.toBeNull();

    const client = createAuxiliaryCodeBuddyClient(resolved!);
    const options = createAuxiliaryChatOptions(resolved!, { temperature: 0.1 });

    expect(client.getCurrentModel()).toBe('gpt-4o-mini');
    expect(client.getBaseURL()).toBe('https://api.openai.com/v1');
    expect(options).toMatchObject({
      model: 'gpt-4o-mini',
      timeoutMs: 120_000,
      temperature: 0.1,
    });
  });
});
