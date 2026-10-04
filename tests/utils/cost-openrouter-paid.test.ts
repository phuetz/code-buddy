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

jest.mock('os', () => {
  const impl = { homedir: jest.fn().mockReturnValue('/home/testuser') };
  return { ...impl, default: impl };
});

import { CostTracker, resolveCostBilling } from '../../src/utils/cost-tracker.js';
import { estimateCost } from '../../src/utils/token-display.js';

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

  it('préserve le runtime local : Ollama reste à 0', () => {
    const result = tracker.calculateCostExtended(
      100, 50, 'llama3.2', 0, undefined, { subscriptionAuth: false, localTarget: true },
    );
    expect(result.total).toBe(0);
    expect(result.billing).toBe('subscription');
  });

  it('le namespace ollama/ reste gratuit même sans contexte', () => {
    const { billing } = resolveCostBilling('ollama/llama3.2');
    expect(billing).toBe('subscription');
  });
});