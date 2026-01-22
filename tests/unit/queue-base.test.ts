/**
 * Unit Tests for Base Queue
 *
 * Tests covering:
 * - Basic FIFO queue operations
 * - Enqueue, dequeue, peek operations
 * - Batch operations
 * - Event emission
 * - Processing with retries
 * - Statistics and status
 */

import { Queue, QueueItem, QueueOptions } from '../../src/queue/queue';

// =============================================================================
// Test Utilities
// =============================================================================

interface TestData {
  id: number;
  value: string;
}

function createTestQueue(options: QueueOptions = {}): Queue<TestData> {
  return new Queue<TestData>({
    maxSize: 100,
    maxRetries: 3,
    retryDelay: 10, // Short delay for tests
    autoProcess: false,
    concurrency: 1,
    ...options,
  });
}

function createTestData(id: number): TestData {
  return { id, value: `value-${id}` };
}

// =============================================================================
// Queue Tests
// =============================================================================

describe('Queue', () => {
  let queue: Queue<TestData>;

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

    it('should use default options', () => {
      const q = new Queue<TestData>();
      const options = q.getOptions();

      expect(options.maxSize).toBe(1000);
      expect(options.maxRetries).toBe(3);
      expect(options.retryDelay).toBe(1000);
      expect(options.autoProcess).toBe(false);
      expect(options.concurrency).toBe(1);

      q.dispose();
    });

    it('should accept custom options', () => {
      const q = new Queue<TestData>({
        maxSize: 50,
        maxRetries: 5,
        retryDelay: 500,
        autoProcess: true,
        concurrency: 4,
      });

      const options = q.getOptions();
      expect(options.maxSize).toBe(50);
      expect(options.maxRetries).toBe(5);
      expect(options.retryDelay).toBe(500);
      expect(options.autoProcess).toBe(true);
      expect(options.concurrency).toBe(4);

      q.dispose();
    });
  });

  describe('enqueue', () => {
    it('should add item to queue', () => {
      const item = queue.enqueue(createTestData(1));

      expect(item).not.toBeNull();
      expect(queue.size()).toBe(1);
    });

    it('should generate unique IDs', () => {
      const item1 = queue.enqueue(createTestData(1));
      const item2 = queue.enqueue(createTestData(2));

      expect(item1?.id).not.toBe(item2?.id);
    });

    it('should set enqueuedAt timestamp', () => {
      const before = new Date();
      const item = queue.enqueue(createTestData(1));
      const after = new Date();

      expect(item?.enqueuedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(item?.enqueuedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should initialize attempts to 0', () => {
      const item = queue.enqueue(createTestData(1));

      expect(item?.attempts).toBe(0);
    });

    it('should store metadata', () => {
      const item = queue.enqueue(createTestData(1), { source: 'test' });

      expect(item?.metadata).toEqual({ source: 'test' });
    });

    it('should emit enqueue event', () => {
      const handler = jest.fn();
      queue.on('enqueue', handler);

      const item = queue.enqueue(createTestData(1));

      expect(handler).toHaveBeenCalledWith(item);
    });

    it('should return null when queue is full', () => {
      const q = createTestQueue({ maxSize: 2 });

      q.enqueue(createTestData(1));
      q.enqueue(createTestData(2));
      const item = q.enqueue(createTestData(3));

      expect(item).toBeNull();

      q.dispose();
    });

    it('should emit full event when queue is full', () => {
      const q = createTestQueue({ maxSize: 1 });
      const handler = jest.fn();
      q.on('full', handler);

      q.enqueue(createTestData(1));
      q.enqueue(createTestData(2));

      expect(handler).toHaveBeenCalled();

      q.dispose();
    });
  });

  describe('enqueueMany', () => {
    it('should add multiple items', () => {
      const items = queue.enqueueMany([
        createTestData(1),
        createTestData(2),
        createTestData(3),
      ]);

      expect(items).toHaveLength(3);
      expect(queue.size()).toBe(3);
    });

    it('should stop adding when queue becomes full', () => {
      const q = createTestQueue({ maxSize: 2 });

      const items = q.enqueueMany([
        createTestData(1),
        createTestData(2),
        createTestData(3),
      ]);

      expect(items).toHaveLength(2);
      expect(q.size()).toBe(2);

      q.dispose();
    });

    it('should return empty array for empty input', () => {
      const items = queue.enqueueMany([]);

      expect(items).toEqual([]);
    });
  });

  describe('dequeue', () => {
    it('should remove and return first item (FIFO)', () => {
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));
      queue.enqueue(createTestData(3));

      const item = queue.dequeue();

      expect(item?.data.id).toBe(1);
      expect(queue.size()).toBe(2);
    });

    it('should return undefined for empty queue', () => {
      const item = queue.dequeue();

      expect(item).toBeUndefined();
    });

    it('should emit dequeue event', () => {
      const handler = jest.fn();
      queue.on('dequeue', handler);

      const enqueued = queue.enqueue(createTestData(1));
      queue.dequeue();

      expect(handler).toHaveBeenCalledWith(enqueued);
    });

    it('should emit empty event when queue becomes empty', () => {
      const handler = jest.fn();
      queue.on('empty', handler);

      queue.enqueue(createTestData(1));
      queue.dequeue();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('dequeueMany', () => {
    beforeEach(() => {
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));
      queue.enqueue(createTestData(3));
    });

    it('should remove multiple items', () => {
      const items = queue.dequeueMany(2);

      expect(items).toHaveLength(2);
      expect(items[0].data.id).toBe(1);
      expect(items[1].data.id).toBe(2);
      expect(queue.size()).toBe(1);
    });

    it('should return all items if count exceeds size', () => {
      const items = queue.dequeueMany(10);

      expect(items).toHaveLength(3);
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return empty array for count of 0', () => {
      const items = queue.dequeueMany(0);

      expect(items).toEqual([]);
    });
  });

  describe('peek', () => {
    it('should return first item without removing', () => {
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));

      const item = queue.peek();

      expect(item?.data.id).toBe(1);
      expect(queue.size()).toBe(2);
    });

    it('should return undefined for empty queue', () => {
      expect(queue.peek()).toBeUndefined();
    });
  });

  describe('peekMany', () => {
    beforeEach(() => {
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));
      queue.enqueue(createTestData(3));
    });

    it('should return multiple items without removing', () => {
      const items = queue.peekMany(2);

      expect(items).toHaveLength(2);
      expect(items[0].data.id).toBe(1);
      expect(items[1].data.id).toBe(2);
      expect(queue.size()).toBe(3);
    });

    it('should return all items if count exceeds size', () => {
      const items = queue.peekMany(10);

      expect(items).toHaveLength(3);
    });
  });

  describe('getById', () => {
    it('should return item by ID', () => {
      const enqueued = queue.enqueue(createTestData(42));

      const item = queue.getById(enqueued!.id);

      expect(item).toBe(enqueued);
    });

    it('should return undefined for non-existent ID', () => {
      const item = queue.getById('nonexistent');

      expect(item).toBeUndefined();
    });
  });

  describe('removeById', () => {
    it('should remove item by ID', () => {
      const item = queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));

      const removed = queue.removeById(item!.id);

      expect(removed).toBe(true);
      expect(queue.size()).toBe(1);
      expect(queue.has(item!.id)).toBe(false);
    });

    it('should return false for non-existent ID', () => {
      const removed = queue.removeById('nonexistent');

      expect(removed).toBe(false);
    });

    it('should emit dequeue event', () => {
      const handler = jest.fn();
      queue.on('dequeue', handler);

      const item = queue.enqueue(createTestData(1));
      queue.removeById(item!.id);

      expect(handler).toHaveBeenCalledWith(item);
    });

    it('should emit empty event if queue becomes empty', () => {
      const handler = jest.fn();
      queue.on('empty', handler);

      const item = queue.enqueue(createTestData(1));
      queue.removeById(item!.id);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('has', () => {
    it('should return true for existing item', () => {
      const item = queue.enqueue(createTestData(1));

      expect(queue.has(item!.id)).toBe(true);
    });

    it('should return false for non-existent item', () => {
      expect(queue.has('nonexistent')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return correct size', () => {
      expect(queue.size()).toBe(0);

      queue.enqueue(createTestData(1));
      expect(queue.size()).toBe(1);

      queue.enqueue(createTestData(2));
      expect(queue.size()).toBe(2);

      queue.dequeue();
      expect(queue.size()).toBe(1);
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty queue', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return false for non-empty queue', () => {
      queue.enqueue(createTestData(1));

      expect(queue.isEmpty()).toBe(false);
    });
  });

  describe('isFull', () => {
    it('should return false when not full', () => {
      const q = createTestQueue({ maxSize: 10 });

      expect(q.isFull()).toBe(false);

      q.dispose();
    });

    it('should return true when full', () => {
      const q = createTestQueue({ maxSize: 2 });
      q.enqueue(createTestData(1));
      q.enqueue(createTestData(2));

      expect(q.isFull()).toBe(true);

      q.dispose();
    });
  });

  describe('clear', () => {
    it('should remove all items', () => {
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));
      queue.enqueue(createTestData(3));

      const count = queue.clear();

      expect(count).toBe(3);
      expect(queue.isEmpty()).toBe(true);
    });

    it('should emit empty event', () => {
      const handler = jest.fn();
      queue.on('empty', handler);

      queue.enqueue(createTestData(1));
      queue.clear();

      expect(handler).toHaveBeenCalled();
    });

    it('should return 0 for empty queue', () => {
      const count = queue.clear();

      expect(count).toBe(0);
    });
  });

  describe('getAll', () => {
    it('should return copy of items', () => {
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));

      const items1 = queue.getAll();
      const items2 = queue.getAll();

      expect(items1).not.toBe(items2);
      expect(items1).toEqual(items2);
    });

    it('should return items in FIFO order', () => {
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));
      queue.enqueue(createTestData(3));

      const items = queue.getAll();

      expect(items.map(i => i.data.id)).toEqual([1, 2, 3]);
    });
  });

  describe('filter', () => {
    beforeEach(() => {
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));
      queue.enqueue(createTestData(3));
      queue.enqueue(createTestData(4));
    });

    it('should filter items based on predicate', () => {
      const evenItems = queue.filter(item => item.data.id % 2 === 0);

      expect(evenItems).toHaveLength(2);
      expect(evenItems.map(i => i.data.id)).toEqual([2, 4]);
    });

    it('should not modify original queue', () => {
      queue.filter(item => item.data.id % 2 === 0);

      expect(queue.size()).toBe(4);
    });
  });

  describe('find', () => {
    beforeEach(() => {
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));
      queue.enqueue(createTestData(3));
    });

    it('should find item based on predicate', () => {
      const item = queue.find(i => i.data.id === 2);

      expect(item?.data.id).toBe(2);
    });

    it('should return undefined if not found', () => {
      const item = queue.find(i => i.data.id === 99);

      expect(item).toBeUndefined();
    });
  });

  describe('Processing', () => {
    describe('setProcessor', () => {
      it('should set processor function', () => {
        const processor = jest.fn().mockResolvedValue(true);

        queue.setProcessor(processor);

        expect(processor).not.toHaveBeenCalled();
      });

      it('should start processing if autoProcess and items exist', async () => {
        const q = createTestQueue({ autoProcess: true });
        q.enqueue(createTestData(1));

        const processor = jest.fn().mockResolvedValue(true);
        q.setProcessor(processor);

        // Wait for processing to start
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(processor).toHaveBeenCalled();

        q.dispose();
      });
    });

    describe('processQueue', () => {
      it('should process all items in order', async () => {
        const processed: number[] = [];
        queue.setProcessor(async (item) => {
          processed.push(item.id);
        });

        queue.enqueue(createTestData(1));
        queue.enqueue(createTestData(2));
        queue.enqueue(createTestData(3));

        await queue.processQueue();

        expect(processed).toEqual([1, 2, 3]);
      });

      it('should throw if no processor set', async () => {
        queue.enqueue(createTestData(1));

        await expect(queue.processQueue()).rejects.toThrow('No processor set');
      });

      it('should emit process event for each item', async () => {
        const handler = jest.fn();
        queue.on('process', handler);

        queue.setProcessor(async () => {});
        queue.enqueue(createTestData(1));
        queue.enqueue(createTestData(2));

        await queue.processQueue();

        expect(handler).toHaveBeenCalledTimes(2);
      });

      it('should emit processed event after successful processing', async () => {
        const handler = jest.fn();
        queue.on('processed', handler);

        queue.setProcessor(async () => 'result');
        queue.enqueue(createTestData(1));

        await queue.processQueue();

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ id: 1 }) }),
          'result'
        );
      });

      it('should emit drain event when processing completes', async () => {
        const handler = jest.fn();
        queue.on('drain', handler);

        queue.setProcessor(async () => {});
        queue.enqueue(createTestData(1));

        await queue.processQueue();

        expect(handler).toHaveBeenCalled();
      });

      it('should not process concurrently if already processing', async () => {
        let processingCount = 0;
        let maxConcurrent = 0;

        queue.setProcessor(async () => {
          processingCount++;
          maxConcurrent = Math.max(maxConcurrent, processingCount);
          await new Promise(resolve => setTimeout(resolve, 10));
          processingCount--;
        });

        queue.enqueue(createTestData(1));
        queue.enqueue(createTestData(2));

        // Start processing twice
        const p1 = queue.processQueue();
        const p2 = queue.processQueue();

        await Promise.all([p1, p2]);

        // With concurrency 1, maxConcurrent should be 1
        expect(maxConcurrent).toBe(1);
      });
    });

    describe('Concurrent Processing', () => {
      it('should process items concurrently', async () => {
        const q = createTestQueue({ concurrency: 3 });
        let maxConcurrent = 0;
        let currentConcurrent = 0;

        q.setProcessor(async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise(resolve => setTimeout(resolve, 20));
          currentConcurrent--;
        });

        for (let i = 0; i < 6; i++) {
          q.enqueue(createTestData(i));
        }

        await q.processQueue();

        expect(maxConcurrent).toBeLessThanOrEqual(3);

        q.dispose();
      });
    });

    describe('Retry Logic', () => {
      it('should retry failed items', async () => {
        let attempts = 0;
        queue.setProcessor(async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
        });

        queue.enqueue(createTestData(1));
        await queue.processQueue();

        expect(attempts).toBe(3);
      });

      it('should emit retry event', async () => {
        const handler = jest.fn();
        queue.on('retry', handler);

        let attempts = 0;
        queue.setProcessor(async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('Fail');
          }
        });

        queue.enqueue(createTestData(1));
        await queue.processQueue();

        expect(handler).toHaveBeenCalledWith(
          expect.anything(),
          1
        );
      });

      it('should emit error event after max retries', async () => {
        const handler = jest.fn();
        queue.on('error', handler);

        queue.setProcessor(async () => {
          throw new Error('Persistent failure');
        });

        queue.enqueue(createTestData(1));
        await queue.processQueue();

        expect(handler).toHaveBeenCalledWith(
          expect.anything(),
          expect.any(Error)
        );
      });

      it('should track attempts on item', async () => {
        let capturedItem: QueueItem<TestData> | undefined;

        queue.setProcessor(async () => {
          throw new Error('Always fail');
        });

        queue.on('error', (item: QueueItem<TestData>) => {
          capturedItem = item;
        });

        queue.enqueue(createTestData(1));
        await queue.processQueue();

        expect(capturedItem?.attempts).toBe(3);
      });

      it('should update lastAttemptAt on each attempt', async () => {
        const timestamps: Date[] = [];

        queue.on('process', (item) => {
          timestamps.push(new Date(item.lastAttemptAt!));
        });

        let count = 0;
        queue.setProcessor(async () => {
          count++;
          if (count < 2) {
            throw new Error('Fail');
          }
        });

        queue.enqueue(createTestData(1));
        await queue.processQueue();

        expect(timestamps).toHaveLength(2);
      });
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stats = queue.getStats();

      expect(stats).toEqual({
        size: 0,
        maxSize: 100,
        processed: 0,
        failed: 0,
        avgProcessingTime: 0,
        isProcessing: false,
      });
    });

    it('should track processed count', async () => {
      queue.setProcessor(async () => {});
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));

      await queue.processQueue();

      expect(queue.getStats().processed).toBe(2);
    });

    it('should track failed count', async () => {
      // Add error handler to prevent unhandled error
      queue.on('error', () => {});

      queue.setProcessor(async () => {
        throw new Error('Fail');
      });
      queue.enqueue(createTestData(1));

      await queue.processQueue();

      expect(queue.getStats().failed).toBe(1);
    });

    it('should calculate average processing time', async () => {
      queue.setProcessor(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });
      queue.enqueue(createTestData(1));

      await queue.processQueue();

      expect(queue.getStats().avgProcessingTime).toBeGreaterThan(0);
    });
  });

  describe('updateOptions', () => {
    it('should update options', () => {
      queue.updateOptions({ maxSize: 50 });

      expect(queue.getOptions().maxSize).toBe(50);
    });

    it('should preserve unchanged options', () => {
      queue.updateOptions({ maxSize: 50 });

      expect(queue.getOptions().maxRetries).toBe(3);
    });
  });

  describe('dispose', () => {
    it('should clear queue', () => {
      queue.enqueue(createTestData(1));
      queue.enqueue(createTestData(2));

      queue.dispose();

      expect(queue.isEmpty()).toBe(true);
    });

    it('should remove all listeners', () => {
      const handler = jest.fn();
      queue.on('enqueue', handler);

      queue.dispose();

      // Enqueue should not trigger handler after dispose
      queue.enqueue(createTestData(1));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('formatStatus', () => {
    it('should format status string', () => {
      queue.enqueue(createTestData(1));

      const status = queue.formatStatus();

      expect(status).toContain('QUEUE STATUS');
      expect(status).toContain('Size');
      expect(status).toContain('Processed');
      expect(status).toContain('Failed');
    });
  });
});

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Queue Edge Cases', () => {
  it('should handle rapid enqueue/dequeue cycles', () => {
    const queue = createTestQueue();

    for (let i = 0; i < 100; i++) {
      queue.enqueue(createTestData(i));
      if (i % 2 === 0) {
        queue.dequeue();
      }
    }

    expect(queue.size()).toBe(50);

    queue.dispose();
  });

  it('should handle processor that returns void', async () => {
    const queue = createTestQueue();
    queue.setProcessor(async () => {
      // No return value
    });
    queue.enqueue(createTestData(1));

    await expect(queue.processQueue()).resolves.toBeUndefined();

    queue.dispose();
  });

  it('should handle processor that throws non-Error', async () => {
    const queue = createTestQueue({ maxRetries: 1 });
    const handler = jest.fn();
    queue.on('error', handler);

    queue.setProcessor(async () => {
      throw 'string error';
    });
    queue.enqueue(createTestData(1));

    await queue.processQueue();

    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Error)
    );

    queue.dispose();
  });

  it('should handle large queue', () => {
    const queue = createTestQueue({ maxSize: 10000 });

    for (let i = 0; i < 1000; i++) {
      queue.enqueue(createTestData(i));
    }

    expect(queue.size()).toBe(1000);

    queue.dispose();
  });
});
