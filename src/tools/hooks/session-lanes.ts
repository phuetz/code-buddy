/**
 * Session Lanes for Tool Execution
 *
 * OpenClaw-inspired serialized execution system to prevent race conditions:
 * - Per-session lane serialization
 * - Global lane for cross-session operations
 * - Timeout handling with configurable limits
 * - Early termination via AbortSignal
 * - Queue management and metrics
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Lane execution task
 */
export interface LaneTask<T = unknown> {
  /** Task ID */
  id: string;
  /** Session ID (or 'global') */
  sessionId: string;
  /** Task name/description */
  name: string;
  /** Task function */
  execute: () => Promise<T>;
  /** Priority (higher = runs first in queue) */
  priority: number;
  /** Timeout in ms */
  timeoutMs: number;
  /** Abort signal */
  abortSignal?: AbortSignal;
  /** Created timestamp */
  createdAt: number;
  /** Started timestamp */
  startedAt?: number;
  /** Completed timestamp */
  completedAt?: number;
  /** Resolve function for promise */
  resolve: (value: T) => void;
  /** Reject function for promise */
  reject: (error: Error) => void;
}

/**
 * Lane status
 */
export type LaneStatus = 'idle' | 'executing' | 'draining';

/**
 * Lane info
 */
export interface LaneInfo {
  /** Session ID */
  sessionId: string;
  /** Current status */
  status: LaneStatus;
  /** Queue size */
  queueSize: number;
  /** Current task ID (if executing) */
  currentTaskId?: string;
  /** Total tasks executed */
  totalExecuted: number;
  /** Total errors */
  totalErrors: number;
  /** Created timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
}

/**
 * Session lanes configuration
 */
export interface SessionLanesConfig {
  /** Default task timeout in ms */
  defaultTimeoutMs: number;
  /** Default wait timeout in ms */
  defaultWaitTimeoutMs: number;
  /** Maximum queue size per lane */
  maxQueueSize: number;
  /** Lane idle timeout in ms (auto-cleanup) */
  laneIdleTimeoutMs: number;
  /** Enable metrics collection */
  enableMetrics: boolean;
  /** Global lane concurrency (usually 1) */
  globalLaneConcurrency: number;
}

/**
 * Default configuration
 */
export const DEFAULT_SESSION_LANES_CONFIG: SessionLanesConfig = {
  defaultTimeoutMs: 600_000, // 10 minutes (OpenClaw default)
  defaultWaitTimeoutMs: 30_000, // 30 seconds (OpenClaw default)
  maxQueueSize: 100,
  laneIdleTimeoutMs: 300_000, // 5 minutes
  enableMetrics: true,
  globalLaneConcurrency: 1,
};

/**
 * Lane execution result
 */
export interface LaneExecutionResult<T> {
  /** Task ID */
  taskId: string;
  /** Success status */
  success: boolean;
  /** Result value */
  result?: T;
  /** Error if failed */
  error?: Error;
  /** Execution time in ms */
  executionTimeMs: number;
  /** Was task cancelled */
  cancelled: boolean;
  /** Was task timed out */
  timedOut: boolean;
}

/**
 * Session lanes events
 */
export interface SessionLanesEvents {
  'lane:created': (sessionId: string) => void;
  'lane:destroyed': (sessionId: string) => void;
  'task:queued': (sessionId: string, taskId: string) => void;
  'task:started': (sessionId: string, taskId: string) => void;
  'task:completed': (sessionId: string, taskId: string, durationMs: number) => void;
  'task:failed': (sessionId: string, taskId: string, error: Error) => void;
  'task:timeout': (sessionId: string, taskId: string) => void;
  'task:cancelled': (sessionId: string, taskId: string) => void;
}

// ============================================================================
// Session Lane
// ============================================================================

/**
 * Individual session lane for serialized execution
 */
class SessionLane extends EventEmitter {
  readonly sessionId: string;
  private queue: LaneTask[] = [];
  private status: LaneStatus = 'idle';
  private currentTask: LaneTask | null = null;
  private totalExecuted = 0;
  private totalErrors = 0;
  private createdAt: number;
  private lastActivityAt: number;
  private processing = false;

  constructor(
    sessionId: string,
    private config: SessionLanesConfig
  ) {
    super();
    this.sessionId = sessionId;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
  }

  /**
   * Queue a task for execution
   */
  async enqueue<T>(task: Omit<LaneTask<T>, 'resolve' | 'reject' | 'id' | 'createdAt'>): Promise<T> {
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Lane queue full (max ${this.config.maxQueueSize})`);
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<T>((resolve, reject) => {
      const fullTask: LaneTask<T> = {
        ...task,
        id: taskId,
        createdAt: Date.now(),
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      // Insert by priority (higher first)
      const insertIndex = this.queue.findIndex(t => t.priority < task.priority);
      if (insertIndex === -1) {
        this.queue.push(fullTask as LaneTask);
      } else {
        this.queue.splice(insertIndex, 0, fullTask as LaneTask);
      }

      this.lastActivityAt = Date.now();
      this.emit('task:queued', this.sessionId, taskId);

      // Start processing if not already
      this.processQueue();
    });
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    this.status = 'executing';

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.currentTask = task;
      task.startedAt = Date.now();

      this.emit('task:started', this.sessionId, task.id);

      try {
        // Execute with timeout and abort signal
        const result = await this.executeWithTimeout(task);

        task.completedAt = Date.now();
        this.totalExecuted++;
        this.lastActivityAt = Date.now();

        const duration = task.completedAt - task.startedAt;
        this.emit('task:completed', this.sessionId, task.id, duration);

        task.resolve(result);
      } catch (error) {
        task.completedAt = Date.now();
        this.totalErrors++;
        this.lastActivityAt = Date.now();

        const err = error as Error;

        if (err.message.includes('aborted') || err.message.includes('cancelled')) {
          this.emit('task:cancelled', this.sessionId, task.id);
        } else if (err.message.includes('timeout')) {
          this.emit('task:timeout', this.sessionId, task.id);
        } else {
          this.emit('task:failed', this.sessionId, task.id, err);
        }

        task.reject(err);
      }

      this.currentTask = null;
    }

    this.processing = false;
    this.status = 'idle';
  }

  /**
   * Execute task with timeout and abort signal
   */
  private async executeWithTimeout<T>(task: LaneTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        reject(new Error(`Task ${task.id} timed out after ${task.timeoutMs}ms`));
      }, task.timeoutMs);

      // Set up abort signal listener
      if (task.abortSignal) {
        if (task.abortSignal.aborted) {
          clearTimeout(timeoutId);
          reject(new Error(`Task ${task.id} was aborted`));
          return;
        }

        task.abortSignal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new Error(`Task ${task.id} was cancelled`));
        });
      }

      // Execute task
      task.execute()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Cancel all pending tasks
   */
  cancelAll(): number {
    const count = this.queue.length;

    for (const task of this.queue) {
      task.reject(new Error('Task cancelled'));
      this.emit('task:cancelled', this.sessionId, task.id);
    }

    this.queue = [];
    return count;
  }

  /**
   * Cancel a specific task
   */
  cancelTask(taskId: string): boolean {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index === -1) return false;

    const [task] = this.queue.splice(index, 1);
    task.reject(new Error('Task cancelled'));
    this.emit('task:cancelled', this.sessionId, taskId);

    return true;
  }

  /**
   * Drain the lane (wait for current task, cancel pending)
   */
  async drain(): Promise<void> {
    this.status = 'draining';

    // Cancel pending tasks
    this.cancelAll();

    // Wait for current task to complete
    if (this.currentTask) {
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.currentTask) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }

    this.status = 'idle';
  }

  /**
   * Get lane info
   */
  getInfo(): LaneInfo {
    return {
      sessionId: this.sessionId,
      status: this.status,
      queueSize: this.queue.length,
      currentTaskId: this.currentTask?.id,
      totalExecuted: this.totalExecuted,
      totalErrors: this.totalErrors,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
    };
  }

  /**
   * Check if lane is idle and old enough for cleanup
   */
  isIdleForCleanup(idleTimeoutMs: number): boolean {
    return (
      this.status === 'idle' &&
      this.queue.length === 0 &&
      Date.now() - this.lastActivityAt > idleTimeoutMs
    );
  }
}

// ============================================================================
// Session Lanes Manager
// ============================================================================

/**
 * Manages all session lanes
 */
export class SessionLanesManager extends EventEmitter {
  private config: SessionLanesConfig;
  private lanes: Map<string, SessionLane> = new Map();
  private globalLane: SessionLane;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<SessionLanesConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SESSION_LANES_CONFIG, ...config };

    // Create global lane
    this.globalLane = new SessionLane('__global__', this.config);
    this.setupLaneEvents(this.globalLane);

    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Execute a task in a session lane
   */
  async execute<T>(
    sessionId: string,
    name: string,
    fn: () => Promise<T>,
    options: {
      priority?: number;
      timeoutMs?: number;
      abortSignal?: AbortSignal;
      useGlobalLane?: boolean;
    } = {}
  ): Promise<LaneExecutionResult<T>> {
    const lane = options.useGlobalLane ? this.globalLane : this.getOrCreateLane(sessionId);
    const startTime = Date.now();

    try {
      const result = await lane.enqueue<T>({
        sessionId,
        name,
        execute: fn,
        priority: options.priority ?? 100,
        timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs,
        abortSignal: options.abortSignal,
      });

      return {
        taskId: `${sessionId}_${Date.now()}`,
        success: true,
        result,
        executionTimeMs: Date.now() - startTime,
        cancelled: false,
        timedOut: false,
      };
    } catch (error) {
      const err = error as Error;
      const isCancelled = err.message.includes('cancelled') || err.message.includes('aborted');
      const isTimedOut = err.message.includes('timeout');

      return {
        taskId: `${sessionId}_${Date.now()}`,
        success: false,
        error: err,
        executionTimeMs: Date.now() - startTime,
        cancelled: isCancelled,
        timedOut: isTimedOut,
      };
    }
  }

  /**
   * Execute in global lane (cross-session)
   */
  async executeGlobal<T>(
    name: string,
    fn: () => Promise<T>,
    options: {
      priority?: number;
      timeoutMs?: number;
      abortSignal?: AbortSignal;
    } = {}
  ): Promise<LaneExecutionResult<T>> {
    return this.execute('__global__', name, fn, { ...options, useGlobalLane: true });
  }

  /**
   * Wait for a condition with timeout (like agent.wait in OpenClaw)
   */
  async wait<T>(
    sessionId: string,
    condition: () => Promise<T | null>,
    options: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      abortSignal?: AbortSignal;
    } = {}
  ): Promise<T> {
    const timeout = options.timeoutMs ?? this.config.defaultWaitTimeoutMs;
    const pollInterval = options.pollIntervalMs ?? 500;
    const startTime = Date.now();

    return this.execute(sessionId, 'wait', async () => {
      while (true) {
        // Check abort
        if (options.abortSignal?.aborted) {
          throw new Error('Wait was aborted');
        }

        // Check timeout
        if (Date.now() - startTime > timeout) {
          throw new Error(`Wait timed out after ${timeout}ms`);
        }

        // Check condition
        const result = await condition();
        if (result !== null) {
          return result;
        }

        // Poll interval
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }, { timeoutMs: timeout, abortSignal: options.abortSignal }).then(r => {
      if (!r.success) throw r.error;
      return r.result!;
    });
  }

  /**
   * Get or create a session lane
   */
  private getOrCreateLane(sessionId: string): SessionLane {
    let lane = this.lanes.get(sessionId);

    if (!lane) {
      lane = new SessionLane(sessionId, this.config);
      this.setupLaneEvents(lane);
      this.lanes.set(sessionId, lane);
      this.emit('lane:created', sessionId);

      logger.debug(`Created session lane: ${sessionId}`);
    }

    return lane;
  }

  /**
   * Setup event forwarding from lane
   */
  private setupLaneEvents(lane: SessionLane): void {
    lane.on('task:queued', (sessionId, taskId) =>
      this.emit('task:queued', sessionId, taskId));
    lane.on('task:started', (sessionId, taskId) =>
      this.emit('task:started', sessionId, taskId));
    lane.on('task:completed', (sessionId, taskId, duration) =>
      this.emit('task:completed', sessionId, taskId, duration));
    lane.on('task:failed', (sessionId, taskId, error) =>
      this.emit('task:failed', sessionId, taskId, error));
    lane.on('task:timeout', (sessionId, taskId) =>
      this.emit('task:timeout', sessionId, taskId));
    lane.on('task:cancelled', (sessionId, taskId) =>
      this.emit('task:cancelled', sessionId, taskId));
  }

  /**
   * Destroy a session lane
   */
  async destroyLane(sessionId: string): Promise<boolean> {
    const lane = this.lanes.get(sessionId);
    if (!lane) return false;

    await lane.drain();
    this.lanes.delete(sessionId);
    this.emit('lane:destroyed', sessionId);

    logger.debug(`Destroyed session lane: ${sessionId}`);
    return true;
  }

  /**
   * Cancel all tasks in a session
   */
  cancelSession(sessionId: string): number {
    const lane = this.lanes.get(sessionId);
    if (!lane) return 0;

    return lane.cancelAll();
  }

  /**
   * Get lane info
   */
  getLaneInfo(sessionId: string): LaneInfo | null {
    const lane = sessionId === '__global__' ? this.globalLane : this.lanes.get(sessionId);
    return lane?.getInfo() ?? null;
  }

  /**
   * Get all lanes info
   */
  getAllLanesInfo(): LaneInfo[] {
    const infos: LaneInfo[] = [this.globalLane.getInfo()];

    for (const lane of this.lanes.values()) {
      infos.push(lane.getInfo());
    }

    return infos;
  }

  /**
   * Start cleanup interval
   */
  private startCleanupInterval(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleLanes();
    }, 60_000); // Check every minute
  }

  /**
   * Stop cleanup interval
   */
  private stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Cleanup idle lanes
   */
  private cleanupIdleLanes(): number {
    let cleaned = 0;

    for (const [sessionId, lane] of this.lanes) {
      if (lane.isIdleForCleanup(this.config.laneIdleTimeoutMs)) {
        this.lanes.delete(sessionId);
        this.emit('lane:destroyed', sessionId);
        cleaned++;

        logger.debug(`Cleaned up idle lane: ${sessionId}`);
      }
    }

    return cleaned;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalLanes: number;
    activeLanes: number;
    idleLanes: number;
    totalQueued: number;
    globalLaneInfo: LaneInfo;
  } {
    const infos = this.getAllLanesInfo();
    const sessionLanes = infos.filter(i => i.sessionId !== '__global__');

    return {
      totalLanes: sessionLanes.length,
      activeLanes: sessionLanes.filter(i => i.status !== 'idle').length,
      idleLanes: sessionLanes.filter(i => i.status === 'idle').length,
      totalQueued: sessionLanes.reduce((sum, i) => sum + i.queueSize, 0),
      globalLaneInfo: this.globalLane.getInfo(),
    };
  }

  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    this.stopCleanupInterval();

    // Drain all lanes
    const drainPromises: Promise<void>[] = [];

    drainPromises.push(this.globalLane.drain());

    for (const lane of this.lanes.values()) {
      drainPromises.push(lane.drain());
    }

    await Promise.all(drainPromises);

    this.lanes.clear();

    logger.debug('Session lanes manager shutdown complete');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let sessionLanesInstance: SessionLanesManager | null = null;

/**
 * Get session lanes manager instance
 */
export function getSessionLanesManager(config?: Partial<SessionLanesConfig>): SessionLanesManager {
  if (!sessionLanesInstance) {
    sessionLanesInstance = new SessionLanesManager(config);
  }
  return sessionLanesInstance;
}

/**
 * Reset session lanes manager
 */
export async function resetSessionLanesManager(): Promise<void> {
  if (sessionLanesInstance) {
    await sessionLanesInstance.shutdown();
    sessionLanesInstance = null;
  }
}

export default SessionLanesManager;
