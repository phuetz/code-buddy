import { describe, expect, it } from 'vitest';
import {
  findRuntimeProvider,
  getDirectRuntimeProviderCatalog,
  getPluginNativeRuntimeProviderCatalog,
  resolvePluginRuntimeProvider,
  resolveProviderFromCatalog,
} from '../../src/providers/provider-catalog.js';

describe('runtime provider catalog', () => {
  it('exposes the direct runtime providers used by the main CodeBuddyClient path', () => {
    const ids = getDirectRuntimeProviderCatalog().map((entry) => entry.id);

    expect(ids).toEqual(expect.arrayContaining([
      'chatgpt',
      'agy-cli',
      'ollama',
      'lemonade',
      'lmstudio',
      'grok',
      'gemini',
      'openai',
      'anthropic',
      'mistral',
      'groq',
      'together',
      'fireworks',
      'openrouter',
      'novita',
      'zai',
      'kimi-coding',
      'kimi-coding-cn',
      'arcee',
      'gmi',
      'minimax',
      'minimax-cn',
      'alibaba',
      'alibaba-coding-plan',
      'kilocode',
      'xiaomi',
      'tencent-tokenhub',
      'opencode-zen',
      'opencode-go',
      'deepseek',
      'huggingface',
      'nvidia',
      'ollama-cloud',
      'stepfun',
      'vllm',
      'custom',
    ]));
    expect(ids).not.toEqual(expect.arrayContaining(['azure', 'bedrock', 'copilot']));
  });

  it('tracks plugin-native transports outside the direct CodeBuddyClient path', () => {
    const pluginProviders = getPluginNativeRuntimeProviderCatalog();
    const ids = pluginProviders.map((entry) => entry.id);

    expect(ids).toEqual(['azure', 'bedrock', 'copilot']);
    expect(pluginProviders.every((entry) => entry.runtimeSupport === 'plugin-native')).toBe(true);
  });

  it('resolves aliases to their canonical runtime provider', () => {
    expect(findRuntimeProvider('openai-codex')?.id).toBe('chatgpt');
    expect(findRuntimeProvider('xai')?.id).toBe('grok');
    expect(findRuntimeProvider('claude')?.id).toBe('anthropic');
    expect(findRuntimeProvider('lm-studio')?.id).toBe('lmstudio');
    expect(findRuntimeProvider('glm')?.id).toBe('zai');
    expect(findRuntimeProvider('kimi')?.id).toBe('kimi-coding');
    expect(findRuntimeProvider('dashscope')?.id).toBe('alibaba');
    expect(findRuntimeProvider('hf')?.id).toBe('huggingface');
    expect(findRuntimeProvider('azure-openai')?.id).toBe('azure');
    expect(findRuntimeProvider('aws-bedrock')?.id).toBe('bedrock');
    expect(findRuntimeProvider('github-copilot')?.id).toBe('copilot');
  });

  it('prefers ChatGPT OAuth over ambient local providers when no override is set', () => {
    const resolved = resolveProviderFromCatalog({
      hasChatGptOAuth: true,
      env: {
        OLLAMA_HOST: 'http://localhost:11434',
      },
    });

    expect(resolved).toMatchObject({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      defaultModel: 'gpt-5.6-sol',
      source: 'oauth',
    });
    expect(findRuntimeProvider('chatgpt')?.models).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
    ]);
    expect(findRuntimeProvider('chatgpt')?.models).not.toContain('terra');
    expect(findRuntimeProvider('chatgpt')?.models).not.toContain('luna');
    expect(findRuntimeProvider('chatgpt')?.models).not.toContain('gpt-5.1-codex');
  });

  it('adds canonical GPT-5.6 Sol to the direct OpenAI catalog', () => {
    expect(findRuntimeProvider('openai')?.models).toContain('gpt-5.6-sol');
  });

  it('honors CODEBUDDY_PROVIDER over ChatGPT OAuth', () => {
    const resolved = resolveProviderFromCatalog({
      hasChatGptOAuth: true,
      providerOverride: 'ollama',
      env: {},
    });

    expect(resolved).toMatchObject({
      provider: 'ollama',
      apiKey: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      source: 'override',
    });
  });

  it('resolves OpenRouter from its API key', () => {
    const resolved = resolveProviderFromCatalog({
      env: {
        OPENROUTER_API_KEY: 'or-key',
      },
    });

    expect(resolved).toMatchObject({
      provider: 'openrouter',
      apiKey: 'or-key',
      baseURL: 'https://openrouter.ai/api/v1',
      defaultModel: 'openrouter/free',
    });
  });

  it('resolves Hermes-style API-key providers from environment variables', () => {
    expect(resolveProviderFromCatalog({
      env: {
        GLM_API_KEY: 'glm-key',
        GLM_MODEL: 'glm-5-code',
      },
    })).toMatchObject({
      provider: 'zai',
      apiKey: 'glm-key',
      baseURL: 'https://api.z.ai/api/paas/v4',
      defaultModel: 'glm-5-code',
    });

    expect(resolveProviderFromCatalog({
      env: {
        KIMI_API_KEY: 'kimi-key',
        KIMI_BASE_URL: 'https://kimi.example/v1/',
      },
    })).toMatchObject({
      provider: 'kimi-coding',
      apiKey: 'kimi-key',
      baseURL: 'https://kimi.example/v1',
    });

    expect(resolveProviderFromCatalog({
      env: {
        HF_TOKEN: 'hf-key',
      },
    })).toMatchObject({
      provider: 'huggingface',
      apiKey: 'hf-key',
      baseURL: 'https://router.huggingface.co/v1',
    });
  });

  it('does not resolve plugin-native transports through the direct provider path', () => {
    expect(resolveProviderFromCatalog({
      providerOverride: 'azure',
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
        AZURE_OPENAI_API_KEY: 'azure-key',
      },
    })).toBeNull();

    expect(resolveProviderFromCatalog({
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
        AZURE_OPENAI_API_KEY: 'azure-key',
      },
    })).toBeNull();
  });

  it('resolves Azure OpenAI as a plugin-native transport', () => {
    const resolved = resolvePluginRuntimeProvider('azure-openai', {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com/',
      AZURE_OPENAI_API_KEY: 'azure-key',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-prod',
    });

    expect(resolved).toMatchObject({
      provider: 'azure',
      apiMode: 'azure-openai',
      runtimeSupport: 'plugin-native',
      pluginId: 'bundled-azure-openai',
      configured: true,
      baseURL: 'https://example.openai.azure.com',
      defaultModel: 'gpt-4o-prod',
    });
    expect(resolved?.credentialSources).toEqual(['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT']);
  });

  it('resolves AWS Bedrock as a plugin-native transport', () => {
    const resolved = resolvePluginRuntimeProvider('aws-bedrock', {
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'aws-access',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      BEDROCK_MODEL: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    });

    expect(resolved).toMatchObject({
      provider: 'bedrock',
      apiMode: 'aws-bedrock',
      runtimeSupport: 'plugin-native',
      pluginId: 'bundled-bedrock',
      configured: true,
      baseURL: 'https://bedrock-runtime.us-east-1.amazonaws.com',
      defaultModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    });
    expect(resolved?.credentialSources).toEqual(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION']);
  });

  it('resolves GitHub Copilot as a plugin-native transport', () => {
    const resolved = resolvePluginRuntimeProvider('github-copilot', {
      GITHUB_COPILOT_TOKEN: 'copilot-token',
      COPILOT_MODEL: 'gpt-4.1',
    });

    expect(resolved).toMatchObject({
      provider: 'copilot',
      apiMode: 'copilot-chat',
      runtimeSupport: 'plugin-native',
      pluginId: 'bundled-copilot',
      configured: true,
      baseURL: 'https://api.githubcopilot.com',
      defaultModel: 'gpt-4.1',
    });
    expect(resolved?.credentialSources).toEqual(['GITHUB_COPILOT_TOKEN']);
  });
});
