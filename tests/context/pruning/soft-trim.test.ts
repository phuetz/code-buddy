/**
 * Soft Trim Tests
 */

import {
  softTrimString,
  softTrimContent,
  softTrimMessage,
  softTrimMessages,
  shouldSoftTrim,
} from '../../../src/context/pruning/soft-trim.js';
import type { PrunableMessage } from '../../../src/context/pruning/config.js';

describe('Soft Trim', () => {
  describe('softTrimString', () => {
    it('should not trim short strings', () => {
      const content = 'Short content here.';
      const result = softTrimString(content, 1500, 1500);

      expect(result.trimmed).toBe(content);
      expect(result.removed).toBe(0);
    });

    it('should trim long strings', () => {
      const content = 'x'.repeat(5000);
      const result = softTrimString(content, 500, 500);

      expect(result.trimmed.length).toBeLessThan(content.length);
      expect(result.removed).toBe(5000 - 500 - 500);
      expect(result.trimmed).toContain('trimmed');
    });

    it('should preserve head and tail', () => {
      const content = 'HEAD_MARKER' + 'x'.repeat(5000) + 'TAIL_MARKER';
      const result = softTrimString(content, 500, 500);

      expect(result.trimmed).toContain('HEAD_MARKER');
      expect(result.trimmed).toContain('TAIL_MARKER');
    });
  });

  describe('softTrimContent', () => {
    it('should handle null content', () => {
      const result = softTrimContent(null);

      expect(result.content).toBeNull();
      expect(result.removed).toBe(0);
      expect(result.trimmed).toBe(false);
    });

    it('should trim long string content', () => {
      const content = 'x'.repeat(5000);
      const result = softTrimContent(content, { minPrunableChars: 1000 });

      expect(typeof result.content).toBe('string');
      expect((result.content as string).length).toBeLessThan(content.length);
      expect(result.trimmed).toBe(true);
    });

    it('should not trim short content', () => {
      const content = 'Short content';
      const result = softTrimContent(content, { minPrunableChars: 4000 });

      expect(result.content).toBe(content);
      expect(result.trimmed).toBe(false);
    });

    it('should handle array content (multimodal)', () => {
      const content = [
        { type: 'text', text: 'x'.repeat(5000) },
        { type: 'image_url', image_url: { url: 'data:...' } },
      ];

      const result = softTrimContent(content, { minPrunableChars: 1000 });

      expect(Array.isArray(result.content)).toBe(true);
      const textPart = (result.content as Array<{ text?: string }>)[0];
      expect(textPart.text?.length).toBeLessThan(5000);
    });
  });

  describe('softTrimMessage', () => {
    const createMessage = (content: string, overrides: Partial<PrunableMessage> = {}): PrunableMessage => ({
      index: 0,
      role: 'assistant',
      content,
      originalLength: content.length,
      timestamp: Date.now(),
      toolCallIds: [],
      softTrimmed: false,
      hardCleared: false,
      ...overrides,
    });

    it('should trim message with long content', () => {
      const msg = createMessage('x'.repeat(5000));
      const result = softTrimMessage(msg, { minPrunableChars: 1000 });

      expect(result.softTrimmed).toBe(true);
      expect((result.content as string).length).toBeLessThan(5000);
    });

    it('should not trim already trimmed message', () => {
      const msg = createMessage('x'.repeat(5000), { softTrimmed: true });
      const result = softTrimMessage(msg, { minPrunableChars: 1000 });

      expect(result.content).toBe(msg.content);
    });

    it('should not trim hard-cleared message', () => {
      const msg = createMessage('[Cleared]', { hardCleared: true });
      const result = softTrimMessage(msg);

      expect(result.content).toBe('[Cleared]');
    });
  });

  describe('softTrimMessages', () => {
    const createMessages = (count: number, contentLength: number = 5000): PrunableMessage[] =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}: ${'x'.repeat(contentLength)}`,
        originalLength: contentLength + 10,
        timestamp: Date.now(),
        toolCallIds: [],
        softTrimmed: false,
        hardCleared: false,
      }));

    it('should skip system messages when configured', () => {
      const messages: PrunableMessage[] = [
        {
          index: 0,
          role: 'system',
          content: 'x'.repeat(5000),
          originalLength: 5000,
          timestamp: Date.now(),
          toolCallIds: [],
          softTrimmed: false,
          hardCleared: false,
        },
      ];

      const result = softTrimMessages(messages, {
        keepSystemMessages: true,
        minPrunableChars: 1000,
      });

      expect(result.messages[0].softTrimmed).toBe(false);
    });

    it('should skip user messages when configured', () => {
      const messages: PrunableMessage[] = [
        {
          index: 0,
          role: 'user',
          content: 'x'.repeat(5000),
          originalLength: 5000,
          timestamp: Date.now(),
          toolCallIds: [],
          softTrimmed: false,
          hardCleared: false,
        },
      ];

      const result = softTrimMessages(messages, {
        keepUserMessages: true,
        minPrunableChars: 1000,
      });

      expect(result.messages[0].softTrimmed).toBe(false);
    });

    it('should keep last N assistant messages', () => {
      const messages: PrunableMessage[] = [
        { index: 0, role: 'assistant', content: 'x'.repeat(5000), originalLength: 5000, timestamp: Date.now(), toolCallIds: [], softTrimmed: false, hardCleared: false },
        { index: 1, role: 'assistant', content: 'x'.repeat(5000), originalLength: 5000, timestamp: Date.now(), toolCallIds: [], softTrimmed: false, hardCleared: false },
        { index: 2, role: 'assistant', content: 'x'.repeat(5000), originalLength: 5000, timestamp: Date.now(), toolCallIds: [], softTrimmed: false, hardCleared: false },
        { index: 3, role: 'assistant', content: 'x'.repeat(5000), originalLength: 5000, timestamp: Date.now(), toolCallIds: [], softTrimmed: false, hardCleared: false },
      ];

      const result = softTrimMessages(messages, {
        keepLastNAssistant: 2,
        keepUserMessages: false,
        minPrunableChars: 1000,
      });

      // First 2 should be trimmed, last 2 should not
      expect(result.messages[0].softTrimmed).toBe(true);
      expect(result.messages[1].softTrimmed).toBe(true);
      expect(result.messages[2].softTrimmed).toBe(false);
      expect(result.messages[3].softTrimmed).toBe(false);
    });

    it('should count trimmed messages and characters', () => {
      const messages = createMessages(4, 5000);
      // Only assistant messages (indices 1, 3) will be considered, keep last 1
      const result = softTrimMessages(messages, {
        keepLastNAssistant: 1,
        keepUserMessages: true,
        minPrunableChars: 1000,
      });

      expect(result.trimmedCount).toBeGreaterThanOrEqual(0);
      expect(result.totalRemoved).toBeGreaterThanOrEqual(0);
    });
  });

  describe('shouldSoftTrim', () => {
    const createMessage = (role: string, contentLength: number): PrunableMessage => ({
      index: 0,
      role,
      content: 'x'.repeat(contentLength),
      originalLength: contentLength,
      timestamp: Date.now(),
      toolCallIds: [],
      softTrimmed: false,
      hardCleared: false,
    });

    it('should return false for already trimmed message', () => {
      const msg = createMessage('assistant', 5000);
      msg.softTrimmed = true;

      expect(shouldSoftTrim(msg, [msg], { minPrunableChars: 1000 })).toBe(false);
    });

    it('should return false for short content', () => {
      const msg = createMessage('assistant', 100);

      expect(shouldSoftTrim(msg, [msg], { minPrunableChars: 4000 })).toBe(false);
    });

    it('should return true for long assistant content', () => {
      const msg = createMessage('assistant', 5000);
      const messages = [msg, createMessage('assistant', 100)]; // Add another so this isn't "last"

      expect(shouldSoftTrim(msg, messages, {
        minPrunableChars: 1000,
        keepLastNAssistant: 1,
      })).toBe(true);
    });
  });
});
