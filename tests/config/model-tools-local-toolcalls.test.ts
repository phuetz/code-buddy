import { describe, it, expect } from 'vitest';
import { getModelToolConfig } from '../../src/config/model-tools.js';

/**
 * Locks the local-model tool-call gating that the autonomous fleet relies on:
 * driving the real agent (editing files) needs the model to emit *structured*
 * tool calls under Code Buddy's full agent prompt. Verified empirically against
 * scripts/autonomy-lab/ and real `buddy goal` runs — qwen3/devstral/mistral do;
 * gemma4:12b also works when tools are preserved. qwen2.5:7b / llama3 stay
 * chat-only.
 * A future "cleanup" must not silently flip these without real goal probes.
 */
describe('model-tools: local tool-call gating', () => {
  it('enables structured tool calls for capable local agentic models', () => {
    for (const m of [
      'qwen3.5-ctx32k:latest',
      'qwen3.5:35b',
      'qwen3.6:35b-a3b-q4_K_M',
      'qwen3:8b',
      'devstral-small-2:24b-instruct-2512-q4_K_M',
      'mistral',
      'gemma4:12b',
    ]) {
      expect(getModelToolConfig(m).supportsToolCalls, m).toBe(true);
    }
  });

  it('keeps small/unreliable local models chat-only', () => {
    for (const m of ['qwen2.5:7b-instruct', 'qwen2.5-coder:7b', 'llama3.2']) {
      expect(getModelToolConfig(m).supportsToolCalls, m).toBe(false);
    }
  });

  it('exposes Gemma 4 multimodal and thinking capabilities to Cowork', () => {
    const config = getModelToolConfig('gemma4:12b');

    expect(config).toMatchObject({
      supportsVision: true,
      supportsReasoning: true,
      supportsToolCalls: true,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    });
  });
});
