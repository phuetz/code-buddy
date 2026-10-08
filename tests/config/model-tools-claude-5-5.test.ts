import { describe, expect, it } from 'vitest';
import { getModelToolConfig } from '../../src/config/model-tools.js';

// GET /v1/models du 2026-10-08 : max_tokens 128000 pour les trois modèles 5.5 ;
// une requête à 128000 est acceptée, 129000 répond 400 (vérifié en réel).
describe('capacités des modèles Claude 5.5', () => {
  it.each(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])('%s : sortie 128 000, outils et vision', model => {
    const config = getModelToolConfig(model);
    expect(config.maxOutputTokens).toBe(128000);
    expect(config.supportsToolCalls).toBe(true);
    expect(config.supportsVision).toBe(true);
  });

  it('Haiku 5.5 a sa propre entrée et ne retombe plus sur le motif générique claude-*', () => {
    expect(getModelToolConfig('claude-haiku-5-5').model).toBe('claude-haiku-5*');
  });
});
