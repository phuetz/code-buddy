import { describe, expect, it } from 'vitest';

import { isModelCompatibleWithProvider } from '../../src/providers/model-provider-compat.js';

describe('isModelCompatibleWithProvider', () => {
  it('keeps the historical first-party rules', () => {
    expect(isModelCompatibleWithProvider('grok-4-latest', 'grok')).toBe(true);
    expect(isModelCompatibleWithProvider('gpt-5.5', 'grok')).toBe(false);
    expect(isModelCompatibleWithProvider('gpt-5.6-sol', 'chatgpt')).toBe(true);
    expect(isModelCompatibleWithProvider('grok-code-fast-1', 'chatgpt')).toBe(false);
    expect(isModelCompatibleWithProvider('qwen2.5-coder:7b', 'ollama')).toBe(true);
    expect(isModelCompatibleWithProvider('grok-code-fast-1', 'ollama')).toBe(false);
    expect(isModelCompatibleWithProvider('anything', undefined)).toBe(true);
  });

  it('rejects a stale vendor slug against another first-party backend (regression: grok default → NVIDIA 404)', () => {
    expect(isModelCompatibleWithProvider('grok-code-fast-1', 'nvidia')).toBe(false);
    expect(isModelCompatibleWithProvider('grok-code-fast-1', 'anthropic')).toBe(false);
    expect(isModelCompatibleWithProvider('gpt-5.5', 'gemini')).toBe(false);
    expect(isModelCompatibleWithProvider('claude-sonnet-4-20250514', 'openai')).toBe(false);
    expect(isModelCompatibleWithProvider('gemini-2.5-flash', 'nvidia')).toBe(false);
  });

  it('accepts a provider-native or unknown-family slug on a first-party backend', () => {
    expect(isModelCompatibleWithProvider('moonshotai/kimi-k3', 'nvidia')).toBe(true);
    expect(isModelCompatibleWithProvider('openai/gpt-oss-20b', 'nvidia')).toBe(true);
    expect(isModelCompatibleWithProvider('claude-sonnet-4-20250514', 'anthropic')).toBe(true);
    expect(isModelCompatibleWithProvider('gemini-2.5-flash', 'gemini')).toBe(true);
    expect(isModelCompatibleWithProvider('gpt-4o', 'openai')).toBe(true);
    expect(isModelCompatibleWithProvider('mistral-large-latest', 'mistral')).toBe(true);
  });

  it('stays permissive for gateways and unknown providers (they re-serve any family)', () => {
    expect(isModelCompatibleWithProvider('grok-4-latest', 'openrouter')).toBe(true);
    expect(isModelCompatibleWithProvider('claude-sonnet-4-20250514', 'bedrock')).toBe(true);
    expect(isModelCompatibleWithProvider('gpt-4o', 'azure')).toBe(true);
    expect(isModelCompatibleWithProvider('gpt-4o', 'copilot')).toBe(true);
    expect(isModelCompatibleWithProvider('gemini-2.5-pro', 'omniroute')).toBe(true);
    expect(isModelCompatibleWithProvider('grok-3', 'some-new-provider')).toBe(true);
  });
});
