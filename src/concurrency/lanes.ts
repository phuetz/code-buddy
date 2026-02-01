/**
 * Session Lanes Module
 *
 * Provides queue-based message processing to prevent message interleaving
 * when multiple requests are in-flight for the same session.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * Lane item with message and metadata
 */
export interface LaneItem<T> {
  /** Unique message ID */
  id: string;
  /** The message/request payload */
  payload: T;
  /** Timestamp when enqueued */
  enqueuedAt: number;
  /** Timestamp when processing started */
  startedAt?: number;
  /** Timestamp when processing completed */
  completedAt?: number;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Lane status
 */
export type LaneStatus = 'idle' | 'processing' | 'paused' | 'draining';

/**
 * Lane events
 */
export interface LaneEvents<T> {
  'enqueue': (item: LaneItem<T>) => void;
  'start': (item: LaneItem<T>) => void;
  'complete': (item: LaneItem<T>, result: unknown) => void;
  'error': (item: LaneItem<T>, error: Error) => void;
  'drain': () => void;
  'pause': () => void;
  'resume': () => void;
}

/**
 * Lane configuration
 */
export interface LaneConfig {
  /** Maximum queue size (0 = unlimited) */
  maxQueueSize: number;
  /** Processing timeout in ms (0 = unlimited) */
  processingTimeoutMs: number;
  /** Whether to process in FIFO order */
  fifo: boolean;
  /** Whether to auto-start processing on enqueue */
  autoStart: boolean;
}

/**
 * Default lane configuration
 */
export const DEFAULT_LANE_CONFIG: LaneConfig = {
  maxQueueSize: 0,
  processingTimeoutMs: 0,
  fifo: true,
  autoStart: true,
};

// ============================================================================
// Session Lane
// ============================================================================

/**
 * A lane for processing messages in order
 */
export class SessionLane<T> extends EventEmitter {
  private config: LaneConfig;
  private queue: LaneItem<T>[] = [];
  private status: LaneStatus = 'idle';
  private currentItem: LaneItem<T> | null = null;
  private processor: ((item: LaneItem<T>) => Promise<unknown>) | null = null;
  private processingPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(config: Partial<LaneConfig> = {}) {
    super();
    this.config = { ...DEFAULT_LANE_CONFIG, ...config };
  }

  /**
   * Set the message processor
   */
  setProcessor(processor: (item: LaneItem<T>) => Promise<unknown>): void {
    this.processor = processor;
  }

  /**
   * Enqueue a message for processing
   */
  enqueue(payload: T, options: { priority?: number; metadata?: Record<string, unknown> } = {}): LaneItem<T> {
    // Check queue size limit
    if (this.config.maxQueueSize > 0 && this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Lane queue full (max: ${this.config.maxQueueSize})`);
    }

    const item: LaneItem<T> = {
      id: `lane-${++this.idCounter}-${Date.now()}`,
      payload,
      enqueuedAt: Date.now(),
      priority: options.priority ?? 0,
      metadata: options.metadata,
    };

    // Insert based on priority and FIFO setting
    if (this.config.fifo) {
      // Simple FIFO - append to end
      this.queue.push(item);
    } else {
      // Priority queue - insert at correct position
      const insertIndex = this.queue.findIndex(q => q.priority > item.priority);
      if (insertIndex === -1) {
        this.queue.push(item);
      } else {
        this.queue.splice(insertIndex, 0, item);
      }
    }

    this.emit('enqueue', item);

    // Auto-start processing if configured
    if (this.config.autoStart && this.status === 'idle') {
      this.startProcessing();
    }

    return item;
  }

  /**
   * Start processing the queue
   */
  startProcessing(): void {
    if (this.status === 'processing' || this.status === 'draining') {
      return;
    }

    if (!this.processor) {
      throw new Error('No processor set for lane');
    }

    this.status = 'processing';
    this.processingPromise = this.processQueue();
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.status !== 'paused') {
      const item = this.queue.shift()!;
      this.currentItem = item;
      item.startedAt = Date.now();

      this.emit('start', item);

      try {
        let result: unknown;

        if (this.config.processingTimeoutMs > 0) {
          // Process with timeout
          result = await Promise.race([
            this.processor!(item),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Processing timeout')),
                this.config.processingTimeoutMs
              )
            ),
          ]);
        } else {
          result = await this.processor!(item);
        }

        item.completedAt = Date.now();
        this.emit('complete', item, result);
      } catch (error) {
        item.completedAt = Date.now();
        this.emit('error', item, error as Error);
      }

      this.currentItem = null;
    }

    if (this.status !== 'paused') {
      this.status = 'idle';
      this.emit('drain');
    }

    this.processingPromise = null;
  }

  /**
   * Pause processing
   */
  pause(): void {
    if (this.status === 'processing') {
      this.status = 'paused';
      this.emit('pause');
    }
  }

  /**
   * Resume processing
   */
  resume(): void {
    if (this.status === 'paused') {
      this.emit('resume');
      this.status = 'processing';
      this.processingPromise = this.processQueue();
    }
  }

  /**
   * Drain the queue (finish current and process remaining)
   */
  async drain(): Promise<void> {
    if (this.status === 'idle' && this.queue.length === 0) {
      return;
    }

    this.status = 'draining';

    // Wait for current processing to complete
    if (this.processingPromise) {
      await this.processingPromise;
    }
  }

  /**
   * Clear the queue (cancel pending items)
   */
  clear(): LaneItem<T>[] {
    const cleared = [...this.queue];
    this.queue = [];
    return cleared;
  }

  /**
   * Get current lane status
   */
  getStatus(): LaneStatus {
    return this.status;
  }

  /**
   * Get queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Get current processing item
   */
  getCurrentItem(): LaneItem<T> | null {
    return this.currentItem;
  }

  /**
   * Get all pending items
   */
  getPendingItems(): LaneItem<T>[] {
    return [...this.queue];
  }

  /**
   * Get lane statistics
   */
  getStats(): {
    status: LaneStatus;
    queueLength: number;
    isProcessing: boolean;
    currentItemId: string | null;
  } {
    return {
      status: this.status,
      queueLength: this.queue.length,
      isProcessing: this.currentItem !== null,
      currentItemId: this.currentItem?.id ?? null,
    };
  }
}

// ============================================================================
// Lane Manager
// ============================================================================

/**
 * Manages multiple session lanes
 */
export class LaneManager<T> {
  private lanes: Map<string, SessionLane<T>> = new Map();
  private config: LaneConfig;
  private defaultProcessor: ((item: LaneItem<T>) => Promise<unknown>) | null = null;

  constructor(config: Partial<LaneConfig> = {}) {
    this.config = { ...DEFAULT_LANE_CONFIG, ...config };
  }

  /**
   * Set default processor for new lanes
   */
  setDefaultProcessor(processor: (item: LaneItem<T>) => Promise<unknown>): void {
    this.defaultProcessor = processor;
  }

  /**
   * Get or create a lane for a session
   */
  getLane(sessionId: string): SessionLane<T> {
    let lane = this.lanes.get(sessionId);

    if (!lane) {
      lane = new SessionLane<T>(this.config);
      if (this.defaultProcessor) {
        lane.setProcessor(this.defaultProcessor);
      }
      this.lanes.set(sessionId, lane);
    }

    return lane;
  }

  /**
   * Check if a lane exists
   */
  hasLane(sessionId: string): boolean {
    return this.lanes.has(sessionId);
  }

  /**
   * Remove a lane
   */
  removeLane(sessionId: string): boolean {
    const lane = this.lanes.get(sessionId);
    if (lane) {
      lane.clear();
      this.lanes.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Enqueue a message to a session's lane
   */
  enqueue(
    sessionId: string,
    payload: T,
    options?: { priority?: number; metadata?: Record<string, unknown> }
  ): LaneItem<T> {
    const lane = this.getLane(sessionId);
    return lane.enqueue(payload, options);
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.lanes.keys());
  }

  /**
   * Get total pending items across all lanes
   */
  getTotalPending(): number {
    let total = 0;
    for (const lane of this.lanes.values()) {
      total += lane.getQueueLength();
      if (lane.getCurrentItem()) total++;
    }
    return total;
  }

  /**
   * Pause all lanes
   */
  pauseAll(): void {
    for (const lane of this.lanes.values()) {
      lane.pause();
    }
  }

  /**
   * Resume all lanes
   */
  resumeAll(): void {
    for (const lane of this.lanes.values()) {
      lane.resume();
    }
  }

  /**
   * Drain all lanes
   */
  async drainAll(): Promise<void> {
    const drainPromises = Array.from(this.lanes.values()).map(lane => lane.drain());
    await Promise.all(drainPromises);
  }

  /**
   * Clear all lanes
   */
  clearAll(): void {
    for (const lane of this.lanes.values()) {
      lane.clear();
    }
    this.lanes.clear();
  }

  /**
   * Get statistics for all lanes
   */
  getStats(): {
    totalLanes: number;
    totalPending: number;
    processingCount: number;
    lanes: Record<string, ReturnType<SessionLane<T>['getStats']>>;
  } {
    const laneStats: Record<string, ReturnType<SessionLane<T>['getStats']>> = {};
    let processingCount = 0;

    for (const [sessionId, lane] of this.lanes) {
      const stats = lane.getStats();
      laneStats[sessionId] = stats;
      if (stats.isProcessing) processingCount++;
    }

    return {
      totalLanes: this.lanes.size,
      totalPending: this.getTotalPending(),
      processingCount,
      lanes: laneStats,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let laneManagerInstance: LaneManager<any> | null = null;

/**
 * Get the singleton lane manager
 */
export function getLaneManager<T = unknown>(config?: Partial<LaneConfig>): LaneManager<T> {
  if (!laneManagerInstance) {
    laneManagerInstance = new LaneManager<T>(config);
  }
  return laneManagerInstance as LaneManager<T>;
}

/**
 * Reset the singleton lane manager
 */
export function resetLaneManager(): void {
  if (laneManagerInstance) {
    laneManagerInstance.clearAll();
    laneManagerInstance = null;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Execute a function with lane ordering for a session
 */
export async function withLane<T, R>(
  sessionId: string,
  payload: T,
  processor: (payload: T) => Promise<R>,
  config?: Partial<LaneConfig>
): Promise<R> {
  const manager = getLaneManager<T>(config);

  return new Promise((resolve, reject) => {
    const lane = manager.getLane(sessionId);

    lane.setProcessor(async (item) => {
      try {
        const result = await processor(item.payload);
        resolve(result);
        return result;
      } catch (error) {
        reject(error);
        throw error;
      }
    });

    lane.enqueue(payload);
  });
}

/**
 * Create a lane-ordered async function
 */
export function createLanedFunction<T, R>(
  getSessionId: (payload: T) => string,
  processor: (payload: T) => Promise<R>,
  config?: Partial<LaneConfig>
): (payload: T) => Promise<R> {
  const manager = getLaneManager<T>(config);

  // Set the processor once
  manager.setDefaultProcessor(async (item) => {
    return await processor(item.payload);
  });

  return async (payload: T): Promise<R> => {
    const sessionId = getSessionId(payload);

    return new Promise((resolve, reject) => {
      const lane = manager.getLane(sessionId);

      const onComplete = (item: LaneItem<T>, result: unknown) => {
        if (item.payload === payload) {
          lane.off('complete', onComplete);
          lane.off('error', onError);
          resolve(result as R);
        }
      };

      const onError = (item: LaneItem<T>, error: Error) => {
        if (item.payload === payload) {
          lane.off('complete', onComplete);
          lane.off('error', onError);
          reject(error);
        }
      };

      lane.on('complete', onComplete);
      lane.on('error', onError);

      lane.enqueue(payload);
    });
  };
}
