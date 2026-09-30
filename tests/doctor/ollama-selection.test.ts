import { describe, expect, it } from 'vitest';

import {
  isOllamaSelectionCurrent,
  resolveOllamaModel,
  selectOllamaModel,
} from '../../src/doctor/index.js';

describe('doctor Ollama selection', () => {
  it('chooses a small tool-calling instruct model instead of a larger rag model', () => {
    const gibibyte = 1024 ** 3;
    const selection = selectOllamaModel(
      [
        { name: 'gemma4-moe-rag:latest', sizeBytes: 15 * gibibyte },
        { name: 'qwen3:4b-instruct', sizeBytes: 2 * gibibyte },
        { name: 'qwen3.5:4b', sizeBytes: 4 * gibibyte },
        { name: 'gemma4:e4b', sizeBytes: 6 * gibibyte },
      ],
      20 * gibibyte,
    );

    expect(selection.model).toBe('qwen3.5:4b');
    expect(selection.maxContext).toBe(32768);
    expect(selection.reason).toContain('tool-calling');
    expect(selection.reason).toContain('4.0 GiB < 20.0 GiB');
  });
  it('uses the measured second choice when the preferred tag is absent', () => {
    const selection = selectOllamaModel([{ name: 'gemma4:e4b', sizeBytes: 6 * 1024 ** 3 }], 20 * 1024 ** 3);
    expect(selection.model).toBe('gemma4:e4b');
    expect(selection.maxContext).toBe(32768);
  });
  it('does not replace an absent recommendation with an unbenchmarked default', () => {
    const selection = selectOllamaModel([{ name: 'qwen3:4b-instruct', sizeBytes: 2 * 1024 ** 3 }], 20 * 1024 ** 3);
    expect(selection.model).toBeNull();
    expect(selection.reason).toContain('recommended');
  });

  it('returns no choice when every installed model is unsuitable or too large', () => {
    const gibibyte = 1024 ** 3;
    const selection = selectOllamaModel(
      [
        { name: 'nomic-embed-text:latest', sizeBytes: 1 * gibibyte },
        { name: 'qwen3:32b-instruct', sizeBytes: 24 * gibibyte },
      ],
      20 * gibibyte,
    );

    expect(selection.model).toBeNull();
    expect(selection.reason).toContain('no installed model meets');
  });

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
