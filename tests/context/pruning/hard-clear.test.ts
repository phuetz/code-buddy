/**
 * Hard Clear Tests
 */

import {
  createToolResultPlaceholder,
  createAssistantPlaceholder,
  createToolCallPlaceholder,
  hardClearMessage,
  hardClearExpiredToolCalls,
  hardClearOldMessages,
  shouldHardClear,
  applyHardClear,
} from '../../../src/context/pruning/hard-clear.js';
import type { PrunableMessage, ToolCallTimestamp } from '../../../src/context/pruning/config.js';

describe('Hard Clear', () => {
  describe('createToolResultPlaceholder', () => {
    it('should create placeholder with tool info', () => {
      const placeholder = createToolResultPlaceholder('read_file', 'tc-123', 5000);

      expect(placeholder).toContain('read_file');
      expect(placeholder).toContain('tc-123');
      expect(placeholder).toContain('5000');
    });
  });

  describe('createAssistantPlaceholder', () => {
    it('should create placeholder with message info', () => {
      const placeholder = createAssistantPlaceholder(5, 3000);

      expect(placeholder).toContain('#5');
      expect(placeholder).toContain('3000');
    });

    it('should include summary when provided', () => {
      const placeholder = createAssistantPlaceholder(5, 3000, 'Did something important');

      expect(placeholder).toContain('Summary');
      expect(placeholder).toContain('Did something important');
    });
  });

  describe('createToolCallPlaceholder', () => {
    it('should create placeholder with tool call info', () => {
      const placeholder = createToolCallPlaceholder('bash', 'tc-456');

      expect(placeholder).toContain('bash');
      expect(placeholder).toContain('tc-456');
    });
  });

  describe('hardClearMessage', () => {
    const createMessage = (content: string = 'test'): PrunableMessage => ({
      index: 0,
      role: 'assistant',
      content,
      originalLength: content.length,
      timestamp: Date.now(),
      toolCallIds: ['tc-1'],
      softTrimmed: false,
      hardCleared: false,
    });

    it('should replace content with placeholder', () => {
      const msg = createMessage('Original content');
      const result = hardClearMessage(msg, '[Cleared]');

      expect(result.content).toBe('[Cleared]');
      expect(result.hardCleared).toBe(true);
    });

    it('should reset soft trim flag', () => {
      const msg = createMessage('Original content');
      msg.softTrimmed = true;

      const result = hardClearMessage(msg, '[Cleared]');

      expect(result.softTrimmed).toBe(false);
      expect(result.hardCleared).toBe(true);
    });

    it('should not re-clear already cleared message', () => {
      const msg = createMessage('[Already cleared]');
      msg.hardCleared = true;

      const result = hardClearMessage(msg, '[New placeholder]');

      expect(result.content).toBe('[Already cleared]');
    });
  });

  describe('hardClearExpiredToolCalls', () => {
    const createMessage = (
      index: number,
      toolCallIds: string[],
      content: string = 'test'
    ): PrunableMessage => ({
      index,
      role: 'tool',
      content,
      originalLength: content.length,
      timestamp: Date.now(),
      toolCallIds,
      softTrimmed: false,
      hardCleared: false,
    });

    const createExpiredToolCall = (
      toolCallId: string,
      toolName: string,
      messageIndex: number
    ): ToolCallTimestamp => ({
      toolCallId,
      toolName,
      calledAt: Date.now() - 10000,
      messageIndex,
      pruned: false,
    });

    it('should clear messages with expired tool calls', () => {
      const messages = [
        createMessage(0, ['tc-1'], 'Tool result 1'),
        createMessage(1, ['tc-2'], 'Tool result 2'),
      ];

      const expired = [createExpiredToolCall('tc-1', 'read_file', 0)];

      const result = hardClearExpiredToolCalls(messages, expired);

      expect(result.clearedCount).toBe(1);
      expect(result.messages[0].hardCleared).toBe(true);
      expect(result.messages[1].hardCleared).toBe(false);
      expect(result.toolCallsCleared).toContain('tc-1');
    });

    it('should not clear messages without expired tool calls', () => {
      const messages = [
        createMessage(0, ['tc-1'], 'Tool result 1'),
      ];

      const expired: ToolCallTimestamp[] = [];

      const result = hardClearExpiredToolCalls(messages, expired);

      expect(result.clearedCount).toBe(0);
      expect(result.messages[0].hardCleared).toBe(false);
    });

    it('should clear multiple messages with expired tool calls', () => {
      const messages = [
        createMessage(0, ['tc-1'], 'Result 1'),
        createMessage(1, ['tc-2'], 'Result 2'),
        createMessage(2, ['tc-3'], 'Result 3'),
      ];

      const expired = [
        createExpiredToolCall('tc-1', 'read_file', 0),
        createExpiredToolCall('tc-3', 'bash', 2),
      ];

      const result = hardClearExpiredToolCalls(messages, expired);

      expect(result.clearedCount).toBe(2);
      expect(result.messages[0].hardCleared).toBe(true);
      expect(result.messages[1].hardCleared).toBe(false);
      expect(result.messages[2].hardCleared).toBe(true);
    });
  });

  describe('hardClearOldMessages', () => {
    const createMessage = (
      role: string,
      ageMs: number
    ): PrunableMessage => ({
      index: 0,
      role,
      content: 'Test content',
      originalLength: 12,
      timestamp: Date.now() - ageMs,
      toolCallIds: [],
      softTrimmed: false,
      hardCleared: false,
    });

    it('should not clear if maxMessageAge is 0', () => {
      const messages = [createMessage('assistant', 1000000)];

      const result = hardClearOldMessages(messages, { maxMessageAge: 0 });

      expect(result.clearedCount).toBe(0);
    });

    it('should clear old messages', () => {
      const messages = [
        createMessage('assistant', 10000), // 10 seconds old
      ];

      const result = hardClearOldMessages(messages, {
        maxMessageAge: 5000, // 5 second limit
        keepLastNAssistant: 0,
      });

      expect(result.clearedCount).toBe(1);
      expect(result.messages[0].hardCleared).toBe(true);
    });

    it('should skip system messages', () => {
      const messages = [createMessage('system', 10000)];

      const result = hardClearOldMessages(messages, {
        maxMessageAge: 5000,
        keepSystemMessages: true,
      });

      expect(result.clearedCount).toBe(0);
    });

    it('should skip user messages', () => {
      const messages = [createMessage('user', 10000)];

      const result = hardClearOldMessages(messages, {
        maxMessageAge: 5000,
        keepUserMessages: true,
      });

      expect(result.clearedCount).toBe(0);
    });
  });

  describe('shouldHardClear', () => {
    const createMessage = (role: string, toolCallIds: string[] = []): PrunableMessage => ({
      index: 0,
      role,
      content: 'Test',
      originalLength: 4,
      timestamp: Date.now(),
      toolCallIds,
      softTrimmed: false,
      hardCleared: false,
    });

    it('should return false for already cleared message', () => {
      const msg = createMessage('assistant');
      msg.hardCleared = true;

      expect(shouldHardClear(msg, new Set(), [msg])).toBe(false);
    });

    it('should return true for message with expired tool call', () => {
      const msg = createMessage('tool', ['tc-1']);
      const expiredIds = new Set(['tc-1']);

      expect(shouldHardClear(msg, expiredIds, [msg])).toBe(true);
    });

    it('should return false for system message', () => {
      const msg = createMessage('system');

      expect(shouldHardClear(msg, new Set(), [msg], { keepSystemMessages: true })).toBe(false);
    });
  });

  describe('applyHardClear', () => {
    const createMessage = (
      index: number,
      role: string,
      toolCallIds: string[] = [],
      ageMs: number = 0
    ): PrunableMessage => ({
      index,
      role,
      content: `Content ${index}`,
      originalLength: 10,
      timestamp: Date.now() - ageMs,
      toolCallIds,
      softTrimmed: false,
      hardCleared: false,
    });

    it('should combine tool call clearing and age clearing', () => {
      const messages = [
        createMessage(0, 'tool', ['tc-1']),
        createMessage(1, 'assistant', [], 100000), // Old message
        createMessage(2, 'assistant', []), // Recent message
      ];

      const expiredToolCalls: ToolCallTimestamp[] = [{
        toolCallId: 'tc-1',
        toolName: 'read_file',
        calledAt: Date.now() - 10000,
        messageIndex: 0,
        pruned: false,
      }];

      const result = applyHardClear(messages, expiredToolCalls, {
        maxMessageAge: 50000,
        keepLastNAssistant: 1,
      });

      // tc-1 message should be cleared
      expect(result.messages[0].hardCleared).toBe(true);
      // Old assistant message should be cleared (index 1, not in last N)
      expect(result.messages[1].hardCleared).toBe(true);
      // Recent assistant message should be kept (last 1)
      expect(result.messages[2].hardCleared).toBe(false);
      expect(result.toolCallsCleared).toContain('tc-1');
    });
  });
});
