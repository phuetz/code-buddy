/**
 * Priority Queue Implementation
 *
 * Extends the basic queue with priority-based ordering.
 * Items with higher priority are processed first.
 */

import { Queue, QueueItem, QueueOptions } from './queue.js';

export type PriorityLevel = 'low' | 'normal' | 'high' | 'critical';

export interface PriorityItem<T> extends QueueItem<T> {
  priority: PriorityLevel;
  priorityValue: number;
}

export interface PriorityQueueOptions extends QueueOptions {
  /** Default priority for new items */
  defaultPriority?: PriorityLevel;
  /** Whether to use fair scheduling (prevents starvation) */
  fairScheduling?: boolean;
  /** Maximum time an item can wait before priority boost (ms) */
  maxWaitTime?: number;
}

const PRIORITY_VALUES: Record<PriorityLevel, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

const DEFAULT_PRIORITY_OPTIONS: Required<PriorityQueueOptions> = {
  maxSize: 1000,
  maxRetries: 3,
  retryDelay: 1000,
  autoProcess: false,
  concurrency: 1,
  defaultPriority: 'normal',
  fairScheduling: false,
  maxWaitTime: 60000, // 1 minute
};

/**
 * Priority Queue
 */
export class PriorityQueue<T = unknown> extends Queue<T> {
  protected override items: PriorityItem<T>[] = [];
  protected priorityOptions: Required<PriorityQueueOptions>;

  constructor(options: PriorityQueueOptions = {}) {
    super(options);
    this.priorityOptions = { ...DEFAULT_PRIORITY_OPTIONS, ...options };
  }

  /**
   * Add an item with priority
   */
  enqueuePriority(
    data: T,
    priority: PriorityLevel = this.priorityOptions.defaultPriority,
    metadata?: Record<string, unknown>
  ): PriorityItem<T> | null {
    if (this.items.length >= this.options.maxSize) {
      this.emit('full');
      return null;
    }

    const item: PriorityItem<T> = {
      id: this.generateId(),
      data,
      enqueuedAt: new Date(),
      attempts: 0,
      priority,
      priorityValue: PRIORITY_VALUES[priority],
      metadata,
    };

    this.insertByPriority(item);
    this.emit('enqueue', item);

    if (this.options.autoProcess && this.processor) {
      this.processQueue();
    }

    return item;
  }

  /**
   * Override enqueue to use priority
   */
  override enqueue(data: T, metadata?: Record<string, unknown>): PriorityItem<T> | null {
    return this.enqueuePriority(data, this.priorityOptions.defaultPriority, metadata);
  }

  /**
   * Insert item in correct position based on priority
   */
  protected insertByPriority(item: PriorityItem<T>): void {
    // Apply fair scheduling if enabled (boost priority of waiting items)
    if (this.priorityOptions.fairScheduling) {
      this.applyFairScheduling();
    }

    // Find insertion point (maintain stability within same priority)
    let insertIndex = this.items.length;

    for (let i = 0; i < this.items.length; i++) {
      if (item.priorityValue > this.items[i].priorityValue) {
        insertIndex = i;
        break;
      }
    }

    this.items.splice(insertIndex, 0, item);
  }

  /**
   * Apply fair scheduling to prevent starvation
   */
  protected applyFairScheduling(): void {
    const now = Date.now();

    for (const item of this.items) {
      const waitTime = now - item.enqueuedAt.getTime();

      if (waitTime > this.priorityOptions.maxWaitTime) {
        // Boost priority for items that have been waiting too long
        const boostLevels = Math.floor(waitTime / this.priorityOptions.maxWaitTime);
        item.priorityValue = Math.min(
          PRIORITY_VALUES['critical'],
          item.priorityValue + boostLevels
        );
      }
    }

    // Re-sort after boosting
    this.items.sort((a, b) => b.priorityValue - a.priorityValue);
  }

  /**
   * Get items by priority level
   */
  getByPriority(priority: PriorityLevel): PriorityItem<T>[] {
    return this.items.filter(item => item.priority === priority);
  }

  /**
   * Count items by priority level
   */
  countByPriority(): Record<PriorityLevel, number> {
    const counts: Record<PriorityLevel, number> = {
      low: 0,
      normal: 0,
      high: 0,
      critical: 0,
    };

    for (const item of this.items) {
      counts[item.priority]++;
    }

    return counts;
  }

  /**
   * Update item priority
   */
  updatePriority(id: string, priority: PriorityLevel): boolean {
    const item = this.items.find(i => i.id === id);

    if (!item) {
      return false;
    }

    // Remove item
    const index = this.items.indexOf(item);
    this.items.splice(index, 1);

    // Update priority
    item.priority = priority;
    item.priorityValue = PRIORITY_VALUES[priority];

    // Re-insert in correct position
    this.insertByPriority(item);

    return true;
  }

  /**
   * Escalate item to higher priority
   */
  escalate(id: string): boolean {
    const item = this.items.find(i => i.id === id);

    if (!item) {
      return false;
    }

    const priorities: PriorityLevel[] = ['low', 'normal', 'high', 'critical'];
    const currentIndex = priorities.indexOf(item.priority);

    if (currentIndex < priorities.length - 1) {
      return this.updatePriority(id, priorities[currentIndex + 1]);
    }

    return false; // Already at highest priority
  }

  /**
   * De-escalate item to lower priority
   */
  deescalate(id: string): boolean {
    const item = this.items.find(i => i.id === id);

    if (!item) {
      return false;
    }

    const priorities: PriorityLevel[] = ['low', 'normal', 'high', 'critical'];
    const currentIndex = priorities.indexOf(item.priority);

    if (currentIndex > 0) {
      return this.updatePriority(id, priorities[currentIndex - 1]);
    }

    return false; // Already at lowest priority
  }

  /**
   * Get highest priority item
   */
  peekHighest(): PriorityItem<T> | undefined {
    return this.items[0];
  }

  /**
   * Get lowest priority item
   */
  peekLowest(): PriorityItem<T> | undefined {
    return this.items[this.items.length - 1];
  }

  /**
   * Dequeue only items with specific priority or higher
   */
  dequeueWithMinPriority(minPriority: PriorityLevel): PriorityItem<T> | undefined {
    const minValue = PRIORITY_VALUES[minPriority];
    const item = this.items.find(i => i.priorityValue >= minValue);

    if (item) {
      const index = this.items.indexOf(item);
      this.items.splice(index, 1);
      this.emit('dequeue', item);

      if (this.items.length === 0) {
        this.emit('empty');
      }

      return item;
    }

    return undefined;
  }

  /**
   * Clear all items of a specific priority
   */
  clearPriority(priority: PriorityLevel): number {
    const initialLength = this.items.length;
    this.items = this.items.filter(item => item.priority !== priority);
    const removed = initialLength - this.items.length;

    if (this.items.length === 0) {
      this.emit('empty');
    }

    return removed;
  }

  /**
   * Get all items sorted by priority (highest first)
   */
  override getAll(): PriorityItem<T>[] {
    return [...this.items];
  }

  /**
   * Get priority queue specific stats
   */
  getPriorityStats(): {
    size: number;
    byPriority: Record<PriorityLevel, number>;
    highestPriority: PriorityLevel | null;
    lowestPriority: PriorityLevel | null;
  } {
    const counts = this.countByPriority();

    let highest: PriorityLevel | null = null;
    let lowest: PriorityLevel | null = null;

    if (this.items.length > 0) {
      highest = this.items[0].priority;
      lowest = this.items[this.items.length - 1].priority;
    }

    return {
      size: this.items.length,
      byPriority: counts,
      highestPriority: highest,
      lowestPriority: lowest,
    };
  }

  /**
   * Format priority queue status for display
   */
  override formatStatus(): string {
    const stats = this.getStats();
    const priorityStats = this.getPriorityStats();

    return [
      '┌────────────────────────────────────┐',
      '│       PRIORITY QUEUE STATUS        │',
      '├────────────────────────────────────┤',
      `│ Size:        ${stats.size.toString().padStart(6)} / ${stats.maxSize.toString().padEnd(6)} │`,
      '├────────────────────────────────────┤',
      `│ Critical:    ${priorityStats.byPriority.critical.toString().padStart(13)} │`,
      `│ High:        ${priorityStats.byPriority.high.toString().padStart(13)} │`,
      `│ Normal:      ${priorityStats.byPriority.normal.toString().padStart(13)} │`,
      `│ Low:         ${priorityStats.byPriority.low.toString().padStart(13)} │`,
      '├────────────────────────────────────┤',
      `│ Processed:   ${stats.processed.toString().padStart(13)} │`,
      `│ Failed:      ${stats.failed.toString().padStart(13)} │`,
      '└────────────────────────────────────┘',
    ].join('\n');
  }
}

/**
 * Create a priority queue with custom settings
 */
export function createPriorityQueue<T>(
  options?: PriorityQueueOptions
): PriorityQueue<T> {
  return new PriorityQueue<T>(options);
}

export default PriorityQueue;
