import { afterEach, beforeEach, vi } from 'vitest';
import {
  PROVIDER_CONFIGS,
  getProviderConfig,
  getValidationConfigForGuide,
  validateProviderKey,
} from '../../src/wizard/provider-onboarding.js';

describe('provider-onboarding validation lib', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock.mockReset()));
  afterEach(() => vi.unstubAllGlobals());

  describe('response validation', () => {
    it.each([
      ['HTML', '<html>Login</html>'],
      ['invalid JSON', '{'],
      ['missing catalog', '{}'],
      ['null', 'null'],
      ['wrong catalog shape', '{"data":{}}'],
      ['invalid model id', '{"data":[{"id":42}]}'],
      ['blank model id', '{"data":[{"id":" "}]}'],
      ['null row', '{"data":[null]}'],
    ])('rejects HTTP 200 with %s', async (_label, body) => {
      fetchMock.mockResolvedValueOnce(new Response(body));
      expect(await validateProviderKey(getProviderConfig('openai')!, 'test-only-key'))
        .toEqual({ valid: false, error: 'Invalid model-list response from OpenAI' });
    });

    it.each([
      ['openai', { data: [{ id: 'test-model' }] }, ['test-model']],
      ['ollama', { models: [{ name: 'test-local' }] }, ['test-local']],
      ['google', { models: [{ name: 'models/test-gemini' }] }, ['test-gemini']],
      ['ollama', { models: [] }, []],
    ])('accepts a valid %s catalog, including an empty local server', async (id, body, models) => {
      fetchMock.mockResolvedValueOnce(Response.json(body));
      expect(await validateProviderKey(getProviderConfig(id)!, 'test-only-key'))
        .toEqual({ valid: true, models });
    });
  });

  describe('OpenRouter authentication', () => {
    it('validates the key before fetching the public catalog', async () => {
      fetchMock.mockResolvedValueOnce(Response.json({ data: { label: 'test key' } }));
      fetchMock.mockResolvedValueOnce(Response.json({ data: [{ id: 'test/model' }] }));
      expect(await validateProviderKey(getProviderConfig('openrouter')!, 'test-only-key'))
        .toEqual({ valid: true, models: ['test/model'] });
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://openrouter.ai/api/v1/key', 'https://openrouter.ai/api/v1/models',
      ]);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer test-only-key' });
    });

    it('does not fetch the public catalog when the key is rejected', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      expect(await validateProviderKey(getProviderConfig('openrouter')!, 'test-only-key'))
        .toEqual({ valid: false, error: 'Invalid API key (authentication failed)' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['<html>Login</html>', '{}', '{"data":[]}', '{"data":{"label":42}}'])(
      'rejects malformed authentication responses: %s', async (body) => {
      fetchMock.mockResolvedValueOnce(new Response(body));
      expect(await validateProviderKey(getProviderConfig('openrouter')!, 'test-only-key'))
        .toEqual({ valid: false, error: 'Invalid authentication response from OpenRouter' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('preserves successful authentication when the optional catalog is unavailable', async () => {
      fetchMock.mockResolvedValueOnce(Response.json({ data: { label: 'test key' } }));
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      expect(await validateProviderKey(getProviderConfig('openrouter')!, 'test-only-key'))
        .toEqual({ valid: true });
    });
  });

  describe('PROVIDER_CONFIGS', () => {
    it('every config has a validation endpoint and an env key', () => {
      for (const config of PROVIDER_CONFIGS) {
        expect(config.id).toBeTruthy();
        expect(config.baseUrl).toMatch(/^https?:\/\//);
        expect(config.validateEndpoint.startsWith('/')).toBe(true);
        expect(config.envKey).toBeTruthy();
      }
    });

    it('uses the Ollama tags endpoint for the local free path', () => {
      const ollama = getProviderConfig('ollama');
      expect(ollama?.baseUrl).toBe('http://localhost:11434');
      expect(ollama?.validateEndpoint).toBe('/api/tags');
    });
  });

  describe('getValidationConfigForGuide', () => {
    it('maps wizard ids to catalog configs (claude→anthropic, gemini→google)', () => {
      expect(getValidationConfigForGuide('claude')?.id).toBe('anthropic');
      expect(getValidationConfigForGuide('gemini')?.id).toBe('google');
      expect(getValidationConfigForGuide('grok')?.id).toBe('grok');
      expect(getValidationConfigForGuide('openai')?.id).toBe('openai');
      expect(getValidationConfigForGuide('openrouter')?.id).toBe('openrouter');
      expect(getValidationConfigForGuide('ollama')?.id).toBe('ollama');
      expect(getValidationConfigForGuide('lmstudio')?.id).toBe('lmstudio');
    });

    it('returns undefined for OAuth/unknown ids that carry no API key', () => {
      expect(getValidationConfigForGuide('chatgpt')).toBeUndefined();
      expect(getValidationConfigForGuide('nonsense')).toBeUndefined();
    });
  });
});
