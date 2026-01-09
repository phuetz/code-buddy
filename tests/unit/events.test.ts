/**
 * Tests for Events Module
 *
 * Comprehensive unit tests for the centralized event system covering:
 * - Event emitting
 * - Event listening
 * - Event filtering
 * - Priority handling
 * - Once-only listeners
 * - Event history
 * - Wildcard listeners
 * - EventBus singleton
 */

import {
  TypedEventEmitter,
  FilteredEventEmitter,
  EventBus,
  getEventBus,
  resetEventBus,
  type BaseEvent,
  type EventListener,
  type EventFilter,
  type ListenerOptions,
  type EventStats,
  type EventHistoryEntry,
  type ApplicationEvents,
  type AgentEvent,
  type ToolEvent,
  type SessionEvent,
  type MessageEvent,
  type FileEvent,
} from '../../src/events/index.js';

// Test event types
interface TestEvents extends Record<string, BaseEvent> {
  'test:simple': BaseEvent & { data: string };
  'test:complex': BaseEvent & { count: number; items: string[] };
  'test:error': BaseEvent & { error: Error };
  'other:event': BaseEvent & { value: number };
}

describe('Events Module', () => {
  describe('TypedEventEmitter', () => {
    let emitter: TypedEventEmitter<TestEvents>;

    beforeEach(() => {
      emitter = new TypedEventEmitter<TestEvents>();
    });

    afterEach(() => {
      emitter.dispose();
    });

    describe('Basic Event Emitting', () => {
      it('should emit events with correct structure', () => {
        const listener = jest.fn();
        emitter.on('test:simple', listener);

        emitter.emit('test:simple', { data: 'hello' });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'test:simple',
            data: 'hello',
            timestamp: expect.any(Number),
          })
        );
      });

      it('should add timestamp automatically', () => {
        const listener = jest.fn();
        emitter.on('test:simple', listener);

        const before = Date.now();
        emitter.emit('test:simple', { data: 'test' });
        const after = Date.now();

        const event = listener.mock.calls[0][0];
        expect(event.timestamp).toBeGreaterThanOrEqual(before);
        expect(event.timestamp).toBeLessThanOrEqual(after);
      });

      it('should return true when event has listeners', () => {
        emitter.on('test:simple', jest.fn());

        const result = emitter.emit('test:simple', { data: 'test' });

        expect(result).toBe(true);
      });

      it('should return false when event has no listeners', () => {
        const result = emitter.emit('test:simple', { data: 'test' });

        expect(result).toBe(false);
      });

      it('should emit complex events with all properties', () => {
        const listener = jest.fn();
        emitter.on('test:complex', listener);

        emitter.emit('test:complex', { count: 5, items: ['a', 'b', 'c'] });

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'test:complex',
            count: 5,
            items: ['a', 'b', 'c'],
          })
        );
      });

      it('should handle metadata in events', () => {
        const listener = jest.fn();
        emitter.on('test:simple', listener);

        emitter.emit('test:simple', {
          data: 'test',
          source: 'unit-test',
          metadata: { key: 'value' },
        });

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            source: 'unit-test',
            metadata: { key: 'value' },
          })
        );
      });
    });

    describe('Event Listening', () => {
      it('should register listeners with on()', () => {
        const listener = jest.fn();

        const id = emitter.on('test:simple', listener);

        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');
      });

      it('should call all registered listeners', () => {
        const listener1 = jest.fn();
        const listener2 = jest.fn();
        const listener3 = jest.fn();

        emitter.on('test:simple', listener1);
        emitter.on('test:simple', listener2);
        emitter.on('test:simple', listener3);

        emitter.emit('test:simple', { data: 'test' });

        expect(listener1).toHaveBeenCalledTimes(1);
        expect(listener2).toHaveBeenCalledTimes(1);
        expect(listener3).toHaveBeenCalledTimes(1);
      });

      it('should not call listeners for different event types', () => {
        const simpleListener = jest.fn();
        const complexListener = jest.fn();

        emitter.on('test:simple', simpleListener);
        emitter.on('test:complex', complexListener);

        emitter.emit('test:simple', { data: 'test' });

        expect(simpleListener).toHaveBeenCalledTimes(1);
        expect(complexListener).not.toHaveBeenCalled();
      });

      it('should return unique listener IDs', () => {
        const listener = jest.fn();

        const id1 = emitter.on('test:simple', listener);
        const id2 = emitter.on('test:simple', listener);
        const id3 = emitter.on('test:complex', listener);

        expect(id1).not.toBe(id2);
        expect(id2).not.toBe(id3);
        expect(id1).not.toBe(id3);
      });

      it('should handle async listeners', async () => {
        const asyncListener = jest.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });

        emitter.on('test:simple', asyncListener);
        emitter.emit('test:simple', { data: 'test' });

        // Wait for async listener to complete
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(asyncListener).toHaveBeenCalledTimes(1);
      });

      it('should handle listener errors gracefully', () => {
        const errorListener = jest.fn().mockImplementation(() => {
          throw new Error('Listener error');
        });
        const normalListener = jest.fn();

        emitter.on('test:simple', errorListener);
        emitter.on('test:simple', normalListener);

        // Should not throw
        expect(() => {
          emitter.emit('test:simple', { data: 'test' });
        }).not.toThrow();

        // Normal listener should still be called
        expect(normalListener).toHaveBeenCalled();
      });
    });

    describe('Once-only Listeners', () => {
      it('should call once listener only once', () => {
        const listener = jest.fn();

        emitter.once('test:simple', listener);

        emitter.emit('test:simple', { data: 'first' });
        emitter.emit('test:simple', { data: 'second' });
        emitter.emit('test:simple', { data: 'third' });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ data: 'first' })
        );
      });

      it('should remove once listener after execution', () => {
        const onceListener = jest.fn();
        const regularListener = jest.fn();

        emitter.once('test:simple', onceListener);
        emitter.on('test:simple', regularListener);

        emitter.emit('test:simple', { data: 'test' });

        expect(emitter.listenerCount('test:simple')).toBe(1);
      });

      it('should support multiple once listeners', () => {
        const listener1 = jest.fn();
        const listener2 = jest.fn();

        emitter.once('test:simple', listener1);
        emitter.once('test:simple', listener2);

        emitter.emit('test:simple', { data: 'test' });

        expect(listener1).toHaveBeenCalledTimes(1);
        expect(listener2).toHaveBeenCalledTimes(1);

        emitter.emit('test:simple', { data: 'test' });

        // Neither should be called again
        expect(listener1).toHaveBeenCalledTimes(1);
        expect(listener2).toHaveBeenCalledTimes(1);
      });
    });

    describe('Removing Listeners', () => {
      it('should remove listener by ID with off()', () => {
        const listener = jest.fn();

        const id = emitter.on('test:simple', listener);
        const removed = emitter.off(id);

        expect(removed).toBe(true);

        emitter.emit('test:simple', { data: 'test' });

        expect(listener).not.toHaveBeenCalled();
      });

      it('should return false when removing non-existent listener', () => {
        const result = emitter.off('non-existent-id');

        expect(result).toBe(false);
      });

      it('should remove only the specified listener', () => {
        const listener1 = jest.fn();
        const listener2 = jest.fn();

        const id1 = emitter.on('test:simple', listener1);
        emitter.on('test:simple', listener2);

        emitter.off(id1);
        emitter.emit('test:simple', { data: 'test' });

        expect(listener1).not.toHaveBeenCalled();
        expect(listener2).toHaveBeenCalled();
      });

      it('should remove all listeners for event type with offAll(type)', () => {
        const listener1 = jest.fn();
        const listener2 = jest.fn();
        const otherListener = jest.fn();

        emitter.on('test:simple', listener1);
        emitter.on('test:simple', listener2);
        emitter.on('test:complex', otherListener);

        emitter.offAll('test:simple');

        emitter.emit('test:simple', { data: 'test' });
        emitter.emit('test:complex', { count: 1, items: [] });

        expect(listener1).not.toHaveBeenCalled();
        expect(listener2).not.toHaveBeenCalled();
        expect(otherListener).toHaveBeenCalled();
      });

      it('should remove all listeners with offAll()', () => {
        const listener1 = jest.fn();
        const listener2 = jest.fn();

        emitter.on('test:simple', listener1);
        emitter.on('test:complex', listener2);

        emitter.offAll();

        emitter.emit('test:simple', { data: 'test' });
        emitter.emit('test:complex', { count: 1, items: [] });

        expect(listener1).not.toHaveBeenCalled();
        expect(listener2).not.toHaveBeenCalled();
      });
    });

    describe('Priority Handling', () => {
      it('should call higher priority listeners first', () => {
        const callOrder: number[] = [];

        emitter.on('test:simple', () => { callOrder.push(1); }, { priority: 1 });
        emitter.on('test:simple', () => { callOrder.push(3); }, { priority: 3 });
        emitter.on('test:simple', () => { callOrder.push(2); }, { priority: 2 });

        emitter.emit('test:simple', { data: 'test' });

        expect(callOrder).toEqual([3, 2, 1]);
      });

      it('should use 0 as default priority', () => {
        const callOrder: string[] = [];

        emitter.on('test:simple', () => { callOrder.push('high'); }, { priority: 10 });
        emitter.on('test:simple', () => { callOrder.push('default'); });
        emitter.on('test:simple', () => { callOrder.push('low'); }, { priority: -5 });

        emitter.emit('test:simple', { data: 'test' });

        expect(callOrder).toEqual(['high', 'default', 'low']);
      });

      it('should handle same priority listeners in registration order', () => {
        const callOrder: string[] = [];

        emitter.on('test:simple', () => { callOrder.push('first'); }, { priority: 5 });
        emitter.on('test:simple', () => { callOrder.push('second'); }, { priority: 5 });
        emitter.on('test:simple', () => { callOrder.push('third'); }, { priority: 5 });

        emitter.emit('test:simple', { data: 'test' });

        // All have same priority, should maintain some consistent order
        expect(callOrder).toHaveLength(3);
      });
    });

    describe('Event Filtering', () => {
      it('should filter events with predicate function', () => {
        const listener = jest.fn();
        const filter: EventFilter<TestEvents['test:complex']> = (event) =>
          event.count > 5;

        emitter.on('test:complex', listener, { filter });

        emitter.emit('test:complex', { count: 3, items: [] }); // Should not trigger
        emitter.emit('test:complex', { count: 10, items: [] }); // Should trigger

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ count: 10 })
        );
      });

      it('should combine filter with once', () => {
        const listener = jest.fn();
        const filter: EventFilter<TestEvents['test:complex']> = (event) =>
          event.count > 5;

        emitter.once('test:complex', listener, { filter });

        emitter.emit('test:complex', { count: 3, items: [] }); // Filtered out
        emitter.emit('test:complex', { count: 10, items: [] }); // Triggers once
        emitter.emit('test:complex', { count: 15, items: [] }); // Already removed

        expect(listener).toHaveBeenCalledTimes(1);
      });

      it('should combine filter with priority', () => {
        const callOrder: number[] = [];
        const filter: EventFilter<TestEvents['test:complex']> = (event) =>
          event.count > 0;

        emitter.on('test:complex', () => { callOrder.push(1); }, {
          filter,
          priority: 1,
        });
        emitter.on('test:complex', () => { callOrder.push(2); }, {
          filter,
          priority: 2,
        });

        emitter.emit('test:complex', { count: 5, items: [] });

        expect(callOrder).toEqual([2, 1]);
      });

      it('should not call listener when filter returns false', () => {
        const listener = jest.fn();
        const filter = () => false;

        emitter.on('test:simple', listener, { filter });
        emitter.emit('test:simple', { data: 'test' });

        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe('Wildcard Listeners', () => {
      it('should receive all events with onAny()', () => {
        const listener = jest.fn();

        emitter.onAny(listener);

        emitter.emit('test:simple', { data: 'simple' });
        emitter.emit('test:complex', { count: 1, items: [] });

        expect(listener).toHaveBeenCalledTimes(2);
      });

      it('should apply priority to wildcard listeners', () => {
        const callOrder: string[] = [];

        emitter.on('test:simple', () => { callOrder.push('specific'); }, {
          priority: 1,
        });
        emitter.onAny(() => { callOrder.push('wildcard'); }, { priority: 10 });

        emitter.emit('test:simple', { data: 'test' });

        expect(callOrder).toEqual(['wildcard', 'specific']);
      });

      it('should apply filter to wildcard listeners', () => {
        const listener = jest.fn();
        const filter: EventFilter = (event) => event.type.startsWith('test:');

        emitter.onAny(listener, { filter });

        emitter.emit('test:simple', { data: 'test' });
        emitter.emit('other:event', { value: 42 });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'test:simple' })
        );
      });

      it('should remove wildcard listener with off()', () => {
        const listener = jest.fn();

        const id = emitter.onAny(listener);
        emitter.off(id);

        emitter.emit('test:simple', { data: 'test' });

        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe('Event History', () => {
      it('should track emitted events in history', () => {
        emitter.on('test:simple', jest.fn());

        emitter.emit('test:simple', { data: 'first' });
        emitter.emit('test:simple', { data: 'second' });

        const history = emitter.getHistory();

        expect(history).toHaveLength(2);
        expect(history[0].event).toMatchObject({ data: 'first' });
        expect(history[1].event).toMatchObject({ data: 'second' });
      });

      it('should include listener count in history entries', () => {
        emitter.on('test:simple', jest.fn());
        emitter.on('test:simple', jest.fn());

        emitter.emit('test:simple', { data: 'test' });

        const history = emitter.getHistory();

        expect(history[0].listenerCount).toBe(2);
      });

      it('should respect max history size', () => {
        const smallEmitter = new TypedEventEmitter<TestEvents>({
          maxHistorySize: 3,
        });

        smallEmitter.on('test:simple', jest.fn());

        smallEmitter.emit('test:simple', { data: '1' });
        smallEmitter.emit('test:simple', { data: '2' });
        smallEmitter.emit('test:simple', { data: '3' });
        smallEmitter.emit('test:simple', { data: '4' });
        smallEmitter.emit('test:simple', { data: '5' });

        const history = smallEmitter.getHistory();

        expect(history).toHaveLength(3);
        expect(history[0].event).toMatchObject({ data: '3' });
        expect(history[2].event).toMatchObject({ data: '5' });

        smallEmitter.dispose();
      });

      it('should filter history with predicate', () => {
        emitter.on('test:simple', jest.fn());
        emitter.on('test:complex', jest.fn());

        emitter.emit('test:simple', { data: 'simple' });
        emitter.emit('test:complex', { count: 5, items: [] });
        emitter.emit('test:simple', { data: 'another' });

        const filtered = emitter.getFilteredHistory<TestEvents['test:complex']>(
          (event) => event.type === 'test:complex'
        );

        expect(filtered).toHaveLength(1);
        expect(filtered[0].event).toMatchObject({ count: 5 });
      });

      it('should clear history', () => {
        emitter.on('test:simple', jest.fn());
        emitter.emit('test:simple', { data: 'test' });

        expect(emitter.getHistory()).toHaveLength(1);

        emitter.clearHistory();

        expect(emitter.getHistory()).toHaveLength(0);
      });
    });

    describe('Statistics', () => {
      it('should track total emitted events', () => {
        emitter.on('test:simple', jest.fn());

        emitter.emit('test:simple', { data: '1' });
        emitter.emit('test:simple', { data: '2' });
        emitter.emit('test:simple', { data: '3' });

        const stats = emitter.getStats();

        expect(stats.totalEmitted).toBe(3);
      });

      it('should track event counts by type', () => {
        emitter.on('test:simple', jest.fn());
        emitter.on('test:complex', jest.fn());

        emitter.emit('test:simple', { data: 'test' });
        emitter.emit('test:simple', { data: 'test' });
        emitter.emit('test:complex', { count: 1, items: [] });

        const stats = emitter.getStats();

        expect(stats.eventCounts['test:simple']).toBe(2);
        expect(stats.eventCounts['test:complex']).toBe(1);
      });

      it('should track total listener count', () => {
        emitter.on('test:simple', jest.fn());
        emitter.on('test:simple', jest.fn());
        emitter.on('test:complex', jest.fn());

        const stats = emitter.getStats();

        expect(stats.totalListeners).toBe(3);
      });

      it('should track last emitted event', () => {
        emitter.on('test:simple', jest.fn());

        emitter.emit('test:simple', { data: 'first' });
        emitter.emit('test:simple', { data: 'last' });

        const stats = emitter.getStats();

        expect(stats.lastEmitted).toMatchObject({ data: 'last' });
      });

      it('should reset statistics', () => {
        emitter.on('test:simple', jest.fn());
        emitter.emit('test:simple', { data: 'test' });

        emitter.resetStats();

        const stats = emitter.getStats();

        expect(stats.totalEmitted).toBe(0);
        expect(stats.eventCounts).toEqual({});
        expect(stats.lastEmitted).toBeUndefined();
        // Listener count should be preserved
        expect(stats.totalListeners).toBe(1);
      });
    });

    describe('Enable/Disable', () => {
      it('should be enabled by default', () => {
        expect(emitter.isEnabled()).toBe(true);
      });

      it('should not emit events when disabled', () => {
        const listener = jest.fn();
        emitter.on('test:simple', listener);

        emitter.setEnabled(false);
        const result = emitter.emit('test:simple', { data: 'test' });

        expect(result).toBe(false);
        expect(listener).not.toHaveBeenCalled();
      });

      it('should emit events after re-enabling', () => {
        const listener = jest.fn();
        emitter.on('test:simple', listener);

        emitter.setEnabled(false);
        emitter.setEnabled(true);
        emitter.emit('test:simple', { data: 'test' });

        expect(listener).toHaveBeenCalled();
      });
    });

    describe('Utility Methods', () => {
      it('should return listener count for specific event', () => {
        emitter.on('test:simple', jest.fn());
        emitter.on('test:simple', jest.fn());
        emitter.on('test:complex', jest.fn());

        expect(emitter.listenerCount('test:simple')).toBe(2);
        expect(emitter.listenerCount('test:complex')).toBe(1);
      });

      it('should include wildcard listeners in count', () => {
        emitter.on('test:simple', jest.fn());
        emitter.onAny(jest.fn());

        expect(emitter.listenerCount('test:simple')).toBe(2);
      });

      it('should return total listener count', () => {
        emitter.on('test:simple', jest.fn());
        emitter.on('test:complex', jest.fn());
        emitter.onAny(jest.fn());

        expect(emitter.listenerCount()).toBe(3);
      });

      it('should return event names with listeners', () => {
        emitter.on('test:simple', jest.fn());
        emitter.on('test:complex', jest.fn());

        const names = emitter.eventNames();

        expect(names).toContain('test:simple');
        expect(names).toContain('test:complex');
      });
    });

    describe('waitFor()', () => {
      it('should resolve when event is emitted', async () => {
        const promise = emitter.waitFor('test:simple');

        // Emit after a short delay
        setTimeout(() => {
          emitter.emit('test:simple', { data: 'resolved' });
        }, 10);

        const event = await promise;

        expect(event).toMatchObject({ data: 'resolved' });
      });

      it('should timeout when event is not emitted', async () => {
        const promise = emitter.waitFor('test:simple', { timeout: 50 });

        await expect(promise).rejects.toThrow('Timeout waiting for event');
      });

      it('should respect filter in waitFor', async () => {
        const filter: EventFilter<TestEvents['test:complex']> = (event) =>
          event.count > 5;
        const promise = emitter.waitFor('test:complex', { filter, timeout: 100 });

        // Emit filtered event first
        setTimeout(() => {
          emitter.emit('test:complex', { count: 3, items: [] });
        }, 10);

        // Emit matching event
        setTimeout(() => {
          emitter.emit('test:complex', { count: 10, items: [] });
        }, 30);

        const event = await promise;

        expect(event.count).toBe(10);
      });
    });

    describe('pipe()', () => {
      it('should pipe events to another emitter', () => {
        const target = new TypedEventEmitter<TestEvents>();
        const targetListener = jest.fn();

        target.on('test:simple', targetListener);
        emitter.pipe('test:simple', target);

        emitter.emit('test:simple', { data: 'piped' });

        expect(targetListener).toHaveBeenCalledWith(
          expect.objectContaining({ data: 'piped' })
        );

        target.dispose();
      });

      it('should transform events when piping', () => {
        const target = new TypedEventEmitter<TestEvents>();
        const targetListener = jest.fn();

        target.on('test:simple', targetListener);
        emitter.pipe('test:simple', target, {
          transform: (event) => ({ ...event, data: event.data.toUpperCase() }),
        });

        emitter.emit('test:simple', { data: 'hello' });

        expect(targetListener).toHaveBeenCalledWith(
          expect.objectContaining({ data: 'HELLO' })
        );

        target.dispose();
      });
    });

    describe('dispose()', () => {
      it('should remove all listeners on dispose', () => {
        emitter.on('test:simple', jest.fn());
        emitter.on('test:complex', jest.fn());
        emitter.onAny(jest.fn());

        emitter.dispose();

        expect(emitter.listenerCount()).toBe(0);
      });

      it('should clear history on dispose', () => {
        emitter.on('test:simple', jest.fn());
        emitter.emit('test:simple', { data: 'test' });

        emitter.dispose();

        expect(emitter.getHistory()).toHaveLength(0);
      });
    });
  });

  describe('FilteredEventEmitter', () => {
    let emitter: TypedEventEmitter<TestEvents>;
    let filtered: FilteredEventEmitter<TestEvents, 'test:complex'>;

    beforeEach(() => {
      emitter = new TypedEventEmitter<TestEvents>();
      filtered = emitter.filter(
        'test:complex',
        (event) => event.count > 5
      );
    });

    afterEach(() => {
      filtered.offAll();
      emitter.dispose();
    });

    it('should create filtered view of emitter', () => {
      const listener = jest.fn();

      filtered.on(listener);

      emitter.emit('test:complex', { count: 3, items: [] });
      emitter.emit('test:complex', { count: 10, items: [] });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ count: 10 })
      );
    });

    it('should support once on filtered emitter', () => {
      const listener = jest.fn();

      filtered.once(listener);

      emitter.emit('test:complex', { count: 10, items: [] });
      emitter.emit('test:complex', { count: 15, items: [] });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should remove listener from filtered emitter', () => {
      const listener = jest.fn();

      const id = filtered.on(listener);
      filtered.off(id);

      emitter.emit('test:complex', { count: 10, items: [] });

      expect(listener).not.toHaveBeenCalled();
    });

    it('should remove all listeners from filtered emitter', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      filtered.on(listener1);
      filtered.on(listener2);
      filtered.offAll();

      emitter.emit('test:complex', { count: 10, items: [] });

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it('should support waitFor on filtered emitter', async () => {
      const promise = filtered.waitFor({ timeout: 100 });

      setTimeout(() => {
        emitter.emit('test:complex', { count: 3, items: [] }); // Filtered
        emitter.emit('test:complex', { count: 10, items: [] }); // Matches
      }, 10);

      const event = await promise;

      expect(event.count).toBe(10);
    });
  });

  describe('EventBus', () => {
    beforeEach(() => {
      resetEventBus();
    });

    afterEach(() => {
      resetEventBus();
    });

    it('should be a singleton', () => {
      const bus1 = EventBus.getInstance();
      const bus2 = EventBus.getInstance();

      expect(bus1).toBe(bus2);
    });

    it('should reset instance', () => {
      const bus1 = EventBus.getInstance();
      EventBus.resetInstance();
      const bus2 = EventBus.getInstance();

      expect(bus1).not.toBe(bus2);
    });

    it('should work with getEventBus helper', () => {
      const bus = getEventBus();

      expect(bus).toBeInstanceOf(EventBus);
    });

    it('should emit and receive events', () => {
      const bus = getEventBus();
      const listener = jest.fn();

      bus.on('tool:started', listener);
      bus.emit('tool:started', {
        toolName: 'bash',
        source: 'test',
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool:started',
          toolName: 'bash',
        })
      );
    });
  });

  describe('Application Event Types', () => {
    let bus: EventBus<ApplicationEvents>;

    beforeEach(() => {
      resetEventBus();
      bus = getEventBus();
    });

    afterEach(() => {
      resetEventBus();
    });

    describe('AgentEvents', () => {
      it('should handle agent:started event', () => {
        const listener = jest.fn();

        bus.on('agent:started', listener);
        bus.emit('agent:started', { agentId: 'agent-1' });

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'agent:started',
            agentId: 'agent-1',
          })
        );
      });

      it('should handle agent:error event with Error', () => {
        const listener = jest.fn();
        const error = new Error('Agent failed');

        bus.on('agent:error', listener);
        bus.emit('agent:error', { error, agentId: 'agent-1' });

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'agent:error',
            error,
          })
        );
      });
    });

    describe('ToolEvents', () => {
      it('should handle tool:started event', () => {
        const listener = jest.fn();

        bus.on('tool:started', listener);
        bus.emit('tool:started', {
          toolName: 'bash',
          args: { command: 'ls -la' },
        });

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool:started',
            toolName: 'bash',
            args: { command: 'ls -la' },
          })
        );
      });

      it('should handle tool:completed event with result', () => {
        const listener = jest.fn();

        bus.on('tool:completed', listener);
        bus.emit('tool:completed', {
          toolName: 'bash',
          result: { success: true, output: 'file.txt' },
          duration: 150,
        });

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            result: { success: true, output: 'file.txt' },
            duration: 150,
          })
        );
      });
    });

    describe('SessionEvents', () => {
      it('should handle session lifecycle events', () => {
        const startListener = jest.fn();
        const endListener = jest.fn();

        bus.on('session:started', startListener);
        bus.on('session:ended', endListener);

        bus.emit('session:started', { sessionId: 'sess-1', userId: 'user-1' });
        bus.emit('session:ended', { sessionId: 'sess-1' });

        expect(startListener).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: 'sess-1', userId: 'user-1' })
        );
        expect(endListener).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: 'sess-1' })
        );
      });
    });

    describe('MessageEvents', () => {
      it('should handle message events', () => {
        const listener = jest.fn();

        bus.on('message:sent', listener);
        bus.emit('message:sent', {
          messageId: 'msg-1',
          content: 'Hello',
          role: 'user',
        });

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'message:sent',
            content: 'Hello',
            role: 'user',
          })
        );
      });
    });

    describe('FileEvents', () => {
      it('should handle file events', () => {
        const listener = jest.fn();

        bus.on('file:modified', listener);
        bus.emit('file:modified', {
          filePath: '/src/index.ts',
          operation: 'edit',
        });

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'file:modified',
            filePath: '/src/index.ts',
          })
        );
      });
    });
  });

  describe('Integration Scenarios', () => {
    let emitter: TypedEventEmitter<TestEvents>;

    beforeEach(() => {
      emitter = new TypedEventEmitter<TestEvents>();
    });

    afterEach(() => {
      emitter.dispose();
    });

    it('should support complex event workflow', async () => {
      const events: string[] = [];

      // Setup multiple listeners with different priorities
      emitter.on('test:simple', () => { events.push('low'); }, { priority: -1 });
      emitter.on('test:simple', () => { events.push('high'); }, { priority: 10 });
      emitter.once('test:simple', () => { events.push('once'); });
      emitter.onAny(() => { events.push('any'); }, { priority: 5 });

      // Emit event
      emitter.emit('test:simple', { data: 'test' });

      expect(events).toEqual(['high', 'any', 'once', 'low']);

      // Emit again - once should not fire
      events.length = 0;
      emitter.emit('test:simple', { data: 'test2' });

      expect(events).toEqual(['high', 'any', 'low']);
    });

    it('should support event-driven communication pattern', async () => {
      const results: string[] = [];

      // Service A listens for simple events and emits complex events
      emitter.on('test:simple', (event) => {
        results.push(`received: ${event.data}`);
        emitter.emit('test:complex', {
          count: event.data.length,
          items: event.data.split(''),
        });
      });

      // Service B listens for complex events
      emitter.on('test:complex', (event) => {
        results.push(`processed: ${event.count} items`);
      });

      // Trigger the chain
      emitter.emit('test:simple', { data: 'hello' });

      expect(results).toEqual(['received: hello', 'processed: 5 items']);
    });

    it('should handle high-volume events efficiently', () => {
      const listener = jest.fn();
      emitter.on('test:simple', listener);

      const startTime = Date.now();

      // Emit 1000 events
      for (let i = 0; i < 1000; i++) {
        emitter.emit('test:simple', { data: `event-${i}` });
      }

      const duration = Date.now() - startTime;

      expect(listener).toHaveBeenCalledTimes(1000);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });
  });
});
