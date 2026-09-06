import { describe, expect, it } from 'vitest';
import {
  isDeclaredProviderFallbackEnabled,
  isFailoverLocalOnly,
  parseFallbackChain,
} from '../../src/providers/provider-failover-policy.js';

describe('declared failover policy', () => {
  it('is off unless CODEBUDDY_PROVIDER_FALLBACK is true/1/on/yes', () => {
    expect(isDeclaredProviderFallbackEnabled({})).toBe(false);
    expect(isDeclaredProviderFallbackEnabled({ CODEBUDDY_PROVIDER_FALLBACK: 'false' })).toBe(false);
    expect(isDeclaredProviderFallbackEnabled({ CODEBUDDY_PROVIDER_FALLBACK: 'true' })).toBe(true);
    expect(isDeclaredProviderFallbackEnabled({ CODEBUDDY_PROVIDER_FALLBACK: '1' })).toBe(true);
  });

  it('parses a > chain including ollama model tags with colons', () => {
    const specs = parseFallbackChain('chatgpt-oauth>xai>gemini>ollama:qwen3.8-ctx32k:latest');
    expect(specs.map((s) => s.provider)).toEqual(['chatgpt-oauth', 'xai', 'gemini', 'ollama']);
    expect(specs[3]?.model).toBe('qwen3.8-ctx32k:latest');
  });

  it('treats LOCAL_ONLY aliases as local-only', () => {
    expect(isFailoverLocalOnly({})).toBe(false);
    expect(isFailoverLocalOnly({ CODEBUDDY_LOCAL_ONLY: 'true' })).toBe(true);
    expect(isFailoverLocalOnly({ CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY: 'true' })).toBe(true);
  });
});
