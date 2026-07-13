import { describe, expect, it } from 'vitest';

import { getModelStrengths, getModelToolConfig } from '../../src/config/model-tools.js';

const OFFICIAL_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

describe('model-tools: GPT-5.6 Sol', () => {
  it('exposes the public API context, output and multimodal tool capabilities', () => {
    const config = getModelToolConfig('gpt-5.6-sol');

    expect(config).toMatchObject({
      model: 'gpt-5.6-sol*',
      supportsReasoning: true,
      supportsToolCalls: true,
      supportsVision: true,
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      patchFormat: 'unified',
      promptProfile: 'rich',
    });
    expect(config.supportedReasoningEfforts).toEqual(OFFICIAL_REASONING_EFFORTS);
    expect(getModelStrengths('gpt-5.6-sol')).toEqual(expect.arrayContaining([
      'code',
      'thinking',
      'reasoning',
      'tool-calling',
      'vision',
      'long-context',
    ]));
  });

  it('supports the exact official gpt-5.6 alias', () => {
    const config = getModelToolConfig('gpt-5.6');

    expect(config.model).toBe('gpt-5.6');
    expect(config.contextWindow).toBe(1_050_000);
    expect(config.maxOutputTokens).toBe(128_000);
    expect(config.supportedReasoningEfforts).toEqual(OFFICIAL_REASONING_EFFORTS);
  });

  it('does not let the alias absorb sibling 5.6 slugs', () => {
    const sibling = getModelToolConfig('gpt-5.6-terra');

    expect(sibling.model).toBe('gpt-5*');
    expect(sibling.contextWindow).toBe(400_000);
    expect(sibling.supportedReasoningEfforts).toBeUndefined();
  });
});
