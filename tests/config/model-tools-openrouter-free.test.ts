import { describe, expect, it } from 'vitest';
import { getModelStrengths, getModelToolConfig } from '../../src/config/model-tools.js';

describe('model-tools: OpenRouter free council pool', () => {
  it('exposes long-context tool calling for free code specialists', () => {
    expect(getModelToolConfig('qwen/qwen3-coder:free')).toMatchObject({
      supportsToolCalls: true,
      supportsVision: false,
      contextWindow: 1_048_576,
      maxOutputTokens: 8_192,
    });
    expect(getModelStrengths('qwen/qwen3-coder:free')).toEqual(
      expect.arrayContaining(['code', 'french', 'cheap', 'tool-calling', 'long-context']),
    );
  });

  it('keeps Gemma 4 as the free multimodal council seat', () => {
    expect(getModelToolConfig('google/gemma-4-26b-a4b-it:free')).toMatchObject({
      supportsReasoning: true,
      supportsToolCalls: true,
      supportsVision: true,
      contextWindow: 262_144,
    });
  });

  it('models the dynamic free router as a zero-cost multimodal tool caller', () => {
    expect(getModelStrengths('openrouter/free')).toEqual(
      expect.arrayContaining(['cheap', 'reasoning', 'vision', 'tool-calling', 'long-context']),
    );
  });

  it('gives Nemotron 3 Ultra its 1M research context and tool support', () => {
    expect(getModelToolConfig('nvidia/nemotron-3-ultra-550b-a55b:free')).toMatchObject({
      supportsReasoning: true,
      supportsToolCalls: true,
      supportsVision: false,
      contextWindow: 1_000_000,
    });
  });
});
