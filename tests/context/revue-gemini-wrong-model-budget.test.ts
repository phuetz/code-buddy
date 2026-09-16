import { describe, expect, it } from 'vitest';
import { getModelToolConfig } from '../../src/config/model-tools.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import { ContextManagerV3 } from '../../src/context/context-manager-v3.js';

describe('Mission G1 — Trou 3 : budget compté sur le mauvais modèle', () => {
  it('ContextManagerV2.updateConfig doit aligner maxContextTokens sur la fenêtre du nouveau modèle', () => {
    // Initialisation avec gpt-4 (fenêtre de base 8192 tokens)
    const initialConfig = getModelToolConfig('gpt-4');
    const manager = new ContextManagerV2({
      model: 'gpt-4',
      maxContextTokens: initialConfig.contextWindow ?? 8192,
      responseReserveTokens: 1024,
    });

    const initialLimit = manager.effectiveLimit;
    expect(initialLimit).toBeLessThanOrEqual(130_000);

    // Changement de modèle vers gemini-2.5-flash qui dispose d'une fenêtre de 1 000 000 tokens
    const geminiConfig = getModelToolConfig('gemini-2.5-flash');
    expect(geminiConfig.contextWindow).toBeGreaterThanOrEqual(1_000_000);

    manager.updateConfig({ model: 'gemini-2.5-flash' });

    // Le budget effectif et maxContextTokens doivent s'adapter au modèle 1M
    // ACTUELLEMENT : updateConfig ne met à jour que tokenCounter et conserve l'ancien maxContextTokens (8192)
    expect(
      manager.effectiveLimit,
      `effectiveLimit remains stuck at ${manager.effectiveLimit} instead of scaling to 1M model window`,
    ).toBeGreaterThan(500_000);

    manager.dispose();
  });

  it('ContextManagerV3.updateConfig doit recalculer la limite de contexte lors du changement de modèle', () => {
    const manager = new ContextManagerV3({
      model: 'gpt-4',
      maxContextTokens: 8192,
      responseReserveTokens: 1024,
    });

    manager.updateConfig({ model: 'gemini-2.5-flash' });

    const stats = manager.getStats([]);
    expect(
      stats.maxTokens,
      `ContextManagerV3.getStats maxTokens remains stuck at ${stats.maxTokens} instead of 1M`,
    ).toBeGreaterThan(500_000);

    manager.dispose();
  });
});
