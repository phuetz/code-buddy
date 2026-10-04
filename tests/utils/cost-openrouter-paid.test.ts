/**
 * Régression : un modèle payant servi par un agrégateur (OpenRouter) ne doit
 * JAMAIS être présenté comme un forfait gratuit.
 *
 * Défaut constaté le 04/10/2026 : `buddy -p` avec
 * `GROK_BASE_URL=https://openrouter.ai/api/v1` et le modèle
 * `deepseek/deepseek-v4.1-flash` affichait `cost: $0.0000` et
 * `"pricing":"subscription","billing":"subscription"`.
 *
 * Cause : `isLocalNoCostModel()` classait « local gratuit » tout slug
 * commençant par un préfixe de `LOCAL_NO_COST_MODEL_IDS.prefixes` (`deepseek`),
 * sans regarder le fournisseur réel. Le classement ne doit dépendre que du
 * fournisseur (contexte) ou, à défaut, d'un slug NON namespacé.
 */

jest.mock('fs-extra', () => {
  const impl = {
    existsSync: jest.fn().mockReturnValue(false),
    readJsonSync: jest.fn().mockReturnValue({}),
    writeJsonSync: jest.fn(),
    ensureDirSync: jest.fn(),
  };
  return { ...impl, default: impl };
});

const { mockReadJsonAtomicSync, mockWriteJsonAtomicSync } = vi.hoisted(() => ({
  mockReadJsonAtomicSync: vi.fn().mockReturnValue(null),
  mockWriteJsonAtomicSync: vi.fn(),
}));
jest.mock('../../src/utils/atomic-write.js', () => ({
  readJsonAtomicSync: mockReadJsonAtomicSync,
  writeJsonAtomicSync: mockWriteJsonAtomicSync,
}));

jest.mock('../../src/database/repositories/analytics-repository.js', () => ({
  getAnalyticsRepository: jest.fn().mockReturnValue({
    recordAnalytics: jest.fn(),
  }),
  AnalyticsRepository: jest.fn(),
}));

import { CostTracker, resolveCostBilling } from '../../src/utils/cost-tracker.js';
import { estimateCost } from '../../src/utils/token-display.js';
import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import { AgentState } from '../../src/agent/agent-state.js';
import { StreamingHandler } from '../../src/agent/streaming/streaming-handler.js';

const PAID_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash';
// Contexte réel d'une requête OpenRouter : ni forfait, ni cible locale.
const OPENROUTER_CTX = { subscriptionAuth: false, localTarget: false };

describe('Coût OpenRouter payant (régression 2026-10-04)', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadJsonAtomicSync.mockReset().mockReturnValue(null);
    tracker = new CostTracker({ useSQLite: false, trackHistory: false });
  });

  afterEach(() => tracker?.dispose());

  it('classifie deepseek/... sur OpenRouter comme pay-per-use, pas subscription', () => {
    const { billing, pricing } = resolveCostBilling(PAID_OPENROUTER_MODEL, OPENROUTER_CTX);
    expect(billing).toBe('pay-per-use');
    expect(pricing).not.toBe('subscription');
  });

  it('calcule un coût NON nul pour deepseek/... sur OpenRouter', () => {
    const result = tracker.calculateCostExtended(
      24_614, 178, PAID_OPENROUTER_MODEL, 0, undefined, OPENROUTER_CTX,
    );
    expect(result.total).toBeGreaterThan(0);
    expect(result.billing).toBe('pay-per-use');
    expect(result.pricing).not.toBe('subscription');
  });

  it('estimateCost (affichage par tour) est NON nul pour deepseek/... sur OpenRouter', () => {
    const cost = estimateCost(
      24_614, 178, undefined, undefined, PAID_OPENROUTER_MODEL, OPENROUTER_CTX,
    );
    expect(cost).toBeGreaterThan(0);
  });

  it('sans contexte, un slug namespacé payant n’est plus classé forfait', () => {
    // Correctif de cause au niveau du slug : `deepseek/...` n'est pas local.
    const { billing } = resolveCostBilling(PAID_OPENROUTER_MODEL);
    expect(billing).toBe('pay-per-use');
  });

  it('préserve le forfait réel : ChatGPT OAuth reste à 0', () => {
    const result = tracker.calculateCostExtended(
      100, 50, 'gpt-5.6-sol', 0, undefined, { subscriptionAuth: true, localTarget: false },
    );
    expect(result.total).toBe(0);
    expect(result.billing).toBe('subscription');
    expect(result.pricing).toBe('subscription');
  });

  it('préserve le runtime local : Ollama reste à 0, sans le mot forfait', () => {
    const result = tracker.calculateCostExtended(
      100, 50, 'llama3.2', 0, undefined, { subscriptionAuth: false, localTarget: true },
    );
    expect(result.total).toBe(0);
    // « subscription » veut dire forfait (ChatGPT OAuth, Gemini CLI). Un runtime
    // local a un tarif connu de 0 $, ce n'est pas un forfait.
    expect(result.billing).toBe('pay-per-use');
    expect(result.pricing).toBe('known');
    expect(result.pricing).not.toBe('subscription');
  });

  it('le namespace ollama/ reste gratuit même sans contexte, sans le mot forfait', () => {
    const verdict = resolveCostBilling('ollama/llama3.2');
    expect(verdict.billing).toBe('pay-per-use');
    expect(verdict.pricing).toBe('known');
    expect(tracker.calculateCost(100, 50, 'ollama/llama3.2')).toBe(0);
  });

  it('un slug nu payant n’est plus à 0 dès que le contexte dit : pas local, pas forfait', () => {
    // Sans barre : l'heuristique historique le prendrait pour un modèle local.
    // Le contexte du client doit gagner.
    const result = tracker.calculateCostExtended(
      1_000, 100, 'deepseek-chat', 0, undefined,
      { subscriptionAuth: false, localTarget: false },
    );
    expect(result.total).toBeGreaterThan(0);
    expect(result.billing).toBe('pay-per-use');
    expect(result.pricing).not.toBe('subscription');
  });

  it('utilise le coût renvoyé par le fournisseur (usage.cost) plutôt que le tarif inconnu', () => {
    const result = tracker.calculateCostExtended(
      24_614, 178, PAID_OPENROUTER_MODEL, 0,
      { promptTokens: 24_614, completionTokens: 178, reportedCostUsd: 0.0059, cachedTokens: 10_496 },
      OPENROUTER_CTX,
    );
    expect(result.total).toBeCloseTo(0.0059, 6);
    expect(result.estimated).toBe(false);
    expect(result.billing).toBe('pay-per-use');
    expect(result.pricing).toBe('known');
  });

  it('compte les jetons en cache dans l’estimation quand le fournisseur n’envoie pas de coût', () => {
    const full = tracker.calculateCostExtended(
      24_614, 178, PAID_OPENROUTER_MODEL, 0,
      { promptTokens: 24_614, completionTokens: 178 },
      OPENROUTER_CTX,
    );
    const cached = tracker.calculateCostExtended(
      24_614, 178, PAID_OPENROUTER_MODEL, 0,
      { promptTokens: 24_614, completionTokens: 178, cachedTokens: 20_000 },
      OPENROUTER_CTX,
    );
    expect(cached.total).toBeGreaterThan(0);
    expect(cached.total).toBeLessThan(full.total);
  });

  it('OLLAMA_HOST ne classe pas un client OpenRouter comme local', () => {
    const previousHost = process.env.OLLAMA_HOST;
    const previousProvider = process.env.CODEBUDDY_PROVIDER;
    process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
    delete process.env.CODEBUDDY_PROVIDER;
    try {
      const client = new CodeBuddyClient(
        'sk-test-openrouter',
        PAID_OPENROUTER_MODEL,
        'https://openrouter.ai/api/v1',
        { enableFallbacks: false },
      );
      expect(client.isSubscriptionAuth()).toBe(false);
      expect(client.isEffectiveTargetLocal()).toBe(false);
      const result = tracker.calculateCostExtended(
        24_614, 178, PAID_OPENROUTER_MODEL, 0, undefined, {
          subscriptionAuth: client.isSubscriptionAuth(),
          localTarget: client.isEffectiveTargetLocal(),
        },
      );
      expect(result.total).toBeGreaterThan(0);
      expect(result.billing).toBe('pay-per-use');
      expect(result.pricing).not.toBe('subscription');
    } finally {
      if (previousHost === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = previousHost;
      if (previousProvider === undefined) delete process.env.CODEBUDDY_PROVIDER;
      else process.env.CODEBUDDY_PROVIDER = previousProvider;
    }
  });

  it('un client de bouclage reste un runtime local à 0 $, pas un forfait', () => {
    const client = new CodeBuddyClient(
      'ollama',
      'llama3.2',
      'http://127.0.0.1:11434/v1',
      { enableFallbacks: false },
    );
    expect(client.isSubscriptionAuth()).toBe(false);
    expect(client.isEffectiveTargetLocal()).toBe(true);
    const result = tracker.calculateCostExtended(
      100, 50, 'llama3.2', 0, undefined, {
        subscriptionAuth: client.isSubscriptionAuth(),
        localTarget: client.isEffectiveTargetLocal(),
      },
    );
    expect(result.total).toBe(0);
    expect(result.billing).not.toBe('subscription');
  });

  it('le forfait n’est vrai que pour la stratégie ChatGPT, pas pour une URL OpenRouter', () => {
    const client = new CodeBuddyClient(
      'oauth-chatgpt',
      'gpt-5.6-sol',
      'https://chatgpt.com/backend-api/codex',
      { enableFallbacks: false },
    );
    expect(client.isSubscriptionAuth()).toBe(true);
    expect(client.isEffectiveTargetLocal()).toBe(false);
  });

  it('AgentState.recordSessionCost honore le contexte : deepseek-chat sur OpenRouter n’est pas gratuit', () => {
    const state = new AgentState({ sessionCostLimit: 10, yoloMode: false });
    state.recordSessionCost(
      1_000, 100, 'deepseek-chat', undefined,
      { subscriptionAuth: false, localTarget: false },
    );
    expect(state.getSessionCost()).toBeGreaterThan(0);
  });

  it('le flux de réponse lit usage.cost et les jetons en cache', () => {
    const handler = new StreamingHandler({
      trackTokens: false,
      sanitizeOutput: false,
      extractToolCalls: false,
    });
    const chunk = {
      choices: [],
      usage: {
        prompt_tokens: 10_377,
        completion_tokens: 120,
        cost: 0.0059,
        prompt_tokens_details: { cached_tokens: 9_000 },
      },
    };
    handler.accumulateChunk(chunk as never);
    expect(handler.getProviderUsage()).toEqual({
      promptTokens: 10_377,
      completionTokens: 120,
      cachedTokens: 9_000,
      reportedCostUsd: 0.0059,
    });
  });
});