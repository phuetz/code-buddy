/**
 * Unit Tests for Priority Queue
 *
 * Tests covering:
 * - Priority-based enqueueing and ordering
 * - Fair scheduling with priority boosting
 * - Priority escalation and de-escalation
 * - Filtering by priority level
 * - Statistics and status formatting
 */

import {
  PriorityQueue,
  createPriorityQueue,
  PriorityLevel,
  PriorityItem,
} from '../../src/queue/priority-queue';

// =============================================================================
// Test Utilities
// =============================================================================

interface TestTask {
  name: string;
  data: string;
}

function createTestQueue(options = {}): PriorityQueue<TestTask> {
  return new PriorityQueue<TestTask>({
    maxSize: 100,
    autoProcess: false,
    ...options,
  });
}

function createTask(name: string): TestTask {
  return { name, data: `data-${name}` };
}

// =============================================================================
// PriorityQueue Tests
// =============================================================================

describe('PriorityQueue', () => {
  let queue: PriorityQueue<TestTask>;

  beforeEach(() => {
    queue = createTestQueue();
  });

  afterEach(() => {
    queue.dispose();
  });

  describe('Constructor', () => {
    it('should create empty queue', () => {
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });

    it('should accept custom options', () => {
      const q = new PriorityQueue<TestTask>({
        maxSize: 50,
        defaultPriority: 'high',
        fairScheduling: true,
        maxWaitTime: 30000,
      });

      expect(q.getOptions().maxSize).toBe(50);
      q.dispose();
    });

    it('should default to normal priority', () => {
      const item = queue.enqueue(createTask('test'));

      expect((item as PriorityItem<TestTask>).priority).toBe('normal');
    });
  });

  describe('enqueuePriority', () => {
    it('should enqueue with specified priority', () => {
      const item = queue.enqueuePriority(createTask('test'), 'high');

      expect(item).not.toBeNull();
      expect(item?.priority).toBe('high');
      expect(item?.priorityValue).toBe(2);
    });

    it('should use default priority when not specified', () => {
      const q = new PriorityQueue<TestTask>({ defaultPriority: 'low' });
      const item = q.enqueuePriority(createTask('test'));

      expect(item?.priority).toBe('low');
      q.dispose();
    });

    it('should return null when queue is full', () => {
      const q = new PriorityQueue<TestTask>({ maxSize: 2 });
      q.enqueuePriority(createTask('1'), 'normal');
      q.enqueuePriority(createTask('2'), 'normal');

      const item = q.enqueuePriority(createTask('3'), 'normal');

      expect(item).toBeNull();
      q.dispose();
    });

    it('should emit full event when queue is full', () => {
      const q = new PriorityQueue<TestTask>({ maxSize: 1 });
      const handler = jest.fn();
      q.on('full', handler);

      q.enqueuePriority(createTask('1'), 'normal');
      q.enqueuePriority(createTask('2'), 'normal');

      expect(handler).toHaveBeenCalled();
      q.dispose();
    });

    it('should emit enqueue event', () => {
      const handler = jest.fn();
      queue.on('enqueue', handler);

      queue.enqueuePriority(createTask('test'), 'high');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 'high',
        })
      );
    });

    it('should store metadata', () => {
      const item = queue.enqueuePriority(
        createTask('test'),
        'normal',
        { source: 'api' }
      );

      expect(item?.metadata).toEqual({ source: 'api' });
    });
  });

  describe('enqueue (override)', () => {
    it('should use default priority', () => {
      const item = queue.enqueue(createTask('test'));

      expect((item as PriorityItem<TestTask>).priority).toBe('normal');
    });
  });

  describe('Priority Ordering', () => {
    it('should order items by priority (highest first)', () => {
      queue.enqueuePriority(createTask('low'), 'low');
      queue.enqueuePriority(createTask('critical'), 'critical');
      queue.enqueuePriority(createTask('high'), 'high');
      queue.enqueuePriority(createTask('normal'), 'normal');

      const items = queue.getAll();

      expect(items.map(i => i.priority)).toEqual([
        'critical',
        'high',
        'normal',
        'low',
      ]);
    });

    it('should maintain FIFO order within same priority', () => {
      queue.enqueuePriority(createTask('first'), 'normal');
      queue.enqueuePriority(createTask('second'), 'normal');
      queue.enqueuePriority(createTask('third'), 'normal');

      const items = queue.getAll();

      expect(items.map(i => i.data.name)).toEqual(['first', 'second', 'third']);
    });

    it('should insert high priority items before lower priority', () => {
      queue.enqueuePriority(createTask('normal1'), 'normal');
      queue.enqueuePriority(createTask('normal2'), 'normal');
      queue.enqueuePriority(createTask('high'), 'high');

      const items = queue.getAll();

      expect(items[0].data.name).toBe('high');
    });
  });

  describe('getByPriority', () => {
    beforeEach(() => {
      queue.enqueuePriority(createTask('low1'), 'low');
      queue.enqueuePriority(createTask('low2'), 'low');
      queue.enqueuePriority(createTask('high1'), 'high');
      queue.enqueuePriority(createTask('normal1'), 'normal');
    });

    it('should return items of specific priority', () => {
      const lowItems = queue.getByPriority('low');

      expect(lowItems).toHaveLength(2);
      expect(lowItems.every(i => i.priority === 'low')).toBe(true);
    });

    it('should return empty array for unused priority', () => {
      const criticalItems = queue.getByPriority('critical');

      expect(criticalItems).toEqual([]);
    });
  });

  describe('countByPriority', () => {
    it('should count items by priority level', () => {
      queue.enqueuePriority(createTask('1'), 'low');
      queue.enqueuePriority(createTask('2'), 'low');
      queue.enqueuePriority(createTask('3'), 'high');
      queue.enqueuePriority(createTask('4'), 'critical');

      const counts = queue.countByPriority();

      expect(counts).toEqual({
        low: 2,
        normal: 0,
        high: 1,
        critical: 1,
      });
    });

    it('should return zeros for empty queue', () => {
      const counts = queue.countByPriority();

      expect(counts).toEqual({
        low: 0,
        normal: 0,
        high: 0,
        critical: 0,
      });
    });
  });

  describe('updatePriority', () => {
    it('should update item priority and reorder', () => {
      const item = queue.enqueuePriority(createTask('test'), 'low');
      queue.enqueuePriority(createTask('other'), 'high');

      const result = queue.updatePriority(item!.id, 'critical');

      expect(result).toBe(true);

      const items = queue.getAll();
      expect(items[0].id).toBe(item!.id);
      expect(items[0].priority).toBe('critical');
    });

    it('should return false for non-existent item', () => {
      const result = queue.updatePriority('nonexistent', 'high');

      expect(result).toBe(false);
    });

    it('should update priorityValue correctly', () => {
      const item = queue.enqueuePriority(createTask('test'), 'low');

      queue.updatePriority(item!.id, 'critical');

      const updated = queue.getAll().find(i => i.id === item!.id);
      expect(updated?.priorityValue).toBe(3);
    });
  });

  describe('escalate', () => {
    it('should increase priority by one level', () => {
      const item = queue.enqueuePriority(createTask('test'), 'low');

      const result = queue.escalate(item!.id);

      expect(result).toBe(true);
      expect(queue.getAll()[0].priority).toBe('normal');
    });

    it('should escalate through all levels', () => {
      const item = queue.enqueuePriority(createTask('test'), 'low');

      queue.escalate(item!.id); // low -> normal
      queue.escalate(item!.id); // normal -> high
      queue.escalate(item!.id); // high -> critical

      expect(queue.getAll()[0].priority).toBe('critical');
    });

    it('should return false when already at critical', () => {
      const item = queue.enqueuePriority(createTask('test'), 'critical');

      const result = queue.escalate(item!.id);

      expect(result).toBe(false);
    });

    it('should return false for non-existent item', () => {
      const result = queue.escalate('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('deescalate', () => {
    it('should decrease priority by one level', () => {
      const item = queue.enqueuePriority(createTask('test'), 'high');

      const result = queue.deescalate(item!.id);

      expect(result).toBe(true);
      expect(queue.getAll()[0].priority).toBe('normal');
    });

    it('should deescalate through all levels', () => {
      const item = queue.enqueuePriority(createTask('test'), 'critical');

      queue.deescalate(item!.id); // critical -> high
      queue.deescalate(item!.id); // high -> normal
      queue.deescalate(item!.id); // normal -> low

      expect(queue.getAll()[0].priority).toBe('low');
    });

    it('should return false when already at low', () => {
      const item = queue.enqueuePriority(createTask('test'), 'low');

      const result = queue.deescalate(item!.id);

      expect(result).toBe(false);
    });

    it('should return false for non-existent item', () => {
      const result = queue.deescalate('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('peekHighest', () => {
    it('should return highest priority item without removing', () => {
      queue.enqueuePriority(createTask('low'), 'low');
      queue.enqueuePriority(createTask('critical'), 'critical');
      queue.enqueuePriority(createTask('high'), 'high');

      const item = queue.peekHighest();

      expect(item?.data.name).toBe('critical');
      expect(queue.size()).toBe(3);
    });

    it('should return undefined for empty queue', () => {
      expect(queue.peekHighest()).toBeUndefined();
    });
  });

  describe('peekLowest', () => {
    it('should return lowest priority item without removing', () => {
      queue.enqueuePriority(createTask('low'), 'low');
      queue.enqueuePriority(createTask('critical'), 'critical');
      queue.enqueuePriority(createTask('high'), 'high');

      const item = queue.peekLowest();

      expect(item?.data.name).toBe('low');
      expect(queue.size()).toBe(3);
    });

    it('should return undefined for empty queue', () => {
      expect(queue.peekLowest()).toBeUndefined();
    });
  });

  describe('dequeueWithMinPriority', () => {
    beforeEach(() => {
      queue.enqueuePriority(createTask('low'), 'low');
      queue.enqueuePriority(createTask('normal'), 'normal');
      queue.enqueuePriority(createTask('high'), 'high');
      queue.enqueuePriority(createTask('critical'), 'critical');
    });

    it('should dequeue only items with minimum priority', () => {
      const item = queue.dequeueWithMinPriority('high');

      expect(item?.priority).toBe('critical');
    });

    it('should return undefined if no items meet minimum', () => {
      // Remove high and critical
      queue.dequeueWithMinPriority('critical');

      const item = queue.dequeueWithMinPriority('critical');

      expect(item).toBeUndefined();
    });

    it('should emit dequeue event', () => {
      const handler = jest.fn();
      queue.on('dequeue', handler);

      queue.dequeueWithMinPriority('normal');

      expect(handler).toHaveBeenCalled();
    });

    it('should emit empty event when queue becomes empty', () => {
      const q = new PriorityQueue<TestTask>();
      q.enqueuePriority(createTask('test'), 'high');

      const handler = jest.fn();
      q.on('empty', handler);

      q.dequeueWithMinPriority('high');

      expect(handler).toHaveBeenCalled();
      q.dispose();
    });
  });

  describe('clearPriority', () => {
    beforeEach(() => {
      queue.enqueuePriority(createTask('low1'), 'low');
      queue.enqueuePriority(createTask('low2'), 'low');
      queue.enqueuePriority(createTask('high1'), 'high');
    });

    it('should remove all items of specific priority', () => {
      const removed = queue.clearPriority('low');

      expect(removed).toBe(2);
      expect(queue.getByPriority('low')).toHaveLength(0);
      expect(queue.getByPriority('high')).toHaveLength(1);
    });

    it('should return 0 if no items of priority exist', () => {
      const removed = queue.clearPriority('critical');

      expect(removed).toBe(0);
    });

    it('should emit empty event if queue becomes empty', () => {
      const q = new PriorityQueue<TestTask>();
      q.enqueuePriority(createTask('high'), 'high');

      const handler = jest.fn();
      q.on('empty', handler);

      q.clearPriority('high');

      expect(handler).toHaveBeenCalled();
      q.dispose();
    });
  });

  describe('Fair Scheduling', () => {
    it('should boost priority for long-waiting items', () => {
      const q = new PriorityQueue<TestTask>({
        fairScheduling: true,
        maxWaitTime: 100, // 100ms for testing
      });

      // Add low priority item with artificially old timestamp
      const item = q.enqueuePriority(createTask('old'), 'low');
      // Manually set old enqueued time
      (item as any).enqueuedAt = new Date(Date.now() - 200);

      // Add a new high priority item (triggers fair scheduling)
      q.enqueuePriority(createTask('new'), 'high');

      // The old item should have been boosted
      const items = q.getAll();
      const oldItem = items.find(i => i.data.name === 'old');

      expect(oldItem?.priorityValue).toBeGreaterThan(0);
      q.dispose();
    });

    it('should not exceed critical priority value', () => {
      const q = new PriorityQueue<TestTask>({
        fairScheduling: true,
        maxWaitTime: 10,
      });

      const item = q.enqueuePriority(createTask('old'), 'low');
      (item as any).enqueuedAt = new Date(Date.now() - 1000);

      // Trigger fair scheduling
      q.enqueuePriority(createTask('new'), 'high');

      const items = q.getAll();
      const oldItem = items.find(i => i.data.name === 'old');

      expect(oldItem?.priorityValue).toBeLessThanOrEqual(3);
      q.dispose();
    });
  });

  describe('getPriorityStats', () => {
    it('should return comprehensive stats', () => {
      queue.enqueuePriority(createTask('1'), 'low');
      queue.enqueuePriority(createTask('2'), 'high');
      queue.enqueuePriority(createTask('3'), 'critical');

      const stats = queue.getPriorityStats();

      expect(stats).toEqual({
        size: 3,
        byPriority: {
          low: 1,
          normal: 0,
          high: 1,
          critical: 1,
        },
        highestPriority: 'critical',
        lowestPriority: 'low',
      });
    });

    it('should return null priorities for empty queue', () => {
      const stats = queue.getPriorityStats();

      expect(stats.highestPriority).toBeNull();
      expect(stats.lowestPriority).toBeNull();
    });
  });

  describe('formatStatus', () => {
    it('should format status with priority breakdown', () => {
      queue.enqueuePriority(createTask('1'), 'low');
      queue.enqueuePriority(createTask('2'), 'critical');

      const status = queue.formatStatus();

      expect(status).toContain('PRIORITY QUEUE STATUS');
      expect(status).toContain('Critical');
      expect(status).toContain('High');
      expect(status).toContain('Normal');
      expect(status).toContain('Low');
    });
  });

  describe('getAll (override)', () => {
    it('should return copy of items array', () => {
      queue.enqueuePriority(createTask('test'), 'normal');

      const items1 = queue.getAll();
      const items2 = queue.getAll();

      expect(items1).not.toBe(items2);
      expect(items1).toEqual(items2);
    });

    it('should return items in priority order', () => {
      queue.enqueuePriority(createTask('low'), 'low');
      queue.enqueuePriority(createTask('high'), 'high');

      const items = queue.getAll();

      expect(items[0].priority).toBe('high');
      expect(items[1].priority).toBe('low');
    });
  });
});

// =============================================================================
// createPriorityQueue Helper Tests
// =============================================================================

describe('createPriorityQueue', () => {
  it('should create priority queue with default options', () => {
    const queue = createPriorityQueue<TestTask>();

    expect(queue).toBeInstanceOf(PriorityQueue);
    expect(queue.size()).toBe(0);

    queue.dispose();
  });

  it('should create priority queue with custom options', () => {
    const queue = createPriorityQueue<TestTask>({
      maxSize: 50,
      defaultPriority: 'high',
    });

    const item = queue.enqueue(createTask('test'));
    expect((item as PriorityItem<TestTask>).priority).toBe('high');

    queue.dispose();
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('PriorityQueue Integration', () => {
  it('should process items in priority order', async () => {
    const queue = new PriorityQueue<TestTask>({
      autoProcess: false,
      concurrency: 1,
    });

    const processed: string[] = [];

    queue.setProcessor(async (item) => {
      processed.push(item.name);
    });

    queue.enqueuePriority(createTask('low'), 'low');
    queue.enqueuePriority(createTask('critical'), 'critical');
    queue.enqueuePriority(createTask('normal'), 'normal');
    queue.enqueuePriority(createTask('high'), 'high');

    await queue.processQueue();

    expect(processed).toEqual(['critical', 'high', 'normal', 'low']);

    queue.dispose();
  });

  it('should handle mixed enqueue and processing', async () => {
    const queue = new PriorityQueue<TestTask>();
    const processed: string[] = [];

    queue.setProcessor(async (item) => {
      processed.push(item.name);
    });

    queue.enqueuePriority(createTask('first'), 'normal');
    await queue.processQueue();

    queue.enqueuePriority(createTask('urgent'), 'critical');
    queue.enqueuePriority(createTask('second'), 'normal');
    await queue.processQueue();

    expect(processed).toEqual(['first', 'urgent', 'second']);

    queue.dispose();
  });

  it('should handle escalation during processing', async () => {
    const queue = new PriorityQueue<TestTask>();

    queue.enqueuePriority(createTask('1'), 'low');
    queue.enqueuePriority(createTask('2'), 'low');
    const item3 = queue.enqueuePriority(createTask('3'), 'low');

    // Escalate item3 to critical
    queue.escalate(item3!.id);
    queue.escalate(item3!.id);
    queue.escalate(item3!.id);

    const items = queue.getAll();
    expect(items[0].data.name).toBe('3');

    queue.dispose();
  });
});
