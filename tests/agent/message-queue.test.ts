/**
 * Tests for MessageQueue class
 */

import { MessageQueue, QueuedMessage, MessageQueueMode } from '../../src/agent/message-queue';

function makeMessage(content: string, source = 'user'): QueuedMessage {
  return { content, source, timestamp: new Date() };
}

describe('MessageQueue', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    queue = new MessageQueue();
  });

  // ==========================================================================
  // Initialization
  // ==========================================================================

  describe('initialization', () => {
    it('should default to followup mode', () => {
      expect(queue.getMode()).toBe('followup');
    });

    it('should start with an empty queue', () => {
      expect(queue.length).toBe(0);
      expect(queue.hasPendingMessages()).toBe(false);
    });

    it('should not be processing initially', () => {
      expect(queue.isProcessing()).toBe(false);
    });
  });

  // ==========================================================================
  // setMode / getMode
  // ==========================================================================

  describe('setMode / getMode', () => {
    it('should set mode to steer', () => {
      queue.setMode('steer');
      expect(queue.getMode()).toBe('steer');
    });

    it('should set mode to followup', () => {
      queue.setMode('steer');
      queue.setMode('followup');
      expect(queue.getMode()).toBe('followup');
    });

    it('should set mode to collect', () => {
      queue.setMode('collect');
      expect(queue.getMode()).toBe('collect');
    });

    it('should emit mode-changed event when mode is set', () => {
      const handler = jest.fn();
      queue.on('mode-changed', handler);

      queue.setMode('steer');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('steer');
    });

    it('should emit mode-changed even when setting the same mode', () => {
      const handler = jest.fn();
      queue.on('mode-changed', handler);

      queue.setMode('followup');
      queue.setMode('followup');

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // enqueue
  // ==========================================================================

  describe('enqueue', () => {
    it('should add a message to the queue', () => {
      const msg = makeMessage('hello');
      queue.enqueue(msg);

      expect(queue.length).toBe(1);
      expect(queue.hasPendingMessages()).toBe(true);
    });

    it('should add multiple messages in order', () => {
      queue.enqueue(makeMessage('first'));
      queue.enqueue(makeMessage('second'));
      queue.enqueue(makeMessage('third'));

      expect(queue.length).toBe(3);
    });

    it('should emit message-enqueued event', () => {
      const handler = jest.fn();
      queue.on('message-enqueued', handler);

      const msg = makeMessage('test');
      queue.enqueue(msg);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('should emit steering-available when in steer mode and processing', () => {
      const handler = jest.fn();
      queue.on('steering-available', handler);

      queue.setMode('steer');
      queue.startProcessing();
      queue.enqueue(makeMessage('interrupt'));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not emit steering-available when in steer mode but not processing', () => {
      const handler = jest.fn();
      queue.on('steering-available', handler);

      queue.setMode('steer');
      queue.enqueue(makeMessage('interrupt'));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not emit steering-available when processing but not in steer mode', () => {
      const handler = jest.fn();
      queue.on('steering-available', handler);

      queue.setMode('followup');
      queue.startProcessing();
      queue.enqueue(makeMessage('message'));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not emit steering-available in collect mode while processing', () => {
      const handler = jest.fn();
      queue.on('steering-available', handler);

      queue.setMode('collect');
      queue.startProcessing();
      queue.enqueue(makeMessage('message'));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Steer mode
  // ==========================================================================

  describe('steer mode', () => {
    beforeEach(() => {
      queue.setMode('steer');
    });

    describe('hasSteeringMessage', () => {
      it('should return true when in steer mode with messages', () => {
        queue.enqueue(makeMessage('steer me'));
        expect(queue.hasSteeringMessage()).toBe(true);
      });

      it('should return false when in steer mode with no messages', () => {
        expect(queue.hasSteeringMessage()).toBe(false);
      });

      it('should return false when not in steer mode even with messages', () => {
        queue.setMode('followup');
        queue.enqueue(makeMessage('not steering'));
        expect(queue.hasSteeringMessage()).toBe(false);
      });

      it('should return false when in collect mode even with messages', () => {
        queue.setMode('collect');
        queue.enqueue(makeMessage('not steering'));
        expect(queue.hasSteeringMessage()).toBe(false);
      });
    });

    describe('consumeSteeringMessage', () => {
      it('should return the first message and remove it', () => {
        queue.enqueue(makeMessage('first'));
        queue.enqueue(makeMessage('second'));

        const msg = queue.consumeSteeringMessage();

        expect(msg).not.toBeNull();
        expect(msg!.content).toBe('first');
        expect(queue.length).toBe(1);
      });

      it('should return null when queue is empty', () => {
        const msg = queue.consumeSteeringMessage();
        expect(msg).toBeNull();
      });

      it('should return null when not in steer mode', () => {
        queue.setMode('followup');
        queue.enqueue(makeMessage('message'));

        const msg = queue.consumeSteeringMessage();
        expect(msg).toBeNull();
        expect(queue.length).toBe(1); // message should remain
      });

      it('should consume messages one at a time in FIFO order', () => {
        queue.enqueue(makeMessage('a'));
        queue.enqueue(makeMessage('b'));
        queue.enqueue(makeMessage('c'));

        expect(queue.consumeSteeringMessage()!.content).toBe('a');
        expect(queue.consumeSteeringMessage()!.content).toBe('b');
        expect(queue.consumeSteeringMessage()!.content).toBe('c');
        expect(queue.consumeSteeringMessage()).toBeNull();
        expect(queue.length).toBe(0);
      });
    });
  });

  // ==========================================================================
  // Followup mode (drain)
  // ==========================================================================

  describe('followup mode / drain', () => {
    it('should return all messages and clear the queue', () => {
      queue.enqueue(makeMessage('one'));
      queue.enqueue(makeMessage('two'));
      queue.enqueue(makeMessage('three'));

      const messages = queue.drain();

      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('one');
      expect(messages[1].content).toBe('two');
      expect(messages[2].content).toBe('three');
      expect(queue.length).toBe(0);
      expect(queue.hasPendingMessages()).toBe(false);
    });

    it('should return an empty array when queue is empty', () => {
      const messages = queue.drain();
      expect(messages).toEqual([]);
    });

    it('should return a copy, not a reference to the internal queue', () => {
      queue.enqueue(makeMessage('msg'));
      const messages = queue.drain();

      // Mutating the returned array should not affect the queue
      messages.push(makeMessage('extra'));
      expect(queue.length).toBe(0);
    });

    it('should work regardless of mode', () => {
      queue.setMode('steer');
      queue.enqueue(makeMessage('msg'));

      const messages = queue.drain();
      expect(messages).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Collect mode
  // ==========================================================================

  describe('collect mode', () => {
    beforeEach(() => {
      queue.setMode('collect');
    });

    it('should combine messages with source prefixes', () => {
      queue.enqueue(makeMessage('hello', 'user'));
      queue.enqueue(makeMessage('world', 'telegram'));

      const result = queue.collect();

      expect(result).toBe('[user] hello\n[telegram] world');
    });

    it('should clear the queue after collecting', () => {
      queue.enqueue(makeMessage('msg', 'user'));
      queue.collect();

      expect(queue.length).toBe(0);
      expect(queue.hasPendingMessages()).toBe(false);
    });

    it('should return empty string when queue is empty', () => {
      const result = queue.collect();
      expect(result).toBe('');
    });

    it('should handle a single message', () => {
      queue.enqueue(makeMessage('only one', 'discord'));

      const result = queue.collect();
      expect(result).toBe('[discord] only one');
    });

    it('should work regardless of mode', () => {
      queue.setMode('followup');
      queue.enqueue(makeMessage('msg', 'user'));

      const result = queue.collect();
      expect(result).toBe('[user] msg');
    });

    it('should handle messages with special characters', () => {
      queue.enqueue(makeMessage('line1\nline2', 'user'));
      queue.enqueue(makeMessage('brackets [test]', 'slack'));

      const result = queue.collect();
      expect(result).toBe('[user] line1\nline2\n[slack] brackets [test]');
    });
  });

  // ==========================================================================
  // Processing state
  // ==========================================================================

  describe('processing state', () => {
    it('should track processing state via startProcessing', () => {
      queue.startProcessing();
      expect(queue.isProcessing()).toBe(true);
    });

    it('should track processing state via endProcessing', () => {
      queue.startProcessing();
      queue.endProcessing();
      expect(queue.isProcessing()).toBe(false);
    });

    it('should emit processing-started event', () => {
      const handler = jest.fn();
      queue.on('processing-started', handler);

      queue.startProcessing();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit processing-ended event', () => {
      const handler = jest.fn();
      queue.on('processing-ended', handler);

      queue.startProcessing();
      queue.endProcessing();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should allow calling startProcessing multiple times', () => {
      queue.startProcessing();
      queue.startProcessing();
      expect(queue.isProcessing()).toBe(true);
    });

    it('should allow calling endProcessing without startProcessing', () => {
      queue.endProcessing();
      expect(queue.isProcessing()).toBe(false);
    });
  });

  // ==========================================================================
  // hasPendingMessages / length
  // ==========================================================================

  describe('hasPendingMessages / length', () => {
    it('should return false and 0 for empty queue', () => {
      expect(queue.hasPendingMessages()).toBe(false);
      expect(queue.length).toBe(0);
    });

    it('should return true and correct count after enqueue', () => {
      queue.enqueue(makeMessage('a'));
      queue.enqueue(makeMessage('b'));

      expect(queue.hasPendingMessages()).toBe(true);
      expect(queue.length).toBe(2);
    });

    it('should update after consuming a steering message', () => {
      queue.setMode('steer');
      queue.enqueue(makeMessage('a'));
      queue.enqueue(makeMessage('b'));

      queue.consumeSteeringMessage();

      expect(queue.length).toBe(1);
      expect(queue.hasPendingMessages()).toBe(true);
    });

    it('should update after drain', () => {
      queue.enqueue(makeMessage('a'));
      queue.drain();

      expect(queue.length).toBe(0);
      expect(queue.hasPendingMessages()).toBe(false);
    });

    it('should update after collect', () => {
      queue.enqueue(makeMessage('a'));
      queue.collect();

      expect(queue.length).toBe(0);
      expect(queue.hasPendingMessages()).toBe(false);
    });
  });

  // ==========================================================================
  // clear
  // ==========================================================================

  describe('clear', () => {
    it('should remove all messages from the queue', () => {
      queue.enqueue(makeMessage('a'));
      queue.enqueue(makeMessage('b'));
      queue.enqueue(makeMessage('c'));

      queue.clear();

      expect(queue.length).toBe(0);
      expect(queue.hasPendingMessages()).toBe(false);
    });

    it('should be safe to call on an empty queue', () => {
      queue.clear();
      expect(queue.length).toBe(0);
    });

    it('should not affect processing state', () => {
      queue.startProcessing();
      queue.enqueue(makeMessage('msg'));
      queue.clear();

      expect(queue.isProcessing()).toBe(true);
      expect(queue.length).toBe(0);
    });

    it('should not affect mode', () => {
      queue.setMode('steer');
      queue.enqueue(makeMessage('msg'));
      queue.clear();

      expect(queue.getMode()).toBe('steer');
    });
  });

  // ==========================================================================
  // Event emission integration
  // ==========================================================================

  describe('event emission', () => {
    it('should emit events in correct order for steer workflow', () => {
      const events: string[] = [];

      queue.on('mode-changed', () => events.push('mode-changed'));
      queue.on('processing-started', () => events.push('processing-started'));
      queue.on('message-enqueued', () => events.push('message-enqueued'));
      queue.on('steering-available', () => events.push('steering-available'));
      queue.on('processing-ended', () => events.push('processing-ended'));

      queue.setMode('steer');
      queue.startProcessing();
      queue.enqueue(makeMessage('interrupt'));
      queue.endProcessing();

      expect(events).toEqual([
        'mode-changed',
        'processing-started',
        'message-enqueued',
        'steering-available',
        'processing-ended',
      ]);
    });

    it('should emit message-enqueued for every message', () => {
      const handler = jest.fn();
      queue.on('message-enqueued', handler);

      queue.enqueue(makeMessage('a'));
      queue.enqueue(makeMessage('b'));
      queue.enqueue(makeMessage('c'));

      expect(handler).toHaveBeenCalledTimes(3);
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle mode change while messages are queued', () => {
      queue.setMode('steer');
      queue.enqueue(makeMessage('msg'));

      // Switch to followup - messages remain, but hasSteeringMessage changes
      queue.setMode('followup');
      expect(queue.hasSteeringMessage()).toBe(false);
      expect(queue.hasPendingMessages()).toBe(true);

      // Can still drain them
      const messages = queue.drain();
      expect(messages).toHaveLength(1);
    });

    it('should handle consume after mode switch from steer to followup', () => {
      queue.setMode('steer');
      queue.enqueue(makeMessage('msg'));

      queue.setMode('followup');
      const result = queue.consumeSteeringMessage();
      expect(result).toBeNull();
      expect(queue.length).toBe(1); // message still in queue
    });

    it('should handle enqueue with empty content', () => {
      queue.enqueue(makeMessage('', 'user'));
      expect(queue.length).toBe(1);

      const collected = queue.collect();
      expect(collected).toBe('[user] ');
    });

    it('should handle rapid enqueue and drain cycles', () => {
      for (let i = 0; i < 100; i++) {
        queue.enqueue(makeMessage(`msg-${i}`));
      }
      expect(queue.length).toBe(100);

      const drained = queue.drain();
      expect(drained).toHaveLength(100);
      expect(queue.length).toBe(0);

      // Re-enqueue after drain
      queue.enqueue(makeMessage('after-drain'));
      expect(queue.length).toBe(1);
    });

    it('should preserve message timestamps', () => {
      const timestamp = new Date('2025-01-01T00:00:00Z');
      const msg: QueuedMessage = { content: 'test', source: 'user', timestamp };

      queue.enqueue(msg);
      const drained = queue.drain();

      expect(drained[0].timestamp).toBe(timestamp);
    });

    it('should handle collect then drain returning empty', () => {
      queue.enqueue(makeMessage('msg'));
      queue.collect();

      const drained = queue.drain();
      expect(drained).toEqual([]);
    });

    it('should handle drain then collect returning empty string', () => {
      queue.enqueue(makeMessage('msg'));
      queue.drain();

      const collected = queue.collect();
      expect(collected).toBe('');
    });
  });
});
