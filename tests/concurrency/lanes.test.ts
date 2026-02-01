/**
 * Session Lanes Tests
 */

import {
  SessionLane,
  LaneManager,
  getLaneManager,
  resetLaneManager,
  withLane,
  createLanedFunction,
  type LaneItem,
} from '../../src/concurrency/lanes.js';

describe('Session Lanes', () => {
  beforeEach(() => {
    resetLaneManager();
  });

  describe('SessionLane', () => {
    it('should create a lane with default config', () => {
      const lane = new SessionLane();
      expect(lane.getStatus()).toBe('idle');
      expect(lane.getQueueLength()).toBe(0);
    });

    it('should enqueue items', () => {
      const lane = new SessionLane({ autoStart: false });
      lane.setProcessor(async () => {});

      const item = lane.enqueue({ message: 'test' });

      expect(item.id).toBeDefined();
      expect(item.payload).toEqual({ message: 'test' });
      expect(lane.getQueueLength()).toBe(1);
    });

    it('should process items in FIFO order', async () => {
      const lane = new SessionLane();
      const results: number[] = [];

      lane.setProcessor(async (item) => {
        results.push(item.payload as number);
        await new Promise(r => setTimeout(r, 10));
      });

      lane.enqueue(1);
      lane.enqueue(2);
      lane.enqueue(3);

      await lane.drain();

      expect(results).toEqual([1, 2, 3]);
    });

    it('should emit events', async () => {
      const lane = new SessionLane();
      const events: string[] = [];

      lane.on('enqueue', () => events.push('enqueue'));
      lane.on('start', () => events.push('start'));
      lane.on('complete', () => events.push('complete'));
      lane.on('drain', () => events.push('drain'));

      lane.setProcessor(async () => {});
      lane.enqueue('test');

      await lane.drain();

      expect(events).toContain('enqueue');
      expect(events).toContain('start');
      expect(events).toContain('complete');
      expect(events).toContain('drain');
    });

    it('should handle processing errors', async () => {
      const lane = new SessionLane();
      let errorCaught = false;

      lane.on('error', () => {
        errorCaught = true;
      });

      lane.setProcessor(async () => {
        throw new Error('Test error');
      });

      lane.enqueue('test');
      await lane.drain();

      expect(errorCaught).toBe(true);
    });

    it('should pause and resume', async () => {
      const lane = new SessionLane();
      const results: number[] = [];

      lane.setProcessor(async (item) => {
        results.push(item.payload as number);
        await new Promise(r => setTimeout(r, 10));
      });

      lane.enqueue(1);
      lane.enqueue(2);
      lane.enqueue(3);

      // Start processing
      lane.startProcessing();

      // Pause after short delay
      await new Promise(r => setTimeout(r, 5));
      lane.pause();

      expect(lane.getStatus()).toBe('paused');

      // Resume
      lane.resume();
      await lane.drain();

      expect(results).toEqual([1, 2, 3]);
    });

    it('should clear pending items', () => {
      const lane = new SessionLane({ autoStart: false });
      lane.setProcessor(async () => {});

      lane.enqueue(1);
      lane.enqueue(2);
      lane.enqueue(3);

      const cleared = lane.clear();

      expect(cleared.length).toBe(3);
      expect(lane.getQueueLength()).toBe(0);
    });

    it('should respect queue size limit', () => {
      const lane = new SessionLane({ maxQueueSize: 2, autoStart: false });
      lane.setProcessor(async () => {});

      lane.enqueue(1);
      lane.enqueue(2);

      expect(() => lane.enqueue(3)).toThrow('Lane queue full');
    });

    it('should track current item', async () => {
      const lane = new SessionLane<string>();
      let capturedPayload: string | undefined;

      lane.setProcessor(async () => {
        const current = lane.getCurrentItem();
        if (current) {
          capturedPayload = current.payload;
        }
        await new Promise(r => setTimeout(r, 10));
      });

      lane.enqueue('test');
      await new Promise(r => setTimeout(r, 15));

      expect(capturedPayload).toBe('test');
    });
  });

  describe('LaneManager', () => {
    it('should create and manage lanes', () => {
      const manager = new LaneManager();

      const lane1 = manager.getLane('session-1');
      const lane2 = manager.getLane('session-2');

      expect(lane1).not.toBe(lane2);
      expect(manager.hasLane('session-1')).toBe(true);
      expect(manager.getActiveSessions()).toContain('session-1');
      expect(manager.getActiveSessions()).toContain('session-2');
    });

    it('should return same lane for same session', () => {
      const manager = new LaneManager();

      const lane1 = manager.getLane('session-1');
      const lane2 = manager.getLane('session-1');

      expect(lane1).toBe(lane2);
    });

    it('should remove lanes', () => {
      const manager = new LaneManager();

      manager.getLane('session-1');
      expect(manager.hasLane('session-1')).toBe(true);

      manager.removeLane('session-1');
      expect(manager.hasLane('session-1')).toBe(false);
    });

    it('should enqueue to specific session', async () => {
      const manager = new LaneManager();
      const results: string[] = [];

      manager.setDefaultProcessor(async (item) => {
        results.push(item.payload as string);
      });

      manager.enqueue('session-1', 'msg-1');
      manager.enqueue('session-2', 'msg-2');

      await manager.drainAll();

      expect(results).toContain('msg-1');
      expect(results).toContain('msg-2');
    });

    it('should get total pending', () => {
      const manager = new LaneManager({ autoStart: false });
      manager.setDefaultProcessor(async () => {});

      manager.enqueue('session-1', 'msg-1');
      manager.enqueue('session-1', 'msg-2');
      manager.enqueue('session-2', 'msg-3');

      expect(manager.getTotalPending()).toBe(3);
    });

    it('should pause and resume all', async () => {
      const manager = new LaneManager();

      manager.setDefaultProcessor(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      manager.enqueue('session-1', 'msg-1');
      manager.enqueue('session-2', 'msg-2');

      manager.pauseAll();

      const lane1 = manager.getLane('session-1');
      const lane2 = manager.getLane('session-2');

      expect(lane1.getStatus()).toBe('paused');
      expect(lane2.getStatus()).toBe('paused');

      manager.resumeAll();
      await manager.drainAll();
    });

    it('should provide statistics', () => {
      const manager = new LaneManager({ autoStart: false });
      manager.setDefaultProcessor(async () => {});

      manager.enqueue('session-1', 'msg-1');
      manager.enqueue('session-2', 'msg-2');

      const stats = manager.getStats();

      expect(stats.totalLanes).toBe(2);
      expect(stats.totalPending).toBe(2);
      expect(stats.lanes['session-1']).toBeDefined();
      expect(stats.lanes['session-2']).toBeDefined();
    });

    it('should clear all lanes', () => {
      const manager = new LaneManager({ autoStart: false });
      manager.setDefaultProcessor(async () => {});

      manager.enqueue('session-1', 'msg-1');
      manager.enqueue('session-2', 'msg-2');

      manager.clearAll();

      expect(manager.getActiveSessions()).toHaveLength(0);
    });
  });

  describe('getLaneManager / resetLaneManager', () => {
    it('should return singleton', () => {
      const manager1 = getLaneManager();
      const manager2 = getLaneManager();

      expect(manager1).toBe(manager2);
    });

    it('should reset singleton', () => {
      const manager1 = getLaneManager();
      resetLaneManager();
      const manager2 = getLaneManager();

      expect(manager1).not.toBe(manager2);
    });
  });

  describe('withLane', () => {
    it('should execute function with lane ordering', async () => {
      resetLaneManager();

      const result = await withLane('session-1', 'input', async (payload) => {
        return `processed: ${payload}`;
      });

      expect(result).toBe('processed: input');
    });
  });

  describe('createLanedFunction', () => {
    it('should create a lane-ordered function', async () => {
      resetLaneManager();
      const results: string[] = [];

      const lanedFn = createLanedFunction<{ session: string; value: string }, string>(
        (payload) => payload.session,
        async (payload) => {
          await new Promise(r => setTimeout(r, 10));
          results.push(payload.value);
          return payload.value;
        }
      );

      // Call multiple times for same session
      const p1 = lanedFn({ session: 'a', value: '1' });
      const p2 = lanedFn({ session: 'a', value: '2' });
      const p3 = lanedFn({ session: 'a', value: '3' });

      await Promise.all([p1, p2, p3]);

      // Should be processed in order
      expect(results).toEqual(['1', '2', '3']);
    });
  });

  describe('priority queue', () => {
    it('should process by priority when not FIFO', async () => {
      const lane = new SessionLane({ fifo: false, autoStart: false });
      const results: number[] = [];

      lane.setProcessor(async (item) => {
        results.push(item.payload as number);
      });

      lane.enqueue(1, { priority: 3 });
      lane.enqueue(2, { priority: 1 });
      lane.enqueue(3, { priority: 2 });

      lane.startProcessing();
      await lane.drain();

      // Lower priority number = higher priority = processed first
      expect(results).toEqual([2, 3, 1]);
    });
  });
});
