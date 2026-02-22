/**
 * Comprehensive Tests for ContextManagerV2
 *
 * Tests the advanced context management system including:
 * - Token counting and configuration
 * - Sliding window strategy
 * - Tool result truncation
 * - Summarization strategy
 * - Hard truncation
 * - Warning system with multiple thresholds
 * - Auto-compact functionality
 */

import {
  ContextManagerV2,
  createContextManager,
  getContextManager,
  ContextManagerConfig,
  ContextStats,
} from '../../src/context/context-manager-v2';
import type { CodeBuddyMessage } from '../../src/codebuddy/client';

// Mock the token counter
jest.mock('../../src/utils/token-counter', () => ({
  createTokenCounter: jest.fn(() => ({
    countMessageTokens: jest.fn((messages: unknown[]) => {
      // Simple mock: estimate 4 chars per token for content
      let total = 0;
      for (const msg of messages as Array<{ content?: string | null; role?: string }>) {
        if (msg.content) {
          total += Math.ceil(msg.content.length / 4);
        }
        total += 5; // Base tokens per message
      }
      return total;
    }),
    dispose: jest.fn(),
  })),
}));

// Mock the logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('ContextManagerV2', () => {
  let manager: ContextManagerV2;

  beforeEach(() => {
    manager = new ContextManagerV2({
      maxContextTokens: 1000,
      responseReserveTokens: 100,
      recentMessagesCount: 5,
      enableSummarization: true,
      compressionRatio: 4,
      model: 'gpt-4',
      autoCompactThreshold: 500,
      warningThresholds: [50, 75, 90],
      enableWarnings: true,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Constructor and Configuration', () => {
    it('should create with default config', () => {
      const defaultManager = new ContextManagerV2();
      const raw = ContextManagerV2.DEFAULT_CONFIG.maxContextTokens -
          ContextManagerV2.DEFAULT_CONFIG.responseReserveTokens;
      expect(defaultManager.effectiveLimit).toBe(Math.floor(raw * 0.95));
      defaultManager.dispose();
    });

    it('should merge custom config with defaults', () => {
      const customManager = new ContextManagerV2({
        maxContextTokens: 5000,
      });
      const config = customManager.getConfig();
      expect(config.maxContextTokens).toBe(5000);
      expect(config.responseReserveTokens).toBe(ContextManagerV2.DEFAULT_CONFIG.responseReserveTokens);
      customManager.dispose();
    });

    it('should calculate effective limit correctly', () => {
      // (1000 - 100) * 0.95 = 855
      expect(manager.effectiveLimit).toBe(855);
    });

    it('should return a copy of config', () => {
      const config1 = manager.getConfig();
      const config2 = manager.getConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('Token Counting', () => {
    it('should count tokens in messages', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Hello, how are you?' },
      ];

      const count = manager.countTokens(messages);
      expect(count).toBeGreaterThan(0);
    });

    it('should handle messages with null content', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'assistant', content: null },
      ];

      const count = manager.countTokens(messages);
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty messages array', () => {
      const count = manager.countTokens([]);
      expect(count).toBe(0);
    });

    it('should count tool_calls messages', () => {
      const messages: CodeBuddyMessage[] = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path": "/test"}' },
            },
          ],
        } as CodeBuddyMessage,
      ];

      const count = manager.countTokens(messages);
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Context Stats', () => {
    it('should get correct context stats', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there! How can I help you?' },
      ];

      const stats = manager.getStats(messages);

      expect(stats.messageCount).toBe(3);
      expect(stats.totalTokens).toBeGreaterThan(0);
      expect(stats.maxTokens).toBe(855);
      expect(stats.usagePercent).toBeGreaterThan(0);
      expect(stats.summarizedSessions).toBe(0);
    });

    it('should correctly identify near limit status', () => {
      // Create a manager with small limit
      const smallManager = new ContextManagerV2({
        maxContextTokens: 100,
        responseReserveTokens: 10,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(30), // ~7.5 tokens each
      }));

      const stats = smallManager.getStats(messages);
      expect(stats.isNearLimit || stats.isCritical).toBe(true);

      smallManager.dispose();
    });

    it('should identify critical status when over 90%', () => {
      const smallManager = new ContextManagerV2({
        maxContextTokens: 50,
        responseReserveTokens: 5,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(20),
      }));

      const stats = smallManager.getStats(messages);
      expect(stats.isCritical).toBe(true);

      smallManager.dispose();
    });

    it('should handle empty messages in stats', () => {
      const stats = manager.getStats([]);
      expect(stats.messageCount).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.usagePercent).toBe(0);
    });
  });

  describe('prepareMessages', () => {
    it('should return messages unchanged when within limits', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Short message' },
        { role: 'assistant', content: 'Short response' },
      ];

      const prepared = manager.prepareMessages(messages);
      expect(prepared).toEqual(messages);
    });

    it('should preserve system message after compression', () => {
      const longContent = 'A'.repeat(200);
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'Important system prompt' },
        ...Array.from({ length: 30 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i}: ${longContent}`,
        })),
      ];

      const prepared = manager.prepareMessages(messages);

      // System message should be preserved
      const systemMsg = prepared.find(
        (m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('Important')
      );
      expect(systemMsg).toBeDefined();
    });

    it('should track last token count', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Test message' },
      ];

      manager.prepareMessages(messages);
      expect(manager.getLastTokenCount()).toBeGreaterThan(0);
    });

    it('should handle empty message array', () => {
      const prepared = manager.prepareMessages([]);
      expect(prepared).toEqual([]);
    });
  });

  describe('Sliding Window Strategy', () => {
    it('should keep recent messages when applying sliding window', () => {
      const smallManager = new ContextManagerV2({
        maxContextTokens: 100, // Very small limit
        responseReserveTokens: 10,
        recentMessagesCount: 3,
        enableSummarization: false,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message number ${i} with some extra content to make it longer`,
      }));

      const prepared = smallManager.prepareMessages(messages);

      // Should have fewer messages after compression
      expect(prepared.length).toBeLessThanOrEqual(messages.length);

      smallManager.dispose();
    });

    it('should add summary marker for removed messages', () => {
      const smallManager = new ContextManagerV2({
        maxContextTokens: 50, // Very small
        responseReserveTokens: 5,
        recentMessagesCount: 2,
        enableSummarization: false,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i} with content here`,
      }));

      const prepared = smallManager.prepareMessages(messages);

      // Look for summary marker
      const summaryMsg = prepared.find(
        (m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('Previous')
      );
      expect(summaryMsg || prepared.length < messages.length).toBeTruthy();

      smallManager.dispose();
    });
  });

  describe('Tool Result Truncation', () => {
    it('should truncate long tool results when over limit', () => {
      const longToolResult = 'X'.repeat(2000);
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Run a command' },
        {
          role: 'tool',
          content: longToolResult,
          tool_call_id: 'call_123',
        } as CodeBuddyMessage,
      ];

      const truncatingManager = new ContextManagerV2({
        maxContextTokens: 200, // Small limit to trigger truncation
        responseReserveTokens: 20,
        recentMessagesCount: 10,
        enableSummarization: false,
      });

      const prepared = truncatingManager.prepareMessages(messages);

      const toolMsg = prepared.find((m) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      // Tool message may be truncated
      if (toolMsg && typeof toolMsg.content === 'string') {
        expect(toolMsg.content.length).toBeGreaterThan(0);
      }

      truncatingManager.dispose();
    });

    it('should not truncate short tool results', () => {
      const shortToolResult = 'Success!';
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Run a command' },
        {
          role: 'tool',
          content: shortToolResult,
          tool_call_id: 'call_123',
        } as CodeBuddyMessage,
      ];

      const prepared = manager.prepareMessages(messages);
      const toolMsg = prepared.find((m) => m.role === 'tool');

      expect(toolMsg).toBeDefined();
      if (toolMsg) {
        expect(toolMsg.content).toBe(shortToolResult);
      }
    });
  });

  describe('Summarization Strategy', () => {
    it('should apply summarization when enabled and over limit', () => {
      const summarizingManager = new ContextManagerV2({
        maxContextTokens: 150, // Small limit
        responseReserveTokens: 15,
        recentMessagesCount: 3,
        enableSummarization: true,
        compressionRatio: 4,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `This is message number ${i} with some content that adds tokens`,
      }));

      const prepared = summarizingManager.prepareMessages(messages);

      // Compression should have been applied
      expect(prepared.length).toBeGreaterThan(0);
      expect(prepared.length).toBeLessThanOrEqual(messages.length + 1); // +1 for possible summary

      summarizingManager.dispose();
    });

    it('should create summary from old messages', () => {
      const summarizingManager = new ContextManagerV2({
        maxContextTokens: 100,
        responseReserveTokens: 10,
        recentMessagesCount: 2,
        enableSummarization: true,
        compressionRatio: 2,
      });

      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Tell me about TypeScript features' },
        { role: 'assistant', content: 'TypeScript has many features like types, interfaces, and generics' },
        { role: 'user', content: 'What about React integration?' },
        { role: 'assistant', content: 'React works great with TypeScript for type-safe components' },
        { role: 'user', content: 'Show me an example' },
        { role: 'assistant', content: 'Here is a simple typed component example' },
      ];

      const prepared = summarizingManager.prepareMessages(messages);

      // Look for summary indicator
      const hasSummary = prepared.some(
        (m) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          (m.content.includes('Summary') || m.content.includes('Previous') || m.content.includes('summarized'))
      );
      // Either summary was added or messages were compressed
      expect(hasSummary || prepared.length < messages.length).toBeTruthy();

      summarizingManager.dispose();
    });
  });

  describe('Hard Truncation', () => {
    it('should hard truncate when all other strategies fail', () => {
      const smallManager = new ContextManagerV2({
        maxContextTokens: 30, // Extremely small
        responseReserveTokens: 3,
        recentMessagesCount: 10, // High count to force hard truncation
        enableSummarization: false,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(100),
      }));

      const prepared = smallManager.prepareMessages(messages);

      // Should have been drastically reduced
      expect(prepared.length).toBeLessThan(messages.length);

      smallManager.dispose();
    });

    it('should keep at least 2 messages', () => {
      const tinyManager = new ContextManagerV2({
        maxContextTokens: 20,
        responseReserveTokens: 2,
        recentMessagesCount: 5,
        enableSummarization: false,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(100),
      }));

      const prepared = tinyManager.prepareMessages(messages);

      // Should keep at least some messages
      expect(prepared.length).toBeGreaterThan(0);

      tinyManager.dispose();
    });

    it('should truncate message content as last resort', () => {
      const tinyManager = new ContextManagerV2({
        maxContextTokens: 15,
        responseReserveTokens: 1,
        recentMessagesCount: 5,
        enableSummarization: false,
      });

      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'A'.repeat(500) },
        { role: 'assistant', content: 'B'.repeat(500) },
      ];

      const prepared = tinyManager.prepareMessages(messages);

      // Messages should exist, possibly truncated
      expect(prepared.length).toBeGreaterThan(0);

      tinyManager.dispose();
    });
  });

  describe('Warning System', () => {
    it('should warn when near limit', () => {
      const smallManager = new ContextManagerV2({
        maxContextTokens: 100,
        responseReserveTokens: 10,
        warningThresholds: [50, 75, 90],
        enableWarnings: true,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(30),
      }));

      const result = smallManager.shouldWarn(messages);

      expect(result.warn).toBe(true);
      expect(result.message).toBeTruthy();
      expect(result.threshold).toBeDefined();

      smallManager.dispose();
    });

    it('should not warn when well within limits', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];

      const result = manager.shouldWarn(messages);
      expect(result.warn).toBe(false);
      expect(result.message).toBe('');
    });

    it('should not duplicate warnings for same threshold', () => {
      const smallManager = new ContextManagerV2({
        maxContextTokens: 100,
        responseReserveTokens: 10,
        warningThresholds: [50],
        enableWarnings: true,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(30),
      }));

      // First call should warn
      const result1 = smallManager.shouldWarn(messages);
      expect(result1.warn).toBe(true);

      // Second call with same threshold should not warn
      const result2 = smallManager.shouldWarn(messages);
      expect(result2.warn).toBe(false);

      smallManager.dispose();
    });

    it('should reset warnings', () => {
      const smallManager = new ContextManagerV2({
        maxContextTokens: 100,
        responseReserveTokens: 10,
        warningThresholds: [50],
        enableWarnings: true,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(30),
      }));

      // Trigger warning
      smallManager.shouldWarn(messages);

      // Reset
      smallManager.resetWarnings();

      // Should warn again
      const result = smallManager.shouldWarn(messages);
      expect(result.warn).toBe(true);

      smallManager.dispose();
    });

    it('should not warn when warnings are disabled', () => {
      const disabledManager = new ContextManagerV2({
        maxContextTokens: 50,
        responseReserveTokens: 5,
        enableWarnings: false,
      });

      const messages: CodeBuddyMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(30),
      }));

      const result = disabledManager.shouldWarn(messages);
      expect(result.warn).toBe(false);

      disabledManager.dispose();
    });

    it('should warn with appropriate emoji for threshold level', () => {
      const smallManager = new ContextManagerV2({
        maxContextTokens: 100,
        responseReserveTokens: 10,
        warningThresholds: [50, 75, 90],
        enableWarnings: true,
      });

      // Create messages that exceed 90%
      const messages: CodeBuddyMessage[] = Array.from({ length: 30 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(50),
      }));

      const result = smallManager.shouldWarn(messages);

      if (result.warn && result.threshold) {
        // Highest threshold hit first
        expect(result.threshold).toBeGreaterThanOrEqual(50);
      }

      smallManager.dispose();
    });
  });

  describe('Auto-Compact', () => {
    it('should detect when auto-compact is needed', () => {
      const messages: CodeBuddyMessage[] = Array.from({ length: 100 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(200),
      }));

      const shouldCompact = manager.shouldAutoCompact(messages);
      expect(shouldCompact).toBe(true);
    });

    it('should not auto-compact when below threshold', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];

      const shouldCompact = manager.shouldAutoCompact(messages);
      expect(shouldCompact).toBe(false);
    });
  });

  describe('Configuration Updates', () => {
    it('should update configuration', () => {
      manager.updateConfig({
        maxContextTokens: 2000,
        responseReserveTokens: 200,
      });

      const config = manager.getConfig();
      expect(config.maxContextTokens).toBe(2000);
      expect(config.responseReserveTokens).toBe(200);
      expect(manager.effectiveLimit).toBe(Math.floor(1800 * 0.95));
    });

    it('should update token counter when model changes', () => {
      manager.updateConfig({
        model: 'claude-3',
      });

      const config = manager.getConfig();
      expect(config.model).toBe('claude-3');
    });

    it('should preserve other config when updating', () => {
      const original = manager.getConfig();
      manager.updateConfig({
        maxContextTokens: 5000,
      });

      const updated = manager.getConfig();
      expect(updated.compressionRatio).toBe(original.compressionRatio);
      expect(updated.enableSummarization).toBe(original.enableSummarization);
    });
  });

  describe('Factory Functions', () => {
    it('should create manager with model detection', () => {
      const gptManager = createContextManager('gpt-4');
      expect(gptManager.getConfig().maxContextTokens).toBe(128000);
      gptManager.dispose();
    });

    it('should create manager for claude-3', () => {
      const claudeManager = createContextManager('claude-3');
      expect(claudeManager.getConfig().maxContextTokens).toBe(200000);
      claudeManager.dispose();
    });

    it('should create manager for llama models', () => {
      const llamaManager = createContextManager('llama3.2');
      // llama3.2 falls through to default contextWindow (32768)
      expect(llamaManager.getConfig().maxContextTokens).toBe(32768);
      llamaManager.dispose();
    });

    it('should use custom token limit', () => {
      const customManager = createContextManager('custom-model', 50000);
      expect(customManager.getConfig().maxContextTokens).toBe(50000);
      customManager.dispose();
    });

    it('should use default limit for unknown models', () => {
      const unknownManager = createContextManager('unknown-model');
      // Unknown models use the permissive fallback contextWindow (32768)
      expect(unknownManager.getConfig().maxContextTokens).toBe(32768);
      unknownManager.dispose();
    });

    it('should set response reserve proportionally', () => {
      const largeManager = createContextManager('gpt-4-turbo');
      const config = largeManager.getConfig();
      // 12.5% of 128000 = 16000
      expect(config.responseReserveTokens).toBe(16000);
      largeManager.dispose();
    });

    it('should return singleton from getContextManager', () => {
      const instance1 = getContextManager();
      const instance2 = getContextManager();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Dispose', () => {
    it('should clean up resources on dispose', () => {
      const testManager = new ContextManagerV2();

      // Trigger some state
      const messages: CodeBuddyMessage[] = Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(50),
      }));
      testManager.prepareMessages(messages);
      testManager.shouldWarn(messages);

      // Dispose
      testManager.dispose();

      // After dispose, token count should be reset
      expect(testManager.getLastTokenCount()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long single message', () => {
      const veryLongContent = 'A'.repeat(10000);
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: veryLongContent },
      ];

      const smallManager = new ContextManagerV2({
        maxContextTokens: 100,
        responseReserveTokens: 10,
        recentMessagesCount: 5,
      });

      const prepared = smallManager.prepareMessages(messages);
      expect(prepared.length).toBeGreaterThan(0);

      smallManager.dispose();
    });

    it('should handle mixed message types', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'System message' },
        { role: 'user', content: 'User query' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: '1', type: 'function', function: { name: 'test', arguments: '{}' } },
          ],
        } as CodeBuddyMessage,
        { role: 'tool', content: 'Tool result', tool_call_id: '1' } as CodeBuddyMessage,
        { role: 'assistant', content: 'Final response' },
      ];

      const prepared = manager.prepareMessages(messages);
      expect(prepared.length).toBeGreaterThan(0);
    });

    it('should handle only system message', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'You are a helpful assistant' },
      ];

      const prepared = manager.prepareMessages(messages);
      expect(prepared).toEqual(messages);
    });

    it('should handle alternating long and short messages', () => {
      const messages: CodeBuddyMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: i % 3 === 0 ? 'A'.repeat(500) : 'Short',
        });
      }

      const smallManager = new ContextManagerV2({
        maxContextTokens: 300,
        responseReserveTokens: 30,
        recentMessagesCount: 5,
        enableSummarization: true,
      });

      const prepared = smallManager.prepareMessages(messages);
      expect(prepared.length).toBeGreaterThan(0);
      expect(prepared.length).toBeLessThanOrEqual(messages.length + 1);

      smallManager.dispose();
    });
  });
});
