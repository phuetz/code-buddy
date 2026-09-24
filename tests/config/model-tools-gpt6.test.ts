import { describe, expect, it } from 'vitest';

import { getModelToolConfig } from '../../src/config/model-tools.js';

describe('model-tools: GPT-6 family (ChatGPT/Codex OAuth backend)', () => {
  it.each(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'])(
    '%s gets the window the backend catalogue publishes, not the 32 768 fallback',
    (model) => {
      expect(getModelToolConfig(model)).toMatchObject({
        model: 'gpt-6-*',
        supportsReasoning: true,
        supportsToolCalls: true,
        supportsVision: true,
        contextWindow: 272_000,
        maxOutputTokens: 128_000,
        patchFormat: 'unified',
        promptProfile: 'rich',
      });
      expect(getModelToolConfig(model).supportedReasoningEfforts).toEqual([
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]);
    },
  );

  it('does not change the GPT-5.6 Sol entry, which describes the public API', () => {
    expect(getModelToolConfig('gpt-5.6-sol')).toMatchObject({
      model: 'gpt-5.6-sol*',
      contextWindow: 1_050_000,
    });
  });
});
