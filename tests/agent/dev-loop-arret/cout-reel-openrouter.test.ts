/**
 * Coût réel : OpenRouter renvoie `usage.cost` (USD facturés). Avant, un modèle
 * absent de la table de prix coûtait 0 $ à la boucle, donc `--budget` ne
 * pouvait jamais se déclencher.
 */
import { describe, expect, it } from 'vitest';
import { StreamingHandler, type RawStreamingChunk } from '../../../src/agent/streaming/index.js';
import { CostTracker } from '../../../src/utils/cost-tracker.js';

describe('coût facturé par la passerelle', () => {
  it('le handler de flux capte usage.cost avec les compteurs de jetons', () => {
    const handler = new StreamingHandler({ trackTokens: false });
    const last: RawStreamingChunk = {
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 1000, completion_tokens: 50, cost: 0.0123 },
    };
    handler.accumulateChunk(last);
    expect(handler.getProviderUsage()).toEqual({
      promptTokens: 1000,
      completionTokens: 50,
      costUsd: 0.0123,
    });
  });

  it('ignore un coût négatif ou non numérique', () => {
    const handler = new StreamingHandler({ trackTokens: false });
    handler.accumulateChunk({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 10, completion_tokens: 1, cost: -1 },
    });
    expect(handler.getProviderUsage()).toEqual({ promptTokens: 10, completionTokens: 1 });
  });

  it('le tracker utilise le coût facturé plutôt que la table de prix (modèle inconnu = 0 avant)', () => {
    const tracker = new CostTracker();
    const model = 'deepseek/deepseek-v4.1-flash';
    const usage = { promptTokens: 80_000, completionTokens: 500, costUsd: 0.0031 };
    expect(tracker.calculateCost(80_000, 500, model, 0, usage)).toBe(0.0031);
    tracker.recordUsage(80_000, 500, model, 0.0031);
    tracker.recordUsage(80_000, 500, model, 0.0031);
    expect(tracker.getReport().sessionCost).toBeCloseTo(0.0062, 6);
  });

  it('sans coût facturé, le calcul historique est inchangé', () => {
    const tracker = new CostTracker();
    const usage = { promptTokens: 1000, completionTokens: 100 };
    expect(tracker.calculateCost(1000, 100, 'gpt-4o', 0, usage)).toBe(
      tracker.calculateCost(1000, 100, 'gpt-4o'),
    );
  });
});
