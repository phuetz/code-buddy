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
  ANTHROPIC_MODEL_CATALOG,
  getAnthropicModel,
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
    delete process.env.CLAUDE_MODEL;
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
      expect(MODEL_DEFAULTS.anthropic).toBe('claude-sonnet-5-5');
      expect(MODEL_DEFAULTS.google).toBe('gemini-2.5-flash');
      expect(MODEL_DEFAULTS.ollama).toBe('llama3.2');
      expect(MODEL_DEFAULTS.lmstudio).toBe('local-model');
      expect(MODEL_DEFAULTS.deepseek).toBe('deepseek-chat');
      expect(MODEL_DEFAULTS.mistral).toBe('devstral-latest');
    });
  });

  describe('FALLBACK_MODEL', () => {
    it('should equal the xai default', () => {
      expect(FALLBACK_MODEL).toBe(MODEL_DEFAULTS.xai);
    });

    it('should be grok-code-fast-1', () => {
      expect(FALLBACK_MODEL).toBe('grok-code-fast-1');
    });
  });

  describe('FALLBACK_PROVIDER', () => {
    it('should be xai', () => {
      expect(FALLBACK_PROVIDER).toBe('xai');
    });
  });

  describe('getProviderDefaultModel', () => {
    it('should return static default when no env var is set', () => {
      expect(getProviderDefaultModel('xai')).toBe('grok-code-fast-1');
      expect(getProviderDefaultModel('openai')).toBe('gpt-4o');
      expect(getProviderDefaultModel('google')).toBe('gemini-2.5-flash');
      expect(getProviderDefaultModel('anthropic')).toBe('claude-sonnet-5-5');
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
      process.env.ANTHROPIC_MODEL = 'claude-opus-5-5';
      expect(getProviderDefaultModel('anthropic')).toBe('claude-opus-5-5');
    });

    it('should respect GEMINI_MODEL env var', () => {
      process.env.GEMINI_MODEL = 'gemini-2.5-pro';
      expect(getProviderDefaultModel('google')).toBe('gemini-2.5-pro');
    });

    it('should return static default for providers without env var mapping', () => {
      expect(getProviderDefaultModel('ollama')).toBe('llama3.2');
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

  describe('gamme Claude 5.5 (validation Anthropic du 2026-10-08)', () => {
    it('le catalogue de repli est la gamme actuelle, sans modèle retiré', () => {
      expect([...ANTHROPIC_MODEL_CATALOG]).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    });

    it('CLAUDE_MODEL est lu quand ANTHROPIC_MODEL est absent, ANTHROPIC_MODEL l’emporte', () => {
      process.env.CLAUDE_MODEL = 'claude-haiku-5-5';
      expect(getProviderDefaultModel('anthropic')).toBe('claude-haiku-5-5');
      process.env.ANTHROPIC_MODEL = 'claude-opus-5-5';
      expect(getProviderDefaultModel('anthropic')).toBe('claude-opus-5-5');
    });

    it('les rôles léger et architecte ont une valeur par défaut et une variable d’environnement', () => {
      delete process.env.CODEBUDDY_ANTHROPIC_LIGHT_MODEL;
      delete process.env.CODEBUDDY_ANTHROPIC_ARCHITECT_MODEL;
      expect(getAnthropicModel('light')).toBe('claude-haiku-5-5');
      expect(getAnthropicModel('architect')).toBe('claude-opus-5-5');
      process.env.CODEBUDDY_ANTHROPIC_LIGHT_MODEL = 'claude-sonnet-5-5';
      expect(getAnthropicModel('light')).toBe('claude-sonnet-5-5');
    });
  });
});
