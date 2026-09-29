/**
 * Tests for src/config/model-defaults.ts
 *
 * Verifies:
 * - MODEL_DEFAULTS contains the expected provider entries
 * - FALLBACK_MODEL matches the xai default
 * - getProviderDefaultModel respects env vars
 * - GEMINI_FALLBACK_CHAIN is ordered correctly
 * - MODEL_ROLES has all expected use-case categories
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MODEL_DEFAULTS,
  FALLBACK_MODEL,
  FALLBACK_PROVIDER,
  getProviderDefaultModel,
  MODEL_ROLES,
  GEMINI_FALLBACK_CHAIN,
  type ProviderKey,
} from '../../src/config/model-defaults.js';

describe('model-defaults', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear model env vars
    delete process.env.GROK_MODEL;
    delete process.env.OPENAI_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('MODEL_DEFAULTS', () => {
    it('should contain all 8 providers', () => {
      const providers: ProviderKey[] = [
        'xai', 'openai', 'anthropic', 'google',
        'ollama', 'lmstudio', 'deepseek', 'mistral',
      ];
      for (const p of providers) {
        expect(MODEL_DEFAULTS[p]).toBeDefined();
        expect(typeof MODEL_DEFAULTS[p]).toBe('string');
        expect(MODEL_DEFAULTS[p].length).toBeGreaterThan(0);
      }
    });

    it('should have the expected default model for each provider', () => {
      expect(MODEL_DEFAULTS.xai).toBe('grok-code-fast-1');
      expect(MODEL_DEFAULTS.openai).toBe('gpt-4o');
      expect(MODEL_DEFAULTS.anthropic).toBe('claude-sonnet-4-20250514');
      expect(MODEL_DEFAULTS.google).toBe('gemini-2.5-flash');
      expect(MODEL_DEFAULTS.ollama).toBe('qwen3:8b');
      expect(MODEL_DEFAULTS.lmstudio).toBe('local-model');
      expect(MODEL_DEFAULTS.deepseek).toBe('deepseek-chat');
      expect(MODEL_DEFAULTS.mistral).toBe('devstral-latest');
    });
  });

  describe('FALLBACK_MODEL', () => {
    it('should be separate from the xai provider default', () => {
      expect(FALLBACK_MODEL).not.toBe(MODEL_DEFAULTS.xai);
    });

    it('should use the documented generic compatibility model', () => {
      expect(FALLBACK_MODEL).toBe('gpt-4o');
    });
  });

  describe('FALLBACK_PROVIDER', () => {
    it('should not select xai without configuration', () => {
      expect(FALLBACK_PROVIDER).toBe('openai');
    });
  });

  describe('getProviderDefaultModel', () => {
    it('should return static default when no env var is set', () => {
      expect(getProviderDefaultModel('xai')).toBe('grok-code-fast-1');
      expect(getProviderDefaultModel('openai')).toBe('gpt-4o');
      expect(getProviderDefaultModel('google')).toBe('gemini-2.5-flash');
      expect(getProviderDefaultModel('anthropic')).toBe('claude-sonnet-4-20250514');
    });

    it('should respect GROK_MODEL env var', () => {
      process.env.GROK_MODEL = 'grok-4-latest';
      expect(getProviderDefaultModel('xai')).toBe('grok-4-latest');
    });

    it('should respect OPENAI_MODEL env var', () => {
      process.env.OPENAI_MODEL = 'gpt-4.1';
      expect(getProviderDefaultModel('openai')).toBe('gpt-4.1');
    });

    it('should respect ANTHROPIC_MODEL env var', () => {
      process.env.ANTHROPIC_MODEL = 'claude-opus-4-20250514';
      expect(getProviderDefaultModel('anthropic')).toBe('claude-opus-4-20250514');
    });

    it('should respect GEMINI_MODEL env var', () => {
      process.env.GEMINI_MODEL = 'gemini-2.5-pro';
      expect(getProviderDefaultModel('google')).toBe('gemini-2.5-pro');
    });

    it('should return static default for providers without env var mapping', () => {
      expect(getProviderDefaultModel('ollama')).toBe('qwen3:8b');
      expect(getProviderDefaultModel('lmstudio')).toBe('local-model');
      expect(getProviderDefaultModel('deepseek')).toBe('deepseek-chat');
      expect(getProviderDefaultModel('mistral')).toBe('devstral-latest');
    });
  });

  describe('GEMINI_FALLBACK_CHAIN', () => {
    it('should have at least 2 entries', () => {
      expect(GEMINI_FALLBACK_CHAIN.length).toBeGreaterThanOrEqual(2);
    });

    it('should contain the default google model', () => {
      expect(GEMINI_FALLBACK_CHAIN).toContain(MODEL_DEFAULTS.google);
    });

    it('should contain gemini-2.0-flash as fallback', () => {
      expect(GEMINI_FALLBACK_CHAIN).toContain('gemini-2.0-flash');
    });
  });

  describe('MODEL_ROLES', () => {
    it('should have fast, reasoning, and architect roles', () => {
      expect(MODEL_ROLES.fast).toBeDefined();
      expect(MODEL_ROLES.reasoning).toBeDefined();
      expect(MODEL_ROLES.architect).toBeDefined();
    });

    it('fast role should contain xai and google entries', () => {
      expect(MODEL_ROLES.fast.xai).toBeDefined();
      expect(MODEL_ROLES.fast.google).toBeDefined();
    });

    it('architect role should contain anthropic entry', () => {
      expect(MODEL_ROLES.architect.anthropic).toBeDefined();
    });
  });
});
