import { describe, expect, it } from 'vitest';
import {
  isDeclaredProviderFallbackEnabled,
  isFailoverLocalOnly,
  parseFallbackChain,
  resetLegacyLlmFailoverAliasWarnForTests,
  resolveDeclaredFallbackProviders,
  shouldBypassUnreachableLocalPreflight,
} from '../../src/providers/provider-failover-policy.js';

describe('declared failover policy', () => {
  it('is off unless CODEBUDDY_PROVIDER_FALLBACK is true/1/on/yes', () => {
    resetLegacyLlmFailoverAliasWarnForTests();
    expect(isDeclaredProviderFallbackEnabled({})).toBe(false);
    expect(isDeclaredProviderFallbackEnabled({ CODEBUDDY_PROVIDER_FALLBACK: 'false' })).toBe(false);
    expect(isDeclaredProviderFallbackEnabled({ CODEBUDDY_PROVIDER_FALLBACK: 'true' })).toBe(true);
    expect(isDeclaredProviderFallbackEnabled({ CODEBUDDY_PROVIDER_FALLBACK: '1' })).toBe(true);
  });

  it('treats CODEBUDDY_LLM_FAILOVER as a deprecated alias of the same flag', () => {
    resetLegacyLlmFailoverAliasWarnForTests();
    expect(isDeclaredProviderFallbackEnabled({ CODEBUDDY_LLM_FAILOVER: '1' })).toBe(true);
    expect(isDeclaredProviderFallbackEnabled({ CODEBUDDY_LLM_FAILOVER: 'true' })).toBe(true);
    expect(isDeclaredProviderFallbackEnabled({ CODEBUDDY_LLM_FAILOVER: '0' })).toBe(false);
    expect(shouldBypassUnreachableLocalPreflight({ CODEBUDDY_LLM_FAILOVER: '1' })).toBe(true);
  });

  it('parses a > chain including ollama model tags with colons', () => {
    const specs = parseFallbackChain('chatgpt-oauth>xai>gemini>ollama:qwen3.8-ctx32k:latest');
    expect(specs.map((s) => s.provider)).toEqual(['chatgpt-oauth', 'xai', 'gemini', 'ollama']);
    expect(specs[3]?.model).toBe('qwen3.8-ctx32k:latest');
  });

  it('parses fournisseur:modele@http://host:port without swallowing the URL into the model', () => {
    const specs = parseFallbackChain(
      'ollama>ollama:qwen3.8-ctx32k:latest@http://127.0.0.1:11435',
    );
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ provider: 'ollama' });
    expect(specs[0]?.baseURL).toBeUndefined();
    expect(specs[1]?.provider).toBe('ollama');
    expect(specs[1]?.model).toBe('qwen3.8-ctx32k:latest');
    expect(specs[1]?.baseURL).toBe('http://127.0.0.1:11435');
  });

  it('resolves a per-target @url onto the candidate baseURL (/v1 for ollama)', () => {
    const resolved = resolveDeclaredFallbackProviders({
      env: {
        CODEBUDDY_FALLBACK_CHAIN: 'ollama:qwen3.8-ctx32k:latest@http://127.0.0.1:11435',
        OLLAMA_HOST: 'http://127.0.0.1:9',
      },
      active: {
        provider: 'ollama',
        apiKey: 'ollama',
        baseURL: 'http://127.0.0.1:9/v1',
        model: 'qwen2.5-coder:7b',
      },
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.provider).toBe('ollama');
    expect(resolved[0]?.model).toBe('qwen3.8-ctx32k:latest');
    expect(resolved[0]?.baseURL).toBe('http://127.0.0.1:11435/v1');
  });

  it('bypasses the unreachable-Ollama CLI preflight only when declared failover is on', () => {
    expect(shouldBypassUnreachableLocalPreflight({})).toBe(false);
    expect(shouldBypassUnreachableLocalPreflight({ CODEBUDDY_PROVIDER_FALLBACK: 'true' })).toBe(true);
  });

  it('treats LOCAL_ONLY aliases as local-only', () => {
    expect(isFailoverLocalOnly({})).toBe(false);
    expect(isFailoverLocalOnly({ CODEBUDDY_LOCAL_ONLY: 'true' })).toBe(true);
    expect(isFailoverLocalOnly({ CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY: 'true' })).toBe(true);
  });
});
