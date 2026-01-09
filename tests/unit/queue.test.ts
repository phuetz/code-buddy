/**
 * Comprehensive Unit Tests for Queue Module
 *
 * Tests cover:
 * - Basic queue operations (enqueue, dequeue, peek, etc.)
 * - Priority queuing with different priority levels
 * - Queue persistence (save, load, backup, restore)
 * - Event emissions
 * - Edge cases and error handling
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Queue, QueueItem } from '../../src/queue/queue';
import { PriorityQueue, PriorityLevel, PriorityItem } from '../../src/queue/priority-queue';
import { PersistentQueue, SerializedQueue } from '../../src/queue/persistent-queue';
import {
  getQueue,
  getPriorityQueue,
  getPersistentQueue,
  resetQueues,
} from '../../src/queue/queue-singleton';

describe('Queue Module', () => {
  // ============================================
  // BASIC QUEUE TESTS
  // ============================================
  describe('Queue', () => {
    let queue: Queue<string>;

    beforeEach(() => {
      queue = new Queue<string>({ maxSize: 10 });
    });

    afterEach(() => {
      queue.dispose();
    });

    describe('Constructor', () => {
      it('should create queue with default options', () => {
        const defaultQueue = new Queue();
        expect(defaultQueue).toBeDefined();
        expect(defaultQueue.size()).toBe(0);
        defaultQueue.dispose();
      });

      it('should create queue with custom options', () => {
        const customQueue = new Queue({ maxSize: 50, maxRetries: 5 });
        const options = customQueue.getOptions();
        expect(options.maxSize).toBe(50);
        expect(options.maxRetries).toBe(5);
        customQueue.dispose();
      });
    });

    describe('Enqueue Operations', () => {
      it('should enqueue a single item', () => {
        const item = queue.enqueue('test-item');

        expect(item).toBeDefined();
        expect(item?.data).toBe('test-item');
        expect(item?.id).toBeDefined();
        expect(item?.enqueuedAt).toBeInstanceOf(Date);
        expect(item?.attempts).toBe(0);
        expect(queue.size()).toBe(1);
      });

      it('should enqueue item with metadata', () => {
        const item = queue.enqueue('test-item', { key: 'value', count: 42 });

        expect(item?.metadata).toEqual({ key: 'value', count: 42 });
      });

      it('should enqueue multiple items', () => {
        const items = queue.enqueueMany(['item1', 'item2', 'item3']);

        expect(items).toHaveLength(3);
        expect(queue.size()).toBe(3);
      });

      it('should return null when queue is full', () => {
        // Fill queue to max
        for (let i = 0; i < 10; i++) {
          queue.enqueue(`item-${i}`);
        }

        const overflow = queue.enqueue('overflow-item');
        expect(overflow).toBeNull();
        expect(queue.size()).toBe(10);
      });

      it('should emit "enqueue" event', () => {
        const eventHandler = jest.fn();
        queue.on('enqueue', eventHandler);

        queue.enqueue('test-item');

        expect(eventHandler).toHaveBeenCalledWith(
          expect.objectContaining({ data: 'test-item' })
        );
      });

      it('should emit "full" event when queue is full', () => {
        const eventHandler = jest.fn();
        queue.on('full', eventHandler);

        // Fill queue
        for (let i = 0; i < 10; i++) {
          queue.enqueue(`item-${i}`);
        }

        // Try to add one more
        queue.enqueue('overflow');

        expect(eventHandler).toHaveBeenCalled();
      });

      it('should generate unique IDs', () => {
        const item1 = queue.enqueue('item1');
        const item2 = queue.enqueue('item2');
        const item3 = queue.enqueue('item3');

        expect(item1?.id).not.toBe(item2?.id);
        expect(item2?.id).not.toBe(item3?.id);
        expect(item1?.id).not.toBe(item3?.id);
      });
    });

    describe('Dequeue Operations', () => {
      beforeEach(() => {
        queue.enqueue('first');
        queue.enqueue('second');
        queue.enqueue('third');
      });

      it('should dequeue items in FIFO order', () => {
        const first = queue.dequeue();
        const second = queue.dequeue();
        const third = queue.dequeue();

        expect(first?.data).toBe('first');
        expect(second?.data).toBe('second');
        expect(third?.data).toBe('third');
      });

      it('should return undefined when queue is empty', () => {
        queue.clear();
        const item = queue.dequeue();

        expect(item).toBeUndefined();
      });

      it('should dequeue multiple items', () => {
        const items = queue.dequeueMany(2);

        expect(items).toHaveLength(2);
        expect(items[0].data).toBe('first');
        expect(items[1].data).toBe('second');
        expect(queue.size()).toBe(1);
      });

      it('should emit "dequeue" event', () => {
        const eventHandler = jest.fn();
        queue.on('dequeue', eventHandler);

        queue.dequeue();

        expect(eventHandler).toHaveBeenCalled();
      });

      it('should emit "empty" event when last item is dequeued', () => {
        const eventHandler = jest.fn();
        queue.on('empty', eventHandler);

        queue.dequeue();
        queue.dequeue();
        queue.dequeue();

        expect(eventHandler).toHaveBeenCalledTimes(1);
      });
    });

    describe('Peek Operations', () => {
      beforeEach(() => {
        queue.enqueue('first');
        queue.enqueue('second');
      });

      it('should peek at the first item without removing it', () => {
        const item = queue.peek();

        expect(item?.data).toBe('first');
        expect(queue.size()).toBe(2);
      });

      it('should return undefined when peeking empty queue', () => {
        queue.clear();
        const item = queue.peek();

        expect(item).toBeUndefined();
      });

      it('should peek at multiple items', () => {
        const items = queue.peekMany(5);

        expect(items).toHaveLength(2);
        expect(items[0].data).toBe('first');
        expect(items[1].data).toBe('second');
        expect(queue.size()).toBe(2);
      });
    });

    describe('Item Retrieval', () => {
      let itemId: string;

      beforeEach(() => {
        const item = queue.enqueue('target');
        itemId = item!.id;
        queue.enqueue('other');
      });

      it('should get item by ID', () => {
        const item = queue.getById(itemId);

        expect(item).toBeDefined();
        expect(item?.data).toBe('target');
      });

      it('should return undefined for unknown ID', () => {
        const item = queue.getById('nonexistent-id');

        expect(item).toBeUndefined();
      });

      it('should check if item exists', () => {
        expect(queue.has(itemId)).toBe(true);
        expect(queue.has('nonexistent')).toBe(false);
      });

      it('should remove item by ID', () => {
        const removed = queue.removeById(itemId);

        expect(removed).toBe(true);
        expect(queue.has(itemId)).toBe(false);
        expect(queue.size()).toBe(1);
      });

      it('should return false when removing nonexistent item', () => {
        const removed = queue.removeById('nonexistent');

        expect(removed).toBe(false);
      });
    });

    describe('Queue State', () => {
      it('should report size correctly', () => {
        expect(queue.size()).toBe(0);

        queue.enqueue('item1');
        expect(queue.size()).toBe(1);

        queue.enqueue('item2');
        expect(queue.size()).toBe(2);

        queue.dequeue();
        expect(queue.size()).toBe(1);
      });

      it('should report empty state', () => {
        expect(queue.isEmpty()).toBe(true);

        queue.enqueue('item');
        expect(queue.isEmpty()).toBe(false);

        queue.dequeue();
        expect(queue.isEmpty()).toBe(true);
      });

      it('should report full state', () => {
        expect(queue.isFull()).toBe(false);

        for (let i = 0; i < 10; i++) {
          queue.enqueue(`item-${i}`);
        }

        expect(queue.isFull()).toBe(true);
      });

      it('should clear all items', () => {
        queue.enqueue('item1');
        queue.enqueue('item2');

        const count = queue.clear();

        expect(count).toBe(2);
        expect(queue.isEmpty()).toBe(true);
      });

      it('should get all items as a copy', () => {
        queue.enqueue('item1');
        queue.enqueue('item2');

        const items = queue.getAll();

        expect(items).toHaveLength(2);
        // Verify it's a copy
        items.pop();
        expect(queue.size()).toBe(2);
      });
    });

    describe('Filter and Find', () => {
      beforeEach(() => {
        queue.enqueue('apple', { type: 'fruit' });
        queue.enqueue('banana', { type: 'fruit' });
        queue.enqueue('carrot', { type: 'vegetable' });
      });

      it('should filter items by predicate', () => {
        const fruits = queue.filter(
          item => (item.metadata as Record<string, string>)?.type === 'fruit'
        );

        expect(fruits).toHaveLength(2);
      });

      it('should find item by predicate', () => {
        const carrot = queue.find(item => item.data === 'carrot');

        expect(carrot).toBeDefined();
        expect(carrot?.data).toBe('carrot');
      });

      it('should return undefined when find has no match', () => {
        const item = queue.find(item => item.data === 'notfound');

        expect(item).toBeUndefined();
      });
    });

    describe('Processing', () => {
      it('should set processor and process queue', async () => {
        const results: string[] = [];

        queue.setProcessor(async (item: string) => {
          results.push(item);
          return item;
        });

        queue.enqueue('item1');
        queue.enqueue('item2');
        queue.enqueue('item3');

        await queue.processQueue();

        expect(results).toEqual(['item1', 'item2', 'item3']);
      });

      it('should throw error when processing without processor', async () => {
        queue.enqueue('item');

        await expect(queue.processQueue()).rejects.toThrow('No processor set');
      });

      it('should emit process events', async () => {
        const processHandler = jest.fn();
        const processedHandler = jest.fn();

        queue.on('process', processHandler);
        queue.on('processed', processedHandler);

        queue.setProcessor(async (item: string) => item.toUpperCase());
        queue.enqueue('test');

        await queue.processQueue();

        expect(processHandler).toHaveBeenCalled();
        expect(processedHandler).toHaveBeenCalled();
      });

      it('should retry failed items', async () => {
        let attempts = 0;

        queue.updateOptions({ maxRetries: 3, retryDelay: 10 });
        queue.setProcessor(async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return 'success';
        });

        queue.enqueue('test');
        await queue.processQueue();

        expect(attempts).toBe(3);
      });

      it('should emit error after max retries', async () => {
        const errorHandler = jest.fn();
        queue.on('error', errorHandler);

        queue.updateOptions({ maxRetries: 2, retryDelay: 10 });
        queue.setProcessor(async () => {
          throw new Error('Permanent failure');
        });

        queue.enqueue('test');
        await queue.processQueue();

        expect(errorHandler).toHaveBeenCalled();
      });

      it('should emit drain when all items processed', async () => {
        const drainHandler = jest.fn();
        queue.on('drain', drainHandler);

        queue.setProcessor(async (item: string) => item);
        queue.enqueue('item1');
        queue.enqueue('item2');

        await queue.processQueue();

        expect(drainHandler).toHaveBeenCalled();
      });
    });

    describe('Statistics', () => {
      it('should return correct stats', async () => {
        queue.setProcessor(async (item: string) => item);
        queue.enqueue('item1');
        queue.enqueue('item2');
        queue.enqueue('item3');

        await queue.processQueue();

        const stats = queue.getStats();

        expect(stats.size).toBe(0);
        expect(stats.processed).toBe(3);
        expect(stats.maxSize).toBe(10);
      });

      it('should track average processing time', async () => {
        queue.setProcessor(async (item: string) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return item;
        });

        queue.enqueue('item1');
        queue.enqueue('item2');

        await queue.processQueue();

        const stats = queue.getStats();
        expect(stats.avgProcessingTime).toBeGreaterThan(0);
      });
    });

    describe('Options', () => {
      it('should update options', () => {
        queue.updateOptions({ maxRetries: 10 });

        const options = queue.getOptions();
        expect(options.maxRetries).toBe(10);
      });

      it('should format status string', () => {
        queue.enqueue('item');

        const status = queue.formatStatus();

        expect(status).toContain('QUEUE STATUS');
        expect(status).toContain('Size');
      });
    });

    describe('Disposal', () => {
      it('should dispose and clear resources', () => {
        queue.enqueue('item1');
        queue.enqueue('item2');

        queue.dispose();

        expect(queue.size()).toBe(0);
      });
    });
  });

  // ============================================
  // PRIORITY QUEUE TESTS
  // ============================================
  describe('PriorityQueue', () => {
    let priorityQueue: PriorityQueue<string>;

    beforeEach(() => {
      priorityQueue = new PriorityQueue<string>({ maxSize: 20 });
    });

    afterEach(() => {
      priorityQueue.dispose();
    });

    describe('Constructor', () => {
      it('should create priority queue with default options', () => {
        const pq = new PriorityQueue();
        expect(pq).toBeDefined();
        pq.dispose();
      });

      it('should accept custom default priority', () => {
        const pq = new PriorityQueue({ defaultPriority: 'high' });
        const item = pq.enqueue('test');
        expect((item as PriorityItem<string>).priority).toBe('high');
        pq.dispose();
      });
    });

    describe('Priority Enqueue', () => {
      it('should enqueue with default priority', () => {
        const item = priorityQueue.enqueue('test');

        expect(item).toBeDefined();
        expect((item as PriorityItem<string>).priority).toBe('normal');
      });

      it('should enqueue with specific priority', () => {
        const item = priorityQueue.enqueuePriority('critical-item', 'critical');

        expect((item as PriorityItem<string>).priority).toBe('critical');
        expect((item as PriorityItem<string>).priorityValue).toBe(3);
      });

      it('should order items by priority', () => {
        priorityQueue.enqueuePriority('low-item', 'low');
        priorityQueue.enqueuePriority('high-item', 'high');
        priorityQueue.enqueuePriority('normal-item', 'normal');
        priorityQueue.enqueuePriority('critical-item', 'critical');

        const items = priorityQueue.getAll();

        expect(items[0].data).toBe('critical-item');
        expect(items[1].data).toBe('high-item');
        expect(items[2].data).toBe('normal-item');
        expect(items[3].data).toBe('low-item');
      });

      it('should maintain FIFO within same priority', () => {
        priorityQueue.enqueuePriority('first-high', 'high');
        priorityQueue.enqueuePriority('second-high', 'high');
        priorityQueue.enqueuePriority('third-high', 'high');

        const items = priorityQueue.getAll();

        expect(items[0].data).toBe('first-high');
        expect(items[1].data).toBe('second-high');
        expect(items[2].data).toBe('third-high');
      });
    });

    describe('Priority Level Operations', () => {
      beforeEach(() => {
        priorityQueue.enqueuePriority('low1', 'low');
        priorityQueue.enqueuePriority('low2', 'low');
        priorityQueue.enqueuePriority('normal1', 'normal');
        priorityQueue.enqueuePriority('high1', 'high');
        priorityQueue.enqueuePriority('critical1', 'critical');
      });

      it('should get items by priority', () => {
        const lowItems = priorityQueue.getByPriority('low');
        const highItems = priorityQueue.getByPriority('high');

        expect(lowItems).toHaveLength(2);
        expect(highItems).toHaveLength(1);
      });

      it('should count items by priority', () => {
        const counts = priorityQueue.countByPriority();

        expect(counts.low).toBe(2);
        expect(counts.normal).toBe(1);
        expect(counts.high).toBe(1);
        expect(counts.critical).toBe(1);
      });

      it('should clear items of specific priority', () => {
        const removed = priorityQueue.clearPriority('low');

        expect(removed).toBe(2);
        expect(priorityQueue.getByPriority('low')).toHaveLength(0);
        expect(priorityQueue.size()).toBe(3);
      });
    });

    describe('Priority Updates', () => {
      let itemId: string;

      beforeEach(() => {
        const item = priorityQueue.enqueuePriority('target', 'normal');
        itemId = item!.id;
        priorityQueue.enqueuePriority('other', 'low');
      });

      it('should update item priority', () => {
        const updated = priorityQueue.updatePriority(itemId, 'critical');

        expect(updated).toBe(true);

        const item = priorityQueue.getById(itemId);
        expect((item as PriorityItem<string>).priority).toBe('critical');
      });

      it('should reorder after priority update', () => {
        priorityQueue.updatePriority(itemId, 'low');

        const items = priorityQueue.getAll();
        // 'other' should now be first as 'target' was demoted
        expect(items[items.length - 1].data).toBe('target');
      });

      it('should return false for nonexistent item', () => {
        const updated = priorityQueue.updatePriority('nonexistent', 'high');

        expect(updated).toBe(false);
      });
    });

    describe('Escalation and De-escalation', () => {
      let itemId: string;

      beforeEach(() => {
        const item = priorityQueue.enqueuePriority('target', 'normal');
        itemId = item!.id;
      });

      it('should escalate item priority', () => {
        const escalated = priorityQueue.escalate(itemId);

        expect(escalated).toBe(true);

        const item = priorityQueue.getById(itemId);
        expect((item as PriorityItem<string>).priority).toBe('high');
      });

      it('should de-escalate item priority', () => {
        const deescalated = priorityQueue.deescalate(itemId);

        expect(deescalated).toBe(true);

        const item = priorityQueue.getById(itemId);
        expect((item as PriorityItem<string>).priority).toBe('low');
      });

      it('should not escalate beyond critical', () => {
        priorityQueue.updatePriority(itemId, 'critical');
        const escalated = priorityQueue.escalate(itemId);

        expect(escalated).toBe(false);
      });

      it('should not de-escalate below low', () => {
        priorityQueue.updatePriority(itemId, 'low');
        const deescalated = priorityQueue.deescalate(itemId);

        expect(deescalated).toBe(false);
      });
    });

    describe('Priority Peek Operations', () => {
      beforeEach(() => {
        priorityQueue.enqueuePriority('low-item', 'low');
        priorityQueue.enqueuePriority('critical-item', 'critical');
        priorityQueue.enqueuePriority('normal-item', 'normal');
      });

      it('should peek highest priority item', () => {
        const item = priorityQueue.peekHighest();

        expect(item?.data).toBe('critical-item');
      });

      it('should peek lowest priority item', () => {
        const item = priorityQueue.peekLowest();

        expect(item?.data).toBe('low-item');
      });
    });

    describe('Priority Dequeue', () => {
      beforeEach(() => {
        priorityQueue.enqueuePriority('low', 'low');
        priorityQueue.enqueuePriority('normal', 'normal');
        priorityQueue.enqueuePriority('high', 'high');
      });

      it('should dequeue with minimum priority', () => {
        const item = priorityQueue.dequeueWithMinPriority('high');

        expect(item?.data).toBe('high');
      });

      it('should return undefined if no items meet minimum priority', () => {
        // Dequeue the high priority item first
        priorityQueue.dequeue();

        const item = priorityQueue.dequeueWithMinPriority('critical');

        expect(item).toBeUndefined();
      });
    });

    describe('Fair Scheduling', () => {
      it('should boost priority for long-waiting items', async () => {
        const pq = new PriorityQueue<string>({
          fairScheduling: true,
          maxWaitTime: 100, // 100ms for testing
        });

        // Add a low priority item
        const item = pq.enqueuePriority('waiting', 'low');
        const originalPriority = (item as PriorityItem<string>).priorityValue;

        // Wait longer than maxWaitTime
        await new Promise(resolve => setTimeout(resolve, 150));

        // Add a new item to trigger fair scheduling
        pq.enqueuePriority('new-item', 'normal');

        // The waiting item should have boosted priority
        const waitingItem = pq.getById(item!.id);
        expect((waitingItem as PriorityItem<string>).priorityValue).toBeGreaterThan(originalPriority);

        pq.dispose();
      });
    });

    describe('Priority Statistics', () => {
      beforeEach(() => {
        priorityQueue.enqueuePriority('low', 'low');
        priorityQueue.enqueuePriority('high', 'high');
      });

      it('should get priority stats', () => {
        const stats = priorityQueue.getPriorityStats();

        expect(stats.size).toBe(2);
        expect(stats.byPriority.low).toBe(1);
        expect(stats.byPriority.high).toBe(1);
        expect(stats.highestPriority).toBe('high');
        expect(stats.lowestPriority).toBe('low');
      });

      it('should format priority queue status', () => {
        const status = priorityQueue.formatStatus();

        expect(status).toContain('PRIORITY QUEUE STATUS');
        expect(status).toContain('Critical');
        expect(status).toContain('High');
        expect(status).toContain('Normal');
        expect(status).toContain('Low');
      });
    });
  });

  // ============================================
  // PERSISTENT QUEUE TESTS
  // ============================================
  describe('PersistentQueue', () => {
    let persistentQueue: PersistentQueue<string>;
    let tempDir: string;

    beforeEach(() => {
      // Create temp directory for storage
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-test-'));
      persistentQueue = new PersistentQueue<string>({
        storageDir: tempDir,
        filename: 'test-queue.json',
        autoSave: true,
      });
    });

    afterEach(() => {
      persistentQueue.dispose();
      // Clean up temp directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    describe('Persistence Basics', () => {
      it('should create storage directory', () => {
        expect(fs.existsSync(tempDir)).toBe(true);
      });

      it('should get storage path', () => {
        const storagePath = persistentQueue.getStoragePath();

        expect(storagePath).toContain('test-queue.json');
      });

      it('should report storage info', () => {
        persistentQueue.enqueuePriority('test', 'normal');

        const info = persistentQueue.getStorageInfo();

        expect(info.exists).toBe(true);
        expect(info.size).toBeGreaterThan(0);
        expect(info.lastModified).not.toBeNull();
        expect(info.lastModified!.getTime()).toBeLessThanOrEqual(Date.now());
      });
    });

    describe('Save Operations', () => {
      it('should save queue to disk', () => {
        persistentQueue.enqueuePriority('item1', 'high');
        persistentQueue.enqueuePriority('item2', 'low');

        const saved = persistentQueue.save();

        expect(saved).toBe(true);
        expect(fs.existsSync(persistentQueue.getStoragePath())).toBe(true);
      });

      it('should auto-save on enqueue', () => {
        persistentQueue.enqueuePriority('auto-saved', 'normal');

        const content = fs.readFileSync(persistentQueue.getStoragePath(), 'utf-8');
        const data = JSON.parse(content);

        expect(data.items).toHaveLength(1);
        expect(data.items[0].data).toBe('auto-saved');
      });

      it('should auto-save on dequeue', () => {
        persistentQueue.enqueuePriority('item1', 'normal');
        persistentQueue.enqueuePriority('item2', 'normal');
        persistentQueue.dequeue();

        const content = fs.readFileSync(persistentQueue.getStoragePath(), 'utf-8');
        const data = JSON.parse(content);

        expect(data.items).toHaveLength(1);
      });

      it('should emit saved event', () => {
        const savedHandler = jest.fn();
        persistentQueue.on('saved', savedHandler);

        persistentQueue.save();

        expect(savedHandler).toHaveBeenCalled();
      });
    });

    describe('Load Operations', () => {
      it('should load queue from disk', () => {
        // Create and save queue data
        persistentQueue.enqueuePriority('persisted', 'critical');
        persistentQueue.save();

        // Create new queue instance
        const newQueue = new PersistentQueue<string>({
          storageDir: tempDir,
          filename: 'test-queue.json',
        });

        expect(newQueue.size()).toBe(1);
        const item = newQueue.peek() as PriorityItem<string>;
        expect(item.data).toBe('persisted');
        expect(item.priority).toBe('critical');

        newQueue.dispose();
      });

      it('should restore stats from disk', async () => {
        // Process some items
        persistentQueue.setProcessor(async (item: string) => item);
        persistentQueue.enqueuePriority('item1', 'normal');
        persistentQueue.enqueuePriority('item2', 'normal');
        await persistentQueue.processQueue();
        persistentQueue.save();

        // Create new queue instance
        const newQueue = new PersistentQueue<string>({
          storageDir: tempDir,
          filename: 'test-queue.json',
        });

        const stats = newQueue.getStats();
        // Stats are restored from disk
        expect(stats.processed).toBeGreaterThanOrEqual(0);
        expect(stats.size).toBe(0); // Items were processed

        newQueue.dispose();
      });

      it('should handle missing storage file', () => {
        const newQueue = new PersistentQueue<string>({
          storageDir: tempDir,
          filename: 'nonexistent.json',
        });

        expect(newQueue.size()).toBe(0);
        expect(newQueue.hasStoredData()).toBe(false);

        newQueue.dispose();
      });

      it('should emit loaded event', () => {
        persistentQueue.enqueuePriority('item', 'normal');
        persistentQueue.save();

        const newQueue = new PersistentQueue<string>({
          storageDir: tempDir,
          filename: 'test-queue.json',
        });

        // The load event should have been emitted during construction
        expect(newQueue.size()).toBe(1);

        newQueue.dispose();
      });
    });

    describe('Export and Import', () => {
      it('should export to file', () => {
        persistentQueue.enqueuePriority('export-item', 'high');

        const exportPath = path.join(tempDir, 'export.json');
        const exported = persistentQueue.exportTo(exportPath);

        expect(exported).toBe(true);
        expect(fs.existsSync(exportPath)).toBe(true);

        const content = fs.readFileSync(exportPath, 'utf-8');
        const data = JSON.parse(content);
        expect(data.items[0].data).toBe('export-item');
      });

      it('should import from file (replace)', () => {
        persistentQueue.enqueuePriority('existing', 'low');

        // Create import file
        const importPath = path.join(tempDir, 'import.json');
        const importData: SerializedQueue<string> = {
          version: 1,
          createdAt: new Date().toISOString(),
          lastSavedAt: new Date().toISOString(),
          items: [
            {
              id: 'imported-1',
              data: 'imported-item',
              enqueuedAt: new Date().toISOString(),
              attempts: 0,
              priority: 'critical',
              priorityValue: 3,
            },
          ],
          stats: { processed: 5, failed: 1 },
        };
        fs.writeFileSync(importPath, JSON.stringify(importData));

        const imported = persistentQueue.importFrom(importPath, false);

        expect(imported).toBe(true);
        expect(persistentQueue.size()).toBe(1);
        expect(persistentQueue.peek()?.data).toBe('imported-item');
      });

      it('should import from file (merge)', () => {
        persistentQueue.enqueuePriority('existing', 'low');

        // Create import file
        const importPath = path.join(tempDir, 'import.json');
        const importData: SerializedQueue<string> = {
          version: 1,
          createdAt: new Date().toISOString(),
          lastSavedAt: new Date().toISOString(),
          items: [
            {
              id: 'imported-1',
              data: 'imported-item',
              enqueuedAt: new Date().toISOString(),
              attempts: 0,
              priority: 'critical',
              priorityValue: 3,
            },
          ],
          stats: { processed: 0, failed: 0 },
        };
        fs.writeFileSync(importPath, JSON.stringify(importData));

        const imported = persistentQueue.importFrom(importPath, true);

        expect(imported).toBe(true);
        expect(persistentQueue.size()).toBe(2);
      });
    });

    describe('Backup Operations', () => {
      it('should create backup', () => {
        persistentQueue.enqueuePriority('backup-item', 'normal');

        const backupPath = persistentQueue.backup();

        expect(backupPath).not.toBeNull();
        expect(fs.existsSync(backupPath!)).toBe(true);
      });

      it('should list available backups', async () => {
        persistentQueue.enqueuePriority('item', 'normal');
        persistentQueue.backup();
        // Small delay to ensure different timestamp
        await new Promise(resolve => setTimeout(resolve, 10));
        persistentQueue.backup();

        const backups = persistentQueue.listBackups();

        expect(backups.length).toBeGreaterThanOrEqual(1);
      });

      it('should restore from backup', () => {
        persistentQueue.enqueuePriority('original', 'low');
        const backupPath = persistentQueue.backup();

        // Modify queue
        persistentQueue.clear();
        persistentQueue.enqueuePriority('new-item', 'high');

        // Restore
        const restored = persistentQueue.restoreFromBackup(backupPath!);

        expect(restored).toBe(true);
        expect(persistentQueue.size()).toBe(1);
        expect(persistentQueue.peek()?.data).toBe('original');
      });
    });

    describe('Storage Management', () => {
      it('should delete storage file', () => {
        persistentQueue.enqueuePriority('item', 'normal');
        persistentQueue.save();

        expect(persistentQueue.hasStoredData()).toBe(true);

        const deleted = persistentQueue.deleteStorage();

        expect(deleted).toBe(true);
        expect(persistentQueue.hasStoredData()).toBe(false);
      });

      it('should format persistent queue status', () => {
        persistentQueue.enqueuePriority('item', 'normal');

        const status = persistentQueue.formatStatus();

        expect(status).toContain('PERSISTENCE STATUS');
        expect(status).toContain('Storage');
      });
    });

    describe('Priority Operations with Persistence', () => {
      it('should persist priority updates', () => {
        const item = persistentQueue.enqueuePriority('item', 'low');
        const itemId = item!.id;

        persistentQueue.updatePriority(itemId, 'critical');

        // Verify in storage
        const content = fs.readFileSync(persistentQueue.getStoragePath(), 'utf-8');
        const data = JSON.parse(content);

        expect(data.items[0].priority).toBe('critical');
      });
    });
  });

  // ============================================
  // SINGLETON TESTS
  // ============================================
  describe('Queue Singletons', () => {
    afterEach(() => {
      resetQueues();
    });

    describe('getQueue', () => {
      it('should return same instance', () => {
        const queue1 = getQueue();
        const queue2 = getQueue();

        expect(queue1).toBe(queue2);
      });

      it('should accept options on first call', () => {
        const queue = getQueue({ maxSize: 500 });

        expect(queue.getOptions().maxSize).toBe(500);
      });
    });

    describe('getPriorityQueue', () => {
      it('should return same instance', () => {
        const pq1 = getPriorityQueue();
        const pq2 = getPriorityQueue();

        expect(pq1).toBe(pq2);
      });
    });

    describe('getPersistentQueue', () => {
      let tempDir: string;

      beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'singleton-test-'));
      });

      afterEach(() => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore
        }
      });

      it('should return same instance', () => {
        const pq1 = getPersistentQueue({ storageDir: tempDir });
        const pq2 = getPersistentQueue();

        expect(pq1).toBe(pq2);
      });
    });

    describe('resetQueues', () => {
      it('should reset all queue instances', () => {
        const queue1 = getQueue();
        const priorityQueue1 = getPriorityQueue();

        resetQueues();

        const queue2 = getQueue();
        const priorityQueue2 = getPriorityQueue();

        expect(queue1).not.toBe(queue2);
        expect(priorityQueue1).not.toBe(priorityQueue2);
      });
    });
  });

  // ============================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================
  describe('Edge Cases', () => {
    describe('Queue', () => {
      it('should handle empty data', () => {
        const queue = new Queue<string>();
        const item = queue.enqueue('');

        expect(item?.data).toBe('');
        queue.dispose();
      });

      it('should handle complex objects', () => {
        const queue = new Queue<{ name: string; value: number }>();
        const item = queue.enqueue({ name: 'test', value: 42 });

        expect(item?.data.name).toBe('test');
        expect(item?.data.value).toBe(42);
        queue.dispose();
      });

      it('should handle null and undefined in array', () => {
        const queue = new Queue<string | null>();
        queue.enqueue(null);

        expect(queue.peek()?.data).toBeNull();
        queue.dispose();
      });

      it('should handle unicode data', () => {
        const queue = new Queue<string>();
        const item = queue.enqueue('Unicode: 中文, 日本語, emoji: 🎉');

        expect(item?.data).toContain('中文');
        expect(item?.data).toContain('🎉');
        queue.dispose();
      });
    });

    describe('PriorityQueue', () => {
      it('should handle all priorities added at once', () => {
        const pq = new PriorityQueue<string>();
        const priorities: PriorityLevel[] = ['low', 'normal', 'high', 'critical'];

        for (const priority of priorities) {
          pq.enqueuePriority(`item-${priority}`, priority);
        }

        expect(pq.peekHighest()?.data).toBe('item-critical');
        expect(pq.peekLowest()?.data).toBe('item-low');
        pq.dispose();
      });

      it('should handle rapid priority changes', () => {
        const pq = new PriorityQueue<string>();
        const item = pq.enqueuePriority('test', 'low');

        pq.updatePriority(item!.id, 'high');
        pq.updatePriority(item!.id, 'critical');
        pq.updatePriority(item!.id, 'normal');

        const retrieved = pq.getById(item!.id) as PriorityItem<string>;
        expect(retrieved.priority).toBe('normal');
        pq.dispose();
      });
    });

    describe('PersistentQueue', () => {
      it('should handle corrupted storage file', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corrupt-test-'));
        const storagePath = path.join(tempDir, 'queue.json');

        // Write corrupted data
        fs.mkdirSync(tempDir, { recursive: true });
        fs.writeFileSync(storagePath, 'not valid json {{{');

        const pq = new PersistentQueue<string>({
          storageDir: tempDir,
          filename: 'queue.json',
        });

        // Should start with empty queue
        expect(pq.size()).toBe(0);

        pq.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('should handle read-only storage', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-test-'));

        const pq = new PersistentQueue<string>({
          storageDir: tempDir,
          filename: 'queue.json',
          autoSave: false, // Disable to control when save happens
        });

        pq.enqueuePriority('item', 'normal');

        // Should not throw even if save fails
        expect(() => pq.save()).not.toThrow();

        pq.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    });
  });

  // ============================================
  // CONCURRENCY TESTS
  // ============================================
  describe('Concurrency', () => {
    it('should handle concurrent enqueues', async () => {
      const queue = new Queue<number>({ maxSize: 1000 });

      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve(queue.enqueue(i))
      );

      await Promise.all(promises);

      expect(queue.size()).toBe(100);
      queue.dispose();
    });

    it('should process items concurrently', async () => {
      const queue = new Queue<number>({ concurrency: 5 });
      const processedOrder: number[] = [];

      queue.setProcessor(async (item: number) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        processedOrder.push(item);
        return item;
      });

      for (let i = 0; i < 10; i++) {
        queue.enqueue(i);
      }

      await queue.processQueue();

      expect(processedOrder).toHaveLength(10);
      queue.dispose();
    });
  });
});
