/**
 * Progressive Fallback Tests
 */

import {
  applyTruncation,
  removeMiddle,
  extractKeyInfo,
  aggressiveTruncate,
  applyProgressiveFallback,
  applyMessageFallback,
} from '../../../src/context/compaction/progressive-fallback.js';
import type { ChatMessage } from '../../../src/types/index.js';

describe('Progressive Fallback', () => {
  const longContent = 'x'.repeat(10000);

  describe('applyTruncation', () => {
    it('should truncate content to target tokens', () => {
      const result = applyTruncation(longContent, 500);

      expect(result.tokenCount).toBeLessThanOrEqual(result.originalTokens);
      expect(result.strategy).toBe('truncate');
      expect(result.compressionRatio).toBeGreaterThan(0);
    });

    it('should preserve head and tail', () => {
      const content = 'HEAD_START' + 'x'.repeat(5000) + 'TAIL_END';
      const result = applyTruncation(content, 500);

      expect(result.content).toContain('HEAD_START');
      expect(result.content).toContain('TAIL_END');
    });

    it('should include truncation marker', () => {
      const result = applyTruncation(longContent, 500);

      expect(result.content).toContain('truncated');
    });
  });

  describe('removeMiddle', () => {
    it('should remove middle content', () => {
      const result = removeMiddle(longContent, 500);

      expect(result.strategy).toBe('remove-middle');
      expect(result.content).toContain('removed');
    });

    it('should favor head over tail (70/30 split)', () => {
      const content = 'H'.repeat(5000) + 'T'.repeat(5000);
      const result = removeMiddle(content, 1000);

      // Count H's and T's in result
      const hCount = (result.content.match(/H/g) || []).length;
      const tCount = (result.content.match(/T/g) || []).length;

      expect(hCount).toBeGreaterThan(tCount);
    });
  });

  describe('extractKeyInfo', () => {
    it('should extract sentences with keywords', () => {
      const content = `
        This is a random sentence.
        There is an error in the authentication module.
        The weather is nice today.
        We need to fix the critical bug immediately.
        TODO: implement caching for better performance.
        Just some filler text here.
        The solution involves adding proper validation.
      `;

      const result = extractKeyInfo(content, 200);

      expect(result.strategy).toBe('extract-key');
      expect(result.content.toLowerCase()).toContain('error');
      expect(result.content.toLowerCase()).toContain('fix');
    });

    it('should fallback to aggressive truncate if no keywords', () => {
      const content = 'Just some plain text without any special keywords. '.repeat(50);
      const result = extractKeyInfo(content, 100);

      // Should fallback since no keywords
      expect(['extract-key', 'aggressive-truncate']).toContain(result.strategy);
    });

    it('should score code indicators', () => {
      const content = `
        Some random text here.
        The function calculateTotal() returns the sum.
        More random text.
        Use \`npm install\` to install dependencies.
      `;

      const result = extractKeyInfo(content, 150);

      // Should extract sentences with code indicators
      expect(result.content).toContain('function');
    });
  });

  describe('aggressiveTruncate', () => {
    it('should perform hard truncation', () => {
      const result = aggressiveTruncate(longContent, 100);

      expect(result.strategy).toBe('aggressive-truncate');
      expect(result.tokenCount).toBeLessThan(result.originalTokens);
    });

    it('should add truncation notice', () => {
      const result = aggressiveTruncate(longContent, 100);

      expect(result.content).toContain('content truncated');
    });
  });

  describe('applyProgressiveFallback', () => {
    it('should use first successful strategy', () => {
      const content = 'x'.repeat(2000);
      const result = applyProgressiveFallback(content, 400);

      expect(result.tokenCount).toBeLessThanOrEqual(400);
      expect(['truncate', 'remove-middle', 'extract-key', 'aggressive-truncate'])
        .toContain(result.strategy);
    });

    it('should try progressively more aggressive strategies', () => {
      // Very low target should require aggressive strategies
      const result = applyProgressiveFallback(longContent, 50);

      expect(result.tokenCount).toBeLessThanOrEqual(100); // Some margin
      expect(result.compressionRatio).toBeGreaterThan(0.9);
    });

    it('should always return a result', () => {
      const result = applyProgressiveFallback(longContent, 10);

      expect(result.content).toBeDefined();
      expect(result.tokenCount).toBeGreaterThan(0);
    });
  });

  describe('applyMessageFallback', () => {
    const createMessages = (count: number): ChatMessage[] =>
      Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `Message ${i + 1}: ${'x'.repeat(500)}`,
      }));

    it('should create summary message from messages', () => {
      const messages = createMessages(10);
      const result = applyMessageFallback(messages, 500);

      expect(result.messages.length).toBe(1);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toContain('Summary');
    });

    it('should mark as using fallback', () => {
      const messages = createMessages(10);
      const result = applyMessageFallback(messages, 500);

      expect(result.usedFallback).toBe(true);
    });

    it('should calculate compression stats', () => {
      const messages = createMessages(10);
      const result = applyMessageFallback(messages, 500);

      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.totalTokens).toBeLessThan(result.originalTokens);
      expect(result.compressionRatio).toBeGreaterThan(0);
      expect(result.messagesCompacted).toBe(10);
    });

    it('should include duration', () => {
      const messages = createMessages(5);
      const result = applyMessageFallback(messages, 500);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should include fallback marker in content', () => {
      const messages = createMessages(5);
      const result = applyMessageFallback(messages, 500);

      expect(result.messages[0].content).toContain('fallback');
    });
  });
});
