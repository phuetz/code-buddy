import { describe, expect, it, vi } from 'vitest';

import {
  CHATGPT_OAUTH_DEFAULT_MODEL,
  ChatGptModelCatalogClient,
  getChatGptOAuthFallbackModels,
  isChatGptModelCompatibilityError,
  isChatGptSubscriptionModel,
  modelUsesResponsesLite,
  normalizeChatGptOAuthModel,
  parseChatGptModelCatalog,
  resolveChatGptReasoningEffort,
  selectChatGptOAuthModel,
} from '../../src/providers/chatgpt-models.js';
import type { ChatGptAuth } from '../../src/providers/codex-oauth.js';

const rawCatalog = {
  models: [
    {
      slug: 'hidden-review',
      priority: 0,
      visibility: 'hide',
      supported_in_api: true,
    },
    {
      slug: 'gpt-5.6-terra',
      display_name: 'GPT-5.6-Terra',
      priority: 2,
      visibility: 'list',
      supported_in_api: true,
      use_responses_lite: true,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low' },
        { effort: 'medium' },
        { effort: 'high' },
        { effort: 'xhigh' },
        { effort: 'max' },
        { effort: 'ultra' },
      ],
    },
    {
      slug: 'gpt-5.6-sol',
      display_name: 'GPT-5.6-Sol',
      priority: 1,
      visibility: 'list',
      supported_in_api: true,
      use_responses_lite: true,
      context_window: 372000,
      max_context_window: 372000,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low' },
        { effort: 'medium' },
        { effort: 'high' },
        { effort: 'xhigh' },
        { effort: 'max' },
        { effort: 'ultra' },
      ],
    },
    {
      slug: 'gpt-5.3-codex-spark',
      priority: 3,
      visibility: 'list',
      supported_in_api: false,
    },
    {
      slug: 'gpt-5.5',
      priority: 7,
      visibility: 'list',
      supported_in_api: true,
      use_responses_lite: false,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'xhigh' }],
    },
  ],
};

function auth(): ChatGptAuth {
  return {
    access_token: 'do-not-log-this-token',
    account_id: 'acct_test',
    is_fedramp: false,
  };
}

describe('ChatGPT OAuth model policy', () => {
  it('canonicalizes the public API alias for the OAuth backend', () => {
    expect(normalizeChatGptOAuthModel('gpt-5.6')).toBe(CHATGPT_OAUTH_DEFAULT_MODEL);
    expect(isChatGptSubscriptionModel('gpt-5.6')).toBe(true);
    expect(isChatGptSubscriptionModel('gpt-5.6-luna')).toBe(true);
    expect(isChatGptSubscriptionModel('grok-code-fast-1')).toBe(false);
  });

  it('filters hidden/unsupported entries and sorts list-visible API models by priority', () => {
    const catalog = parseChatGptModelCatalog(rawCatalog, 'W/"etag"', 123);
    expect(catalog?.models.map((model) => model.slug)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.5',
    ]);
    expect(catalog?.models[0]).toMatchObject({
      contextWindow: 372000,
      maxContextWindow: 372000,
      useResponsesLite: true,
      defaultReasoningEffort: 'medium',
    });
  });

  it('selects Sol and uses discovered priority order for compatibility fallback', () => {
    const catalog = parseChatGptModelCatalog(rawCatalog)!;
    expect(selectChatGptOAuthModel('unknown-model', catalog)).toBe('gpt-5.6-sol');
    expect(getChatGptOAuthFallbackModels('gpt-5.6-sol', catalog)).toEqual([
      'gpt-5.6-terra',
      'gpt-5.5',
    ]);
    expect(getChatGptOAuthFallbackModels('gpt-5.6-sol', null)).toEqual(['gpt-5.5']);
  });

  it('recognizes only explicit 400/404 model errors, never auth or quota failures', () => {
    const body = JSON.stringify({ error: { code: 'model_not_supported', message: 'not available' } });
    expect(isChatGptModelCompatibilityError(400, body)).toBe(true);
    expect(isChatGptModelCompatibilityError(404, body)).toBe(true);
    expect(isChatGptModelCompatibilityError(401, body)).toBe(false);
    expect(isChatGptModelCompatibilityError(429, body)).toBe(false);
    expect(isChatGptModelCompatibilityError(400, '{"detail":"bad input"}')).toBe(false);
  });

  it('supports Sol max/ultra and reads Responses Lite from metadata', () => {
    const catalog = parseChatGptModelCatalog(rawCatalog)!;
    expect(resolveChatGptReasoningEffort('ultra', 'gpt-5.6-sol', catalog)).toBe('ultra');
    expect(resolveChatGptReasoningEffort(undefined, 'gpt-5.6-sol', catalog)).toBe('medium');
    expect(resolveChatGptReasoningEffort('ultra', 'gpt-5.5', catalog)).toBe('xhigh');
    expect(modelUsesResponsesLite('gpt-5.6-sol', catalog)).toBe(true);
    expect(modelUsesResponsesLite('gpt-5.5', catalog)).toBe(false);
  });
});

describe('ChatGptModelCatalogClient', () => {
  it('sends account auth, client_version, and revalidates with ETag', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(rawCatalog), {
        status: 200,
        headers: { etag: 'W/"models-v1"' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = new ChatGptModelCatalogClient({
      fetchImpl: fetchMock,
      clientVersion: '0.144.1',
      cacheTtlMs: 0,
    });

    const first = await client.discover(auth());
    const second = await client.discover(auth());

    expect(second).toEqual({
      ...first,
      fetchedAt: expect.any(Number),
    });
    expect(second!.fetchedAt).toBeGreaterThanOrEqual(first!.fetchedAt);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0]!;
    expect(String(firstUrl)).toContain('/backend-api/codex/models?client_version=0.144.1');
    const firstHeaders = (firstInit as RequestInit).headers as Record<string, string>;
    expect(firstHeaders.Authorization).toBe('Bearer do-not-log-this-token');
    expect(firstHeaders['ChatGPT-Account-ID']).toBe('acct_test');

    const secondHeaders = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(secondHeaders['If-None-Match']).toBe('W/"models-v1"');
    expect(JSON.stringify(first)).not.toContain('do-not-log-this-token');
  });
});
