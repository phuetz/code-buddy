/**
 * Basic Queue Implementation
 *
 * A generic FIFO queue with async processing support.
 * Provides enqueue, dequeue, peek, and batch operations.
 */

import { EventEmitter } from 'events';

export interface QueueItem<T> {
  id: string;
  data: T;
  enqueuedAt: Date;
  attempts: number;
  lastAttemptAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface QueueOptions {
  /** Maximum items in queue */
  maxSize?: number;
  /** Maximum retry attempts per item */
  maxRetries?: number;
  /** Delay between retries in ms */
  retryDelay?: number;
  /** Whether to process items automatically */
  autoProcess?: boolean;
  /** Concurrency for auto processing */
  concurrency?: number;
}

export interface QueueStats {
  size: number;
  maxSize: number;
  processed: number;
  failed: number;
  avgProcessingTime: number;
  isProcessing: boolean;
}

export interface QueueEventMap<T> {
  'enqueue': (item: QueueItem<T>) => void;
  'dequeue': (item: QueueItem<T>) => void;
  'process': (item: QueueItem<T>) => void;
  'processed': (item: QueueItem<T>, result: unknown) => void;
  'error': (item: QueueItem<T>, error: Error) => void;
  'retry': (item: QueueItem<T>, attempt: number) => void;
  'full': () => void;
  'empty': () => void;
  'drain': () => void;
}

const DEFAULT_OPTIONS: Required<QueueOptions> = {
  maxSize: 1000,
  maxRetries: 3,
  retryDelay: 1000,
  autoProcess: false,
  concurrency: 1,
};

/**
 * Basic FIFO Queue
 */
export class Queue<T = unknown> extends EventEmitter {
  protected items: QueueItem<T>[] = [];
  protected options: Required<QueueOptions>;
  protected processing: boolean = false;
  protected processedCount: number = 0;
  protected failedCount: number = 0;
  protected processingTimes: number[] = [];
  protected idCounter: number = 0;
  protected processor?: (item: T) => Promise<unknown>;
  protected activeProcessing: number = 0;

  constructor(options: QueueOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate unique item ID
   */
  protected generateId(): string {
    const timestamp = Date.now().toString(36);
    const counter = (++this.idCounter).toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `q_${timestamp}_${counter}_${random}`;
  }

  /**
   * Add an item to the queue
   */
  enqueue(data: T, metadata?: Record<string, unknown>): QueueItem<T> | null {
    if (this.items.length >= this.options.maxSize) {
      this.emit('full');
      return null;
    }

    const item: QueueItem<T> = {
      id: this.generateId(),
      data,
      enqueuedAt: new Date(),
      attempts: 0,
      metadata,
    };

    this.items.push(item);
    this.emit('enqueue', item);

    if (this.options.autoProcess && this.processor) {
      this.processQueue();
    }

    return item;
  }

  /**
   * Add multiple items to the queue
   */
  enqueueMany(dataItems: T[]): QueueItem<T>[] {
    const added: QueueItem<T>[] = [];

    for (const data of dataItems) {
      const item = this.enqueue(data);
      if (item) {
        added.push(item);
      } else {
        break; // Queue is full
      }
    }

    return added;
  }

  /**
   * Remove and return the first item from the queue
   */
  dequeue(): QueueItem<T> | undefined {
    const item = this.items.shift();

    if (item) {
      this.emit('dequeue', item);

      if (this.items.length === 0) {
        this.emit('empty');
      }
    }

    return item;
  }

  /**
   * Remove multiple items from the queue
   */
  dequeueMany(count: number): QueueItem<T>[] {
    const items: QueueItem<T>[] = [];

    for (let i = 0; i < count && this.items.length > 0; i++) {
      const item = this.dequeue();
      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  /**
   * View the first item without removing it
   */
  peek(): QueueItem<T> | undefined {
    return this.items[0];
  }

  /**
   * View multiple items without removing them
   */
  peekMany(count: number): QueueItem<T>[] {
    return this.items.slice(0, count);
  }

  /**
   * Get item by ID
   */
  getById(id: string): QueueItem<T> | undefined {
    return this.items.find(item => item.id === id);
  }

  /**
   * Remove item by ID
   */
  removeById(id: string): boolean {
    const index = this.items.findIndex(item => item.id === id);

    if (index !== -1) {
      const [item] = this.items.splice(index, 1);
      this.emit('dequeue', item);

      if (this.items.length === 0) {
        this.emit('empty');
      }

      return true;
    }

    return false;
  }

  /**
   * Check if queue contains an item
   */
  has(id: string): boolean {
    return this.items.some(item => item.id === id);
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Check if queue is full
   */
  isFull(): boolean {
    return this.items.length >= this.options.maxSize;
  }

  /**
   * Clear all items from the queue
   */
  clear(): number {
    const count = this.items.length;
    this.items = [];
    this.emit('empty');
    return count;
  }

  /**
   * Get all items (copy)
   */
  getAll(): QueueItem<T>[] {
    return [...this.items];
  }

  /**
   * Filter items based on predicate
   */
  filter(predicate: (item: QueueItem<T>) => boolean): QueueItem<T>[] {
    return this.items.filter(predicate);
  }

  /**
   * Find an item based on predicate
   */
  find(predicate: (item: QueueItem<T>) => boolean): QueueItem<T> | undefined {
    return this.items.find(predicate);
  }

  /**
   * Set the processor function for auto-processing
   */
  setProcessor(processor: (item: T) => Promise<unknown>): void {
    this.processor = processor;

    if (this.options.autoProcess && this.items.length > 0) {
      this.processQueue();
    }
  }

  /**
   * Process all items in the queue
   */
  async processQueue(): Promise<void> {
    if (this.processing) return;
    if (!this.processor) {
      throw new Error('No processor set. Use setProcessor() before processing.');
    }

    this.processing = true;

    // For sequential processing (concurrency === 1), process all items one by one
    if (this.options.concurrency === 1) {
      while (this.items.length > 0) {
        const item = this.dequeue();
        if (!item) break;

        this.activeProcessing++;
        await this.processItem(item);
        this.activeProcessing--;
      }

      this.processing = false;
      this.emit('drain');
      return;
    }

    // For concurrent processing, use Promise.all pattern
    const processWorker = async (): Promise<void> => {
      while (this.items.length > 0) {
        const item = this.dequeue();
        if (!item) break;

        this.activeProcessing++;
        await this.processItem(item);
        this.activeProcessing--;
      }
    };

    // Start workers up to concurrency limit
    const workers: Promise<void>[] = [];
    for (let i = 0; i < this.options.concurrency; i++) {
      workers.push(processWorker());
    }

    await Promise.all(workers);
    this.processing = false;
    this.emit('drain');
  }

  /**
   * Process a single item with retry logic
   */
  protected async processItem(item: QueueItem<T>): Promise<void> {
    if (!this.processor) return;

    item.attempts++;
    item.lastAttemptAt = new Date();

    this.emit('process', item);

    const startTime = Date.now();

    try {
      const result = await this.processor(item.data);
      const processingTime = Date.now() - startTime;
      this.processingTimes.push(processingTime);
      this.processedCount++;

      this.emit('processed', item, result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (item.attempts < this.options.maxRetries) {
        this.emit('retry', item, item.attempts);

        await this.sleep(this.options.retryDelay * item.attempts);

        // Re-enqueue for retry
        this.items.unshift(item);
      } else {
        this.failedCount++;
        this.emit('error', item, err);
      }
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const avgProcessingTime = this.processingTimes.length > 0
      ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
      : 0;

    return {
      size: this.items.length,
      maxSize: this.options.maxSize,
      processed: this.processedCount,
      failed: this.failedCount,
      avgProcessingTime,
      isProcessing: this.processing,
    };
  }

  /**
   * Update queue options
   */
  updateOptions(options: Partial<QueueOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current options
   */
  getOptions(): Required<QueueOptions> {
    return { ...this.options };
  }

  /**
   * Helper sleep function
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.clear();
    this.removeAllListeners();
    this.processor = undefined;
  }

  /**
   * Format queue status for display
   */
  formatStatus(): string {
    const stats = this.getStats();
    return [
      '┌────────────────────────────────────┐',
      '│          QUEUE STATUS              │',
      '├────────────────────────────────────┤',
      `│ Size:        ${stats.size.toString().padStart(6)} / ${stats.maxSize.toString().padEnd(6)} │`,
      `│ Processed:   ${stats.processed.toString().padStart(13)} │`,
      `│ Failed:      ${stats.failed.toString().padStart(13)} │`,
      `│ Avg Time:    ${stats.avgProcessingTime.toFixed(0).padStart(10)}ms │`,
      `│ Processing:  ${(stats.isProcessing ? 'Yes' : 'No').padStart(13)} │`,
      '└────────────────────────────────────┘',
    ].join('\n');
  }
}

export default Queue;
