/**
 * Inter-Agent Announcements Module
 *
 * Provides a structured communication mechanism between agents
 * using a queue-based announcement system.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Announcement types
 */
export type AnnouncementType =
  | 'result'      // Task result
  | 'error'       // Error notification
  | 'progress'    // Progress update
  | 'request'     // Request for action
  | 'info'        // Informational message
  | 'warning';    // Warning notification

/**
 * Announcement priority
 */
export type AnnouncementPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * An announcement between agents
 */
export interface Announcement<T = unknown> {
  /** Unique announcement ID */
  id: string;
  /** Source agent ID */
  source: string;
  /** Target agent ID */
  target: string;
  /** Announcement type */
  type: AnnouncementType;
  /** Priority level */
  priority: AnnouncementPriority;
  /** Payload data */
  payload: T;
  /** Creation timestamp */
  createdAt: number;
  /** Whether the announcement has been consumed */
  consumed: boolean;
  /** Consumption timestamp */
  consumedAt?: number;
  /** Optional correlation ID for request/response tracking */
  correlationId?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Announcement filter
 */
export interface AnnouncementFilter {
  /** Filter by source agent */
  source?: string;
  /** Filter by announcement type */
  type?: AnnouncementType | AnnouncementType[];
  /** Filter by priority */
  priority?: AnnouncementPriority | AnnouncementPriority[];
  /** Filter by correlation ID */
  correlationId?: string;
  /** Whether to include consumed announcements */
  includeConsumed?: boolean;
}

/**
 * Announcement queue events
 */
export interface AnnouncementEvents {
  'announce': (announcement: Announcement) => void;
  'consume': (announcement: Announcement) => void;
  'expire': (announcement: Announcement) => void;
}

/**
 * Announcement queue configuration
 */
export interface AnnouncementQueueConfig {
  /** Maximum announcements per target (0 = unlimited) */
  maxPerTarget: number;
  /** Announcement TTL in ms (0 = no expiry) */
  ttlMs: number;
  /** Cleanup interval in ms */
  cleanupIntervalMs: number;
}

/**
 * Default configuration
 */
export const DEFAULT_ANNOUNCEMENT_CONFIG: AnnouncementQueueConfig = {
  maxPerTarget: 100,
  ttlMs: 5 * 60 * 1000, // 5 minutes
  cleanupIntervalMs: 60 * 1000, // 1 minute
};

// ============================================================================
// Announcement Queue
// ============================================================================

/**
 * Announcement queue for inter-agent communication
 */
export class AnnouncementQueue extends EventEmitter {
  private config: AnnouncementQueueConfig;
  private queues: Map<string, Announcement[]> = new Map();
  private idCounter = 0;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<AnnouncementQueueConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ANNOUNCEMENT_CONFIG, ...config };

    if (this.config.cleanupIntervalMs > 0) {
      this.startCleanup();
    }
  }

  /**
   * Create and enqueue an announcement
   */
  announce<T = unknown>(
    source: string,
    target: string,
    type: AnnouncementType,
    payload: T,
    options: {
      priority?: AnnouncementPriority;
      correlationId?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Announcement<T> {
    const announcement: Announcement<T> = {
      id: `ann-${++this.idCounter}-${Date.now()}`,
      source,
      target,
      type,
      priority: options.priority ?? 'normal',
      payload,
      createdAt: Date.now(),
      consumed: false,
      correlationId: options.correlationId,
      metadata: options.metadata,
    };

    // Get or create queue for target
    let queue = this.queues.get(target);
    if (!queue) {
      queue = [];
      this.queues.set(target, queue);
    }

    // Check queue size limit
    if (this.config.maxPerTarget > 0 && queue.length >= this.config.maxPerTarget) {
      // Remove oldest non-urgent announcement
      const removeIndex = queue.findIndex(a => a.priority !== 'urgent' && !a.consumed);
      if (removeIndex !== -1) {
        const removed = queue.splice(removeIndex, 1)[0];
        this.emit('expire', removed);
      }
    }

    // Insert based on priority
    const insertIndex = this.findInsertIndex(queue, announcement.priority);
    queue.splice(insertIndex, 0, announcement);

    this.emit('announce', announcement);
    this.notifyTarget(target);

    return announcement;
  }

  /**
   * Find insertion index based on priority
   */
  private findInsertIndex(queue: Announcement[], priority: AnnouncementPriority): number {
    const priorityOrder: Record<AnnouncementPriority, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
      low: 3,
    };

    const targetPriority = priorityOrder[priority];

    for (let i = 0; i < queue.length; i++) {
      if (priorityOrder[queue[i].priority] > targetPriority) {
        return i;
      }
    }

    return queue.length;
  }

  /**
   * Notify a target agent of pending announcements
   */
  private notifyTarget(target: string): void {
    // This would typically integrate with the agent system
    // For now, we just emit an event that can be listened to
    this.emit(`notify:${target}`);
  }

  /**
   * Consume announcements for a target
   */
  consume(target: string, filter?: AnnouncementFilter): Announcement[] {
    const queue = this.queues.get(target);
    if (!queue || queue.length === 0) {
      return [];
    }

    const consumed: Announcement[] = [];
    const remaining: Announcement[] = [];

    for (const announcement of queue) {
      if (announcement.consumed && !filter?.includeConsumed) {
        remaining.push(announcement);
        continue;
      }

      if (this.matchesFilter(announcement, filter)) {
        announcement.consumed = true;
        announcement.consumedAt = Date.now();
        consumed.push(announcement);
        this.emit('consume', announcement);
      } else {
        remaining.push(announcement);
      }
    }

    this.queues.set(target, remaining);

    return consumed;
  }

  /**
   * Peek at announcements without consuming
   */
  peek(target: string, filter?: AnnouncementFilter): Announcement[] {
    const queue = this.queues.get(target);
    if (!queue) {
      return [];
    }

    return queue.filter(a => this.matchesFilter(a, filter));
  }

  /**
   * Check if announcement matches filter
   */
  private matchesFilter(announcement: Announcement, filter?: AnnouncementFilter): boolean {
    if (!filter) return true;

    if (filter.source && announcement.source !== filter.source) {
      return false;
    }

    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      if (!types.includes(announcement.type)) {
        return false;
      }
    }

    if (filter.priority) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      if (!priorities.includes(announcement.priority)) {
        return false;
      }
    }

    if (filter.correlationId && announcement.correlationId !== filter.correlationId) {
      return false;
    }

    if (!filter.includeConsumed && announcement.consumed) {
      return false;
    }

    return true;
  }

  /**
   * Get pending count for a target
   */
  getPendingCount(target: string): number {
    const queue = this.queues.get(target);
    if (!queue) return 0;
    return queue.filter(a => !a.consumed).length;
  }

  /**
   * Check if target has pending announcements
   */
  hasPending(target: string, filter?: AnnouncementFilter): boolean {
    const queue = this.queues.get(target);
    if (!queue) return false;
    return queue.some(a => !a.consumed && this.matchesFilter(a, filter));
  }

  /**
   * Wait for an announcement (with timeout)
   */
  async waitFor(
    target: string,
    filter?: AnnouncementFilter,
    timeoutMs: number = 30000
  ): Promise<Announcement | null> {
    // Check if already available
    const existing = this.peek(target, filter);
    if (existing.length > 0) {
      return this.consume(target, filter)[0] || null;
    }

    // Wait for new announcement
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.off(`notify:${target}`, handler);
        resolve(null);
      }, timeoutMs);

      const handler = () => {
        const announcements = this.consume(target, filter);
        if (announcements.length > 0) {
          clearTimeout(timeout);
          this.off(`notify:${target}`, handler);
          resolve(announcements[0]);
        }
      };

      this.on(`notify:${target}`, handler);
    });
  }

  /**
   * Start cleanup timer
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Cleanup expired announcements
   */
  cleanup(): void {
    if (this.config.ttlMs === 0) return;

    const now = Date.now();

    for (const [target, queue] of this.queues) {
      const remaining = queue.filter(a => {
        const age = now - a.createdAt;
        if (age > this.config.ttlMs) {
          this.emit('expire', a);
          return false;
        }
        return true;
      });

      if (remaining.length === 0) {
        this.queues.delete(target);
      } else {
        this.queues.set(target, remaining);
      }
    }
  }

  /**
   * Stop the queue
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clear all announcements
   */
  clear(): void {
    this.queues.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalTargets: number;
    totalPending: number;
    totalConsumed: number;
    byTarget: Record<string, { pending: number; consumed: number }>;
  } {
    let totalPending = 0;
    let totalConsumed = 0;
    const byTarget: Record<string, { pending: number; consumed: number }> = {};

    for (const [target, queue] of this.queues) {
      const pending = queue.filter(a => !a.consumed).length;
      const consumed = queue.filter(a => a.consumed).length;

      totalPending += pending;
      totalConsumed += consumed;
      byTarget[target] = { pending, consumed };
    }

    return {
      totalTargets: this.queues.size,
      totalPending,
      totalConsumed,
      byTarget,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let announcementQueueInstance: AnnouncementQueue | null = null;

/**
 * Get the singleton announcement queue
 */
export function getAnnouncementQueue(
  config?: Partial<AnnouncementQueueConfig>
): AnnouncementQueue {
  if (!announcementQueueInstance) {
    announcementQueueInstance = new AnnouncementQueue(config);
  }
  return announcementQueueInstance;
}

/**
 * Reset the singleton announcement queue
 */
export function resetAnnouncementQueue(): void {
  if (announcementQueueInstance) {
    announcementQueueInstance.stop();
    announcementQueueInstance.clear();
    announcementQueueInstance = null;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Send a result announcement
 */
export function announceResult<T>(
  source: string,
  target: string,
  result: T,
  correlationId?: string
): Announcement<T> {
  return getAnnouncementQueue().announce(source, target, 'result', result, { correlationId });
}

/**
 * Send an error announcement
 */
export function announceError(
  source: string,
  target: string,
  error: string | Error,
  correlationId?: string
): Announcement<{ message: string; stack?: string }> {
  const payload = {
    message: error instanceof Error ? error.message : error,
    stack: error instanceof Error ? error.stack : undefined,
  };
  return getAnnouncementQueue().announce(source, target, 'error', payload, {
    correlationId,
    priority: 'high',
  });
}

/**
 * Send a progress announcement
 */
export function announceProgress(
  source: string,
  target: string,
  progress: { percent: number; message?: string },
  correlationId?: string
): Announcement<{ percent: number; message?: string }> {
  return getAnnouncementQueue().announce(source, target, 'progress', progress, {
    correlationId,
    priority: 'low',
  });
}

/**
 * Send a request announcement
 */
export function announceRequest<T>(
  source: string,
  target: string,
  request: T,
  correlationId?: string
): Announcement<T> {
  return getAnnouncementQueue().announce(source, target, 'request', request, {
    correlationId,
    priority: 'normal',
  });
}

/**
 * Wait for a response to a request
 */
export async function requestAndWait<TReq, TRes>(
  source: string,
  target: string,
  request: TReq,
  timeoutMs: number = 30000
): Promise<TRes | null> {
  const correlationId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Send the request
  announceRequest(source, target, request, correlationId);

  // Wait for the response
  const response = await getAnnouncementQueue().waitFor(
    source,
    { source: target, type: 'result', correlationId },
    timeoutMs
  );

  return response?.payload as TRes ?? null;
}
