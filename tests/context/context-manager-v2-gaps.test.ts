/**
 * Gap coverage for ContextManagerV2 — memory metrics, forceCleanup, dispose,
 * shouldWarn dedup, shouldAutoCompact, enhanced compression API.
 *
 * Base tests in tests/context-manager-v2.test.ts cover token counting,
 * prepareMessages, sliding window, tool truncation, summarization, warnings, config.
 */

import { ContextManagerV2 } from '../../src/context/context-manager-v2';
import type { CodeBuddyMessage } from '../../src/codebuddy/client';

describe('ContextManagerV2 (gap coverage)', () => {
  // Helper: create a manager with small limits for fast tests
  function createManager(overrides: Record<string, unknown> = {}): ContextManagerV2 {
    return new ContextManagerV2({
      maxContextTokens: 2000,
      responseReserveTokens: 200,
      recentMessagesCount: 5,
      enableSummarization: false,
      compressionRatio: 4,
      model: 'gpt-4',
      autoCompactThreshold: 1500,
      warningThresholds: [50, 75, 90],
      enableWarnings: true,
      enableEnhancedCompression: false,
      ...overrides,
    });
  }

  // Helper: create N messages totaling ~target tokens (rough: 1 token ≈ 4 chars)
  function makeMessages(count: number, charsPerMsg = 100): CodeBuddyMessage[] {
    const msgs: CodeBuddyMessage[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}: ${'x'.repeat(charsPerMsg)}`,
      });
    }
    return msgs;
  }

  // --------------------------------------------------------------------------
  // getMemoryMetrics()
  // --------------------------------------------------------------------------

  describe('getMemoryMetrics()', () => {
    it('should return initial metrics with all zeros/nulls', () => {
      const mgr = createManager();
      const metrics = mgr.getMemoryMetrics();
      expect(metrics.summaryCount).toBe(0);
      expect(metrics.summaryTokens).toBe(0);
      expect(metrics.peakMessageCount).toBe(0);
      expect(metrics.compressionCount).toBe(0);
      expect(metrics.totalTokensSaved).toBe(0);
      expect(metrics.lastCompressionTime).toBeNull();
      expect(metrics.warningsTriggered).toBe(0);
      mgr.dispose();
    });

    it('should track warningsTriggered after shouldWarn', () => {
      const mgr = createManager({ maxContextTokens: 400, autoCompactThreshold: 100000 });
      // Create messages that use >50% of 400 tokens (200+ tokens, ~800 chars)
      const msgs = makeMessages(10, 100);
      mgr.shouldWarn(msgs);
      const metrics = mgr.getMemoryMetrics();
      expect(metrics.warningsTriggered).toBeGreaterThanOrEqual(1);
      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // formatMemoryMetrics()
  // --------------------------------------------------------------------------

  describe('formatMemoryMetrics()', () => {
    it('should return human-readable multi-line string', () => {
      const mgr = createManager();
      const formatted = mgr.formatMemoryMetrics();
      expect(formatted).toContain('Context Manager Memory Metrics');
      expect(formatted).toContain('Summaries stored');
      expect(formatted).toContain('Peak messages');
      expect(formatted).toContain('Compressions');
      mgr.dispose();
    });

    it('should show "Never" when no compression has occurred', () => {
      const mgr = createManager();
      const formatted = mgr.formatMemoryMetrics();
      expect(formatted).toContain('Never');
      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // forceCleanup()
  // --------------------------------------------------------------------------

  describe('forceCleanup()', () => {
    it('should return summariesRemoved=0 and tokensFreed=0 when no summaries', () => {
      const mgr = createManager();
      const result = mgr.forceCleanup();
      expect(result.summariesRemoved).toBe(0);
      expect(result.tokensFreed).toBe(0);
      mgr.dispose();
    });

    it('should clear triggered warnings', () => {
      const mgr = createManager({ maxContextTokens: 400, autoCompactThreshold: 100000 });
      const msgs = makeMessages(10, 100);
      mgr.shouldWarn(msgs);
      expect(mgr.getMemoryMetrics().warningsTriggered).toBeGreaterThan(0);
      mgr.forceCleanup();
      expect(mgr.getMemoryMetrics().warningsTriggered).toBe(0);
      mgr.dispose();
    });

    it('should reset peakMessageCount to 0', () => {
      const mgr = createManager();
      // getStats tracks peak
      mgr.getStats(makeMessages(20));
      mgr.forceCleanup();
      expect(mgr.getMemoryMetrics().peakMessageCount).toBe(0);
      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // dispose()
  // --------------------------------------------------------------------------

  describe('dispose()', () => {
    it('should clear state', () => {
      const mgr = createManager();
      mgr.dispose();
      const metrics = mgr.getMemoryMetrics();
      expect(metrics.summaryCount).toBe(0);
      expect(metrics.warningsTriggered).toBe(0);
    });

    it('should be safe to call multiple times', () => {
      const mgr = createManager();
      expect(() => {
        mgr.dispose();
        mgr.dispose();
        mgr.dispose();
      }).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // shouldWarn() — multi-threshold dedup
  // --------------------------------------------------------------------------

  describe('shouldWarn() dedup', () => {
    it('should trigger warning when usage exceeds threshold', () => {
      const mgr = createManager({ maxContextTokens: 400, autoCompactThreshold: 100000 });
      const msgs = makeMessages(10, 100); // should exceed 50% of 400
      const result = mgr.shouldWarn(msgs);
      expect(result.warn).toBe(true);
      expect(result.threshold).toBeDefined();
      mgr.dispose();
    });

    it('should not re-trigger the same threshold twice', () => {
      const mgr = createManager({ maxContextTokens: 400, autoCompactThreshold: 100000 });
      const msgs = makeMessages(10, 100);
      const first = mgr.shouldWarn(msgs);
      expect(first.warn).toBe(true);
      const triggeredThreshold = first.threshold;

      // Same messages again — same threshold should not re-trigger
      const second = mgr.shouldWarn(msgs);
      // If another threshold is triggered, that's fine. But the same one shouldn't be.
      if (second.warn && second.threshold === triggeredThreshold) {
        fail('Same threshold should not re-trigger');
      }
      mgr.dispose();
    });

    it('should reset warnings via resetWarnings()', () => {
      const mgr = createManager({ maxContextTokens: 400, autoCompactThreshold: 100000 });
      const msgs = makeMessages(10, 100);
      mgr.shouldWarn(msgs);
      expect(mgr.getMemoryMetrics().warningsTriggered).toBeGreaterThan(0);

      mgr.resetWarnings();
      expect(mgr.getMemoryMetrics().warningsTriggered).toBe(0);

      // Should be able to trigger again
      const result = mgr.shouldWarn(msgs);
      expect(result.warn).toBe(true);
      mgr.dispose();
    });

    it('should not warn when enableWarnings is false', () => {
      const mgr = createManager({ enableWarnings: false, maxContextTokens: 400 });
      const msgs = makeMessages(10, 100);
      const result = mgr.shouldWarn(msgs);
      expect(result.warn).toBe(false);
      mgr.dispose();
    });

    it('should return threshold number in result', () => {
      const mgr = createManager({ maxContextTokens: 400, autoCompactThreshold: 100000 });
      const msgs = makeMessages(10, 100);
      const result = mgr.shouldWarn(msgs);
      if (result.warn) {
        expect([50, 75, 90]).toContain(result.threshold);
      }
      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // shouldAutoCompact()
  // --------------------------------------------------------------------------

  describe('shouldAutoCompact()', () => {
    it('should return true when tokens exceed autoCompactThreshold', () => {
      const mgr = createManager({ autoCompactThreshold: 100 }); // very low threshold
      const msgs = makeMessages(10, 100); // ~250 tokens
      expect(mgr.shouldAutoCompact(msgs)).toBe(true);
      mgr.dispose();
    });

    it('should return false when tokens below autoCompactThreshold', () => {
      const mgr = createManager({ autoCompactThreshold: 999999 });
      const msgs = makeMessages(2, 20);
      expect(mgr.shouldAutoCompact(msgs)).toBe(false);
      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Enhanced compression API
  // --------------------------------------------------------------------------

  describe('enhanced compression API', () => {
    it('should return null from getLastCompressionResult initially', () => {
      const mgr = createManager();
      expect(mgr.getLastCompressionResult()).toBeNull();
      mgr.dispose();
    });

    it('should return empty array from listContextArchives when no archives', () => {
      const mgr = createManager({ enableEnhancedCompression: true });
      const archives = mgr.listContextArchives();
      expect(archives).toEqual([]);
      mgr.dispose();
    });

    it('should return undefined from recoverFullContext when no archives', () => {
      const mgr = createManager({ enableEnhancedCompression: true });
      const result = mgr.recoverFullContext('nonexistent');
      expect(result).toBeUndefined();
      mgr.dispose();
    });
  });
});
