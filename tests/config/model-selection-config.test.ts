import { buildOllamaPullHint } from '../../src/providers/local-model-resolver.js';
import { resolveRuntimeAuxiliaryProvider } from '../../src/providers/auxiliary-provider.js';
import { PROVIDER_DEFAULT_MODEL } from '../../src/wizard/onboarding.js';
import { createAzureProvider } from '../../src/plugins/bundled/azure-provider.js';
import { createBedrockProvider } from '../../src/plugins/bundled/bedrock-provider.js';
import { createGroqProvider } from '../../src/plugins/bundled/groq-provider.js';
import { resolveProviderFromCatalog } from '../../src/providers/provider-catalog.js';
import { ModelFailoverChain } from '../../src/agents/model-failover.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { getModelForRole, getProviderDefaultModel, getProviderFallbackModels, getProviderModels } from '../../src/config/model-defaults.js';
import { DEFAULT_CONFIG, getConfigManager, resetConfigManager, parseTOML, serializeTOML, extractPreservedUserConfig } from '../../src/config/toml-config.js';
import { GrokProvider } from '../../src/providers/grok-provider.js';
import { selectChatGptOAuthModel, getChatGptOAuthFallbackModels } from '../../src/providers/chatgpt-models.js';
import { selectModel } from '../../src/optimization/model-routing.js';
import { enableFastMode, disableFastMode, getFastModeModel } from '../../src/commands/handlers/fast-mode-handler.js';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetConfigManager();
  disableFastMode();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function configure(toml: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'buddy-model-choices-'));
  dirs.push(dir);
  const file = join(dir, 'config.toml');
  writeFileSync(file, toml);
  vi.stubEnv('CODEBUDDY_CONFIG', file);
  resetConfigManager();
}
it('charge principal, rôles et replis TOML et relit les choix après un profil', () => {
  const provider = new GrokProvider();
  configure(`[model_defaults.xai]
primary = "principal-test"
fast = "rapide-test"
reasoning = "raisonnement-test"
fallback = ["repli-1", "repli-2"]
models = ["additionnel-test"]
[profiles.revue.model_defaults.xai]
primary = "principal-revue"
review = "reviseur-test"
`);
  expect(provider.defaultModel).toBe('principal-test');
  expect(getModelForRole('xai', 'fast')).toBe('rapide-test');
  expect(getProviderFallbackModels('xai')).toEqual(['repli-1', 'repli-2']);
  expect(getProviderModels('xai')).toEqual(['principal-test', 'additionnel-test']);
  getConfigManager().applyProfile('revue');
  expect(provider.defaultModel).toBe('principal-revue');
  expect(getModelForRole('xai', 'review')).toBe('reviseur-test');
  expect(getModelForRole('xai', 'fast')).toBe('rapide-test');
});
it('fait primer les variables et isole les rôles non conversationnels', () => {
  configure('[model_defaults.openai]\nprimary = "conversation-test"\n');
  vi.stubEnv('GROK_MODEL', ' modele-test ');
  vi.stubEnv('CODEBUDDY_XAI_MODEL_FAST', ' rapide-env ');
  vi.stubEnv('CODEBUDDY_XAI_FALLBACK_MODELS', 'repli-env, autre-env');
  expect(getProviderDefaultModel('xai')).toBe('modele-test');
  expect(getModelForRole('xai', 'fast')).toBe('rapide-env');
  expect(getProviderFallbackModels('xai')).toEqual(['repli-env', 'autre-env']);
  expect(getModelForRole('openai', 'embedding')).toBe('text-embedding-3-small');
  expect(getModelForRole('openai', 'transcription')).toBe('whisper-1');
  expect(getProviderDefaultModel('xai', { XAI_MODEL: 'alias-test' })).toBe('alias-test');
});
it('préserve les tables par fournisseur lors de la réécriture de configuration', () => {
  const parsed = parseTOML('[model_defaults.xai]\nprimary = "principal-test"\nfallback = ["repli-test"]\n');
  configure('[model_defaults.xai]\nprimary = "principal-test"\nfallback = ["repli-test"]\n');
  const serialized = serializeTOML(getConfigManager().getConfig(), extractPreservedUserConfig(parsed));
  expect(parseTOML(serialized).model_defaults).toEqual(parsed.model_defaults);
});
it('applique les choix ChatGPT principal et replis sans catalogue disponible', () => {
  configure('[model_defaults.chatgpt]\nprimary = "gpt-6.1-sol"\nfallback = ["gpt-6-sol", "gpt-6-luna"]\n');
  expect(selectChatGptOAuthModel(undefined, null)).toBe('gpt-6.1-sol');
  expect(getChatGptOAuthFallbackModels('gpt-6.1-sol', null)).toEqual(['gpt-6-sol', 'gpt-6-luna']);
});
it('route la complexité et le mode rapide selon les rôles configurés', () => {
  configure('[model_defaults.xai]\nfast = "rapide-test"\nreasoning = "raisonnement-test"\n');
  enableFastMode('grok-exemple');
  expect(getFastModeModel()).toBe('rapide-test');
  expect(selectModel({ complexity: 'reasoning_heavy', confidence: 1, estimatedTokens: 10, requiresVision: false }, undefined, ['raisonnement-test']).recommendedModel).toBe('raisonnement-test');
});
it('utilise le catalogue xAI renvoyé par le fournisseur et retombe sur la configuration hors ligne', async () => {
  const provider = new GrokProvider();
  const list = vi.fn().mockResolvedValueOnce({ data: [{ id: 'nouveau-modele-servi' }] }).mockRejectedValueOnce(new Error('offline'));
  Object.assign(provider, { client: { models: { list } } });
  expect(await provider.getModels()).toEqual(['nouveau-modele-servi']);
  expect(await provider.getModels()).toContain('grok-4.7');
});

it('parcourt les replis xAI configurés après un échec de chaque modèle', () => {
  configure('[model_defaults.xai]\nprimary = "principal-test"\nfallback = ["repli-1", "repli-2"]\n');
  vi.stubEnv('GROK_API_KEY', 'synthetic-test-key');
  const chain = ModelFailoverChain.fromEnvironment();
  expect(chain.getNextProvider()?.model).toBe('principal-test');
  chain.markFailed('grok', 'model unavailable');
  expect(chain.getNextProvider()?.model).toBe('repli-1');
  chain.markFailed('grok', 'model unavailable');
  expect(chain.getNextProvider()?.model).toBe('repli-2');
});
it('conserve les alternatives parmi les modèles disponibles quand un rôle configuré manque', () => {
  configure('[model_defaults.xai]\nfast = "modele-indisponible"\n');
  const choice = selectModel({ complexity: 'simple', confidence: 1, estimatedTokens: 10, requiresVision: false }, undefined, ['grok-3-mini', 'grok-3']);
  expect(choice.recommendedModel).toBe('grok-3-mini');
  expect(choice.alternativeModel).toBe('grok-3');
});

it('sérialise aussi les choix fournis par une API sans document utilisateur antérieur', () => {
  const text = serializeTOML({ ...DEFAULT_CONFIG, model_defaults: { xai: { primary: 'principal-api' } } });
  expect(parseTOML(text).model_defaults).toEqual({ xai: { primary: 'principal-api' } });
});

it('applique les principaux TOML à la détection des fournisseurs API et locaux', () => {
  configure('[model_defaults.openai]\nprimary = "api-test"\n[model_defaults.google]\nprimary = "google-test"\n[model_defaults.ollama]\nprimary = "local-test"\n');
  expect(resolveProviderFromCatalog({ providerOverride: 'openai', env: {} })?.defaultModel).toBe('api-test');
  expect(resolveProviderFromCatalog({ providerOverride: 'gemini', env: {} })?.defaultModel).toBe('google-test');
  expect(resolveProviderFromCatalog({ providerOverride: 'ollama', env: {} })?.defaultModel).toBe('local-test');
});

it.each([
  ['azure', createAzureProvider], ['bedrock', createBedrockProvider], ['groq', createGroqProvider],
] as const)('configure le choix et la requête du plugin %s', async (key, create) => {
  configure(`[model_defaults.${key}]\nprimary = "${key}-test"\n`);
  vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://azure.example.test');
  vi.stubEnv('AWS_BEDROCK_REGION', 'eu-west-1');
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'synthetic-access');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'synthetic-secret');
  vi.stubEnv('GROQ_API_KEY', 'synthetic-key');
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }], output: { message: { content: [{ text: 'ok' }] } } }) });
  vi.stubGlobal('fetch', fetchImpl);
  const plugin = create()!;
  const picked = await plugin.onboarding!['wizard.modelPicker']!([
    { id: 'autre-modele', name: 'autre-modele', contextWindow: 100 },
    { id: `${key}-test`, name: `${key}-test`, contextWindow: 100 },
  ]);
  expect(picked).toBe(`${key}-test`);
  expect(await plugin.chat!([{ role: 'user', content: 'test' }])).toBe('ok');
  const [url, options] = fetchImpl.mock.calls[0]!;
  if (key === 'groq') expect(JSON.parse(options.body).model).toBe('groq-test');
  else expect(url).toContain(`${key}-test`);
});

it('configure les indications locales et la vision OpenRouter après le chargement des modules', () => {
  configure('[model_defaults.ollama]\nhint = "local-hint-test"\n[model_defaults.openrouter]\nprimary = "router-test"\nvision = "vision-test"\n');
  expect(buildOllamaPullHint({ baseURL: 'http://localhost:11434', reachable: true })).toContain('ollama pull local-hint-test');
  expect(PROVIDER_DEFAULT_MODEL.openrouter).toBe('router-test');
  expect(resolveRuntimeAuxiliaryProvider({ task: 'vision', hasChatGptOAuth: false, env: { OPENROUTER_API_KEY: 'synthetic-key' } })?.model).toBe('vision-test');
});
