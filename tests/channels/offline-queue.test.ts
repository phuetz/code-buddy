/**
 * OfflineQueue Tests
 *
 * Tests for the offline message queue used to buffer messages
 * when a channel is disconnected.
 */

import { OfflineQueue } from '../../src/channels/offline-queue.js';
import type { QueuedMessage } from '../../src/channels/offline-queue.js';

describe('OfflineQueue', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = new OfflineQueue();
  });

  // ==========================================================================
  // Construction
  // ==========================================================================

  describe('constructor', () => {
    it('should create with default max size of 100', () => {
      expect(queue.getMaxSize()).toBe(100);
    });

    it('should accept custom max size', () => {
      const q = new OfflineQueue(50);
      expect(q.getMaxSize()).toBe(50);
    });

    it('should enforce minimum max size of 1', () => {
      const q = new OfflineQueue(0);
      expect(q.getMaxSize()).toBe(1);
    });

    it('should handle negative max size by setting to 1', () => {
      const q = new OfflineQueue(-5);
      expect(q.getMaxSize()).toBe(1);
    });

    it('should start empty', () => {
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });
  });

  // ==========================================================================
  // Enqueue
  // ==========================================================================

  describe('enqueue', () => {
    it('should add a message to the queue', () => {
      const result = queue.enqueue({ channelId: '123', content: 'hello' });
      expect(result).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('should add multiple messages in FIFO order', () => {
      queue.enqueue({ channelId: '1', content: 'first' });
      queue.enqueue({ channelId: '2', content: 'second' });
      queue.enqueue({ channelId: '3', content: 'third' });

      expect(queue.size()).toBe(3);

      const messages = queue.drain();
      expect(messages[0].content).toBe('first');
      expect(messages[1].content).toBe('second');
      expect(messages[2].content).toBe('third');
    });

    it('should include metadata when provided', () => {
      queue.enqueue({
        channelId: '123',
        content: 'hello',
        metadata: { priority: 'high', source: 'test' },
      });

      const messages = queue.drain();
      expect(messages[0].metadata).toEqual({ priority: 'high', source: 'test' });
    });

    it('should set queuedAt timestamp', () => {
      const before = new Date();
      queue.enqueue({ channelId: '123', content: 'hello' });
      const after = new Date();

      const messages = queue.drain();
      expect(messages[0].queuedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(messages[0].queuedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should return true when queue has space', () => {
      const q = new OfflineQueue(5);
      expect(q.enqueue({ channelId: '1', content: 'a' })).toBe(true);
      expect(q.enqueue({ channelId: '2', content: 'b' })).toBe(true);
    });

    it('should return false when dropping oldest message', () => {
      const q = new OfflineQueue(2);
      expect(q.enqueue({ channelId: '1', content: 'a' })).toBe(true);
      expect(q.enqueue({ channelId: '2', content: 'b' })).toBe(true);
      expect(q.enqueue({ channelId: '3', content: 'c' })).toBe(false);
      expect(q.size()).toBe(2);
    });
  });

  // ==========================================================================
  // Max Size Enforcement
  // ==========================================================================

  describe('max size enforcement', () => {
    it('should drop oldest message when queue is full', () => {
      const q = new OfflineQueue(3);
      q.enqueue({ channelId: '1', content: 'first' });
      q.enqueue({ channelId: '2', content: 'second' });
      q.enqueue({ channelId: '3', content: 'third' });
      q.enqueue({ channelId: '4', content: 'fourth' });

      expect(q.size()).toBe(3);

      const messages = q.drain();
      expect(messages[0].content).toBe('second');
      expect(messages[1].content).toBe('third');
      expect(messages[2].content).toBe('fourth');
    });

    it('should handle queue of size 1', () => {
      const q = new OfflineQueue(1);
      q.enqueue({ channelId: '1', content: 'a' });
      q.enqueue({ channelId: '2', content: 'b' });

      expect(q.size()).toBe(1);
      const messages = q.drain();
      expect(messages[0].content).toBe('b');
    });

    it('should report isFull correctly', () => {
      const q = new OfflineQueue(2);
      expect(q.isFull()).toBe(false);

      q.enqueue({ channelId: '1', content: 'a' });
      expect(q.isFull()).toBe(false);

      q.enqueue({ channelId: '2', content: 'b' });
      expect(q.isFull()).toBe(true);
    });
  });

  // ==========================================================================
  // Drain
  // ==========================================================================

  describe('drain', () => {
    it('should return all messages in order', () => {
      queue.enqueue({ channelId: '1', content: 'a' });
      queue.enqueue({ channelId: '2', content: 'b' });
      queue.enqueue({ channelId: '3', content: 'c' });

      const messages = queue.drain();
      expect(messages).toHaveLength(3);
      expect(messages.map(m => m.content)).toEqual(['a', 'b', 'c']);
    });

    it('should empty the queue after drain', () => {
      queue.enqueue({ channelId: '1', content: 'a' });
      queue.enqueue({ channelId: '2', content: 'b' });

      queue.drain();
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return empty array when queue is empty', () => {
      const messages = queue.drain();
      expect(messages).toEqual([]);
    });

    it('should allow new messages after drain', () => {
      queue.enqueue({ channelId: '1', content: 'a' });
      queue.drain();

      queue.enqueue({ channelId: '2', content: 'b' });
      const messages = queue.drain();
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('b');
    });
  });

  // ==========================================================================
  // Clear
  // ==========================================================================

  describe('clear', () => {
    it('should remove all messages', () => {
      queue.enqueue({ channelId: '1', content: 'a' });
      queue.enqueue({ channelId: '2', content: 'b' });

      queue.clear();
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });

    it('should be safe to clear empty queue', () => {
      expect(() => queue.clear()).not.toThrow();
      expect(queue.size()).toBe(0);
    });

    it('should allow new messages after clear', () => {
      queue.enqueue({ channelId: '1', content: 'a' });
      queue.clear();

      queue.enqueue({ channelId: '2', content: 'b' });
      expect(queue.size()).toBe(1);
    });
  });

  // ==========================================================================
  // Peek
  // ==========================================================================

  describe('peek', () => {
    it('should return first message without removing it', () => {
      queue.enqueue({ channelId: '1', content: 'first' });
      queue.enqueue({ channelId: '2', content: 'second' });

      const peeked = queue.peek();
      expect(peeked?.content).toBe('first');
      expect(queue.size()).toBe(2); // Not removed
    });

    it('should return undefined for empty queue', () => {
      expect(queue.peek()).toBeUndefined();
    });
  });

  // ==========================================================================
  // isEmpty / isFull
  // ==========================================================================

  describe('isEmpty', () => {
    it('should return true for new queue', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return false after enqueue', () => {
      queue.enqueue({ channelId: '1', content: 'a' });
      expect(queue.isEmpty()).toBe(false);
    });

    it('should return true after drain', () => {
      queue.enqueue({ channelId: '1', content: 'a' });
      queue.drain();
      expect(queue.isEmpty()).toBe(true);
    });
  });

  // ==========================================================================
  // Message Structure
  // ==========================================================================

  describe('message structure', () => {
    it('should preserve channelId, content, and metadata', () => {
      queue.enqueue({
        channelId: 'test-channel',
        content: 'test message',
        metadata: { key: 'value' },
      });

      const messages = queue.drain();
      expect(messages[0]).toMatchObject({
        channelId: 'test-channel',
        content: 'test message',
        metadata: { key: 'value' },
      });
    });

    it('should handle messages without metadata', () => {
      queue.enqueue({ channelId: '1', content: 'no meta' });

      const messages = queue.drain();
      expect(messages[0].metadata).toBeUndefined();
    });

    it('should handle empty content', () => {
      queue.enqueue({ channelId: '1', content: '' });

      const messages = queue.drain();
      expect(messages[0].content).toBe('');
    });
  });
});
