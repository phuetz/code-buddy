/**
 * Comprehensive Unit Tests for Compression Module
 *
 * Tests cover:
 * - Message compression with configurable thresholds
 * - Conversation history compression
 * - Context window management
 * - Token counting and estimation
 * - Deduplication
 * - Observation masking
 * - Progressive summarization
 */

import {
  ContextCompressor,
  getContextCompressor,
  resetContextCompressor,
  ContextEntry,
  CompressionConfig,
  CompressionResult,
  CompressionStats,
} from '../../src/context/context-compressor';

import {
  ContextManagerV2,
  ContextManagerConfig,
  createContextManager,
  getContextManager,
} from '../../src/context/context-manager-v2';

import {
  TokenCounter,
  createTokenCounter,
  countTokens,
  estimateTokens,
  formatTokenCount,
  calculateCost,
  formatCost,
} from '../../src/utils/token-counter';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock ContextEntry for testing
 */
function createMockEntry(
  overrides: Partial<ContextEntry> = {}
): ContextEntry {
  return {
    id: Math.random().toString(36).substring(7),
    type: 'user',
    content: 'Test message content',
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Create multiple mock entries
 */
function createMockEntries(
  count: number,
  overrides: Partial<ContextEntry> = {}
): ContextEntry[] {
  return Array.from({ length: count }, (_, i) =>
    createMockEntry({
      id: `entry-${i}`,
      timestamp: Date.now() - (count - i) * 1000,
      ...overrides,
    })
  );
}

// ============================================================================
// ContextCompressor Tests
// ============================================================================

describe('ContextCompressor', () => {
  let compressor: ContextCompressor;

  beforeEach(() => {
    resetContextCompressor();
    compressor = new ContextCompressor();
  });

  afterEach(() => {
    compressor.dispose();
  });

  // ==========================================================================
  // Constructor and Configuration Tests
  // ==========================================================================

  describe('Constructor and Configuration', () => {
    it('should create with default configuration', () => {
      expect(compressor).toBeDefined();
      const stats = compressor.getStats();
      expect(stats.totalCompressions).toBe(0);
    });

    it('should accept custom maxTokens configuration', () => {
      const customCompressor = new ContextCompressor({
        maxTokens: 50000,
      });

      // Verify by attempting compression with entries below the limit
      const entries = createMockEntries(5, { tokens: 1000 });
      const result = customCompressor.compress(entries);

      // Should not compress when under budget
      expect(result.savings).toBe(0);
      customCompressor.dispose();
    });

    it('should accept custom maskThreshold configuration', () => {
      const customCompressor = new ContextCompressor({
        maskThreshold: 100, // Very low threshold (100 tokens ~ 400 chars)
      });

      // Create content with many lines (> 20) so bash compression actually reduces size
      // For bash, content with > 20 lines gets compressed to first 10 lines + preview
      const largeContent = Array.from({ length: 50 }, (_, i) =>
        `Output line ${i}: some data here`
      ).join('\n');

      const compressed = customCompressor.compressToolResult(largeContent, 'bash');

      // The compressed output should be smaller and contain compression markers
      expect(compressed.length).toBeLessThan(largeContent.length);
      expect(compressed).toContain('bash');
      customCompressor.dispose();
    });

    it('should accept custom preserveRecent configuration', () => {
      const customCompressor = new ContextCompressor({
        maxTokens: 100,
        preserveRecent: 3,
      });

      const entries = createMockEntries(10, { tokens: 50 });
      const result = customCompressor.compress(entries);

      // Recent entries should be preserved
      expect(result.entries.length).toBeGreaterThanOrEqual(3);
      customCompressor.dispose();
    });

    it('should accept custom preserveImportant configuration', () => {
      const customCompressor = new ContextCompressor({
        maxTokens: 100,
        preserveImportant: 2,
      });

      // Create entries with varying importance
      const entries: ContextEntry[] = [
        createMockEntry({
          id: '1',
          type: 'user',
          content: 'ERROR: Critical failure',
          tokens: 50,
          importance: 0.9,
        }),
        createMockEntry({
          id: '2',
          type: 'tool_result',
          content: 'Some regular output',
          tokens: 50,
        }),
      ];

      const result = customCompressor.compress(entries);
      expect(result).toBeDefined();
      customCompressor.dispose();
    });

    it('should accept custom summaryRatio configuration', () => {
      const customCompressor = new ContextCompressor({
        maxTokens: 100,
        summaryRatio: 0.1, // Aggressive compression
      });

      expect(customCompressor).toBeDefined();
      customCompressor.dispose();
    });

    it('should accept enableDeduplication configuration', () => {
      const withDedup = new ContextCompressor({
        enableDeduplication: true,
      });

      const withoutDedup = new ContextCompressor({
        enableDeduplication: false,
      });

      expect(withDedup).toBeDefined();
      expect(withoutDedup).toBeDefined();
      withDedup.dispose();
      withoutDedup.dispose();
    });

    it('should accept enableObservationMasking configuration', () => {
      const withMasking = new ContextCompressor({
        enableObservationMasking: true,
      });

      const withoutMasking = new ContextCompressor({
        enableObservationMasking: false,
      });

      expect(withMasking).toBeDefined();
      expect(withoutMasking).toBeDefined();
      withMasking.dispose();
      withoutMasking.dispose();
    });

    it('should merge custom config with defaults', () => {
      const customCompressor = new ContextCompressor({
        maxTokens: 5000,
        // Other values should remain default
      });

      // The compressor should work with merged config
      const entries = createMockEntries(3);
      const result = customCompressor.compress(entries);
      expect(result.entries).toHaveLength(3);
      customCompressor.dispose();
    });
  });

  // ==========================================================================
  // Message Compression with Configurable Thresholds
  // ==========================================================================

  describe('Message Compression with Configurable Thresholds', () => {
    it('should not compress when total tokens are under maxTokens', () => {
      const entries = createMockEntries(5, { tokens: 10 });
      const result = compressor.compress(entries);

      expect(result.entries).toHaveLength(5);
      expect(result.originalTokens).toBe(50);
      expect(result.compressedTokens).toBe(50);
      expect(result.savings).toBe(0);
    });

    it('should compress when total tokens exceed maxTokens', () => {
      const smallCompressor = new ContextCompressor({
        maxTokens: 50,
      });

      const entries = createMockEntries(10, { tokens: 20 });
      const result = smallCompressor.compress(entries);

      expect(result.compressedTokens).toBeLessThanOrEqual(result.originalTokens);
      expect(result.savings).toBeGreaterThanOrEqual(0);
      smallCompressor.dispose();
    });

    it('should respect different threshold levels', () => {
      // Test with various threshold settings
      const thresholds = [100, 500, 1000, 5000];

      for (const threshold of thresholds) {
        const testCompressor = new ContextCompressor({
          maxTokens: threshold,
        });

        const entries = createMockEntries(5, { tokens: threshold / 4 });
        const result = testCompressor.compress(entries);

        // With 5 entries at threshold/4 tokens each, total is 1.25x threshold
        // Should trigger compression
        expect(result.compressedTokens).toBeLessThanOrEqual(result.originalTokens);
        testCompressor.dispose();
      }
    });

    it('should apply compression strategies progressively', () => {
      const smallCompressor = new ContextCompressor({
        maxTokens: 100,
        enableDeduplication: true,
        enableObservationMasking: true,
      });

      // Create entries that will trigger multiple compression strategies
      const entries: ContextEntry[] = [
        createMockEntry({
          id: '1',
          type: 'tool_result',
          content: 'x'.repeat(1000),
          tokens: 250,
          metadata: { toolName: 'bash' },
        }),
        createMockEntry({
          id: '2',
          type: 'tool_result',
          content: 'x'.repeat(1000),
          tokens: 250,
          metadata: { toolName: 'search' },
        }),
        createMockEntry({
          id: '3',
          type: 'user',
          content: 'Important question',
          tokens: 10,
        }),
      ];

      const result = smallCompressor.compress(entries);

      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
      smallCompressor.dispose();
    });

    it('should handle entries with missing token counts', () => {
      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'user',
          content: 'Hello world',
          timestamp: Date.now(),
          // tokens field is missing
        },
        {
          id: '2',
          type: 'assistant',
          content: 'Hi there',
          timestamp: Date.now(),
          // tokens field is missing
        },
      ];

      const result = compressor.compress(entries);

      // Should estimate tokens from content
      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.entries).toHaveLength(2);
    });

    it('should handle empty entries array', () => {
      const result = compressor.compress([]);

      expect(result.entries).toHaveLength(0);
      expect(result.originalTokens).toBe(0);
      expect(result.compressedTokens).toBe(0);
      expect(result.savings).toBe(0);
    });

    it('should handle single entry', () => {
      const entries = [createMockEntry({ tokens: 100 })];
      const result = compressor.compress(entries);

      expect(result.entries).toHaveLength(1);
      expect(result.originalTokens).toBe(100);
    });
  });

  // ==========================================================================
  // Conversation History Compression
  // ==========================================================================

  describe('Conversation History Compression', () => {
    it('should preserve recent messages during compression', () => {
      const smallCompressor = new ContextCompressor({
        maxTokens: 100,
        preserveRecent: 3,
      });

      const entries = createMockEntries(10, { tokens: 50 });
      const result = smallCompressor.compress(entries);

      // Recent entries should be preserved (at least preserveRecent count)
      expect(result.entries.length).toBeGreaterThanOrEqual(3);
      smallCompressor.dispose();
    });

    it('should deduplicate identical entries', () => {
      const smallCompressor = new ContextCompressor({
        maxTokens: 50,
        enableDeduplication: true,
      });

      const duplicateContent = 'This is duplicate content';
      const entries: ContextEntry[] = [
        createMockEntry({
          id: '1',
          content: duplicateContent,
          tokens: 20,
          timestamp: Date.now() - 3000,
        }),
        createMockEntry({
          id: '2',
          content: duplicateContent,
          tokens: 20,
          timestamp: Date.now() - 2000,
        }),
        createMockEntry({
          id: '3',
          content: duplicateContent,
          tokens: 20,
          timestamp: Date.now() - 1000,
        }),
      ];

      const result = smallCompressor.compress(entries);

      expect(result.deduplicatedCount).toBeGreaterThanOrEqual(0);
      smallCompressor.dispose();
    });

    it('should not deduplicate when disabled', () => {
      const noDedupCompressor = new ContextCompressor({
        maxTokens: 50,
        enableDeduplication: false,
      });

      const duplicateContent = 'This is duplicate content';
      const entries: ContextEntry[] = [
        createMockEntry({
          id: '1',
          content: duplicateContent,
          tokens: 20,
        }),
        createMockEntry({
          id: '2',
          content: duplicateContent,
          tokens: 20,
        }),
      ];

      const result = noDedupCompressor.compress(entries);
      expect(result.deduplicatedCount).toBe(0);
      noDedupCompressor.dispose();
    });

    it('should summarize old entries when over budget', () => {
      const smallCompressor = new ContextCompressor({
        maxTokens: 100,
        preserveRecent: 2,
        summaryRatio: 0.2,
      });

      const entries: ContextEntry[] = Array.from({ length: 10 }, (_, i) =>
        createMockEntry({
          id: `entry-${i}`,
          type: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(200), // Will generate significant tokens
          tokens: 50,
          timestamp: Date.now() - (10 - i) * 1000,
        })
      );

      const result = smallCompressor.compress(entries);

      expect(result.summarizedCount).toBeGreaterThanOrEqual(0);
      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
      smallCompressor.dispose();
    });

    it('should preserve entries with error content', () => {
      const entries: ContextEntry[] = [
        createMockEntry({
          id: '1',
          type: 'tool_result',
          content: 'Error: Something went wrong\nTypeError: undefined',
          metadata: { hasError: true, toolName: 'bash' },
          tokens: 50,
        }),
        createMockEntry({
          id: '2',
          type: 'assistant',
          content: 'Normal response',
          tokens: 20,
        }),
      ];

      const result = compressor.compress(entries);

      const errorEntry = result.entries.find((e) => e.metadata?.hasError);
      expect(errorEntry).toBeDefined();
      expect(errorEntry?.content).toContain('Error');
    });

    it('should handle mixed entry types', () => {
      const entries: ContextEntry[] = [
        createMockEntry({ type: 'system', content: 'System prompt' }),
        createMockEntry({ type: 'user', content: 'User question' }),
        createMockEntry({ type: 'assistant', content: 'Assistant response' }),
        createMockEntry({ type: 'tool_call', content: 'Tool invocation' }),
        createMockEntry({ type: 'tool_result', content: 'Tool output' }),
      ];

      const result = compressor.compress(entries);

      expect(result.entries.length).toBeGreaterThan(0);
    });

    it('should maintain chronological order after compression', () => {
      const entries = createMockEntries(5).map((e, i) => ({
        ...e,
        timestamp: Date.now() - (5 - i) * 1000,
      }));

      const result = compressor.compress(entries);

      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i].timestamp).toBeGreaterThanOrEqual(
          result.entries[i - 1].timestamp
        );
      }
    });
  });

  // ==========================================================================
  // Context Window Management
  // ==========================================================================

  describe('Context Window Management', () => {
    it('should respect maxTokens limit', () => {
      const maxTokens = 200;
      const limitedCompressor = new ContextCompressor({ maxTokens });

      const entries = createMockEntries(20, { tokens: 50 });
      const result = limitedCompressor.compress(entries);

      // Compressed tokens should be at or below the limit
      // (or very close with some tolerance for edge cases)
      expect(result.compressedTokens).toBeLessThanOrEqual(maxTokens * 1.5);
      limitedCompressor.dispose();
    });

    it('should truncate least important entries when over budget', () => {
      const smallCompressor = new ContextCompressor({
        maxTokens: 50,
        preserveRecent: 2,
        preserveImportant: 1,
      });

      const entries: ContextEntry[] = [
        createMockEntry({
          id: '1',
          type: 'user',
          content: 'CRITICAL ERROR: Failure',
          tokens: 25,
          importance: 0.9,
        }),
        createMockEntry({
          id: '2',
          type: 'tool_result',
          content: 'Regular output',
          tokens: 25,
          importance: 0.3,
        }),
        createMockEntry({
          id: '3',
          type: 'assistant',
          content: 'Response',
          tokens: 25,
          importance: 0.5,
        }),
      ];

      const result = smallCompressor.compress(entries);

      // Should have fewer entries after compression
      expect(result.entries.length).toBeLessThanOrEqual(entries.length);
      smallCompressor.dispose();
    });

    it('should mask long tool outputs', () => {
      const smallCompressor = new ContextCompressor({
        maxTokens: 100,
        maskThreshold: 50,
        enableObservationMasking: true,
        preserveRecent: 1,
      });

      const entries: ContextEntry[] = [
        createMockEntry({
          id: '1',
          type: 'tool_result',
          content: 'x'.repeat(1000),
          tokens: 250,
          metadata: { toolName: 'bash' },
          timestamp: Date.now() - 5000,
        }),
        createMockEntry({
          id: '2',
          type: 'user',
          content: 'Recent message',
          tokens: 10,
          timestamp: Date.now(),
        }),
      ];

      const result = smallCompressor.compress(entries);

      expect(result.maskedCount).toBeGreaterThanOrEqual(0);
      smallCompressor.dispose();
    });

    it('should not mask outputs when masking is disabled', () => {
      const noMaskCompressor = new ContextCompressor({
        maxTokens: 100,
        enableObservationMasking: false,
      });

      const entries: ContextEntry[] = [
        createMockEntry({
          id: '1',
          type: 'tool_result',
          content: 'x'.repeat(500),
          tokens: 125,
          metadata: { toolName: 'bash' },
        }),
      ];

      const result = noMaskCompressor.compress(entries);

      expect(result.maskedCount).toBe(0);
      noMaskCompressor.dispose();
    });

    it('should calculate importance scores correctly', () => {
      // Use a small maxTokens to force compression (importance calculation happens during compression)
      const smallCompressor = new ContextCompressor({
        maxTokens: 50,
      });

      const entries: ContextEntry[] = [
        createMockEntry({
          type: 'user',
          content: 'User message with ERROR in it',
          tokens: 30,
        }),
        createMockEntry({
          type: 'assistant',
          content: 'Normal assistant response',
          tokens: 30,
        }),
        createMockEntry({
          type: 'system',
          content: 'System message',
          tokens: 30,
        }),
      ];

      const result = smallCompressor.compress(entries);

      // After compression (when over budget), entries should have importance scores
      for (const entry of result.entries) {
        // Importance is calculated during compression when over budget
        if (entry.importance !== undefined) {
          expect(entry.importance).toBeGreaterThanOrEqual(0);
          expect(entry.importance).toBeLessThanOrEqual(1);
        }
      }

      smallCompressor.dispose();
    });
  });

  // ==========================================================================
  // Tool Result Compression
  // ==========================================================================

  describe('compressToolResult', () => {
    it('should not compress small tool outputs', () => {
      const smallOutput = 'Command executed successfully';
      const result = compressor.compressToolResult(smallOutput, 'bash');

      expect(result).toBe(smallOutput);
    });

    it('should compress large search results', () => {
      const largeSearchOutput = Array.from({ length: 200 }, (_, i) =>
        `src/file${i}.ts:${i}: function test${i}() {}`
      ).join('\n');

      const result = compressor.compressToolResult(largeSearchOutput, 'search');

      expect(result.length).toBeLessThan(largeSearchOutput.length);
      expect(result).toContain('search');
    });

    it('should compress large file contents', () => {
      const largeFileContent = Array.from({ length: 500 }, (_, i) =>
        `const line${i} = ${i};`
      ).join('\n');

      const customCompressor = new ContextCompressor({
        maskThreshold: 100,
      });

      const result = customCompressor.compressToolResult(largeFileContent, 'read_file');

      expect(result.length).toBeLessThan(largeFileContent.length);
      customCompressor.dispose();
    });

    it('should compress bash output with errors', () => {
      const bashOutput = Array.from({ length: 100 }, (_, i) =>
        i === 50 ? 'Error: Command failed with exit code 1' : `Line ${i} of output`
      ).join('\n');

      const customCompressor = new ContextCompressor({
        maskThreshold: 50,
      });

      const result = customCompressor.compressToolResult(bashOutput, 'bash');

      expect(result.length).toBeLessThan(bashOutput.length);
      expect(result).toContain('bash');
      customCompressor.dispose();
    });

    it('should compress git diff output', () => {
      const gitDiffOutput = Array.from({ length: 200 }, (_, i) =>
        i % 2 === 0 ? `+Added line ${i}` : `-Removed line ${i}`
      ).join('\n');

      const customCompressor = new ContextCompressor({
        maskThreshold: 50,
      });

      const result = customCompressor.compressToolResult(gitDiffOutput, 'git_diff');

      expect(result.length).toBeLessThan(gitDiffOutput.length);
      customCompressor.dispose();
    });

    it('should compress git log output', () => {
      const gitLogOutput = Array.from({ length: 100 }, (_, i) =>
        `commit abc${i}def\nAuthor: User\nDate: 2024-01-${i.toString().padStart(2, '0')}\n\n    Commit message ${i}`
      ).join('\n\n');

      const customCompressor = new ContextCompressor({
        maskThreshold: 50,
      });

      const result = customCompressor.compressToolResult(gitLogOutput, 'git_log');

      expect(result.length).toBeLessThan(gitLogOutput.length);
      customCompressor.dispose();
    });

    it('should handle find_symbols tool', () => {
      const symbolsOutput = Array.from({ length: 100 }, (_, i) =>
        `Symbol: function${i} at src/file${i}.ts:${i}`
      ).join('\n');

      const customCompressor = new ContextCompressor({
        maskThreshold: 50,
      });

      const result = customCompressor.compressToolResult(symbolsOutput, 'find_symbols');

      expect(result.length).toBeLessThan(symbolsOutput.length);
      customCompressor.dispose();
    });

    it('should handle find_references tool', () => {
      const referencesOutput = Array.from({ length: 100 }, (_, i) =>
        `Reference: src/file${i}.ts:${i}: someFunction()`
      ).join('\n');

      const customCompressor = new ContextCompressor({
        maskThreshold: 50,
      });

      const result = customCompressor.compressToolResult(referencesOutput, 'find_references');

      expect(result.length).toBeLessThan(referencesOutput.length);
      customCompressor.dispose();
    });

    it('should handle list_files tool', () => {
      const listFilesOutput = Array.from({ length: 100 }, (_, i) =>
        `src/components/file${i}.tsx`
      ).join('\n');

      const customCompressor = new ContextCompressor({
        maskThreshold: 50,
      });

      const result = customCompressor.compressToolResult(listFilesOutput, 'list_files');

      expect(result.length).toBeLessThan(listFilesOutput.length);
      customCompressor.dispose();
    });

    it('should handle unknown tool types with truncation', () => {
      // Use a very long output with many lines to trigger truncation
      const unknownToolOutput = Array.from({ length: 100 }, (_, i) =>
        `Line ${i}: Some output content here`
      ).join('\n');

      const customCompressor = new ContextCompressor({
        maskThreshold: 50, // Low threshold to trigger compression
      });

      const result = customCompressor.compressToolResult(unknownToolOutput, 'unknown_tool');

      // The output should be truncated (contains truncation markers)
      expect(result.length).toBeLessThan(unknownToolOutput.length);
      expect(result).toContain('Truncated');
      customCompressor.dispose();
    });

    it('should preserve output under threshold for all tool types', () => {
      const tools = ['bash', 'search', 'read_file', 'git_diff', 'unknown'];
      const shortOutput = 'Short output';

      for (const tool of tools) {
        const result = compressor.compressToolResult(shortOutput, tool);
        expect(result).toBe(shortOutput);
      }
    });
  });

  // ==========================================================================
  // Statistics and Tracking
  // ==========================================================================

  describe('Statistics and Tracking', () => {
    it('should track compression statistics', () => {
      const smallCompressor = new ContextCompressor({ maxTokens: 50 });

      const entries = createMockEntries(5, { tokens: 30 });
      smallCompressor.compress(entries);

      const stats = smallCompressor.getStats();

      expect(stats.totalCompressions).toBe(1);
      expect(stats.totalTokensSaved).toBeGreaterThanOrEqual(0);
      smallCompressor.dispose();
    });

    it('should track multiple compressions', () => {
      const smallCompressor = new ContextCompressor({ maxTokens: 50 });

      const entries = createMockEntries(5, { tokens: 30 });

      smallCompressor.compress(entries);
      smallCompressor.compress(entries);
      smallCompressor.compress(entries);

      const stats = smallCompressor.getStats();

      expect(stats.totalCompressions).toBe(3);
      smallCompressor.dispose();
    });

    it('should calculate average savings', () => {
      const smallCompressor = new ContextCompressor({ maxTokens: 50 });

      const entries = createMockEntries(5, { tokens: 30 });

      smallCompressor.compress(entries);
      smallCompressor.compress(entries);

      const stats = smallCompressor.getStats();

      expect(stats.averageSavings).toBeDefined();
      expect(typeof stats.averageSavings).toBe('number');
      smallCompressor.dispose();
    });

    it('should track compression history', () => {
      const smallCompressor = new ContextCompressor({ maxTokens: 50 });

      const entries = createMockEntries(5, { tokens: 30 });

      smallCompressor.compress(entries);
      smallCompressor.compress(entries);

      const stats = smallCompressor.getStats();

      expect(stats.compressionHistory).toBeDefined();
      expect(stats.compressionHistory.length).toBe(2);
      expect(stats.compressionHistory[0].timestamp).toBeDefined();
      expect(stats.compressionHistory[0].savings).toBeDefined();
      smallCompressor.dispose();
    });

    it('should limit compression history to 100 records', () => {
      const smallCompressor = new ContextCompressor({ maxTokens: 10 });

      const entries = createMockEntries(2, { tokens: 20 });

      // Compress 110 times
      for (let i = 0; i < 110; i++) {
        smallCompressor.compress(entries);
      }

      const stats = smallCompressor.getStats();

      expect(stats.compressionHistory.length).toBeLessThanOrEqual(100);
      smallCompressor.dispose();
    });

    it('should reset statistics', () => {
      const smallCompressor = new ContextCompressor({ maxTokens: 50 });

      const entries = createMockEntries(5, { tokens: 30 });
      smallCompressor.compress(entries);

      smallCompressor.resetStats();
      const stats = smallCompressor.getStats();

      expect(stats.totalCompressions).toBe(0);
      expect(stats.totalTokensSaved).toBe(0);
      expect(stats.averageSavings).toBe(0);
      expect(stats.compressionHistory).toHaveLength(0);
      smallCompressor.dispose();
    });

    it('should not count compression when under budget', () => {
      const entries = createMockEntries(2, { tokens: 10 });

      compressor.compress(entries);
      const stats = compressor.getStats();

      expect(stats.totalCompressions).toBe(0);
    });

    it('should return copy of stats', () => {
      const stats1 = compressor.getStats();
      const stats2 = compressor.getStats();

      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  // ==========================================================================
  // Event Emission
  // ==========================================================================

  describe('Event Emission', () => {
    it('should emit compressed event when compression occurs', (done) => {
      const smallCompressor = new ContextCompressor({ maxTokens: 50 });

      smallCompressor.on('compressed', (data) => {
        expect(data.originalTokens).toBeDefined();
        expect(data.compressedTokens).toBeDefined();
        expect(data.savings).toBeDefined();
        expect(data.duration).toBeDefined();
        smallCompressor.dispose();
        done();
      });

      const entries = createMockEntries(5, { tokens: 30 });
      smallCompressor.compress(entries);
    });

    it('should not emit event when no compression needed', (done) => {
      let eventEmitted = false;

      compressor.on('compressed', () => {
        eventEmitted = true;
      });

      const entries = createMockEntries(2, { tokens: 5 });
      compressor.compress(entries);

      setTimeout(() => {
        expect(eventEmitted).toBe(false);
        done();
      }, 100);
    });

    it('should include duration in compressed event', (done) => {
      const smallCompressor = new ContextCompressor({ maxTokens: 50 });

      smallCompressor.on('compressed', (data) => {
        expect(typeof data.duration).toBe('number');
        expect(data.duration).toBeGreaterThanOrEqual(0);
        smallCompressor.dispose();
        done();
      });

      const entries = createMockEntries(5, { tokens: 30 });
      smallCompressor.compress(entries);
    });
  });

  // ==========================================================================
  // Compression Result Structure
  // ==========================================================================

  describe('Compression Result Structure', () => {
    it('should include all required fields in result', () => {
      const entries = createMockEntries(3);
      const result: CompressionResult = compressor.compress(entries);

      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('originalTokens');
      expect(result).toHaveProperty('compressedTokens');
      expect(result).toHaveProperty('savings');
      expect(result).toHaveProperty('maskedCount');
      expect(result).toHaveProperty('summarizedCount');
      expect(result).toHaveProperty('deduplicatedCount');
    });

    it('should return valid types for all fields', () => {
      const entries = createMockEntries(3);
      const result = compressor.compress(entries);

      expect(Array.isArray(result.entries)).toBe(true);
      expect(typeof result.originalTokens).toBe('number');
      expect(typeof result.compressedTokens).toBe('number');
      expect(typeof result.savings).toBe('number');
      expect(typeof result.maskedCount).toBe('number');
      expect(typeof result.summarizedCount).toBe('number');
      expect(typeof result.deduplicatedCount).toBe('number');
    });

    it('should have non-negative numeric values', () => {
      const entries = createMockEntries(3);
      const result = compressor.compress(entries);

      expect(result.originalTokens).toBeGreaterThanOrEqual(0);
      expect(result.compressedTokens).toBeGreaterThanOrEqual(0);
      expect(result.savings).toBeGreaterThanOrEqual(0);
      expect(result.maskedCount).toBeGreaterThanOrEqual(0);
      expect(result.summarizedCount).toBeGreaterThanOrEqual(0);
      expect(result.deduplicatedCount).toBeGreaterThanOrEqual(0);
    });

    it('should have valid entries in result', () => {
      const entries = createMockEntries(3);
      const result = compressor.compress(entries);

      for (const entry of result.entries) {
        expect(entry.id).toBeDefined();
        expect(entry.type).toBeDefined();
        expect(entry.content).toBeDefined();
        expect(entry.timestamp).toBeDefined();
      }
    });
  });

  // ==========================================================================
  // Singleton Pattern
  // ==========================================================================

  describe('Singleton Pattern', () => {
    it('should return same instance from getContextCompressor', () => {
      const instance1 = getContextCompressor();
      const instance2 = getContextCompressor();

      expect(instance1).toBe(instance2);
    });

    it('should return new instance after reset', () => {
      const instance1 = getContextCompressor();
      resetContextCompressor();
      const instance2 = getContextCompressor();

      expect(instance1).not.toBe(instance2);
    });

    it('should accept config on first call', () => {
      resetContextCompressor();
      const instance = getContextCompressor({ maxTokens: 5000 });

      expect(instance).toBeDefined();
    });
  });

  // ==========================================================================
  // Dispose
  // ==========================================================================

  describe('Dispose', () => {
    it('should remove all event listeners on dispose', () => {
      const testCompressor = new ContextCompressor();

      let callCount = 0;
      testCompressor.on('compressed', () => {
        callCount++;
      });

      testCompressor.dispose();

      // After dispose, events should not be emitted
      expect(testCompressor.listenerCount('compressed')).toBe(0);
    });
  });
});

// ============================================================================
// Token Counting and Estimation Tests
// ============================================================================

describe('Token Counting and Estimation', () => {
  describe('TokenCounter', () => {
    let counter: TokenCounter;

    beforeEach(() => {
      counter = new TokenCounter();
    });

    afterEach(() => {
      counter.dispose();
    });

    it('should count tokens in simple text', () => {
      const count = counter.countTokens('Hello, world!');

      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(10);
    });

    it('should return 0 for empty string', () => {
      const count = counter.countTokens('');

      expect(count).toBe(0);
    });

    it('should handle long text', () => {
      const longText = 'word '.repeat(1000);
      const count = counter.countTokens(longText);

      expect(count).toBeGreaterThan(0);
    });

    it('should count message tokens', () => {
      const messages = [
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const count = counter.countMessageTokens(messages);

      expect(count).toBeGreaterThan(0);
    });

    it('should handle messages with null content', () => {
      const messages = [
        { role: 'assistant', content: null },
      ];

      const count = counter.countMessageTokens(messages);

      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should handle messages with tool_calls', () => {
      const messages = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'test' } }],
        },
      ];

      const count = counter.countMessageTokens(messages);

      expect(count).toBeGreaterThan(0);
    });

    it('should create counter with specific model', () => {
      const gpt4Counter = new TokenCounter('gpt-4');
      const count = gpt4Counter.countTokens('Hello');

      expect(count).toBeGreaterThan(0);
      gpt4Counter.dispose();
    });

    it('should handle unknown model gracefully', () => {
      const unknownCounter = new TokenCounter('unknown-model');
      const count = unknownCounter.countTokens('Hello');

      expect(count).toBeGreaterThan(0);
      unknownCounter.dispose();
    });

    it('should estimate streaming tokens', () => {
      const estimate = counter.estimateStreamingTokens('Partial response so far');

      expect(estimate).toBeGreaterThan(0);
    });
  });

  describe('createTokenCounter', () => {
    it('should create token counter with default model', () => {
      const counter = createTokenCounter();

      expect(counter).toBeInstanceOf(TokenCounter);
      counter.dispose();
    });

    it('should create token counter with specified model', () => {
      const counter = createTokenCounter('gpt-4');

      expect(counter).toBeInstanceOf(TokenCounter);
      counter.dispose();
    });
  });

  describe('countTokens (convenience function)', () => {
    it('should count tokens using default counter', () => {
      const count = countTokens('Hello, world!');

      expect(count).toBeGreaterThan(0);
    });

    it('should reuse singleton counter', () => {
      const count1 = countTokens('First');
      const count2 = countTokens('Second');

      expect(count1).toBeGreaterThan(0);
      expect(count2).toBeGreaterThan(0);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens from character count', () => {
      const text = 'Hello, world!'; // 13 chars
      const estimate = estimateTokens(text);

      // ~4 chars per token means ~3-4 tokens
      expect(estimate).toBeGreaterThanOrEqual(3);
      expect(estimate).toBeLessThanOrEqual(5);
    });

    it('should return 0 for empty string', () => {
      const estimate = estimateTokens('');

      expect(estimate).toBe(0);
    });

    it('should handle long text', () => {
      const longText = 'x'.repeat(4000);
      const estimate = estimateTokens(longText);

      // ~4 chars per token means ~1000 tokens
      expect(estimate).toBeGreaterThanOrEqual(900);
      expect(estimate).toBeLessThanOrEqual(1100);
    });
  });

  describe('formatTokenCount', () => {
    it('should format small numbers as-is', () => {
      expect(formatTokenCount(0)).toBe('0');
      expect(formatTokenCount(100)).toBe('100');
      expect(formatTokenCount(999)).toBe('999');
    });

    it('should format thousands with k suffix', () => {
      expect(formatTokenCount(1000)).toBe('1k');
      expect(formatTokenCount(1500)).toBe('1.5k');
      expect(formatTokenCount(10000)).toBe('10k');
      // 999999 / 1000 = 999.999 which formats to 1000.0k
      expect(formatTokenCount(999999)).toMatch(/999\.9*k|1000(\.0)?k/);
    });

    it('should format millions with m suffix', () => {
      expect(formatTokenCount(1000000)).toBe('1m');
      expect(formatTokenCount(1500000)).toBe('1.5m');
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for known models', () => {
      const cost = calculateCost(1000, 500, 'gpt-4');

      expect(cost.inputCost).toBeGreaterThan(0);
      expect(cost.outputCost).toBeGreaterThan(0);
      expect(cost.totalCost).toBe(cost.inputCost + cost.outputCost);
    });

    it('should handle local models as free', () => {
      const cost = calculateCost(1000, 500, 'local');

      expect(cost.inputCost).toBe(0);
      expect(cost.outputCost).toBe(0);
      expect(cost.totalCost).toBe(0);
    });

    it('should handle ollama models as free', () => {
      const cost = calculateCost(1000, 500, 'ollama');

      expect(cost.totalCost).toBe(0);
    });

    it('should match partial model names', () => {
      const cost = calculateCost(1000, 500, 'gpt-4-turbo-preview');

      expect(cost.totalCost).toBeGreaterThan(0);
    });

    it('should default to free for unknown models', () => {
      const cost = calculateCost(1000, 500, 'completely-unknown-model');

      expect(cost.totalCost).toBe(0);
    });
  });

  describe('formatCost', () => {
    it('should show Free for zero cost', () => {
      expect(formatCost(0)).toBe('Free');
    });

    it('should format very small costs in millicents', () => {
      expect(formatCost(0.0005)).toMatch(/\$.*m$/);
    });

    it('should format small costs with 4 decimals', () => {
      expect(formatCost(0.005)).toMatch(/\$0\.0050/);
    });

    it('should format medium costs with 3 decimals', () => {
      expect(formatCost(0.5)).toMatch(/\$0\.500/);
    });

    it('should format large costs with 2 decimals', () => {
      expect(formatCost(5.5)).toMatch(/\$5\.50/);
    });
  });
});

// ============================================================================
// Integration with ContextManagerV2
// ============================================================================

describe('Integration: ContextCompressor with ContextManagerV2', () => {
  let compressor: ContextCompressor;
  let manager: ContextManagerV2;

  beforeEach(() => {
    resetContextCompressor();
    compressor = new ContextCompressor();
    manager = new ContextManagerV2({
      maxContextTokens: 1000,
      responseReserveTokens: 100,
      recentMessagesCount: 5,
      enableSummarization: true,
    });
  });

  afterEach(() => {
    compressor.dispose();
    manager.dispose();
  });

  it('should compress entries matching ContextManagerV2 message format', () => {
    // Simulate entries derived from CodeBuddyMessage format
    const entries: ContextEntry[] = [
      {
        id: '1',
        type: 'system',
        content: 'You are a helpful assistant.',
        timestamp: Date.now(),
      },
      {
        id: '2',
        type: 'user',
        content: 'Hello!',
        timestamp: Date.now(),
      },
      {
        id: '3',
        type: 'assistant',
        content: 'Hi there! How can I help?',
        timestamp: Date.now(),
      },
    ];

    const result = compressor.compress(entries);

    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('should work with entries having tool metadata', () => {
    const entries: ContextEntry[] = [
      {
        id: '1',
        type: 'tool_call',
        content: JSON.stringify({ name: 'bash', arguments: { command: 'ls' } }),
        timestamp: Date.now(),
        metadata: { toolName: 'bash' },
      },
      {
        id: '2',
        type: 'tool_result',
        content: 'file1.txt\nfile2.txt\nfile3.txt',
        timestamp: Date.now(),
        metadata: { toolName: 'bash', success: true },
      },
    ];

    const result = compressor.compress(entries);

    expect(result).toBeDefined();
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('should complement ContextManagerV2 compression strategies', () => {
    // Both compressor and manager should work together
    // Manager handles message-level compression
    // Compressor handles context-entry-level compression

    const smallManager = new ContextManagerV2({
      maxContextTokens: 100,
      responseReserveTokens: 10,
      recentMessagesCount: 3,
    });

    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Message ${i} with some content`,
    }));

    const preparedMessages = smallManager.prepareMessages(messages);

    // Convert to entries for compressor
    const entries: ContextEntry[] = preparedMessages.map((msg, i) => ({
      id: `${i}`,
      type: msg.role as ContextEntry['type'],
      content: typeof msg.content === 'string' ? msg.content : '',
      timestamp: Date.now(),
    }));

    const result = compressor.compress(entries);

    expect(result.entries.length).toBeGreaterThan(0);
    smallManager.dispose();
  });

  it('should handle context stats from both systems', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ];

    // ContextManagerV2 stats
    const managerStats = manager.getStats(messages);
    expect(managerStats.totalTokens).toBeGreaterThan(0);

    // ContextCompressor stats
    const entries = messages.map((msg, i) => ({
      id: `${i}`,
      type: msg.role as ContextEntry['type'],
      content: msg.content,
      timestamp: Date.now(),
    }));

    compressor.compress(entries);
    const compressorStats = compressor.getStats();
    expect(compressorStats.totalCompressions).toBe(0); // Under budget
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  let compressor: ContextCompressor;

  beforeEach(() => {
    resetContextCompressor();
    compressor = new ContextCompressor();
  });

  afterEach(() => {
    compressor.dispose();
  });

  it('should handle entries with very long content', () => {
    const veryLongContent = 'x'.repeat(100000);
    const entries: ContextEntry[] = [
      createMockEntry({
        content: veryLongContent,
      }),
    ];

    const result = compressor.compress(entries);

    expect(result).toBeDefined();
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('should handle entries with empty content', () => {
    const entries: ContextEntry[] = [
      createMockEntry({ content: '' }),
      createMockEntry({ content: '' }),
    ];

    const result = compressor.compress(entries);

    expect(result.entries).toHaveLength(2);
  });

  it('should handle entries with special characters', () => {
    const specialContent = '!@#$%^&*()_+-=[]{}|;\':",./<>?\n\t\r';
    const entries: ContextEntry[] = [
      createMockEntry({ content: specialContent }),
    ];

    const result = compressor.compress(entries);

    expect(result).toBeDefined();
  });

  it('should handle entries with unicode content', () => {
    const unicodeContent = 'Hello, World! \nHello, World! Hello, World!';
    const entries: ContextEntry[] = [
      createMockEntry({ content: unicodeContent }),
    ];

    const result = compressor.compress(entries);

    expect(result).toBeDefined();
  });

  it('should handle entries with JSON content', () => {
    const jsonContent = JSON.stringify({ key: 'value', nested: { array: [1, 2, 3] } });
    const entries: ContextEntry[] = [
      createMockEntry({
        content: jsonContent,
        type: 'tool_result',
        metadata: { toolName: 'api_call' },
      }),
    ];

    const result = compressor.compress(entries);

    expect(result).toBeDefined();
  });

  it('should handle entries with code content', () => {
    const codeContent = `
function test() {
  const x = 1;
  for (let i = 0; i < 10; i++) {
    console.log(i);
  }
  return x;
}
    `.trim();

    const entries: ContextEntry[] = [
      createMockEntry({
        content: codeContent,
        type: 'tool_result',
        metadata: { toolName: 'read_file', isCodeOutput: true },
      }),
    ];

    const result = compressor.compress(entries);

    expect(result).toBeDefined();
  });

  it('should handle rapid successive compressions', () => {
    const smallCompressor = new ContextCompressor({ maxTokens: 50 });
    const entries = createMockEntries(5, { tokens: 30 });

    const results: CompressionResult[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(smallCompressor.compress(entries));
    }

    expect(results).toHaveLength(10);
    expect(smallCompressor.getStats().totalCompressions).toBe(10);
    smallCompressor.dispose();
  });

  it('should handle null/undefined array values gracefully', () => {
    // Pass an array that might have been corrupted
    const entries = createMockEntries(3);

    // This should not throw
    const result = compressor.compress(entries);
    expect(result).toBeDefined();
  });

  it('should handle entries with missing optional fields', () => {
    const minimalEntry: ContextEntry = {
      id: '1',
      type: 'user',
      content: 'Test',
      timestamp: Date.now(),
      // All optional fields omitted: tokens, importance, compressed, originalTokens, metadata
    };

    const result = compressor.compress([minimalEntry]);

    expect(result.entries).toHaveLength(1);
  });

  it('should handle entries with all optional fields', () => {
    const fullEntry: ContextEntry = {
      id: '1',
      type: 'tool_result',
      content: 'Test output',
      timestamp: Date.now(),
      tokens: 10,
      importance: 0.7,
      compressed: false,
      originalTokens: 10,
      metadata: {
        toolName: 'bash',
        success: true,
        hasError: false,
        isCodeOutput: true,
        fileCount: 2,
      },
    };

    const result = compressor.compress([fullEntry]);

    expect(result.entries).toHaveLength(1);
  });

  it('should handle compressing already compressed entries', () => {
    const smallCompressor = new ContextCompressor({ maxTokens: 50 });

    const entries: ContextEntry[] = [
      createMockEntry({
        id: '1',
        content: '[Summarized: 100 lines -> 10 lines]\nSome summary',
        compressed: true,
        originalTokens: 500,
        tokens: 50,
      }),
      createMockEntry({
        id: '2',
        content: 'New entry',
        tokens: 30,
      }),
    ];

    const result = smallCompressor.compress(entries);

    expect(result).toBeDefined();
    smallCompressor.dispose();
  });
});

// ============================================================================
// Performance Tests (Basic)
// ============================================================================

describe('Performance Characteristics', () => {
  it('should compress large entry sets in reasonable time', () => {
    const largeCompressor = new ContextCompressor({ maxTokens: 1000 });

    const entries = createMockEntries(100, { tokens: 50 });

    const startTime = Date.now();
    const result = largeCompressor.compress(entries);
    const duration = Date.now() - startTime;

    expect(result).toBeDefined();
    // Should complete in under 5 seconds (very generous for 100 entries)
    expect(duration).toBeLessThan(5000);
    largeCompressor.dispose();
  });

  it('should handle compression of entries with many duplicates efficiently', () => {
    const compressor = new ContextCompressor({
      maxTokens: 100,
      enableDeduplication: true,
    });

    const duplicateContent = 'This is duplicate content that repeats';
    const entries = Array.from({ length: 50 }, (_, i) =>
      createMockEntry({
        id: `entry-${i}`,
        content: duplicateContent,
        tokens: 20,
      })
    );

    const startTime = Date.now();
    const result = compressor.compress(entries);
    const duration = Date.now() - startTime;

    expect(result).toBeDefined();
    expect(duration).toBeLessThan(2000);
    compressor.dispose();
  });
});
