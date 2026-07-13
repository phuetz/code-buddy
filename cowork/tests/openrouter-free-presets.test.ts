import { describe, expect, it } from 'vitest';
import { API_PROVIDER_PRESETS } from '../src/shared/api-model-presets';
import { getPiAiModelPresets } from '../src/main/config/config-store';

describe('OpenRouter free presets', () => {
  it('keeps the zero-cost router first in the static Cowork catalog', () => {
    expect(API_PROVIDER_PRESETS.openrouter.models[0]).toEqual({
      id: 'openrouter/free',
      name: 'Gratuit — routeur automatique (recommandé)',
    });
    expect(API_PROVIDER_PRESETS.openrouter.models.map((model) => model.id)).toEqual(
      expect.arrayContaining([
        'openai/gpt-oss-20b:free',
        'cohere/north-mini-code:free',
        'qwen/qwen3-coder:free',
        'google/gemma-4-26b-a4b-it:free',
        'nvidia/nemotron-3-ultra-550b-a55b:free',
        'poolside/laguna-xs-2.1:free',
      ])
    );
  });

  it('preserves free variants when the dynamic pi-ai registry is merged', async () => {
    const presets = await getPiAiModelPresets();
    const ids = presets.openrouter.models.map((model) => model.id);

    expect(ids[0]).toBe('openrouter/free');
    expect(ids).toContain('openai/gpt-oss-20b:free');
    expect(ids).toContain('cohere/north-mini-code:free');
    expect(ids).toContain('nvidia/nemotron-3-ultra-550b-a55b:free');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
