/**
 * Qwen3.8-27B served LOCALLY (Ollama bare id `qwen3.8:27b`) must hit its own
 * full-capability registry entry, not fall through to the conservative `qwen3*`
 * glob (32k ctx / 4k out). Without it the headless agent compresses every turn
 * and loops on restore_context (observed 2026-08-23 on the `qwen` engine of
 * scripts/deleguer.sh).
 */
import { describe, it, expect } from 'vitest';
import { getModelToolConfig } from '../../src/config/model-tools.js';

describe('qwen3.8 local registry entry', () => {
  it('qwen3.8:27b (Ollama bare id) gets the 262k full-capability entry', () => {
    const c = getModelToolConfig('qwen3.8:27b');
    expect(c.contextWindow).toBe(262144);
    expect(c.maxOutputTokens).toBe(16384);
    expect(c.supportsToolCalls).toBe(true);
    expect(c.supportsVision).toBe(true);
    expect(c.patchFormat).toBe('search_replace');
  });

  it('a plain qwen3 build still gets the conservative qwen3* entry', () => {
    const c = getModelToolConfig('qwen3:8b');
    expect(c.contextWindow).toBe(32768);
    expect(c.supportsVision).toBe(false);
  });
});
