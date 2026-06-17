import { describe, it, expect, beforeEach } from 'vitest';
import { getExtendedThinking, resetExtendedThinking } from '../../src/agent/extended-thinking.js';

/**
 * Locks the UI-level → thinking-budget mapping that the Cowork ReasoningLevelPicker
 * hot-swap depends on. The OpenAI-compat / Grok / Ollama providers read
 * getThinkingConfig() fresh per request, so this mapping is what actually reaches
 * the model after a level change.
 */
describe('ExtendedThinkingManager.applyThinkingLevel', () => {
  beforeEach(() => {
    resetExtendedThinking();
  });

  it('disables thinking for "off" (after having been enabled)', () => {
    const et = getExtendedThinking();
    et.applyThinkingLevel('high');
    expect(et.isEnabled()).toBe(true);
    et.applyThinkingLevel('off');
    expect(et.isEnabled()).toBe(false);
    expect(et.getThinkingConfig()).toEqual({});
  });

  it('maps each level to its budget and enables thinking', () => {
    const et = getExtendedThinking();
    const cases: Array<[string, number]> = [
      ['minimal', 1024],
      ['low', 2048],
      ['medium', 4096],
      ['high', 8192],
      ['xhigh', 16384],
    ];
    for (const [level, budget] of cases) {
      et.applyThinkingLevel(level);
      expect(et.isEnabled()).toBe(true);
      expect(et.getThinkingConfig()).toEqual({
        thinking: { type: 'enabled', budget_tokens: budget },
      });
    }
  });

  it('fail-safe: an unknown level disables thinking', () => {
    const et = getExtendedThinking();
    et.applyThinkingLevel('high');
    et.applyThinkingLevel('bogus-level');
    expect(et.isEnabled()).toBe(false);
    expect(et.getThinkingConfig()).toEqual({});
  });
});
