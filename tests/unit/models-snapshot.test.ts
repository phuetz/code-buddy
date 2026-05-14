/**
 * Unit tests for model tool config
 *
 * Tests that:
 * - Hardcoded configs match known model patterns
 * - Unknown models get bare defaults (fallback)
 * - Known patterns return correct contextWindow and maxOutputTokens
 */

import { describe, it, expect, vi } from 'vitest';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getModelToolConfig } from '../../src/config/model-tools.js';

describe('Model Tool Config', () => {
  it('should return config for known gpt-4o pattern', () => {
    const config = getModelToolConfig('gpt-4o-test');
    expect(config.contextWindow).toBe(128000);
    expect(config.maxOutputTokens).toBe(16384);
    expect(config.supportsVision).toBe(true);
  });

  it('should return config for known gpt-4o base model', () => {
    const config = getModelToolConfig('gpt-4o');
    expect(config.contextWindow).toBe(128000);
    expect(config.maxOutputTokens).toBe(16384);
  });

  it('should use bare defaults when model is not in hardcoded configs', () => {
    const config = getModelToolConfig('completely-unknown-model-xyz-123');
    // Should get generic defaults
    expect(config.contextWindow).toBe(32768);
    expect(config.maxOutputTokens).toBe(4096);
    expect(config.supportsToolCalls).toBe(true);
    expect(config.supportsVision).toBe(false);
  });

  it('should return consistent results for the same model (caching)', () => {
    const config1 = getModelToolConfig('gpt-4o');
    const config2 = getModelToolConfig('gpt-4o');
    expect(config1).toBe(config2); // Same reference (cached)
  });

  it('should match grok model patterns', () => {
    const config = getModelToolConfig('grok-3-beta');
    expect(config.supportsToolCalls).toBe(true);
    expect(config.contextWindow).toBeGreaterThan(0);
  });

  it('should match ChatGPT Codex subscription models before generic GPT-5', () => {
    const config = getModelToolConfig('gpt-5.5');
    expect(config.model).toBe('gpt-5.5*');
    expect(config.contextWindow).toBe(200000);
    expect(config.maxOutputTokens).toBe(64000);
    expect(config.patchFormat).toBe('search_replace');
  });
});
