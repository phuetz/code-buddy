/**
 * Tests for /compress Command - Context Compression
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import {
  compressContext,
  createCompressedMessages,
  formatCompressResult,
  CompressResult,
} from '../../src/commands/compress';

describe('compress command', () => {
  describe('compressContext', () => {
    // Mock LLM call
    const mockLlmCall = jest.fn();

    // Mock token estimator (simple: 1 token per 4 characters)
    const mockEstimateTokens = (text: string): number => Math.ceil(text.length / 4);

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should not compress context when under 2000 tokens', async () => {
      const messages: ChatCompletionMessageParam[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = await compressContext(messages, mockLlmCall, mockEstimateTokens);

      expect(result.success).toBe(false);
      expect(result.summary).toBe('Context too small to compress');
      expect(mockLlmCall).not.toHaveBeenCalled();
    });

    it('should compress context when over 2000 tokens', async () => {
      // Create messages with enough content to exceed 2000 tokens (~8000 chars)
      const longContent = 'x'.repeat(9000);
      const messages: ChatCompletionMessageParam[] = [
        { role: 'user', content: longContent },
        { role: 'assistant', content: 'Response to long message' },
      ];

      const mockSummary = '## Session Summary\nThis is a compressed summary.';
      mockLlmCall.mockResolvedValue(mockSummary);

      const result = await compressContext(messages, mockLlmCall, mockEstimateTokens);

      expect(result.success).toBe(true);
      expect(result.summary).toBe(mockSummary);
      expect(mockLlmCall).toHaveBeenCalledTimes(1);
    });

    it('should calculate token savings correctly', async () => {
      const longContent = 'x'.repeat(10000); // ~2500 tokens
      const messages: ChatCompletionMessageParam[] = [
        { role: 'user', content: longContent },
      ];

      const shortSummary = 'Brief summary'; // ~3 tokens
      mockLlmCall.mockResolvedValue(shortSummary);

      const result = await compressContext(messages, mockLlmCall, mockEstimateTokens);

      expect(result.success).toBe(true);
      expect(result.originalTokens).toBe(mockEstimateTokens(longContent));
      expect(result.compressedTokens).toBe(mockEstimateTokens(shortSummary));
      expect(result.savedTokens).toBe(result.originalTokens - result.compressedTokens);
      expect(result.savingsPercent).toBeGreaterThan(0);
    });

    it('should filter out system messages from summary prompt', async () => {
      const longContent = 'x'.repeat(9000);
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: longContent },
        { role: 'assistant', content: 'Response' },
      ];

      mockLlmCall.mockResolvedValue('Summary');

      await compressContext(messages, mockLlmCall, mockEstimateTokens);

      // The LLM call should have been made with a prompt that excludes system message
      const promptArg = mockLlmCall.mock.calls[0][0];
      expect(promptArg).not.toContain('You are a helpful assistant.');
      expect(promptArg).toContain('User:');
      expect(promptArg).toContain('Assistant:');
    });

    it('should handle messages with non-string content', async () => {
      const longContent = 'x'.repeat(9000);
      const messages: ChatCompletionMessageParam[] = [
        { role: 'user', content: longContent },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Response with structured content' },
          ] as any,
        },
      ];

      mockLlmCall.mockResolvedValue('Summary');

      const result = await compressContext(messages, mockLlmCall, mockEstimateTokens);

      expect(result.success).toBe(true);
    });

    it('should truncate very long message content in summary prompt', async () => {
      // Create a message longer than 1000 characters to test truncation
      const veryLongContent = 'x'.repeat(2000);
      const messages: ChatCompletionMessageParam[] = [
        { role: 'user', content: veryLongContent },
        { role: 'assistant', content: 'Response' },
      ];

      // Total tokens will be > 2000 (veryLongContent alone is 500 tokens)
      // Need more content
      const moreContent = 'y'.repeat(8000);
      messages.push({ role: 'user', content: moreContent });

      mockLlmCall.mockResolvedValue('Summary');

      await compressContext(messages, mockLlmCall, mockEstimateTokens);

      const promptArg = mockLlmCall.mock.calls[0][0];
      // The prompt should contain truncation indicator for long messages
      expect(promptArg).toContain('...');
    });

    it('should include conversation summary instructions in prompt', async () => {
      const longContent = 'x'.repeat(9000);
      const messages: ChatCompletionMessageParam[] = [
        { role: 'user', content: longContent },
      ];

      mockLlmCall.mockResolvedValue('Summary');

      await compressContext(messages, mockLlmCall, mockEstimateTokens);

      const promptArg = mockLlmCall.mock.calls[0][0];
      expect(promptArg).toContain('Summarize this conversation');
      expect(promptArg).toContain('Key decisions made');
      expect(promptArg).toContain('Files modified or created');
      expect(promptArg).toContain('Problems solved');
      expect(promptArg).toContain('Current task state');
      expect(promptArg).toContain('Important context for continuation');
    });

    it('should return correct CompressResult structure', async () => {
      const longContent = 'x'.repeat(9000);
      const messages: ChatCompletionMessageParam[] = [
        { role: 'user', content: longContent },
      ];

      mockLlmCall.mockResolvedValue('Summary');

      const result = await compressContext(messages, mockLlmCall, mockEstimateTokens);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('originalTokens');
      expect(result).toHaveProperty('compressedTokens');
      expect(result).toHaveProperty('savedTokens');
      expect(result).toHaveProperty('savingsPercent');
      expect(result).toHaveProperty('summary');
    });
  });

  describe('createCompressedMessages', () => {
    it('should create array with system message and summary', () => {
      const systemMessage: ChatCompletionMessageParam = {
        role: 'system',
        content: 'You are a helpful assistant.',
      };
      const summary = '## Session Summary\nKey decisions made...';

      const result = createCompressedMessages(systemMessage, summary);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(systemMessage);
      expect(result[1].role).toBe('assistant');
    });

    it('should include summary in assistant message', () => {
      const systemMessage: ChatCompletionMessageParam = {
        role: 'system',
        content: 'System prompt',
      };
      const summary = 'Test summary content';

      const result = createCompressedMessages(systemMessage, summary);

      expect(result[1].content).toContain('[Previous conversation compressed]');
      expect(result[1].content).toContain(summary);
      expect(result[1].content).toContain('[Continuing from compressed state]');
    });

    it('should preserve system message exactly', () => {
      const systemMessage: ChatCompletionMessageParam = {
        role: 'system',
        content: 'Complex system prompt with special characters: @#$%^&*()',
      };
      const summary = 'Summary';

      const result = createCompressedMessages(systemMessage, summary);

      expect(result[0]).toBe(systemMessage);
    });
  });

  describe('formatCompressResult', () => {
    it('should format unsuccessful result', () => {
      const result: CompressResult = {
        success: false,
        originalTokens: 500,
        compressedTokens: 500,
        savedTokens: 0,
        savingsPercent: 0,
        summary: 'Context too small to compress',
      };

      const formatted = formatCompressResult(result);

      expect(formatted).toBe('Context too small to compress (500 tokens)');
    });

    it('should format successful result with statistics', () => {
      const result: CompressResult = {
        success: true,
        originalTokens: 10000,
        compressedTokens: 2000,
        savedTokens: 8000,
        savingsPercent: 80,
        summary: 'Summary',
      };

      const formatted = formatCompressResult(result);

      expect(formatted).toContain('Context compressed:');
      expect(formatted).toContain('Original: 10,000 tokens');
      expect(formatted).toContain('Compressed: 2,000 tokens');
      expect(formatted).toContain('Saved: 8,000 tokens (80%)');
    });

    it('should format numbers with locale formatting', () => {
      const result: CompressResult = {
        success: true,
        originalTokens: 1000000,
        compressedTokens: 500000,
        savedTokens: 500000,
        savingsPercent: 50,
        summary: 'Summary',
      };

      const formatted = formatCompressResult(result);

      // Should use locale-specific number formatting (commas)
      expect(formatted).toContain('1,000,000');
      expect(formatted).toContain('500,000');
    });

    it('should handle edge case with zero savings', () => {
      const result: CompressResult = {
        success: true,
        originalTokens: 5000,
        compressedTokens: 5000,
        savedTokens: 0,
        savingsPercent: 0,
        summary: 'Summary',
      };

      const formatted = formatCompressResult(result);

      expect(formatted).toContain('Saved: 0 tokens (0%)');
    });
  });
});
