/**
 * Tests for model utilities
 */

import {
  isSupportedModel,
  getModelInfo,
  validateModel,
  getDefaultModel,
  getSupportedModels,
  getModelsByProvider,
  suggestModel,
  formatModelInfo,
} from '../../src/utils/model-utils';
import { ValidationError } from '../../src/utils/errors';

describe('Model Utilities', () => {
  describe('isSupportedModel', () => {
    it('should return true for supported models', () => {
      expect(isSupportedModel('grok-4-latest')).toBe(true);
      expect(isSupportedModel('grok-3-latest')).toBe(true);
      expect(isSupportedModel('claude-opus-4-6')).toBe(true);
    });

    it('should return false for unsupported models', () => {
      expect(isSupportedModel('unknown-model')).toBe(false);
      expect(isSupportedModel('')).toBe(false);
    });
  });

  describe('getModelInfo', () => {
    it('should return info for supported models', () => {
      const info = getModelInfo('grok-4-latest');
      expect(info.isSupported).toBe(true);
      expect(info.maxTokens).toBe(256000);
      expect(info.provider).toBe('xai');
    });

    it('should return default info for unsupported models', () => {
      const info = getModelInfo('unknown-model');
      expect(info.isSupported).toBe(false);
      expect(info.maxTokens).toBe(8192); // Default
      expect(info.provider).toBe('unknown');
    });
  });

  describe('validateModel', () => {
    it('should validate supported models in non-strict mode', () => {
      expect(() => validateModel('grok-4-latest', false)).not.toThrow();
      expect(() => validateModel('unknown-model', false)).not.toThrow();
    });

    it('should reject empty model names', () => {
      expect(() => validateModel('', false)).toThrow(ValidationError);
      expect(() => validateModel('   ', false)).toThrow(ValidationError);
    });

    it('should validate only supported models in strict mode', () => {
      expect(() => validateModel('grok-4-latest', true)).not.toThrow();
      expect(() => validateModel('unknown-model', true)).toThrow(
        ValidationError
      );
    });
  });

  describe('getDefaultModel', () => {
    it('should return correct default for each provider', () => {
      expect(getDefaultModel('xai')).toBe('grok-4-latest');
      expect(getDefaultModel('anthropic')).toBe('claude-opus-4-6');
      expect(getDefaultModel('openai')).toBe('gpt-4o');
      expect(getDefaultModel('google')).toBe('gemini-2.5-pro');
      expect(getDefaultModel('lmstudio')).toBe('local-model');
      expect(getDefaultModel('unknown')).toBe('grok-4-latest');
    });
  });

  describe('getSupportedModels', () => {
    it('should return all supported models', () => {
      const models = getSupportedModels();
      expect(models).toContain('grok-4-latest');
      expect(models).toContain('claude-opus-4-6');
      expect(models).toContain('gemini-2.5-pro');
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('getModelsByProvider', () => {
    it('should return models for xai provider', () => {
      const models = getModelsByProvider('xai');
      expect(models).toContain('grok-4-latest');
      expect(models).toContain('grok-3-latest');
      expect(models.every((m) => m.startsWith('grok'))).toBe(true);
    });

    it('should return models for anthropic provider', () => {
      const models = getModelsByProvider('anthropic');
      expect(models).toContain('claude-opus-4-6');
      expect(models.every((m) => m.startsWith('claude'))).toBe(true);
    });

    it('should return models for google provider', () => {
      const models = getModelsByProvider('google');
      expect(models).toContain('gemini-2.5-pro');
      expect(models.every((m) => m.startsWith('gemini'))).toBe(true);
    });

    it('should return models for openai provider', () => {
      const models = getModelsByProvider('openai');
      expect(models).toContain('gpt-4o');
      expect(models.length).toBeGreaterThan(0);
    });

    it('should return models for lmstudio provider', () => {
      const models = getModelsByProvider('lmstudio');
      expect(models).toContain('local-model');
      expect(models).toContain('llama-3.1-8b');
      expect(models.length).toBeGreaterThan(0);
    });

    it('should return empty array for unknown provider', () => {
      const models = getModelsByProvider('unknown');
      expect(models).toEqual([]);
    });
  });

  describe('suggestModel', () => {
    it('should find exact matches', () => {
      const suggestions = suggestModel('grok-4-latest');
      expect(suggestions).toContain('grok-4-latest');
      expect(suggestions.length).toBe(1);
    });

    it('should find models that start with prefix', () => {
      const suggestions = suggestModel('grok');
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.every((s) => s.startsWith('grok'))).toBe(true);
    });

    it('should find models that contain substring', () => {
      const suggestions = suggestModel('latest');
      expect(suggestions.some((s) => s.includes('latest'))).toBe(true);
    });

    it('should be case insensitive', () => {
      const suggestions1 = suggestModel('GROK');
      const suggestions2 = suggestModel('grok');
      expect(suggestions1).toEqual(suggestions2);
    });

    it('should return empty array for no matches', () => {
      const suggestions = suggestModel('xyz123notamodel');
      expect(suggestions).toEqual([]);
    });
  });

  describe('formatModelInfo', () => {
    it('should format supported model info', () => {
      const formatted = formatModelInfo('grok-4-latest');
      expect(formatted).toContain('Model: grok-4-latest');
      expect(formatted).toContain('Provider: xai');
      expect(formatted).toContain(`Max Tokens: ${(256000).toLocaleString()}`);
      expect(formatted).toContain('Supported: Yes');
    });

    it('should format unsupported model info', () => {
      const formatted = formatModelInfo('unknown-model');
      expect(formatted).toContain('Model: unknown-model');
      expect(formatted).toContain('Provider: unknown');
      expect(formatted).toContain('Supported: No');
    });
  });
});
