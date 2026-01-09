/**
 * Tests for Context Manager V3
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

// Mock tiktoken
jest.mock('tiktoken', () => ({
  encoding_for_model: jest.fn(() => ({
    encode: jest.fn((text: string) => new Array(Math.ceil(text.length / 4))),
    free: jest.fn()
  })),
  get_encoding: jest.fn(() => ({
    encode: jest.fn((text: string) => new Array(Math.ceil(text.length / 4))),
    free: jest.fn()
  }))
}));

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Helper to create properly typed messages
function createMessage(role: 'system' | 'user' | 'assistant' | 'tool', content: string | null): CodeBuddyMessage {
  if (role === 'system') {
    return { role: 'system', content: content ?? '' };
  }
  if (role === 'user') {
    return { role: 'user', content: content ?? '' };
  }
  if (role === 'assistant') {
    return { role: 'assistant', content };
  }
  return { role: 'tool', content: content ?? '', tool_call_id: 'test-id' };
}

describe('ContextManagerV3', () => {
  let ContextManagerV3: typeof import('../../src/context/context-manager-v3.js').ContextManagerV3;
  let createContextManager: typeof import('../../src/context/context-manager-v3.js').createContextManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await import('../../src/context/context-manager-v3.js');
    ContextManagerV3 = module.ContextManagerV3;
    createContextManager = module.createContextManager;
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const manager = new ContextManagerV3();
      expect(manager).toBeDefined();
      manager.dispose();
    });

    it('should create with custom config', () => {
      const manager = new ContextManagerV3({
        maxContextTokens: 64000,
        responseReserveTokens: 2048,
        model: 'gpt-3.5-turbo'
      });
      expect(manager).toBeDefined();
      manager.dispose();
    });

    it('should merge custom config with defaults', () => {
      const manager = new ContextManagerV3({
        maxContextTokens: 32000
      });
      const messages = [createMessage('user', 'Hello')];
      const stats = manager.getStats(messages);
      expect(stats.maxTokens).toBe(32000);
      manager.dispose();
    });
  });

  describe('updateConfig', () => {
    it('should update config values', () => {
      const manager = new ContextManagerV3();
      manager.updateConfig({ maxContextTokens: 64000 });

      const messages = [createMessage('user', 'Hello')];
      const stats = manager.getStats(messages);
      expect(stats.maxTokens).toBe(64000);
      manager.dispose();
    });

    it('should reinitialize token counter when model changes', () => {
      const manager = new ContextManagerV3({ model: 'gpt-4' });
      manager.updateConfig({ model: 'gpt-3.5-turbo' });

      const messages = [createMessage('user', 'Hello')];
      const stats = manager.getStats(messages);
      expect(stats.totalTokens).toBeGreaterThan(0);
      manager.dispose();
    });
  });

  describe('getStats', () => {
    it('should return correct stats for simple messages', () => {
      const manager = new ContextManagerV3();
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('assistant', 'Hi there!')
      ];

      const stats = manager.getStats(messages);

      expect(stats.totalTokens).toBeGreaterThan(0);
      expect(stats.maxTokens).toBe(128000);
      expect(stats.usagePercent).toBeGreaterThan(0);
      expect(stats.messageCount).toBe(2);
      expect(stats.isNearLimit).toBe(false);
      expect(stats.isCritical).toBe(false);
      manager.dispose();
    });

    it('should handle empty messages array', () => {
      const manager = new ContextManagerV3();
      const stats = manager.getStats([]);

      expect(stats.totalTokens).toBe(3); // Just priming tokens
      expect(stats.messageCount).toBe(0);
      manager.dispose();
    });

    it('should handle messages with null content', () => {
      const manager = new ContextManagerV3();
      const messages: CodeBuddyMessage[] = [
        { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'test', arguments: '{}' } }] }
      ];

      const stats = manager.getStats(messages);
      expect(stats.totalTokens).toBeGreaterThan(0);
      manager.dispose();
    });

    it('should indicate near limit correctly', () => {
      const manager = new ContextManagerV3({ maxContextTokens: 100 });
      const messages = [createMessage('user', 'x'.repeat(400))];

      const stats = manager.getStats(messages);
      expect(stats.isNearLimit).toBe(true);
      manager.dispose();
    });

    it('should indicate critical correctly', () => {
      const manager = new ContextManagerV3({ maxContextTokens: 100 });
      const messages = [createMessage('user', 'x'.repeat(500))];

      const stats = manager.getStats(messages);
      expect(stats.isCritical).toBe(true);
      manager.dispose();
    });
  });

  describe('shouldWarn', () => {
    it('should not warn when warnings are disabled', () => {
      const manager = new ContextManagerV3({
        enableWarnings: false,
        maxContextTokens: 100
      });
      const messages = [createMessage('user', 'x'.repeat(400))];

      const warning = manager.shouldWarn(messages);
      expect(warning.warn).toBe(false);
      manager.dispose();
    });

    it('should warn at 80% threshold', () => {
      const manager = new ContextManagerV3({
        maxContextTokens: 100,
        warningThresholds: [80, 95]
      });
      const messages = [createMessage('user', 'x'.repeat(350))];

      const warning = manager.shouldWarn(messages);
      expect(warning.warn).toBe(true);
      expect(warning.level).toBe('warning');
      manager.dispose();
    });

    it('should warn critical at 95% threshold', () => {
      const manager = new ContextManagerV3({
        maxContextTokens: 100,
        warningThresholds: [80, 95]
      });
      // First trigger 80%
      manager.shouldWarn([createMessage('user', 'x'.repeat(350))]);

      // Then trigger 95%
      const warning = manager.shouldWarn([createMessage('user', 'x'.repeat(500))]);
      expect(warning.warn).toBe(true);
      expect(warning.level).toBe('critical');
      manager.dispose();
    });

    it('should not repeat same threshold warning', () => {
      const manager = new ContextManagerV3({
        maxContextTokens: 100,
        warningThresholds: [80]
      });
      const messages = [createMessage('user', 'x'.repeat(400))];

      // First call should warn
      const warning1 = manager.shouldWarn(messages);
      expect(warning1.warn).toBe(true);

      // Second call should not warn (already triggered)
      const warning2 = manager.shouldWarn(messages);
      expect(warning2.warn).toBe(false);
      manager.dispose();
    });

    it('should reset warning when usage drops', () => {
      const manager = new ContextManagerV3({
        maxContextTokens: 100,
        warningThresholds: [80]
      });

      // Trigger warning at 80%
      const warning1 = manager.shouldWarn([createMessage('user', 'x'.repeat(400))]);
      expect(warning1.warn).toBe(true);

      // Drop usage below threshold
      const warning2 = manager.shouldWarn([createMessage('user', 'Hello')]);
      expect(warning2.warn).toBe(false);

      // Trigger again - should warn
      const warning3 = manager.shouldWarn([createMessage('user', 'x'.repeat(400))]);
      expect(warning3.warn).toBe(true);
      manager.dispose();
    });

    it('should include percentage in warning', () => {
      const manager = new ContextManagerV3({
        maxContextTokens: 100,
        warningThresholds: [80]
      });
      const messages = [createMessage('user', 'x'.repeat(400))];

      const warning = manager.shouldWarn(messages);
      expect(warning.percentage).toBeDefined();
      expect(warning.percentage).toBeGreaterThanOrEqual(80);
      manager.dispose();
    });
  });

  describe('prepareMessages', () => {
    it('should return messages unchanged when under limit', () => {
      const manager = new ContextManagerV3();
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('assistant', 'Hi!')
      ];

      const prepared = manager.prepareMessages(messages);
      expect(prepared).toEqual(messages);
      manager.dispose();
    });

    it('should compress messages when over limit', () => {
      const manager = new ContextManagerV3({
        maxContextTokens: 50,
        responseReserveTokens: 10
      });
      const messages = [
        createMessage('system', 'System prompt'),
        createMessage('user', 'x'.repeat(200)),
        createMessage('assistant', 'y'.repeat(200)),
        createMessage('user', 'Recent message')
      ];

      const prepared = manager.prepareMessages(messages);
      // Should have fewer tokens after compression
      expect(prepared.length).toBeLessThanOrEqual(messages.length);
      manager.dispose();
    });

    it('should preserve system prompt during compression', () => {
      const manager = new ContextManagerV3({
        maxContextTokens: 50,
        responseReserveTokens: 10
      });
      const messages = [
        createMessage('system', 'You are a helpful assistant.'),
        createMessage('user', 'x'.repeat(300)),
        createMessage('assistant', 'y'.repeat(300))
      ];

      const prepared = manager.prepareMessages(messages);
      const systemMessage = prepared.find(m => m.role === 'system');
      expect(systemMessage).toBeDefined();
      manager.dispose();
    });

    it('should preserve recent messages during compression', () => {
      const manager = new ContextManagerV3({
        maxContextTokens: 100,
        responseReserveTokens: 10,
        recentMessagesCount: 2
      });
      const messages = [
        createMessage('user', 'Old message 1'),
        createMessage('assistant', 'Old response 1'),
        createMessage('user', 'Old message 2'),
        createMessage('assistant', 'Old response 2'),
        createMessage('user', 'Recent message'),
        createMessage('assistant', 'Recent response')
      ];

      const prepared = manager.prepareMessages(messages);
      // Recent messages should be preserved
      expect(prepared.some(m => m.content === 'Recent message')).toBe(true);
      expect(prepared.some(m => m.content === 'Recent response')).toBe(true);
      manager.dispose();
    });
  });

  describe('dispose', () => {
    it('should dispose without error', () => {
      const manager = new ContextManagerV3();
      expect(() => manager.dispose()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      const manager = new ContextManagerV3();
      expect(() => {
        manager.dispose();
        manager.dispose();
      }).not.toThrow();
    });
  });

  describe('createContextManager factory', () => {
    it('should create manager with model', () => {
      const manager = createContextManager('gpt-4');
      expect(manager).toBeInstanceOf(ContextManagerV3);
      manager.dispose();
    });

    it('should create manager with model and maxTokens', () => {
      const manager = createContextManager('gpt-4', 64000);
      const stats = manager.getStats([createMessage('user', 'Hello')]);
      expect(stats.maxTokens).toBe(64000);
      manager.dispose();
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have sensible default values', () => {
      expect(ContextManagerV3.DEFAULT_CONFIG.maxContextTokens).toBe(128000);
      expect(ContextManagerV3.DEFAULT_CONFIG.responseReserveTokens).toBe(4096);
      expect(ContextManagerV3.DEFAULT_CONFIG.recentMessagesCount).toBe(10);
      expect(ContextManagerV3.DEFAULT_CONFIG.enableSummarization).toBe(true);
      expect(ContextManagerV3.DEFAULT_CONFIG.model).toBe('gpt-4');
      expect(ContextManagerV3.DEFAULT_CONFIG.enableWarnings).toBe(true);
    });
  });
});
