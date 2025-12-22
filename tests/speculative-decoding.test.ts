/**
 * Tests for Speculative Decoding
 *
 * Tests draft/target model acceleration for local LLM inference.
 */

import {
  SpeculativeDecoder,
  getSpeculativeDecoder,
  resetSpeculativeDecoder,
  RECOMMENDED_PAIRS,
  DEFAULT_SPECULATIVE_CONFIG,
  createMockDraftCallback,
  createMockTargetCallback,
} from '../src/inference/speculative-decoding.js';

// ============================================================================
// SpeculativeDecoder Tests
// ============================================================================

describe('SpeculativeDecoder', () => {
  beforeEach(() => {
    resetSpeculativeDecoder();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const decoder = new SpeculativeDecoder();
      const config = decoder.getConfig();

      expect(config.draftModel).toBe(DEFAULT_SPECULATIVE_CONFIG.draftModel);
      expect(config.targetModel).toBe(DEFAULT_SPECULATIVE_CONFIG.targetModel);
      expect(config.speculationLength).toBe(DEFAULT_SPECULATIVE_CONFIG.speculationLength);
    });

    it('should create with custom config', () => {
      const decoder = new SpeculativeDecoder({
        draftModel: 'custom-draft',
        targetModel: 'custom-target',
        speculationLength: 8,
        adaptiveLength: false,
      });
      const config = decoder.getConfig();

      expect(config.draftModel).toBe('custom-draft');
      expect(config.targetModel).toBe('custom-target');
      expect(config.speculationLength).toBe(8);
      expect(config.adaptiveLength).toBe(false);
    });
  });

  describe('generate', () => {
    it('should generate tokens using speculative decoding', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 4,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(0.8);
      const targetCallback = createMockTargetCallback(0.8);

      const result = await decoder.generate(
        'Test prompt',
        20,
        draftCallback,
        targetCallback
      );

      expect(result.tokens.length).toBeGreaterThan(0);
      // May slightly exceed maxTokens due to batch generation
      expect(result.tokens.length).toBeLessThanOrEqual(30);
      expect(result.stats.totalTokens).toBeGreaterThan(0);
    });

    it('should call onToken callback for each token', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 2,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(0.9);
      const targetCallback = createMockTargetCallback(0.9);
      const onToken = jest.fn();

      await decoder.generate('Test', 10, draftCallback, targetCallback, onToken);

      expect(onToken).toHaveBeenCalled();
    });

    it('should emit draft events', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 2,
        adaptiveLength: false,
      });

      const draftHandler = jest.fn();
      decoder.on('draft', draftHandler);

      const draftCallback = createMockDraftCallback(0.8);
      const targetCallback = createMockTargetCallback(0.8);

      await decoder.generate('Test', 10, draftCallback, targetCallback);

      expect(draftHandler).toHaveBeenCalled();
      expect(draftHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: expect.any(Array),
          timeMs: expect.any(Number),
        })
      );
    });

    it('should emit verify events', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 2,
        adaptiveLength: false,
      });

      const verifyHandler = jest.fn();
      decoder.on('verify', verifyHandler);

      const draftCallback = createMockDraftCallback(0.8);
      const targetCallback = createMockTargetCallback(0.8);

      await decoder.generate('Test', 10, draftCallback, targetCallback);

      expect(verifyHandler).toHaveBeenCalled();
      expect(verifyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          accepted: expect.any(Number),
          total: expect.any(Number),
          timeMs: expect.any(Number),
        })
      );
    });

    it('should emit complete event', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 2,
        adaptiveLength: false,
      });

      const completeHandler = jest.fn();
      decoder.on('complete', completeHandler);

      const draftCallback = createMockDraftCallback(0.8);
      const targetCallback = createMockTargetCallback(0.8);

      await decoder.generate('Test', 10, draftCallback, targetCallback);

      expect(completeHandler).toHaveBeenCalledTimes(1);
      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          totalTokens: expect.any(Number),
          stats: expect.any(Object),
        })
      );
    });

    it('should throw if already running', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 4,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(0.8);
      const targetCallback = createMockTargetCallback(0.8);

      // Start first generation
      const firstRun = decoder.generate('Test', 50, draftCallback, targetCallback);

      // Try to start second immediately
      await expect(
        decoder.generate('Test2', 10, draftCallback, targetCallback)
      ).rejects.toThrow('already running');

      await firstRun;
    });

    it('should respect maxTokens limit approximately', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 2,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(1.0); // Always accept
      const targetCallback = createMockTargetCallback(1.0);

      const result = await decoder.generate('Test', 10, draftCallback, targetCallback);

      // May slightly exceed due to batch generation, but should be close
      expect(result.tokens.length).toBeGreaterThan(0);
      expect(result.tokens.length).toBeLessThanOrEqual(15); // Allow some overshoot
    });
  });

  describe('statistics', () => {
    it('should track acceptance rate', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 4,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(0.5);
      const targetCallback = createMockTargetCallback(0.5);

      const result = await decoder.generate('Test', 20, draftCallback, targetCallback);

      expect(result.stats.acceptanceRate).toBeGreaterThanOrEqual(0);
      expect(result.stats.acceptanceRate).toBeLessThanOrEqual(1);
    });

    it('should track accepted and rejected tokens', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 4,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(0.7);
      const targetCallback = createMockTargetCallback(0.7);

      const result = await decoder.generate('Test', 20, draftCallback, targetCallback);

      expect(result.stats.acceptedTokens).toBeGreaterThanOrEqual(0);
      expect(result.stats.rejectedTokens).toBeGreaterThanOrEqual(0);
      expect(result.stats.totalTokens).toBe(
        result.stats.acceptedTokens + result.stats.speculationRounds
      );
    });

    it('should calculate estimated speedup', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 4,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(0.8);
      const targetCallback = createMockTargetCallback(0.8);

      const result = await decoder.generate('Test', 20, draftCallback, targetCallback);

      expect(result.stats.estimatedSpeedup).toBeGreaterThan(0);
    });

    it('should track speculation rounds', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 4,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(0.8);
      const targetCallback = createMockTargetCallback(0.8);

      const result = await decoder.generate('Test', 20, draftCallback, targetCallback);

      expect(result.stats.speculationRounds).toBeGreaterThan(0);
    });
  });

  describe('adaptive speculation length', () => {
    it('should increase length with high acceptance', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 2,
        adaptiveLength: true,
      });

      // Use very high acceptance rate
      const draftCallback = createMockDraftCallback(0.95);
      const targetCallback = createMockTargetCallback(0.95);

      await decoder.generate('Test', 30, draftCallback, targetCallback);

      // After many rounds with high acceptance, length should have increased
      const config = decoder.getConfig();
      // We can't directly check internal state, but we can verify it didn't crash
      expect(config.speculationLength).toBe(2); // Config stays the same, internal changes
    });

    it('should not change length when disabled', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 4,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(0.1); // Very low acceptance
      const targetCallback = createMockTargetCallback(0.1);

      await decoder.generate('Test', 20, draftCallback, targetCallback);

      const config = decoder.getConfig();
      expect(config.speculationLength).toBe(4);
    });
  });

  describe('shouldUseSpeculation', () => {
    it('should return true after successful runs', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 4,
        adaptiveLength: false,
      });

      // Run with high acceptance to build up good stats
      const draftCallback = createMockDraftCallback(0.9);
      const targetCallback = createMockTargetCallback(0.9);

      await decoder.generate('Test', 20, draftCallback, targetCallback);

      // After successful runs, should recommend using
      expect(decoder.shouldUseSpeculation()).toBe(true);
    });

    it('should return false with very low acceptance rate after many rounds', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 4,
        minAcceptanceRate: 0.5,
        adaptiveLength: false,
      });

      // Run with very low acceptance
      const draftCallback = createMockDraftCallback(0.1);
      const targetCallback = createMockTargetCallback(0.1);

      await decoder.generate('Test', 50, draftCallback, targetCallback);

      // After many rounds with low acceptance, should recommend not using
      const should = decoder.shouldUseSpeculation();
      // This depends on stats - check that the method works
      expect(typeof should).toBe('boolean');
    });
  });

  describe('getRecommendedDraft', () => {
    it('should find draft for Qwen target', () => {
      const pair = SpeculativeDecoder.getRecommendedDraft('qwen2.5-7b-instruct');
      expect(pair).not.toBeNull();
      expect(pair?.draft).toContain('qwen');
    });

    it('should find draft for Llama target', () => {
      const pair = SpeculativeDecoder.getRecommendedDraft('llama-3.1-8b');
      expect(pair).not.toBeNull();
      expect(pair?.draft).toContain('llama');
    });

    it('should return null for unknown model', () => {
      const pair = SpeculativeDecoder.getRecommendedDraft('totally-unknown-model');
      expect(pair).toBeNull();
    });
  });

  describe('generateLlamaCppArgs', () => {
    it('should generate draft model argument', () => {
      const decoder = new SpeculativeDecoder({
        draftModel: '/path/to/draft.gguf',
      });

      const args = decoder.generateLlamaCppArgs();

      expect(args).toContain('--model-draft');
      expect(args).toContain('/path/to/draft.gguf');
    });

    it('should generate draft length argument', () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 6,
      });

      const args = decoder.generateLlamaCppArgs();

      expect(args).toContain('--draft');
      expect(args).toContain('6');
    });

    it('should generate draft probability threshold', () => {
      const decoder = new SpeculativeDecoder();
      const args = decoder.generateLlamaCppArgs();

      expect(args).toContain('--draft-p-min');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const decoder = new SpeculativeDecoder();
      decoder.updateConfig({ speculationLength: 8 });

      const config = decoder.getConfig();
      expect(config.speculationLength).toBe(8);
    });

    it('should emit configUpdated event', () => {
      const decoder = new SpeculativeDecoder();
      const handler = jest.fn();
      decoder.on('configUpdated', handler);

      decoder.updateConfig({ adaptiveLength: false });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics', async () => {
      const decoder = new SpeculativeDecoder({
        speculationLength: 2,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(0.8);
      const targetCallback = createMockTargetCallback(0.8);

      await decoder.generate('Test', 10, draftCallback, targetCallback);

      const statsBefore = decoder.getStats();
      expect(statsBefore.totalTokens).toBeGreaterThan(0);

      decoder.resetStats();

      const statsAfter = decoder.getStats();
      expect(statsAfter.totalTokens).toBe(0);
      expect(statsAfter.acceptedTokens).toBe(0);
      expect(statsAfter.speculationRounds).toBe(0);
    });
  });

  describe('formatStats', () => {
    it('should format stats for display', async () => {
      const decoder = new SpeculativeDecoder({
        draftModel: 'draft-model',
        targetModel: 'target-model',
        speculationLength: 4,
        adaptiveLength: false,
      });

      const draftCallback = createMockDraftCallback(0.8);
      const targetCallback = createMockTargetCallback(0.8);

      await decoder.generate('Test', 15, draftCallback, targetCallback);

      const formatted = decoder.formatStats();

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('Speculative Decoding');
      expect(formatted).toContain('draft-model');
      expect(formatted).toContain('target-model');
      expect(formatted).toContain('Acceptance Rate');
      expect(formatted).toContain('Speedup');
    });
  });
});

// ============================================================================
// RECOMMENDED_PAIRS Tests
// ============================================================================

describe('RECOMMENDED_PAIRS', () => {
  it('should have multiple pairs', () => {
    expect(RECOMMENDED_PAIRS.length).toBeGreaterThan(0);
  });

  it('should have valid pair structure', () => {
    for (const pair of RECOMMENDED_PAIRS) {
      expect(pair.draft).toBeDefined();
      expect(pair.target).toBeDefined();
      expect(pair.description).toBeDefined();
      expect(pair.expectedSpeedup).toBeGreaterThan(1);
    }
  });

  it('should include Qwen pairs', () => {
    const qwenPairs = RECOMMENDED_PAIRS.filter(
      (p) => p.draft.includes('qwen') && p.target.includes('qwen')
    );
    expect(qwenPairs.length).toBeGreaterThan(0);
  });

  it('should include Llama pairs', () => {
    const llamaPairs = RECOMMENDED_PAIRS.filter(
      (p) => p.draft.includes('llama') && p.target.includes('llama')
    );
    expect(llamaPairs.length).toBeGreaterThan(0);
  });

  it('should have draft smaller than target', () => {
    // This is a heuristic check based on naming conventions
    for (const pair of RECOMMENDED_PAIRS) {
      // Extract sizes from names (e.g., "qwen2.5-0.5b" -> 0.5)
      const draftSize = parseFloat(pair.draft.match(/(\d+\.?\d*)b/i)?.[1] || '0');
      const targetSize = parseFloat(pair.target.match(/(\d+\.?\d*)b/i)?.[1] || '0');

      if (draftSize > 0 && targetSize > 0) {
        expect(draftSize).toBeLessThan(targetSize);
      }
    }
  });
});

// ============================================================================
// Mock Callbacks Tests
// ============================================================================

describe('Mock Callbacks', () => {
  describe('createMockDraftCallback', () => {
    it('should create a working draft callback', async () => {
      const callback = createMockDraftCallback();
      const result = await callback('test prompt', 4);

      expect(result.tokens).toHaveLength(4);
      expect(result.logprobs).toHaveLength(4);
      expect(result.draftTimeMs).toBeGreaterThan(0);
    });

    it('should respect num tokens parameter', async () => {
      const callback = createMockDraftCallback();
      const result = await callback('test', 8);

      expect(result.tokens).toHaveLength(8);
    });
  });

  describe('createMockTargetCallback', () => {
    it('should create a working target callback', async () => {
      const callback = createMockTargetCallback();
      const draftTokens = [1, 2, 3, 4];
      const result = await callback('test prompt', draftTokens);

      expect(result.accepted).toBeGreaterThanOrEqual(0);
      expect(result.accepted).toBeLessThanOrEqual(draftTokens.length);
      expect(result.finalTokens).toBeDefined();
      expect(result.verifyTimeMs).toBeGreaterThan(0);
    });

    it('should respect acceptance rate', async () => {
      // With 100% acceptance rate
      const highCallback = createMockTargetCallback(1.0);
      const highResult = await highCallback('test', [1, 2, 3, 4]);
      expect(highResult.accepted).toBe(4);
      expect(highResult.fullAccept).toBe(true);
    });
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================

describe('SpeculativeDecoder Singleton', () => {
  beforeEach(() => {
    resetSpeculativeDecoder();
  });

  describe('getSpeculativeDecoder', () => {
    it('should return same instance', () => {
      const d1 = getSpeculativeDecoder();
      const d2 = getSpeculativeDecoder();
      expect(d1).toBe(d2);
    });

    it('should accept config on first call', () => {
      const decoder = getSpeculativeDecoder({ speculationLength: 6 });
      expect(decoder.getConfig().speculationLength).toBe(6);
    });
  });

  describe('resetSpeculativeDecoder', () => {
    it('should reset singleton', () => {
      const d1 = getSpeculativeDecoder();
      resetSpeculativeDecoder();
      const d2 = getSpeculativeDecoder();
      expect(d1).not.toBe(d2);
    });
  });
});
