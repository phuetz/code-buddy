/**
 * Tool Throttle Tests
 */

import {
  throttle,
  ToolPhaseThrottler,
  resetToolPhaseThrottler,
} from '../../src/streaming/tool-throttle.js';
import type { ToolPhaseEvent } from '../../src/streaming/tool-phases.js';

describe('Tool Throttle', () => {
  describe('throttle function', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should execute immediately on first call', () => {
      const fn = jest.fn();
      const throttled = throttle(fn, { intervalMs: 100 });

      throttled('arg1');

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('arg1');
    });

    it('should throttle subsequent calls', () => {
      const fn = jest.fn();
      const throttled = throttle(fn, { intervalMs: 100 });

      throttled('call1');
      throttled('call2');
      throttled('call3');

      // First call executes immediately
      expect(fn).toHaveBeenCalledTimes(1);

      // After interval, trailing call executes
      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('call3');
    });

    it('should cancel pending calls', () => {
      const fn = jest.fn();
      const throttled = throttle(fn, { intervalMs: 100 });

      throttled('call1');
      throttled('call2');
      throttled.cancel();

      jest.advanceTimersByTime(200);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should flush pending calls', () => {
      const fn = jest.fn();
      const throttled = throttle(fn, { intervalMs: 100 });

      throttled('call1');
      throttled('call2');
      throttled.flush();

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('call2');
    });
  });

  describe('ToolPhaseThrottler', () => {
    let throttler: ToolPhaseThrottler;

    beforeEach(() => {
      resetToolPhaseThrottler();
      throttler = new ToolPhaseThrottler({ intervalMs: 100 });
      jest.useFakeTimers();
    });

    afterEach(() => {
      throttler.dispose();
      jest.useRealTimers();
    });

    const createEvent = (
      phase: 'start' | 'update' | 'result',
      toolCallId: string = 'tc-1',
      progress: number = 0
    ): ToolPhaseEvent => ({
      phase,
      toolCallId,
      toolName: 'test_tool',
      progress,
      timestamp: Date.now(),
    });

    describe('push', () => {
      it('should emit start events immediately', () => {
        const events: ToolPhaseEvent[] = [];
        throttler.setCallback((e) => events.push(e));

        throttler.push(createEvent('start'));

        expect(events.length).toBe(1);
        expect(events[0].phase).toBe('start');
      });

      it('should emit result events immediately', () => {
        const events: ToolPhaseEvent[] = [];
        throttler.setCallback((e) => events.push(e));

        throttler.push(createEvent('result'));

        expect(events.length).toBe(1);
        expect(events[0].phase).toBe('result');
      });

      it('should throttle update events', () => {
        const events: ToolPhaseEvent[] = [];
        throttler.setCallback((e) => events.push(e));

        // First update - emitted immediately
        throttler.push(createEvent('update', 'tc-1', 10));
        expect(events.length).toBe(1);

        // Second update - queued
        throttler.push(createEvent('update', 'tc-1', 50));
        expect(events.length).toBe(1);

        // Third update - queued (replaces second)
        throttler.push(createEvent('update', 'tc-1', 75));
        expect(events.length).toBe(1);

        // After interval - last queued event emitted
        jest.advanceTimersByTime(100);
        expect(events.length).toBe(2);
        expect(events[1].progress).toBe(75);
      });

      it('should handle multiple tool calls independently', () => {
        const events: ToolPhaseEvent[] = [];
        throttler.setCallback((e) => events.push(e));

        throttler.push(createEvent('update', 'tc-1', 10));
        throttler.push(createEvent('update', 'tc-2', 20));
        throttler.push(createEvent('update', 'tc-1', 30));
        throttler.push(createEvent('update', 'tc-2', 40));

        // Two immediate (first of each)
        expect(events.length).toBe(2);

        jest.advanceTimersByTime(100);

        // Two trailing (last of each)
        expect(events.length).toBe(4);
      });
    });

    describe('flushAll', () => {
      it('should emit all pending events', () => {
        const events: ToolPhaseEvent[] = [];
        throttler.setCallback((e) => events.push(e));

        throttler.push(createEvent('update', 'tc-1', 10));
        throttler.push(createEvent('update', 'tc-1', 50));
        throttler.push(createEvent('update', 'tc-2', 30));
        throttler.push(createEvent('update', 'tc-2', 60));

        expect(events.length).toBe(2); // First of each

        throttler.flushAll();

        expect(events.length).toBe(4); // All events
      });
    });

    describe('cancelAll', () => {
      it('should cancel all pending events', () => {
        const events: ToolPhaseEvent[] = [];
        throttler.setCallback((e) => events.push(e));

        throttler.push(createEvent('update', 'tc-1', 10));
        throttler.push(createEvent('update', 'tc-1', 50));

        expect(events.length).toBe(1);

        throttler.cancelAll();
        jest.advanceTimersByTime(100);

        expect(events.length).toBe(1); // No trailing event
      });
    });

    describe('setInterval', () => {
      it('should update throttle interval', () => {
        expect(throttler.getInterval()).toBe(100);

        throttler.setInterval(200);

        expect(throttler.getInterval()).toBe(200);
      });
    });
  });
});
