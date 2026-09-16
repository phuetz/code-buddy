/**
 * Lemonade serves Qwen3.6 as `Qwen3.6-35B-A3B-MTP-GGUF` (capital Q, GGUF
 * suffix). That id must keep structured tool calls and the lite agent surface
 * that completed the fleet recipe on gemma4:12b — not the hosted 262k
 * `qwen3.6*` row (standard prompt, 32k output) which drowned the in-loop
 * tool list (mission 8).
 */
import { describe, it, expect } from 'vitest';
import { findModelToolConfig, getModelToolConfig } from '../../src/config/model-tools.js';

const LEMONADE_ID = 'Qwen3.6-35B-A3B-MTP-GGUF';

describe('qwen3.6 Lemonade GGUF registry entry', () => {
  it.each([
    LEMONADE_ID,
    'qwen3.6-35B-A3B-MTP-GGUF',
    'Qwen3.6-35B-A3B-MTP-GGUF:latest',
    'Qwen3.6-27B-GGUF',
  ])('%s matches the GGUF lite entry with tool calls on', (name) => {
    expect(findModelToolConfig(name)?.model).toBe('Qwen3.6-*-GGUF*');
    expect(getModelToolConfig(name)).toMatchObject({
      supportsToolCalls: true,
      supportsReasoning: true,
      promptProfile: 'lite',
      contextWindow: 32768,
      maxOutputTokens: 8192,
      patchFormat: 'search_replace',
    });
  });

  it('does not steal hosted OpenRouter / Ollama qwen3.6 ids from qwen3.6*', () => {
    expect(findModelToolConfig('qwen3.6:35b-a3b-q4_K_M')?.model).toBe('qwen3.6*');
    expect(findModelToolConfig('qwen/qwen3.6-27b')?.model).toBe('qwen3.6*');
    expect(getModelToolConfig('qwen3.6:35b-a3b-q4_K_M').supportsToolCalls).toBe(true);
    expect(getModelToolConfig('qwen3.6:35b-a3b-q4_K_M').promptProfile).not.toBe('lite');
  });

  it('keeps a plain qwen3 build on the conservative qwen3* row', () => {
    expect(findModelToolConfig('qwen3:8b')?.model).toBe('qwen3*');
    expect(getModelToolConfig('qwen3:8b').supportsToolCalls).toBe(true);
  });
});
