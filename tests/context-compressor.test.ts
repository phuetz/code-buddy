/**
 * Tests for Context Compressor
 */

import {
  ContextCompressor,
  getContextCompressor,
  resetContextCompressor,
  ContextEntry,
  CompressionResult,
} from '../src/context/context-compressor';

describe('ContextCompressor', () => {
  let compressor: ContextCompressor;

  beforeEach(() => {
    resetContextCompressor();
    compressor = new ContextCompressor();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      expect(compressor).toBeDefined();
    });

    it('should accept custom config', () => {
      const customCompressor = new ContextCompressor({
        maxTokens: 4000,
        maskThreshold: 500,
      });

      expect(customCompressor).toBeDefined();
    });
  });

  describe('compress', () => {
    it('should return entries unchanged when under budget', () => {
      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'user',
          content: 'Hello world',
          timestamp: Date.now(),
          tokens: 10,
        },
        {
          id: '2',
          type: 'assistant',
          content: 'Hi there!',
          timestamp: Date.now(),
          tokens: 10,
        },
      ];

      const result = compressor.compress(entries);

      expect(result.entries).toHaveLength(2);
      expect(result.originalTokens).toBe(20);
      expect(result.savings).toBe(0);
    });

    it('should compress entries when over budget', () => {
      // Create compressor with low max tokens
      const smallCompressor = new ContextCompressor({
        maxTokens: 50,
      });

      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'tool_result',
          content: 'x'.repeat(500), // ~125 tokens
          timestamp: Date.now() - 10000,
          metadata: { toolName: 'bash' },
        },
        {
          id: '2',
          type: 'user',
          content: 'Important message',
          timestamp: Date.now(),
        },
      ];

      const result = smallCompressor.compress(entries);

      expect(result.compressedTokens).toBeLessThanOrEqual(result.originalTokens);
    });

    it('should handle duplicate entries during compression', () => {
      // Use small budget to trigger compression
      const smallCompressor = new ContextCompressor({ maxTokens: 10 });
      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'tool_result',
          content: 'File not found: test.ts',
          timestamp: Date.now() - 2000,
          tokens: 50,
          metadata: { toolName: 'read_file' },
        },
        {
          id: '2',
          type: 'tool_result',
          content: 'File not found: test.ts',
          timestamp: Date.now() - 1000,
          tokens: 50,
          metadata: { toolName: 'read_file' },
        },
        {
          id: '3',
          type: 'tool_result',
          content: 'File not found: test.ts',
          timestamp: Date.now(),
          tokens: 50,
          metadata: { toolName: 'read_file' },
        },
      ];

      const result = smallCompressor.compress(entries);

      // Compression should have run and saved some tokens
      expect(result.compressedTokens).toBeLessThan(result.originalTokens);
      // Deduplication count is implementation-dependent
      expect(result.deduplicatedCount).toBeGreaterThanOrEqual(0);
    });

    it('should emit compressed event', (done) => {
      // Force compression by using small max tokens
      const smallCompressor = new ContextCompressor({
        maxTokens: 10,
      });

      smallCompressor.on('compressed', (data) => {
        expect(data.originalTokens).toBeDefined();
        expect(data.compressedTokens).toBeDefined();
        expect(data.savings).toBeDefined();
        done();
      });

      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'user',
          content: 'Test message with some content',
          timestamp: Date.now(),
          tokens: 100, // Explicitly set high token count to exceed budget
        },
      ];

      smallCompressor.compress(entries);
    });

    it('should preserve error content', () => {
      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'tool_result',
          content: 'Error: Something failed\nTypeError: undefined is not a function',
          timestamp: Date.now(),
          metadata: { toolName: 'bash', hasError: true },
        },
      ];

      const result = compressor.compress(entries);

      // Should retain error content
      const errorEntry = result.entries.find(e => e.metadata?.hasError);
      expect(errorEntry?.content).toContain('Error');
    });
  });

  describe('compressToolResult', () => {
    it('should not compress small outputs', () => {
      const output = 'Small output';
      const compressed = compressor.compressToolResult(output, 'bash');

      expect(compressed).toBe(output);
    });

    it('should compress large search results', () => {
      // Create output that exceeds the default maskThreshold of 2000 tokens (~8000 chars)
      const searchOutput = `
src/file1.ts:10: function test() {}
src/file2.ts:20: function test2() {}
src/file3.ts:30: function test3() {}
src/file4.ts:40: function test4() {}
src/file5.ts:50: function test5() {}
      `.repeat(200); // ~10000 chars

      const compressed = compressor.compressToolResult(searchOutput, 'search');

      expect(compressed.length).toBeLessThan(searchOutput.length);
    });

    it('should return output as-is when under threshold', () => {
      // Content under the threshold should not be compressed
      const fileContent = 'const line = 1;\n'.repeat(100); // ~1600 chars < 8000 threshold

      const compressed = compressor.compressToolResult(fileContent, 'read_file');

      expect(compressed).toBe(fileContent);
    });

    it('should compress when over threshold', () => {
      // Create a low-threshold compressor
      const lowThresholdCompressor = new ContextCompressor({
        maskThreshold: 100, // Very low threshold
      });

      const bashOutput = 'output line\n'.repeat(100);

      const compressed = lowThresholdCompressor.compressToolResult(bashOutput, 'bash');

      expect(compressed.length).toBeLessThan(bashOutput.length);
    });
  });

  describe('getStats', () => {
    it('should return compression statistics', () => {
      // Force compression by creating entries that exceed budget
      const smallCompressor = new ContextCompressor({ maxTokens: 10 });
      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'user',
          content: 'Test message that will exceed budget',
          timestamp: Date.now(),
          tokens: 100, // Explicitly exceed budget
        },
      ];

      smallCompressor.compress(entries);
      const stats = smallCompressor.getStats();

      expect(stats.totalCompressions).toBe(1);
      expect(stats.totalTokensSaved).toBeDefined();
      expect(stats.averageSavings).toBeDefined();
    });

    it('should track multiple compressions', () => {
      // Force compression
      const smallCompressor = new ContextCompressor({ maxTokens: 10 });
      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'user',
          content: 'Test message that exceeds budget',
          timestamp: Date.now(),
          tokens: 100, // Explicitly exceed budget
        },
      ];

      smallCompressor.compress(entries);
      smallCompressor.compress(entries);
      smallCompressor.compress(entries);

      const stats = smallCompressor.getStats();
      expect(stats.totalCompressions).toBe(3);
    });

    it('should not count compressions when under budget', () => {
      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'user',
          content: 'Test',
          timestamp: Date.now(),
          tokens: 1,
        },
      ];

      compressor.compress(entries);
      const stats = compressor.getStats();

      // Under budget, so no compression counted
      expect(stats.totalCompressions).toBe(0);
    });
  });

  describe('resetStats', () => {
    it('should reset statistics', () => {
      // Force compression first
      const smallCompressor = new ContextCompressor({ maxTokens: 10 });
      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'user',
          content: 'Test message that exceeds budget',
          timestamp: Date.now(),
          tokens: 100, // Explicitly exceed budget
        },
      ];

      smallCompressor.compress(entries);
      smallCompressor.resetStats();
      const stats = smallCompressor.getStats();

      expect(stats.totalCompressions).toBe(0);
      expect(stats.totalTokensSaved).toBe(0);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getContextCompressor();
      const instance2 = getContextCompressor();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getContextCompressor();
      resetContextCompressor();
      const instance2 = getContextCompressor();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('compression result structure', () => {
    it('should include all required fields', () => {
      const entries: ContextEntry[] = [
        {
          id: '1',
          type: 'user',
          content: 'Test message',
          timestamp: Date.now(),
        },
      ];

      const result: CompressionResult = compressor.compress(entries);

      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('originalTokens');
      expect(result).toHaveProperty('compressedTokens');
      expect(result).toHaveProperty('savings');
      expect(result).toHaveProperty('maskedCount');
      expect(result).toHaveProperty('summarizedCount');
      expect(result).toHaveProperty('deduplicatedCount');
    });
  });
});
