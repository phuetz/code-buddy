import { afterEach, describe, expect, it, vi } from 'vitest';
import { getModelToolConfig } from '../../src/config/model-tools.js';
import { API_CONFIG } from '../../src/config/constants.js';
import { MODEL_DEFAULTS } from '../../src/config/model-defaults.js';
import { findRuntimeProvider } from '../../src/providers/provider-catalog.js';
import { ChatGptModelCatalogClient, selectChatGptOAuthModel, getChatGptOAuthFallbackModels } from '../../src/providers/chatgpt-models.js';
import { resolveCliModelList } from '../../src/cli/model-listing.js';

const auth = { access_token: 'synthetic-test-token', account_id: 'test', is_fedramp: false };
afterEach(() => vi.unstubAllEnvs());
describe('catalogue septembre 2026', () => {
  it('annonce 0.159.0 et expose le nouveau modèle sans modifier le défaut', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async input => {
      const version = new URL(String(input)).searchParams.get('client_version');
      return new Response(JSON.stringify({ models: [
        { slug: 'gpt-6-sol', visibility: 'list', supported_in_api: true },
        ...(version === '0.159.0' ? [{ slug: 'gpt-6.1-sol', visibility: 'list', supported_in_api: true }] : []),
      ] }));
    });
    const catalog = await new ChatGptModelCatalogClient({ fetchImpl }).discover(auth);
    expect(catalog?.models.map(m => m.slug)).toContain('gpt-6.1-sol');
    expect(selectChatGptOAuthModel(undefined, catalog)).toBe('gpt-6-sol');
  });
  it('lit la surcharge de version à la création du client', async () => {
    vi.stubEnv('CODEBUDDY_CODEX_CLIENT_VERSION', ' 9.8.7 ');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    await new ChatGptModelCatalogClient({ fetchImpl }).discover(auth);
    expect(new URL(String(fetchImpl.mock.calls[0]![0])).searchParams.get('client_version')).toBe('9.8.7');
  });
  it('liste les modèles du compte plutôt que la seule valeur statique', async () => {
    const result = await resolveCliModelList({
      provider: 'chatgpt', baseURL: 'https://chatgpt.com/backend-api/codex',
      auth,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ models: [
        { slug: 'gpt-6.1-sol', visibility: 'list', supported_in_api: true },
        { slug: 'hidden', visibility: 'hide', supported_in_api: true },
      ] }))),
    });
    expect(result.models).toEqual([{ id: 'gpt-6.1-sol', owned_by: 'chatgpt' }]);
  });
  it('respecte les replis explicites même avec un catalogue de compte disponible', async () => {
    const catalog = await new ChatGptModelCatalogClient({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ models: [
      { slug: 'gpt-6-sol', visibility: 'list', supported_in_api: true },
      { slug: 'gpt-6-luna', visibility: 'list', supported_in_api: true },
    ] }))) }).discover(auth);
    vi.stubEnv('CODEBUDDY_CHATGPT_FALLBACK_MODELS', 'gpt-6-luna,gpt-6-sol,absent');
    expect(getChatGptOAuthFallbackModels('gpt-6.1-sol', catalog)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    vi.stubEnv('CODEBUDDY_CHATGPT_FALLBACK_MODELS', '');
    expect(getChatGptOAuthFallbackModels('gpt-6.1-sol', catalog)).toEqual([]);
  });
  it('unifie les défauts xAI du catalogue et des constantes', () => {
    expect(findRuntimeProvider('grok')?.defaultModel).toBe(MODEL_DEFAULTS.xai);
    expect(API_CONFIG.DEFAULT_MODEL).toBe(MODEL_DEFAULTS.xai);
    expect(findRuntimeProvider('grok')?.models).toContain('grok-4.7');
  });
  it.each([
    ['grok-4.7-build-fast', 256000], ['grok-4.7', 500000], ['gpt-6.1-sol', 272000],
    ['grok-4-fast', 2000000], ['grok-4.6', 500000], ['grok-4-1-fast-reasoning', 2000000],
  ])('attribue le contexte exact à %s', (model, context) => {
    expect(getModelToolConfig(model).contextWindow).toBe(context);
  });
});
