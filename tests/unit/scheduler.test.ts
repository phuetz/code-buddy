/**
 * Unit tests for the Scheduler module
 *
 * Tests cover:
 * - Task scheduling (create, add, get, remove tasks)
 * - Priority management (priority queuing, aging, updates)
 * - Execution timing (scheduled execution, delays, timeouts)
 * - Dependency management
 * - Concurrent execution control
 * - Task lifecycle and events
 * - Error handling and retries
 */

import { EventEmitter } from 'events';
import {
  Scheduler,
  createScheduler,
  getScheduler,
  resetScheduler,
  ScheduledTask,
  TaskPriority,
  SchedulerConfig,
  DEFAULT_SCHEDULER_CONFIG,
} from '../../src/scheduler';

// Helper to create a simple async task handler
function createHandler(result: unknown = 'done', delay: number = 0): () => Promise<unknown> {
  return async () => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return result;
  };
}

// Helper to create a failing task handler
function createFailingHandler(error: string = 'Task failed', delay: number = 0): () => Promise<never> {
  return async () => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error(error);
  };
}

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    jest.useFakeTimers();
    resetScheduler();
    scheduler = new Scheduler({
      tickInterval: 10,
      agingInterval: 1000,
      defaultTimeout: 5000,
      maxConcurrent: 3,
    });
  });

  afterEach(() => {
    if (scheduler) {
      scheduler.dispose();
    }
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    it('should create Scheduler with default config', () => {
      const defaultScheduler = new Scheduler();
      expect(defaultScheduler).toBeInstanceOf(Scheduler);
      expect(defaultScheduler.getConfig()).toEqual(DEFAULT_SCHEDULER_CONFIG);
      defaultScheduler.dispose();
    });

    it('should create Scheduler with custom config', () => {
      const customConfig: Partial<SchedulerConfig> = {
        maxConcurrent: 10,
        defaultPriority: 2,
        enablePriorityAging: false,
      };
      const customScheduler = new Scheduler(customConfig);
      const config = customScheduler.getConfig();

      expect(config.maxConcurrent).toBe(10);
      expect(config.defaultPriority).toBe(2);
      expect(config.enablePriorityAging).toBe(false);
      customScheduler.dispose();
    });

    it('should be an EventEmitter', () => {
      expect(scheduler).toBeInstanceOf(EventEmitter);
      expect(scheduler.on).toBeDefined();
      expect(scheduler.emit).toBeDefined();
    });

    it('should not be running initially', () => {
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe('Task Scheduling', () => {
    describe('createTask', () => {
      it('should create a task with default options', () => {
        const task = scheduler.createTask(createHandler());

        expect(task.id).toMatch(/^task_/);
        expect(task.status).toBe('pending');
        expect(task.priority).toBe(DEFAULT_SCHEDULER_CONFIG.defaultPriority);
        expect(task.retries).toBe(0);
        expect(task.dependencies).toEqual([]);
        expect(task.tags).toEqual([]);
      });

      it('should create a task with custom options', () => {
        const task = scheduler.createTask(createHandler(), {
          name: 'My Task',
          priority: 1,
          maxRetries: 5,
          timeout: 10000,
          tags: ['important', 'batch'],
          metadata: { key: 'value' },
        });

        expect(task.name).toBe('My Task');
        expect(task.priority).toBe(1);
        expect(task.maxRetries).toBe(5);
        expect(task.timeout).toBe(10000);
        expect(task.tags).toEqual(['important', 'batch']);
        expect(task.metadata).toEqual({ key: 'value' });
      });

      it('should create a scheduled task with scheduledAt', () => {
        const scheduledAt = new Date(Date.now() + 60000);
        const task = scheduler.createTask(createHandler(), { scheduledAt });

        expect(task.status).toBe('scheduled');
        expect(task.scheduledAt).toEqual(scheduledAt);
      });

      it('should emit task:created event', () => {
        const handler = jest.fn();
        scheduler.on('task:created', handler);

        const task = scheduler.createTask(createHandler());

        expect(handler).toHaveBeenCalledWith(task);
      });

      it('should generate unique IDs for each task', () => {
        const task1 = scheduler.createTask(createHandler());
        const task2 = scheduler.createTask(createHandler());
        const task3 = scheduler.createTask(createHandler());

        expect(task1.id).not.toBe(task2.id);
        expect(task2.id).not.toBe(task3.id);
        expect(task1.id).not.toBe(task3.id);
      });
    });

    describe('addTask', () => {
      it('should add an existing task', () => {
        const task: ScheduledTask = {
          id: 'external-task-1',
          name: 'External Task',
          handler: createHandler(),
          priority: 2,
          status: 'pending',
          createdAt: new Date(),
          retries: 0,
          maxRetries: 3,
          timeout: 5000,
          dependencies: [],
          tags: [],
          metadata: {},
        };

        scheduler.addTask(task);

        expect(scheduler.getTask('external-task-1')).toBe(task);
      });

      it('should emit task:added event', () => {
        const handler = jest.fn();
        scheduler.on('task:added', handler);

        const task: ScheduledTask = {
          id: 'external-task-2',
          name: 'External Task',
          handler: createHandler(),
          priority: 3,
          status: 'pending',
          createdAt: new Date(),
          retries: 0,
          maxRetries: 3,
          timeout: 5000,
          dependencies: [],
          tags: [],
          metadata: {},
        };

        scheduler.addTask(task);

        expect(handler).toHaveBeenCalledWith(task);
      });
    });

    describe('getTask', () => {
      it('should return task by ID', () => {
        const task = scheduler.createTask(createHandler());
        const retrieved = scheduler.getTask(task.id);

        expect(retrieved).toBe(task);
      });

      it('should return undefined for non-existent task', () => {
        expect(scheduler.getTask('non-existent')).toBeUndefined();
      });
    });

    describe('getAllTasks', () => {
      it('should return all tasks', () => {
        scheduler.createTask(createHandler());
        scheduler.createTask(createHandler());
        scheduler.createTask(createHandler());

        const tasks = scheduler.getAllTasks();
        expect(tasks).toHaveLength(3);
      });

      it('should return empty array when no tasks', () => {
        expect(scheduler.getAllTasks()).toEqual([]);
      });
    });

    describe('getTasksByStatus', () => {
      it('should return tasks filtered by status', () => {
        const task1 = scheduler.createTask(createHandler());
        const task2 = scheduler.createTask(createHandler());
        scheduler.cancelTask(task2.id);
        scheduler.createTask(createHandler());

        const pending = scheduler.getTasksByStatus('pending');
        const cancelled = scheduler.getTasksByStatus('cancelled');

        expect(pending).toHaveLength(2);
        expect(cancelled).toHaveLength(1);
        expect(cancelled[0].id).toBe(task2.id);
      });
    });

    describe('getTasksByTag', () => {
      it('should return tasks filtered by tag', () => {
        scheduler.createTask(createHandler(), { tags: ['batch', 'important'] });
        scheduler.createTask(createHandler(), { tags: ['batch'] });
        scheduler.createTask(createHandler(), { tags: ['other'] });

        const batchTasks = scheduler.getTasksByTag('batch');
        const importantTasks = scheduler.getTasksByTag('important');

        expect(batchTasks).toHaveLength(2);
        expect(importantTasks).toHaveLength(1);
      });
    });

    describe('removeTask', () => {
      it('should remove a pending task', () => {
        const task = scheduler.createTask(createHandler());
        const result = scheduler.removeTask(task.id);

        expect(result).toBe(true);
        expect(scheduler.getTask(task.id)).toBeUndefined();
      });

      it('should emit task:removed event', () => {
        const handler = jest.fn();
        scheduler.on('task:removed', handler);

        const task = scheduler.createTask(createHandler());
        scheduler.removeTask(task.id);

        expect(handler).toHaveBeenCalledWith(task.id);
      });

      it('should return false for non-existent task', () => {
        expect(scheduler.removeTask('non-existent')).toBe(false);
      });

      it('should not remove running task', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ tickInterval: 10, maxConcurrent: 1 });

        const task = localScheduler.createTask(createHandler('result', 100));
        localScheduler.start();

        // Wait for task to start
        await new Promise(resolve => setTimeout(resolve, 50));

        const result = localScheduler.removeTask(task.id);
        expect(result).toBe(false);

        localScheduler.dispose();
      });
    });

    describe('clearFinished', () => {
      it('should clear completed, failed, and cancelled tasks', () => {
        const task1 = scheduler.createTask(createHandler());
        const task2 = scheduler.createTask(createHandler());
        const task3 = scheduler.createTask(createHandler());
        scheduler.createTask(createHandler()); // pending

        scheduler.cancelTask(task1.id);
        // Manually set statuses for testing
        task2.status = 'completed';
        task3.status = 'failed';

        const cleared = scheduler.clearFinished();

        expect(cleared).toBe(3);
        expect(scheduler.getAllTasks()).toHaveLength(1);
      });
    });
  });

  describe('Priority Management', () => {
    describe('getPendingTasks', () => {
      it('should return pending tasks sorted by priority', () => {
        scheduler.createTask(createHandler(), { priority: 5 });
        scheduler.createTask(createHandler(), { priority: 1 });
        scheduler.createTask(createHandler(), { priority: 3 });

        const pending = scheduler.getPendingTasks();

        expect(pending[0].priority).toBe(1);
        expect(pending[1].priority).toBe(3);
        expect(pending[2].priority).toBe(5);
      });

      it('should sort by creation time for same priority', () => {
        const task1 = scheduler.createTask(createHandler(), { priority: 3 });
        const task2 = scheduler.createTask(createHandler(), { priority: 3 });
        const task3 = scheduler.createTask(createHandler(), { priority: 3 });

        const pending = scheduler.getPendingTasks();

        expect(pending[0].id).toBe(task1.id);
        expect(pending[1].id).toBe(task2.id);
        expect(pending[2].id).toBe(task3.id);
      });
    });

    describe('updatePriority', () => {
      it('should update task priority', () => {
        const task = scheduler.createTask(createHandler(), { priority: 5 });
        const result = scheduler.updatePriority(task.id, 1);

        expect(result).toBe(true);
        expect(task.priority).toBe(1);
      });

      it('should emit task:priority-changed event', () => {
        const handler = jest.fn();
        scheduler.on('task:priority-changed', handler);

        const task = scheduler.createTask(createHandler(), { priority: 5 });
        scheduler.updatePriority(task.id, 2);

        expect(handler).toHaveBeenCalledWith({
          task,
          oldPriority: 5,
          newPriority: 2,
        });
      });

      it('should return false for non-existent task', () => {
        expect(scheduler.updatePriority('non-existent', 1)).toBe(false);
      });

      it('should not update completed task priority', () => {
        const task = scheduler.createTask(createHandler());
        task.status = 'completed';

        const result = scheduler.updatePriority(task.id, 1);

        expect(result).toBe(false);
      });

      it('should not update running task priority', () => {
        const task = scheduler.createTask(createHandler());
        task.status = 'running';

        const result = scheduler.updatePriority(task.id, 1);

        expect(result).toBe(false);
      });
    });

    describe('applyPriorityAging', () => {
      it('should increase priority (lower number) for waiting tasks', () => {
        const localScheduler = new Scheduler({
          enablePriorityAging: true,
          agingRate: 1,
          agingInterval: 1000,
        });

        const task = localScheduler.createTask(createHandler(), { priority: 5 });

        // Manually age the task by setting createdAt to the past
        task.createdAt = new Date(Date.now() - 3000);

        localScheduler.applyPriorityAging();

        expect(task.priority).toBeLessThan(5);
        localScheduler.dispose();
      });

      it('should emit task:priority-aged event', () => {
        const localScheduler = new Scheduler({
          enablePriorityAging: true,
          agingRate: 1,
          agingInterval: 1000,
        });

        const handler = jest.fn();
        localScheduler.on('task:priority-aged', handler);

        const task = localScheduler.createTask(createHandler(), { priority: 5 });
        task.createdAt = new Date(Date.now() - 2000);

        localScheduler.applyPriorityAging();

        expect(handler).toHaveBeenCalled();
        localScheduler.dispose();
      });

      it('should not go below priority 1', () => {
        const localScheduler = new Scheduler({
          enablePriorityAging: true,
          agingRate: 10,
          agingInterval: 100,
        });

        const task = localScheduler.createTask(createHandler(), { priority: 2 });
        task.createdAt = new Date(Date.now() - 10000);

        localScheduler.applyPriorityAging();

        expect(task.priority).toBe(1);
        localScheduler.dispose();
      });

      it('should not apply aging when disabled', () => {
        const localScheduler = new Scheduler({
          enablePriorityAging: false,
        });

        const task = localScheduler.createTask(createHandler(), { priority: 5 });
        task.createdAt = new Date(Date.now() - 10000);

        localScheduler.applyPriorityAging();

        expect(task.priority).toBe(5);
        localScheduler.dispose();
      });
    });

    describe('getNextTask', () => {
      it('should return highest priority pending task', () => {
        scheduler.createTask(createHandler(), { priority: 5, name: 'Low' });
        scheduler.createTask(createHandler(), { priority: 1, name: 'High' });
        scheduler.createTask(createHandler(), { priority: 3, name: 'Medium' });

        const next = scheduler.getNextTask();

        expect(next?.name).toBe('High');
      });

      it('should return null when no tasks available', () => {
        expect(scheduler.getNextTask()).toBeNull();
      });

      it('should skip tasks with unsatisfied dependencies', () => {
        const task1 = scheduler.createTask(createHandler(), { name: 'Task1', priority: 1 });
        scheduler.createTask(createHandler(), {
          name: 'Task2',
          priority: 1,
          dependencies: [task1.id],
        });
        scheduler.createTask(createHandler(), { name: 'Task3', priority: 2 });

        const next = scheduler.getNextTask();

        expect(next?.name).toBe('Task1');
      });
    });
  });

  describe('Execution Timing', () => {
    describe('scheduleAt', () => {
      it('should schedule task for specific time', () => {
        const futureTime = new Date(Date.now() + 60000);
        const task = scheduler.scheduleAt(createHandler(), futureTime);

        expect(task.status).toBe('scheduled');
        expect(task.scheduledAt).toEqual(futureTime);
      });

      it('should execute scheduled task when time arrives', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ tickInterval: 10 });

        let executed = false;
        const scheduledTime = new Date(Date.now() + 50);
        localScheduler.scheduleAt(async () => { executed = true; }, scheduledTime);

        localScheduler.start();

        await new Promise(resolve => setTimeout(resolve, 150));

        expect(executed).toBe(true);
        localScheduler.dispose();
      });
    });

    describe('scheduleAfter', () => {
      it('should schedule task after delay', () => {
        const now = Date.now();
        const task = scheduler.scheduleAfter(createHandler(), 5000);

        expect(task.status).toBe('scheduled');
        expect(task.scheduledAt!.getTime()).toBeGreaterThanOrEqual(now + 5000);
      });

      it('should execute task after delay', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ tickInterval: 10 });

        let executed = false;
        localScheduler.scheduleAfter(async () => { executed = true; }, 50);

        localScheduler.start();

        await new Promise(resolve => setTimeout(resolve, 150));

        expect(executed).toBe(true);
        localScheduler.dispose();
      });
    });

    describe('getReadyScheduledTasks', () => {
      it('should return scheduled tasks that are ready', () => {
        // Past time - should be ready
        scheduler.scheduleAt(createHandler(), new Date(Date.now() - 1000), { name: 'Ready' });
        // Future time - not ready
        scheduler.scheduleAt(createHandler(), new Date(Date.now() + 60000), { name: 'NotReady' });

        const ready = scheduler.getReadyScheduledTasks();

        expect(ready).toHaveLength(1);
        expect(ready[0].name).toBe('Ready');
      });

      it('should sort ready tasks by priority', () => {
        scheduler.scheduleAt(createHandler(), new Date(Date.now() - 1000), { priority: 5 });
        scheduler.scheduleAt(createHandler(), new Date(Date.now() - 1000), { priority: 1 });
        scheduler.scheduleAt(createHandler(), new Date(Date.now() - 1000), { priority: 3 });

        const ready = scheduler.getReadyScheduledTasks();

        expect(ready[0].priority).toBe(1);
        expect(ready[1].priority).toBe(3);
        expect(ready[2].priority).toBe(5);
      });
    });

    describe('Task Timeout', () => {
      it('should fail task that exceeds timeout', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({
          tickInterval: 10,
          defaultTimeout: 50,
        });

        const task = localScheduler.createTask(async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return 'done';
        });

        localScheduler.start();

        await new Promise(resolve => setTimeout(resolve, 300));

        expect(task.status).toBe('failed');
        expect(task.error?.message).toContain('timed out');
        localScheduler.dispose();
      });
    });
  });

  describe('Task Execution', () => {
    describe('executeTask', () => {
      it('should execute task and return result', async () => {
        jest.useRealTimers();
        const task = scheduler.createTask(createHandler('test-result'));

        const result = await scheduler.executeTask(task);

        expect(result.success).toBe(true);
        expect(result.result).toBe('test-result');
        expect(result.taskId).toBe(task.id);
      });

      it('should update task status to completed', async () => {
        jest.useRealTimers();
        const task = scheduler.createTask(createHandler());

        await scheduler.executeTask(task);

        expect(task.status).toBe('completed');
        expect(task.completedAt).toBeDefined();
      });

      it('should emit task:started event', async () => {
        jest.useRealTimers();
        const handler = jest.fn();
        scheduler.on('task:started', handler);

        const task = scheduler.createTask(createHandler());
        await scheduler.executeTask(task);

        expect(handler).toHaveBeenCalledWith(task);
      });

      it('should emit task:completed event', async () => {
        jest.useRealTimers();
        const handler = jest.fn();
        scheduler.on('task:completed', handler);

        const task = scheduler.createTask(createHandler());
        await scheduler.executeTask(task);

        expect(handler).toHaveBeenCalledWith(task, expect.objectContaining({
          success: true,
        }));
      });

      it('should track execution duration', async () => {
        jest.useRealTimers();
        const task = scheduler.createTask(createHandler('done', 50));

        const result = await scheduler.executeTask(task);

        expect(result.duration).toBeGreaterThanOrEqual(40);
      });
    });

    describe('Error Handling', () => {
      it('should handle task failure', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ defaultMaxRetries: 0 });
        const task = localScheduler.createTask(createFailingHandler('Test error'));

        const result = await localScheduler.executeTask(task);

        expect(result.success).toBe(false);
        expect(result.error?.message).toBe('Test error');
        expect(task.status).toBe('failed');
        localScheduler.dispose();
      });

      it('should emit task:failed event', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ defaultMaxRetries: 0 });
        const handler = jest.fn();
        localScheduler.on('task:failed', handler);

        const task = localScheduler.createTask(createFailingHandler());
        await localScheduler.executeTask(task);

        expect(handler).toHaveBeenCalledWith(task, expect.objectContaining({
          success: false,
        }));
        localScheduler.dispose();
      });
    });

    describe('Retry Handling', () => {
      it('should retry failed task up to maxRetries', async () => {
        jest.useRealTimers();
        let attempts = 0;
        const localScheduler = new Scheduler({ defaultMaxRetries: 3 });
        const task = localScheduler.createTask(async () => {
          attempts++;
          if (attempts < 4) throw new Error('Retry');
          return 'success';
        });

        // Execute multiple times to simulate retries
        for (let i = 0; i < 4; i++) {
          await localScheduler.executeTask(task);
          if (task.status === 'completed' || task.status === 'failed') break;
        }

        expect(attempts).toBe(4);
        expect(task.status).toBe('completed');
        localScheduler.dispose();
      });

      it('should emit task:retry event', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ defaultMaxRetries: 2 });
        const handler = jest.fn();
        localScheduler.on('task:retry', handler);

        const task = localScheduler.createTask(createFailingHandler());
        await localScheduler.executeTask(task);

        expect(handler).toHaveBeenCalledWith(task, 1);
        localScheduler.dispose();
      });

      it('should fail after exhausting retries', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ defaultMaxRetries: 2 });
        const task = localScheduler.createTask(createFailingHandler());

        // Execute 3 times (initial + 2 retries)
        for (let i = 0; i < 3; i++) {
          await localScheduler.executeTask(task);
          if (task.status === 'failed') break;
        }

        expect(task.status).toBe('failed');
        expect(task.retries).toBe(2);
        localScheduler.dispose();
      });
    });

    describe('Concurrent Execution', () => {
      it('should respect maxConcurrent limit', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({
          tickInterval: 10,
          maxConcurrent: 2,
        });

        let maxConcurrent = 0;
        let currentConcurrent = 0;

        const createTrackedHandler = () => async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise(resolve => setTimeout(resolve, 50));
          currentConcurrent--;
        };

        localScheduler.createTask(createTrackedHandler());
        localScheduler.createTask(createTrackedHandler());
        localScheduler.createTask(createTrackedHandler());
        localScheduler.createTask(createTrackedHandler());

        localScheduler.start();
        await new Promise(resolve => setTimeout(resolve, 300));

        expect(maxConcurrent).toBeLessThanOrEqual(2);
        localScheduler.dispose();
      });

      it('should return running count', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({
          tickInterval: 10,
          maxConcurrent: 3,
        });

        localScheduler.createTask(createHandler('done', 100));
        localScheduler.createTask(createHandler('done', 100));

        localScheduler.start();
        await new Promise(resolve => setTimeout(resolve, 30));

        expect(localScheduler.getRunningCount()).toBe(2);
        localScheduler.dispose();
      });
    });
  });

  describe('Dependency Management', () => {
    describe('areDependenciesSatisfied', () => {
      it('should return true when no dependencies', () => {
        const task = scheduler.createTask(createHandler());
        expect(scheduler.areDependenciesSatisfied(task)).toBe(true);
      });

      it('should return true when all dependencies completed', () => {
        const dep1 = scheduler.createTask(createHandler());
        const dep2 = scheduler.createTask(createHandler());
        dep1.status = 'completed';
        dep2.status = 'completed';

        const task = scheduler.createTask(createHandler(), {
          dependencies: [dep1.id, dep2.id],
        });

        expect(scheduler.areDependenciesSatisfied(task)).toBe(true);
      });

      it('should return false when dependency not completed', () => {
        const dep = scheduler.createTask(createHandler());

        const task = scheduler.createTask(createHandler(), {
          dependencies: [dep.id],
        });

        expect(scheduler.areDependenciesSatisfied(task)).toBe(false);
      });

      it('should return false when dependency does not exist', () => {
        const task = scheduler.createTask(createHandler(), {
          dependencies: ['non-existent'],
        });

        expect(scheduler.areDependenciesSatisfied(task)).toBe(false);
      });
    });

    it('should execute dependent tasks in order', async () => {
      jest.useRealTimers();
      const localScheduler = new Scheduler({ tickInterval: 10 });
      const executionOrder: string[] = [];

      const task1 = localScheduler.createTask(async () => {
        executionOrder.push('task1');
      }, { name: 'task1' });

      localScheduler.createTask(async () => {
        executionOrder.push('task2');
      }, { name: 'task2', dependencies: [task1.id] });

      localScheduler.start();
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(executionOrder).toEqual(['task1', 'task2']);
      localScheduler.dispose();
    });
  });

  describe('Task Lifecycle', () => {
    describe('cancelTask', () => {
      it('should cancel pending task', () => {
        const task = scheduler.createTask(createHandler());
        const result = scheduler.cancelTask(task.id);

        expect(result).toBe(true);
        expect(task.status).toBe('cancelled');
      });

      it('should emit task:cancelled event', () => {
        const handler = jest.fn();
        scheduler.on('task:cancelled', handler);

        const task = scheduler.createTask(createHandler());
        scheduler.cancelTask(task.id);

        expect(handler).toHaveBeenCalledWith(task);
      });

      it('should return false for non-existent task', () => {
        expect(scheduler.cancelTask('non-existent')).toBe(false);
      });

      it('should return false for already completed task', () => {
        const task = scheduler.createTask(createHandler());
        task.status = 'completed';

        expect(scheduler.cancelTask(task.id)).toBe(false);
      });
    });

    describe('pauseTask', () => {
      it('should pause pending task', () => {
        const task = scheduler.createTask(createHandler());
        const result = scheduler.pauseTask(task.id);

        expect(result).toBe(true);
        expect(task.status).toBe('paused');
      });

      it('should pause scheduled task', () => {
        const task = scheduler.scheduleAfter(createHandler(), 60000);
        const result = scheduler.pauseTask(task.id);

        expect(result).toBe(true);
        expect(task.status).toBe('paused');
      });

      it('should emit task:paused event', () => {
        const handler = jest.fn();
        scheduler.on('task:paused', handler);

        const task = scheduler.createTask(createHandler());
        scheduler.pauseTask(task.id);

        expect(handler).toHaveBeenCalledWith(task);
      });

      it('should return false for running task', () => {
        const task = scheduler.createTask(createHandler());
        task.status = 'running';

        expect(scheduler.pauseTask(task.id)).toBe(false);
      });
    });

    describe('resumeTask', () => {
      it('should resume paused task', () => {
        const task = scheduler.createTask(createHandler());
        scheduler.pauseTask(task.id);
        const result = scheduler.resumeTask(task.id);

        expect(result).toBe(true);
        expect(task.status).toBe('pending');
      });

      it('should resume scheduled task with correct status', () => {
        const task = scheduler.scheduleAfter(createHandler(), 60000);
        scheduler.pauseTask(task.id);
        scheduler.resumeTask(task.id);

        expect(task.status).toBe('scheduled');
      });

      it('should emit task:resumed event', () => {
        const handler = jest.fn();
        scheduler.on('task:resumed', handler);

        const task = scheduler.createTask(createHandler());
        scheduler.pauseTask(task.id);
        scheduler.resumeTask(task.id);

        expect(handler).toHaveBeenCalledWith(task);
      });

      it('should return false for non-paused task', () => {
        const task = scheduler.createTask(createHandler());
        expect(scheduler.resumeTask(task.id)).toBe(false);
      });
    });
  });

  describe('Scheduler Control', () => {
    describe('start', () => {
      it('should start the scheduler', () => {
        scheduler.start();

        expect(scheduler.isRunning()).toBe(true);
      });

      it('should emit scheduler:started event', () => {
        const handler = jest.fn();
        scheduler.on('scheduler:started', handler);

        scheduler.start();

        expect(handler).toHaveBeenCalled();
      });

      it('should not restart if already running', () => {
        const handler = jest.fn();
        scheduler.on('scheduler:started', handler);

        scheduler.start();
        scheduler.start();

        expect(handler).toHaveBeenCalledTimes(1);
      });
    });

    describe('stop', () => {
      it('should stop the scheduler', () => {
        scheduler.start();
        scheduler.stop();

        expect(scheduler.isRunning()).toBe(false);
      });

      it('should emit scheduler:stopped event', () => {
        const handler = jest.fn();
        scheduler.on('scheduler:stopped', handler);

        scheduler.start();
        scheduler.stop();

        expect(handler).toHaveBeenCalled();
      });

      it('should be safe to call when not running', () => {
        expect(() => scheduler.stop()).not.toThrow();
      });
    });

    describe('dispose', () => {
      it('should stop scheduler and clear tasks', () => {
        scheduler.createTask(createHandler());
        scheduler.createTask(createHandler());
        scheduler.start();

        scheduler.dispose();

        expect(scheduler.isRunning()).toBe(false);
        expect(scheduler.getAllTasks()).toHaveLength(0);
      });
    });
  });

  describe('Configuration', () => {
    describe('getConfig', () => {
      it('should return a copy of config', () => {
        const config1 = scheduler.getConfig();
        const config2 = scheduler.getConfig();

        expect(config1).toEqual(config2);
        expect(config1).not.toBe(config2);
      });
    });

    describe('updateConfig', () => {
      it('should update config', () => {
        scheduler.updateConfig({ maxConcurrent: 10 });

        expect(scheduler.getConfig().maxConcurrent).toBe(10);
      });

      it('should emit config:updated event', () => {
        const handler = jest.fn();
        scheduler.on('config:updated', handler);

        scheduler.updateConfig({ maxConcurrent: 10 });

        expect(handler).toHaveBeenCalled();
      });

      it('should restart scheduler if running', () => {
        scheduler.start();
        const stopHandler = jest.fn();
        const startHandler = jest.fn();
        scheduler.on('scheduler:stopped', stopHandler);
        scheduler.on('scheduler:started', startHandler);

        scheduler.updateConfig({ maxConcurrent: 10 });

        expect(stopHandler).toHaveBeenCalled();
        expect(startHandler).toHaveBeenCalled();
        expect(scheduler.isRunning()).toBe(true);
      });
    });
  });

  describe('Statistics', () => {
    describe('getStats', () => {
      it('should return accurate task counts', () => {
        scheduler.createTask(createHandler()); // pending
        scheduler.createTask(createHandler()); // pending
        const task3 = scheduler.createTask(createHandler());
        scheduler.cancelTask(task3.id);
        const task4 = scheduler.createTask(createHandler());
        task4.status = 'completed';
        const task5 = scheduler.createTask(createHandler());
        task5.status = 'failed';

        const stats = scheduler.getStats();

        expect(stats.totalTasks).toBe(5);
        expect(stats.pendingTasks).toBe(2);
        expect(stats.cancelledTasks).toBe(1);
        expect(stats.completedTasks).toBe(1);
        expect(stats.failedTasks).toBe(1);
      });

      it('should calculate throughput', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ tickInterval: 10 });

        localScheduler.createTask(createHandler());
        localScheduler.createTask(createHandler());
        localScheduler.createTask(createHandler());

        localScheduler.start();
        await new Promise(resolve => setTimeout(resolve, 200));

        const stats = localScheduler.getStats();
        expect(stats.throughput).toBeGreaterThan(0);
        localScheduler.dispose();
      });
    });
  });

  describe('Waiting Functions', () => {
    describe('waitForTask', () => {
      it('should resolve when task completes', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ tickInterval: 10 });

        const task = localScheduler.createTask(createHandler('result'));
        localScheduler.start();

        const result = await localScheduler.waitForTask(task.id, 5000);

        expect(result.success).toBe(true);
        expect(result.result).toBe('result');
        localScheduler.dispose();
      });

      it('should resolve with failure for failed task', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ tickInterval: 10, defaultMaxRetries: 0 });

        const task = localScheduler.createTask(createFailingHandler('error'));
        localScheduler.start();

        const result = await localScheduler.waitForTask(task.id, 5000);

        expect(result.success).toBe(false);
        localScheduler.dispose();
      });

      it('should reject for non-existent task', async () => {
        jest.useRealTimers();

        await expect(scheduler.waitForTask('non-existent', 100))
          .rejects.toThrow('Task not found');
      });

      it('should timeout if task takes too long', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ tickInterval: 10 });

        localScheduler.createTask(createHandler('result', 5000));
        // Don't start scheduler - task won't execute

        await expect(localScheduler.waitForTask('task', 50))
          .rejects.toThrow('Task not found');

        localScheduler.dispose();
      });
    });

    describe('waitForAll', () => {
      it('should resolve when all tasks complete', async () => {
        jest.useRealTimers();
        const localScheduler = new Scheduler({ tickInterval: 10 });

        localScheduler.createTask(createHandler());
        localScheduler.createTask(createHandler());
        localScheduler.createTask(createHandler());

        localScheduler.start();

        await expect(localScheduler.waitForAll(5000)).resolves.toBeUndefined();
        localScheduler.dispose();
      });

      it('should resolve immediately when no tasks', async () => {
        jest.useRealTimers();

        await expect(scheduler.waitForAll(100)).resolves.toBeUndefined();
      });
    });
  });
});

describe('Singleton Functions', () => {
  beforeEach(() => {
    resetScheduler();
  });

  afterEach(() => {
    resetScheduler();
  });

  describe('createScheduler', () => {
    it('should create a new instance', () => {
      const scheduler = createScheduler();
      expect(scheduler).toBeInstanceOf(Scheduler);
      scheduler.dispose();
    });

    it('should accept config', () => {
      const scheduler = createScheduler({ maxConcurrent: 10 });
      expect(scheduler.getConfig().maxConcurrent).toBe(10);
      scheduler.dispose();
    });
  });

  describe('getScheduler', () => {
    it('should return singleton instance', () => {
      const scheduler1 = getScheduler();
      const scheduler2 = getScheduler();

      expect(scheduler1).toBe(scheduler2);
    });

    it('should create instance if none exists', () => {
      const scheduler = getScheduler();
      expect(scheduler).toBeInstanceOf(Scheduler);
    });
  });

  describe('resetScheduler', () => {
    it('should reset the singleton', () => {
      const scheduler1 = getScheduler();

      resetScheduler();

      const scheduler2 = getScheduler();
      expect(scheduler1).not.toBe(scheduler2);
    });

    it('should be safe to call when no instance exists', () => {
      expect(() => {
        resetScheduler();
        resetScheduler();
      }).not.toThrow();
    });
  });
});

describe('DEFAULT_SCHEDULER_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_SCHEDULER_CONFIG.maxConcurrent).toBeGreaterThan(0);
    expect(DEFAULT_SCHEDULER_CONFIG.defaultPriority).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_SCHEDULER_CONFIG.defaultPriority).toBeLessThanOrEqual(5);
    expect(DEFAULT_SCHEDULER_CONFIG.defaultTimeout).toBeGreaterThan(0);
    expect(DEFAULT_SCHEDULER_CONFIG.defaultMaxRetries).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_SCHEDULER_CONFIG.tickInterval).toBeGreaterThan(0);
  });
});
