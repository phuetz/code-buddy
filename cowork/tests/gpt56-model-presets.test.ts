import { describe, expect, it } from 'vitest';

import {
  API_PROVIDER_PRESETS,
  PI_AI_CURATED_PRESETS,
  getModelInputGuidance,
} from '../src/shared/api-model-presets';

describe('GPT-5.6 Sol Cowork presets', () => {
  it('makes Sol the ChatGPT subscription default while preserving legacy choices', () => {
    const models = API_PROVIDER_PRESETS.chatgpt.models;

    expect(models[0]).toMatchObject({ id: 'gpt-5.6-sol' });
    expect(models[0]?.name).toContain('372K');
    expect(models.map((model) => model.id)).toEqual(expect.arrayContaining([
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
    ]));
    expect(models.map((model) => model.id)).not.toContain('terra');
    expect(models.map((model) => model.id)).not.toContain('luna');
    expect(models.map((model) => model.id)).not.toContain('gpt-5.1-codex');
    expect(models.find((model) => model.id === 'gpt-5.5')?.name).toContain('legacy fallback');
  });

  it('describes the canonical public OpenAI model without duplicating its alias', () => {
    const models = API_PROVIDER_PRESETS.openai.models;
    const sol = models.find((model) => model.id === 'gpt-5.6-sol');

    expect(sol?.name).toContain('1.05M');
    expect(sol?.name).toContain('vision');
    expect(sol?.name).toContain('reasoning max');
    expect(sol?.name).toContain('alias gpt-5.6');
    expect(models.some((model) => model.id === 'gpt-5.6')).toBe(false);
    expect(PI_AI_CURATED_PRESETS.openai?.pick[0]).toBe('gpt-5.6-sol');
    expect(getModelInputGuidance('openai').placeholder).toContain('gpt-5.6-sol');
  });
});
