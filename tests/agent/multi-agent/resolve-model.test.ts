import { describe, expect, it } from 'vitest';
import { resolveMultiAgentModel } from '../../../src/agent/multi-agent/base-agent.js';

describe('resolveMultiAgentModel', () => {
  it('prefers GROK_MODEL over a hardcoded grok-3-latest agent default', () => {
    expect(
      resolveMultiAgentModel('grok-3-latest', undefined, 'qwen3.8:27b'),
    ).toBe('qwen3.8:27b');
  });

  it('keeps an explicit per-agent override', () => {
    expect(
      resolveMultiAgentModel('grok-3-latest', 'claude-opus', 'qwen3.8:27b'),
    ).toBe('claude-opus');
  });

  it('uses the generic compatibility model when no provider is configured', () => {
    expect(resolveMultiAgentModel(undefined, undefined, undefined)).toBe('gpt-4o');
  });
});
