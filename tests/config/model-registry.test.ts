/**
 * Tests for ModelRegistry — Sprint 2 of Model Architecture refactor.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModelRegistry, getModelRegistry, resetModelRegistry } from '../../src/config/model-registry.js';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    // Create a registry with a minimal test snapshot
    registry = new ModelRegistry({
      'grok-3-latest': {
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
      },
      'gpt-4o': {
        maxInputTokens: 128000,
        maxOutputTokens: 16384,
        supportsVision: true,
        supportsFunctionCalling: true,
      },
      'test-model-with-cost': {
        maxInputTokens: 32000,
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
    });
  });

  describe('getPricing', () => {
    it('should return built-in pricing for known models', () => {
      const pricing = registry.getPricing('grok-3');
      expect(pricing.inputPerMillion).toBe(3.0);
      expect(pricing.outputPerMillion).toBe(15.0);
    });

    it('should return snapshot pricing when cost fields are present', () => {
      const pricing = registry.getPricing('test-model-with-cost');
      expect(pricing.inputPerMillion).toBe(3.0);
      expect(pricing.outputPerMillion).toBe(15.0);
    });

    it('should do prefix matching for models with suffixes', () => {
      const pricing = registry.getPricing('grok-3-latest');
      expect(pricing.inputPerMillion).toBe(3.0);
      expect(pricing.outputPerMillion).toBe(15.0);
    });

    it('should return pricing for GPT-4o', () => {
      const pricing = registry.getPricing('gpt-4o');
      expect(pricing.inputPerMillion).toBe(2.5);
      expect(pricing.outputPerMillion).toBe(10.0);
    });

    it('should use GPT-5.6 Sol public API pricing before the GPT-5 prefix fallback', () => {
      expect(registry.getPricing('gpt-5.6-sol')).toEqual({
        inputPerMillion: 5,
        outputPerMillion: 30,
      });
      expect(registry.getPricing('gpt-5.6')).toEqual({
        inputPerMillion: 5,
        outputPerMillion: 30,
      });
    });

    it('should return pricing for Claude models', () => {
      const pricing = registry.getPricing('claude-3-opus');
      expect(pricing.inputPerMillion).toBe(15.0);
      expect(pricing.outputPerMillion).toBe(75.0);
    });

    it('should return free pricing for local models', () => {
      const pricing = registry.getPricing('ollama');
      expect(pricing.inputPerMillion).toBe(0);
      expect(pricing.outputPerMillion).toBe(0);
    });

    it('should return default pricing for unknown models', () => {
      const pricing = registry.getPricing('unknown-model-xyz');
      expect(pricing.inputPerMillion).toBe(3.0);
      expect(pricing.outputPerMillion).toBe(15.0);
    });
  });

  describe('resolveAlias', () => {
    it('should resolve built-in aliases', () => {
      expect(registry.resolveAlias('sonnet')).toBe('claude-sonnet-4-20250514');
      expect(registry.resolveAlias('opus')).toBe('claude-opus-4-6');
      expect(registry.resolveAlias('haiku')).toBe('claude-haiku-4-5-20251001');
      expect(registry.resolveAlias('gpt4')).toBe('gpt-4o');
      expect(registry.resolveAlias('gpt-5.6')).toBe('gpt-5.6-sol');
      expect(registry.resolveAlias('gemini')).toBe('gemini-2.5-flash');
      expect(registry.resolveAlias('grok')).toBe('grok-code-fast-1');
    });

    it('should be case-insensitive', () => {
      expect(registry.resolveAlias('SONNET')).toBe('claude-sonnet-4-20250514');
      expect(registry.resolveAlias('Opus')).toBe('claude-opus-4-6');
    });

    it('should return input unchanged for unknown aliases', () => {
      expect(registry.resolveAlias('grok-3-latest')).toBe('grok-3-latest');
      expect(registry.resolveAlias('not-an-alias')).toBe('not-an-alias');
    });

    it('should support env var overrides', () => {
      process.env.CODEBUDDY_ALIAS_SONNET = 'my-custom-sonnet-model';
      const reg = new ModelRegistry({});
      expect(reg.resolveAlias('sonnet')).toBe('my-custom-sonnet-model');
      delete process.env.CODEBUDDY_ALIAS_SONNET;
    });

    it('should allow setting custom aliases', () => {
      registry.setAlias('mymodel', 'grok-3-latest');
      expect(registry.resolveAlias('mymodel')).toBe('grok-3-latest');
    });
  });

  describe('listModels', () => {
    it('should list all models in snapshot', () => {
      const models = registry.listModels();
      expect(models).toContain('grok-3-latest');
      expect(models).toContain('gpt-4o');
      expect(models).toContain('test-model-with-cost');
      expect(models).toHaveLength(3);
    });

    it('should filter by provider', () => {
      const xaiModels = registry.listModels({ provider: 'xai' });
      expect(xaiModels).toContain('grok-3-latest');
      expect(xaiModels).not.toContain('gpt-4o');
    });
  });

  describe('getAliases', () => {
    it('should return a map of all aliases', () => {
      const aliases = registry.getAliases();
      expect(aliases.size).toBeGreaterThan(0);
      expect(aliases.get('sonnet')).toBe('claude-sonnet-4-20250514');
    });
  });
});

describe('getModelRegistry singleton', () => {
  afterEach(() => {
    resetModelRegistry();
  });

  it('should return the same instance on repeated calls', () => {
    const a = getModelRegistry();
    const b = getModelRegistry();
    expect(a).toBe(b);
  });

  it('should return a new instance after reset', () => {
    const a = getModelRegistry();
    resetModelRegistry();
    const b = getModelRegistry();
    expect(a).not.toBe(b);
  });
});
