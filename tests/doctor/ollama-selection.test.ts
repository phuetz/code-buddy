import { describe, expect, it } from 'vitest';

import { isOllamaSelectionCurrent, resolveOllamaModel } from '../../src/doctor/index.js';

describe('doctor Ollama selection', () => {
  it('rejects a stale default model and selects an advertised tag', () => {
    const models = ['qwen3:4b-instruct', 'qwen2.5:1.5b-instruct'];
    const settings = { provider: 'ollama', defaultModel: 'grok-code-fast-1' };

    expect(isOllamaSelectionCurrent(models, settings)).toBe(false);
    expect(resolveOllamaModel(models, settings)).toBe('qwen3:4b-instruct');
  });

  it('keeps a current model and refuses to select when none is reachable', () => {
    const models = ['qwen3:4b-instruct'];
    const settings = { provider: 'ollama', model: 'qwen3:4b-instruct', defaultModel: 'qwen3:4b-instruct' };

    expect(isOllamaSelectionCurrent(models, settings)).toBe(true);
    expect(resolveOllamaModel([], settings)).toBeUndefined();
  });
});
