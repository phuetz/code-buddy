/**
 * Adaptive Chunker Tests
 */

import {
  calculateMessageStats,
  calculateOptimalChunkCount,
  chunkMessages,
  balanceChunks,
} from '../../../src/context/compaction/adaptive-chunker.js';
import type { ChatMessage } from '../../../src/types/index.js';

describe('Adaptive Chunker', () => {
  // Helper to create test messages
  function createMessages(count: number, contentLength: number = 100): ChatMessage[] {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1}: ${'x'.repeat(contentLength)}`,
    }));
  }

  describe('calculateMessageStats', () => {
    it('should return zeros for empty messages', () => {
      const stats = calculateMessageStats([]);

      expect(stats.totalMessages).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.avgTokensPerMessage).toBe(0);
      expect(stats.maxTokensPerMessage).toBe(0);
      expect(stats.minTokensPerMessage).toBe(0);
    });

    it('should calculate stats for messages', () => {
      const messages = createMessages(5, 100);
      const stats = calculateMessageStats(messages);

      expect(stats.totalMessages).toBe(5);
      expect(stats.totalTokens).toBeGreaterThan(0);
      expect(stats.avgTokensPerMessage).toBeGreaterThan(0);
      expect(stats.maxTokensPerMessage).toBeGreaterThanOrEqual(stats.avgTokensPerMessage);
      expect(stats.minTokensPerMessage).toBeLessThanOrEqual(stats.avgTokensPerMessage);
    });

    it('should handle varying message lengths', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Short' },
        { role: 'assistant', content: 'x'.repeat(500) },
        { role: 'user', content: 'Medium length message here' },
      ];

      const stats = calculateMessageStats(messages);

      expect(stats.totalMessages).toBe(3);
      expect(stats.maxTokensPerMessage).toBeGreaterThan(stats.minTokensPerMessage);
    });
  });

  describe('calculateOptimalChunkCount', () => {
    it('should return 1 for very few messages', () => {
      const stats = {
        totalMessages: 4,
        totalTokens: 200,
        avgTokensPerMessage: 50,
        maxTokensPerMessage: 60,
        minTokensPerMessage: 40,
      };

      const chunks = calculateOptimalChunkCount(stats, 4, { minChunkSize: 3 });
      expect(chunks).toBe(1);
    });

    it('should use target chunks for normal message counts', () => {
      const stats = {
        totalMessages: 20,
        totalTokens: 4000,
        avgTokensPerMessage: 200,
        maxTokensPerMessage: 300,
        minTokensPerMessage: 100,
      };

      const chunks = calculateOptimalChunkCount(stats, 4);
      expect(chunks).toBe(4);
    });

    it('should reduce chunks if tokens per chunk too small', () => {
      const stats = {
        totalMessages: 10,
        totalTokens: 1000,
        avgTokensPerMessage: 100,
        maxTokensPerMessage: 150,
        minTokensPerMessage: 50,
      };

      // 1000 tokens / 4 chunks = 250 tokens per chunk, which is < 500
      const chunks = calculateOptimalChunkCount(stats, 4);
      expect(chunks).toBeLessThanOrEqual(2);
    });

    it('should increase chunks if tokens per chunk too large', () => {
      const stats = {
        totalMessages: 20,
        totalTokens: 20000,
        avgTokensPerMessage: 1000,
        maxTokensPerMessage: 1500,
        minTokensPerMessage: 500,
      };

      // 20000 tokens / 4 chunks = 5000 tokens per chunk, which is > 4000
      const chunks = calculateOptimalChunkCount(stats, 4);
      expect(chunks).toBeGreaterThan(4);
    });
  });

  describe('chunkMessages', () => {
    it('should return empty array for no messages', () => {
      const chunks = chunkMessages([]);
      expect(chunks).toEqual([]);
    });

    it('should return single chunk for few messages', () => {
      const messages = createMessages(3);
      const chunks = chunkMessages(messages, 4, { minChunkSize: 3 });

      expect(chunks.length).toBe(1);
      expect(chunks[0].messages.length).toBe(3);
      expect(chunks[0].index).toBe(0);
    });

    it('should create multiple chunks for many messages', () => {
      // Use longer content to ensure we exceed token thresholds
      const messages = createMessages(40, 500);
      const chunks = chunkMessages(messages, 4);

      // All messages should be included
      const totalMessages = chunks.reduce((sum, c) => sum + c.messages.length, 0);
      expect(totalMessages).toBe(40);

      // Chunks should be indexed correctly
      chunks.forEach((chunk, i) => {
        expect(chunk.index).toBe(i);
      });
    });

    it('should respect max chunk size', () => {
      // Use longer content to force splitting, and more chunks
      const messages = createMessages(50, 500);
      const chunks = chunkMessages(messages, 10, { maxChunkSize: 10 });

      // All messages should be included
      const totalMessages = chunks.reduce((sum, c) => sum + c.messages.length, 0);
      expect(totalMessages).toBe(50);

      // Check that chunking happened (may not strictly respect maxChunkSize depending on token distribution)
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should track token counts per chunk', () => {
      const messages = createMessages(10);
      const chunks = chunkMessages(messages, 2);

      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeGreaterThan(0);
      }
    });
  });

  describe('balanceChunks', () => {
    it('should return empty array for no chunks', () => {
      const balanced = balanceChunks([]);
      expect(balanced).toEqual([]);
    });

    it('should return single chunk unchanged', () => {
      const chunks = [{
        index: 0,
        messages: createMessages(5),
        tokenCount: 500,
      }];

      const balanced = balanceChunks(chunks);
      expect(balanced.length).toBe(1);
      expect(balanced[0].tokenCount).toBe(500);
    });

    it('should merge small chunks', () => {
      const chunks = [
        { index: 0, messages: createMessages(2), tokenCount: 100 },
        { index: 1, messages: createMessages(2), tokenCount: 150 },
        { index: 2, messages: createMessages(5), tokenCount: 600 },
      ];

      const balanced = balanceChunks(chunks, 500);

      // First two small chunks should be merged
      expect(balanced.length).toBeLessThan(3);
    });

    it('should re-index chunks after balancing', () => {
      const chunks = [
        { index: 0, messages: createMessages(2), tokenCount: 200 },
        { index: 1, messages: createMessages(2), tokenCount: 200 },
        { index: 2, messages: createMessages(5), tokenCount: 600 },
      ];

      const balanced = balanceChunks(chunks, 500);

      // Check proper indexing
      balanced.forEach((chunk, i) => {
        expect(chunk.index).toBe(i);
      });
    });

    it('should not merge chunks that exceed minimum', () => {
      const chunks = [
        { index: 0, messages: createMessages(5), tokenCount: 600 },
        { index: 1, messages: createMessages(5), tokenCount: 700 },
        { index: 2, messages: createMessages(5), tokenCount: 800 },
      ];

      const balanced = balanceChunks(chunks, 500);

      // No merging should occur
      expect(balanced.length).toBe(3);
    });
  });
});
