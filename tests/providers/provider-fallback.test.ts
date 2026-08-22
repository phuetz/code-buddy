import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AuthProfileManager } from '../../src/auth/profile-manager.js';
import {
  resolveRuntimeCredentialPoolProviders,
  resolveRuntimeFallbackProviders,
} from '../../src/providers/provider-fallback.js';

describe('runtime provider fallback resolution', () => {
  it('resolves comma-separated provider:model fallbacks through the runtime catalog', () => {
    const fallbacks = resolveRuntimeFallbackProviders({
      env: {
        CODEBUDDY_FALLBACK_PROVIDERS: 'openai:gpt-4o, glm:glm-5-code',
        OPENAI_API_KEY: 'openai-key',
        GLM_API_KEY: 'glm-key',
      },
      hasChatGptOAuth: false,
      active: {
        baseURL: 'https://api.x.ai/v1',
        model: 'grok-code-fast-1',
      },
    });

    expect(fallbacks.map((fallback) => ({
      provider: fallback.provider,
      model: fallback.model,
      apiKey: fallback.apiKey,
      baseURL: fallback.baseURL,
    }))).toEqual([
      {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'openai-key',
        baseURL: 'https://api.openai.com/v1',
      },
      {
        provider: 'zai',
        model: 'glm-5-code',
        apiKey: 'glm-key',
        baseURL: 'https://api.z.ai/api/paas/v4',
      },
    ]);
  });

  it('supports single fallback provider and model env vars', () => {
    const fallbacks = resolveRuntimeFallbackProviders({
      env: {
        CODEBUDDY_FALLBACK_PROVIDER: 'kimi',
        CODEBUDDY_FALLBACK_MODEL: 'kimi-k2-thinking',
        KIMI_API_KEY: 'kimi-key',
      },
      hasChatGptOAuth: false,
    });

    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]).toMatchObject({
      provider: 'kimi-coding',
      model: 'kimi-k2-thinking',
      apiKey: 'kimi-key',
      baseURL: 'https://api.moonshot.ai/v1',
    });
  });

  it('skips unconfigured API-key fallbacks and active-provider duplicates', () => {
    const fallbacks = resolveRuntimeFallbackProviders({
      env: {
        CODEBUDDY_FALLBACK_PROVIDERS: 'openai:gpt-4o,openrouter:openai/gpt-4o',
        OPENROUTER_API_KEY: 'openrouter-key',
      },
      hasChatGptOAuth: false,
      active: {
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-4o',
      },
    });

    expect(fallbacks).toEqual([]);
  });

  it('resolves same-provider auth profiles as credential pool candidates', () => {
    const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-auth-pool-'));
    const manager = new AuthProfileManager({
      persistPath: path.join(persistDir, 'state.json'),
      sessionSticky: false,
      profiles: [
        {
          id: 'grok-active-key',
          provider: 'grok',
          type: 'api-key',
          credentials: { apiKey: 'primary-key' },
          priority: 100,
          metadata: {
            model: 'grok-code-fast-1',
            baseURL: 'https://api.x.ai/v1',
          },
        },
        {
          id: 'xai-pool-key',
          provider: 'xai',
          type: 'api-key',
          credentials: { apiKey: 'pool-key' },
          priority: 50,
          metadata: {
            model: 'grok-code-fast-1',
            baseURL: 'https://api.x.ai/v1',
          },
        },
        {
          id: 'openai-other-provider',
          provider: 'openai',
          type: 'api-key',
          credentials: { apiKey: 'openai-key' },
          priority: 10,
          metadata: { model: 'gpt-4o' },
        },
      ],
    });

    try {
      const pool = resolveRuntimeCredentialPoolProviders({
        authProfileManager: manager,
        active: {
          apiKey: 'primary-key',
          baseURL: 'https://api.x.ai/v1',
          model: 'grok-code-fast-1',
        },
      });

      expect(pool).toHaveLength(1);
      expect(pool[0]).toMatchObject({
        provider: 'grok',
        profileId: 'xai-pool-key',
        fallbackSource: 'auth-profile',
        apiKey: 'pool-key',
        baseURL: 'https://api.x.ai/v1',
        model: 'grok-code-fast-1',
        rawSpec: 'auth-profile:xai-pool-key',
      });
    } finally {
      manager.shutdown();
      fs.rmSync(persistDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
