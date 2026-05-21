import { describe, expect, it, vi } from 'vitest';

import {
  getStaticChatGptModels,
  resolveCliModelList,
  shouldUseStaticChatGptModels,
} from '../../src/cli/model-listing.js';

describe('CLI model listing', () => {
  it('uses a static ChatGPT OAuth model list instead of probing the Codex backend', async () => {
    const fetchImpl = vi.fn();

    const result = await resolveCliModelList({
      baseURL: 'https://chatgpt.com/backend-api/codex',
      provider: 'chatgpt',
      defaultModel: 'gpt-5.5',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({
      source: 'chatgpt-oauth',
      models: [{ id: 'gpt-5.5', owned_by: 'chatgpt' }],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('detects ChatGPT from provider or Codex base URL', () => {
    expect(shouldUseStaticChatGptModels({
      baseURL: 'https://example.com/v1',
      provider: 'chatgpt',
    })).toBe(true);
    expect(shouldUseStaticChatGptModels({
      baseURL: 'https://chatgpt.com/backend-api/codex',
    })).toBe(true);
    expect(shouldUseStaticChatGptModels({
      baseURL: 'https://api.x.ai/v1',
      provider: 'grok',
    })).toBe(false);
  });

  it('falls back to gpt-5.5 for ChatGPT when no default model is configured', () => {
    expect(getStaticChatGptModels()).toEqual([{ id: 'gpt-5.5', owned_by: 'chatgpt' }]);
  });

  it('fetches models from OpenAI-compatible endpoints', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'local-model', owned_by: 'local' }] }),
    });

    const result = await resolveCliModelList({
      baseURL: 'http://localhost:1234/v1',
      provider: 'openai',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:1234/v1/models');
    expect(result).toEqual({
      source: 'openai-compatible',
      models: [{ id: 'local-model', owned_by: 'local' }],
    });
  });

  it('normalizes trailing slashes for OpenAI-compatible endpoints', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await resolveCliModelList({
      baseURL: 'http://localhost:1234/v1/',
      provider: 'openai',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:1234/v1/models');
  });

  it('surfaces OpenAI-compatible model listing failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    await expect(resolveCliModelList({
      baseURL: 'http://localhost:1234/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow('HTTP 503: Service Unavailable');
  });
});
