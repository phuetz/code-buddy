import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MODELS,
  anthropicDefaultModel,
} from '../src/shared/anthropic-models';
import {
  API_PROVIDER_PRESETS,
  PI_AI_CURATED_PRESETS,
  getModelInputGuidance,
} from '../src/shared/api-model-presets';

// Modèles qui répondent 404 not_found_error chez Anthropic (vérifié le 2026-10-08).
const RETIRED = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-7-sonnet-latest',
  'claude-3-5-sonnet-latest',
  'claude-3-5-sonnet-20241022',
];

describe('Cowork — modèles Anthropic de la gamme 5.5', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('le préréglage Anthropic propose opus, sonnet et haiku 5.5 et aucun modèle retiré', () => {
    const ids = API_PROVIDER_PRESETS.anthropic.models.map((model) => model.id);
    expect(ids).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    for (const retired of RETIRED) expect(ids).not.toContain(retired);
  });

  it('la sélection dynamique pi-ai vise les mêmes modèles', () => {
    expect(PI_AI_CURATED_PRESETS.anthropic?.pick).toEqual([...ANTHROPIC_MODELS]);
  });

  it('le modèle par défaut est claude-sonnet-5-5, remplaçable par ANTHROPIC_MODEL', () => {
    vi.stubEnv('ANTHROPIC_MODEL', '');
    expect(ANTHROPIC_DEFAULT_MODEL).toBe('claude-sonnet-5-5');
    expect(anthropicDefaultModel()).toBe('claude-sonnet-5-5');
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-haiku-5-5');
    expect(anthropicDefaultModel()).toBe('claude-haiku-5-5');
  });

  it('les exemples de saisie ne citent plus de modèle retiré', () => {
    for (const provider of ['custom', 'anthropic'] as const) {
      const { placeholder } = getModelInputGuidance(provider);
      for (const retired of RETIRED) expect(placeholder).not.toContain(retired);
      expect(placeholder).toContain('claude-sonnet-5-5');
    }
  });
});
