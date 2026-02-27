/**
 * Queue Singleton Management
 *
 * Provides global access to queue instances with lazy initialization.
 */

import { Queue, QueueOptions } from './queue.js';
import { PriorityQueue, PriorityQueueOptions } from './priority-queue.js';
import { PersistentQueue, PersistentQueueOptions } from './persistent-queue.js';

// Singleton instances - stored with 'any' type for generic singleton pattern
// Type assertions are used when returning typed versions to callers
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for generic singleton pattern
let queueInstance: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for generic singleton pattern
let priorityQueueInstance: PriorityQueue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for generic singleton pattern
let persistentQueueInstance: PersistentQueue<any> | null = null;

/**
 * Get the global Queue instance
 */
export function getQueue<T = unknown>(options?: QueueOptions): Queue<T> {
  if (!queueInstance) {
    queueInstance = new Queue<T>(options);
  }
  return queueInstance as Queue<T>;
}

/**
 * Get the global PriorityQueue instance
 */
export function getPriorityQueue<T = unknown>(options?: PriorityQueueOptions): PriorityQueue<T> {
  if (!priorityQueueInstance) {
    priorityQueueInstance = new PriorityQueue<T>(options);
  }
  return priorityQueueInstance as PriorityQueue<T>;
}

/**
 * Get the global PersistentQueue instance
 */
export function getPersistentQueue<T = unknown>(options?: PersistentQueueOptions): PersistentQueue<T> {
  if (!persistentQueueInstance) {
    persistentQueueInstance = new PersistentQueue<T>(options);
  }
  return persistentQueueInstance as PersistentQueue<T>;
}

/**
 * Reset all queue singletons
 */
export function resetQueues(): void {
  if (queueInstance) {
    queueInstance.dispose();
    queueInstance = null;
  }

  if (priorityQueueInstance) {
    priorityQueueInstance.dispose();
    priorityQueueInstance = null;
  }

  if (persistentQueueInstance) {
    persistentQueueInstance.dispose();
    persistentQueueInstance = null;
  }
}

/**
 * Get queue status summary
 */
export function getQueuesSummary(): {
  queue: ReturnType<Queue['getStats']> | null;
  priorityQueue: ReturnType<PriorityQueue['getStats']> | null;
  persistentQueue: ReturnType<PersistentQueue['getStats']> | null;
} {
  return {
    queue: queueInstance?.getStats() ?? null,
    priorityQueue: priorityQueueInstance?.getStats() ?? null,
    persistentQueue: persistentQueueInstance?.getStats() ?? null,
  };
}
