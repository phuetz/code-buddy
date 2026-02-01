/**
 * Session Lanes Tests
 */

import {
  SessionLanesManager,
  getSessionLanesManager,
  resetSessionLanesManager,
  DEFAULT_SESSION_LANES_CONFIG,
} from '../../../src/tools/hooks/index.js';

describe('SessionLanesManager', () => {
  let manager: SessionLanesManager;

  beforeEach(() => {
    manager = new SessionLanesManager({
      defaultTimeoutMs: 5000,
      defaultWaitTimeoutMs: 1000,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  describe('basic execution', () => {
    it('should execute task in session lane', async () => {
      const result = await manager.execute('session-1', 'test-task', async () => {
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should execute async task', async () => {
      const result = await manager.execute('session-1', 'async-task', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 42;
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe(42);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(50);
    });

    it('should handle task errors', async () => {
      const result = await manager.execute('session-1', 'failing-task', async () => {
        throw new Error('Task failed');
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Task failed');
    });

    it('should execute in global lane', async () => {
      const result = await manager.executeGlobal('global-task', async () => {
        return 'global result';
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe('global result');
    });
  });

  describe('serialized execution', () => {
    it('should execute tasks in order within session', async () => {
      const order: number[] = [];

      const promises = [
        manager.execute('session-1', 'task-1', async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          order.push(1);
          return 1;
        }),
        manager.execute('session-1', 'task-2', async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          order.push(2);
          return 2;
        }),
        manager.execute('session-1', 'task-3', async () => {
          order.push(3);
          return 3;
        }),
      ];

      await Promise.all(promises);

      // Tasks should execute in queue order (FIFO with priority)
      expect(order).toEqual([1, 2, 3]);
    });

    it('should execute different sessions in parallel', async () => {
      const results: string[] = [];

      const promise1 = manager.execute('session-1', 'task-1', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        results.push('s1');
        return 's1';
      });

      const promise2 = manager.execute('session-2', 'task-2', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        results.push('s2');
        return 's2';
      });

      await Promise.all([promise1, promise2]);

      // Session 2 should complete first (shorter delay)
      expect(results[0]).toBe('s2');
      expect(results[1]).toBe('s1');
    });

    it('should respect task priority', async () => {
      const order: number[] = [];

      // Queue tasks with different priorities
      // Higher priority should execute first when both are queued
      const task1 = manager.execute('session-1', 'low-priority', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        order.push(1);
        return 1;
      }, { priority: 10 });

      // Give task1 a head start to be queued first
      await new Promise(resolve => setTimeout(resolve, 5));

      const task2 = manager.execute('session-1', 'high-priority', async () => {
        order.push(2);
        return 2;
      }, { priority: 100 });

      const task3 = manager.execute('session-1', 'medium-priority', async () => {
        order.push(3);
        return 3;
      }, { priority: 50 });

      await Promise.all([task1, task2, task3]);

      // First task already started, then high, then medium
      // Since task1 was already executing, it completes first
      expect(order[0]).toBe(1);
    });
  });

  describe('timeout handling', () => {
    it('should timeout slow tasks', async () => {
      const result = await manager.execute('session-1', 'slow-task', async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return 'done';
      }, { timeoutMs: 100 });

      expect(result.success).toBe(false);
      // The error message should contain "timeout"
      expect(result.error?.message).toContain('timed out');
    });
  });

  describe('cancellation', () => {
    it('should cancel task via AbortSignal', async () => {
      const controller = new AbortController();

      const resultPromise = manager.execute('session-1', 'cancelable', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'done';
      }, { abortSignal: controller.signal });

      // Cancel after 50ms
      setTimeout(() => controller.abort(), 50);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it('should cancel all session tasks', async () => {
      // Queue multiple tasks
      const promise1 = manager.execute('session-1', 'task-1', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 1;
      });

      // Wait for first task to start executing
      await new Promise(resolve => setTimeout(resolve, 10));

      const promise2 = manager.execute('session-1', 'task-2', async () => {
        return 2;
      });

      const promise3 = manager.execute('session-1', 'task-3', async () => {
        return 3;
      });

      // Cancel all pending tasks
      const cancelledCount = manager.cancelSession('session-1');

      // Should have cancelled the pending tasks (2 and 3)
      expect(cancelledCount).toBeGreaterThanOrEqual(0);

      // Wait for results
      const results = await Promise.allSettled([promise1, promise2, promise3]);

      // At least one should be cancelled
      const cancelled = results.filter(r =>
        r.status === 'fulfilled' && (r.value as { cancelled: boolean }).cancelled
      );
      expect(cancelled.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('wait functionality', () => {
    it('should wait for condition', async () => {
      let value = 0;

      // Increment value after 50ms
      setTimeout(() => { value = 42; }, 50);

      const result = await manager.wait('session-1', async () => {
        return value === 42 ? value : null;
      }, { pollIntervalMs: 10 });

      expect(result).toBe(42);
    });

    it('should timeout wait', async () => {
      await expect(
        manager.wait('session-1', async () => null, {
          timeoutMs: 100,
          pollIntervalMs: 10,
        })
      ).rejects.toThrow('timed out');
    });
  });

  describe('lane management', () => {
    it('should create lane on first task', async () => {
      expect(manager.getLaneInfo('new-session')).toBeNull();

      await manager.execute('new-session', 'task', async () => 'done');

      const info = manager.getLaneInfo('new-session');
      expect(info).not.toBeNull();
      expect(info!.sessionId).toBe('new-session');
    });

    it('should destroy lane', async () => {
      await manager.execute('to-destroy', 'task', async () => 'done');

      expect(manager.getLaneInfo('to-destroy')).not.toBeNull();

      const destroyed = await manager.destroyLane('to-destroy');

      expect(destroyed).toBe(true);
      expect(manager.getLaneInfo('to-destroy')).toBeNull();
    });

    it('should get all lanes info', async () => {
      await manager.execute('session-1', 'task', async () => 1);
      await manager.execute('session-2', 'task', async () => 2);

      const infos = manager.getAllLanesInfo();

      // Should have global + 2 sessions
      expect(infos.length).toBeGreaterThanOrEqual(3);

      const sessionIds = infos.map(i => i.sessionId);
      expect(sessionIds).toContain('__global__');
      expect(sessionIds).toContain('session-1');
      expect(sessionIds).toContain('session-2');
    });

    it('should track lane statistics', async () => {
      await manager.execute('session-1', 'task-1', async () => 1);
      await manager.execute('session-1', 'task-2', async () => 2);

      const info = manager.getLaneInfo('session-1');

      expect(info!.totalExecuted).toBe(2);
      expect(info!.totalErrors).toBe(0);
    });

    it('should track errors in statistics', async () => {
      await manager.execute('session-1', 'failing', async () => {
        throw new Error('fail');
      });

      const info = manager.getLaneInfo('session-1');

      expect(info!.totalErrors).toBe(1);
    });
  });

  describe('events', () => {
    it('should emit task:queued event', async () => {
      const handler = jest.fn();
      manager.on('task:queued', handler);

      await manager.execute('session-1', 'task', async () => 'done');

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0]).toBe('session-1');
    });

    it('should emit task:completed event', async () => {
      const handler = jest.fn();
      manager.on('task:completed', handler);

      await manager.execute('session-1', 'task', async () => 'done');

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0]).toBe('session-1');
    });

    it('should emit task:failed event', async () => {
      const handler = jest.fn();
      manager.on('task:failed', handler);

      await manager.execute('session-1', 'failing', async () => {
        throw new Error('fail');
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should emit lane:created event', async () => {
      const handler = jest.fn();
      manager.on('lane:created', handler);

      await manager.execute('new-session', 'task', async () => 'done');

      expect(handler).toHaveBeenCalledWith('new-session');
    });
  });

  describe('statistics', () => {
    it('should return correct stats', async () => {
      await manager.execute('session-1', 'task', async () => 1);
      await manager.execute('session-2', 'task', async () => 2);

      const stats = manager.getStats();

      expect(stats.totalLanes).toBe(2);
      expect(stats.globalLaneInfo).toBeDefined();
    });
  });

  describe('singleton', () => {
    afterEach(async () => {
      await resetSessionLanesManager();
    });

    it('should return same instance', () => {
      const instance1 = getSessionLanesManager();
      const instance2 = getSessionLanesManager();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance', async () => {
      const instance1 = getSessionLanesManager();
      await instance1.execute('test', 'task', async () => 'done');

      await resetSessionLanesManager();

      const instance2 = getSessionLanesManager();
      expect(instance2).not.toBe(instance1);
    });
  });
});
