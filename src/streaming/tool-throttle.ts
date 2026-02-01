/**
 * Tool Throttle
 *
 * Throttles tool phase updates to prevent overwhelming
 * the UI with too many updates. Default throttle is 80ms.
 */

import type { ToolPhaseEvent } from './tool-phases.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Throttle configuration
 */
export interface ThrottleConfig {
  /** Throttle interval in milliseconds */
  intervalMs: number;
  /** Whether to emit the first event immediately */
  leading: boolean;
  /** Whether to emit the last event after interval */
  trailing: boolean;
  /** Maximum queue size for pending events */
  maxQueueSize: number;
}

/**
 * Default throttle configuration
 */
export const DEFAULT_THROTTLE_CONFIG: ThrottleConfig = {
  intervalMs: 80,
  leading: true,
  trailing: true,
  maxQueueSize: 100,
};

// ============================================================================
// Throttle Function
// ============================================================================

/**
 * Create a throttled function
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  config: Partial<ThrottleConfig> = {}
): T & { cancel: () => void; flush: () => void } {
  const cfg = { ...DEFAULT_THROTTLE_CONFIG, ...config };

  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now();
    const elapsed = now - lastCall;

    const execute = () => {
      lastCall = Date.now();
      lastArgs = null;
      fn.apply(this, args);
    };

    if (elapsed >= cfg.intervalMs) {
      // First call or interval has passed
      if (cfg.leading) {
        execute();
      } else {
        lastArgs = args;
        if (!timeoutId) {
          timeoutId = setTimeout(() => {
            timeoutId = null;
            if (lastArgs) {
              fn.apply(this, lastArgs);
              lastArgs = null;
              lastCall = Date.now();
            }
          }, cfg.intervalMs);
        }
      }
    } else {
      // Within interval, queue for trailing call
      lastArgs = args;
      if (cfg.trailing && !timeoutId) {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          if (lastArgs) {
            fn.apply(this, lastArgs);
            lastArgs = null;
            lastCall = Date.now();
          }
        }, cfg.intervalMs - elapsed);
      }
    }
  } as T & { cancel: () => void; flush: () => void };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  throttled.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (lastArgs) {
      fn.apply(null, lastArgs);
      lastArgs = null;
      lastCall = Date.now();
    }
  };

  return throttled;
}

// ============================================================================
// Tool Phase Throttler
// ============================================================================

/**
 * Throttled event queue entry
 */
interface QueueEntry {
  event: ToolPhaseEvent;
  timestamp: number;
}

/**
 * Throttles tool phase events by tool call ID
 */
export class ToolPhaseThrottler {
  private config: ThrottleConfig;
  private queues: Map<string, QueueEntry[]> = new Map();
  private lastEmit: Map<string, number> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private callback: ((event: ToolPhaseEvent) => void) | null = null;

  constructor(config: Partial<ThrottleConfig> = {}) {
    this.config = { ...DEFAULT_THROTTLE_CONFIG, ...config };
  }

  /**
   * Set the callback for throttled events
   */
  setCallback(callback: (event: ToolPhaseEvent) => void): void {
    this.callback = callback;
  }

  /**
   * Push an event to the throttler
   */
  push(event: ToolPhaseEvent): void {
    const { toolCallId, phase } = event;
    const now = Date.now();

    // Start and result phases are always emitted immediately
    if (phase === 'start' || phase === 'result') {
      this.emitEvent(event);
      this.clearQueue(toolCallId);
      return;
    }

    // Check if we can emit immediately
    const lastEmitTime = this.lastEmit.get(toolCallId) || 0;
    const elapsed = now - lastEmitTime;

    if (elapsed >= this.config.intervalMs) {
      // Emit immediately if interval has passed
      this.emitEvent(event);
      this.lastEmit.set(toolCallId, now);
    } else {
      // Queue for later emission
      this.queueEvent(toolCallId, event);

      // Schedule trailing emission if not already scheduled
      if (!this.timers.has(toolCallId)) {
        const timer = setTimeout(() => {
          this.flushQueue(toolCallId);
        }, this.config.intervalMs - elapsed);
        this.timers.set(toolCallId, timer);
      }
    }
  }

  /**
   * Queue an event for later emission
   */
  private queueEvent(toolCallId: string, event: ToolPhaseEvent): void {
    let queue = this.queues.get(toolCallId);
    if (!queue) {
      queue = [];
      this.queues.set(toolCallId, queue);
    }

    queue.push({ event, timestamp: Date.now() });

    // Trim queue if too large (keep most recent)
    if (queue.length > this.config.maxQueueSize) {
      queue.shift();
    }
  }

  /**
   * Flush queued events for a tool call
   */
  private flushQueue(toolCallId: string): void {
    const timer = this.timers.get(toolCallId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(toolCallId);
    }

    const queue = this.queues.get(toolCallId);
    if (queue && queue.length > 0) {
      // Emit only the most recent event
      const latest = queue[queue.length - 1];
      this.emitEvent(latest.event);
      this.lastEmit.set(toolCallId, Date.now());
      this.queues.delete(toolCallId);
    }
  }

  /**
   * Clear queue for a tool call
   */
  private clearQueue(toolCallId: string): void {
    const timer = this.timers.get(toolCallId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(toolCallId);
    }
    this.queues.delete(toolCallId);
    this.lastEmit.delete(toolCallId);
  }

  /**
   * Emit an event via callback
   */
  private emitEvent(event: ToolPhaseEvent): void {
    if (this.callback) {
      try {
        this.callback(event);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Flush all pending events
   */
  flushAll(): void {
    for (const toolCallId of this.queues.keys()) {
      this.flushQueue(toolCallId);
    }
  }

  /**
   * Cancel all pending events
   */
  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.queues.clear();
    this.lastEmit.clear();
  }

  /**
   * Get throttle interval
   */
  getInterval(): number {
    return this.config.intervalMs;
  }

  /**
   * Set throttle interval
   */
  setInterval(intervalMs: number): void {
    this.config.intervalMs = intervalMs;
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.cancelAll();
    this.callback = null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let throttlerInstance: ToolPhaseThrottler | null = null;

/**
 * Get or create the ToolPhaseThrottler singleton
 */
export function getToolPhaseThrottler(config?: Partial<ThrottleConfig>): ToolPhaseThrottler {
  if (!throttlerInstance) {
    throttlerInstance = new ToolPhaseThrottler(config);
  }
  return throttlerInstance;
}

/**
 * Reset the ToolPhaseThrottler singleton
 */
export function resetToolPhaseThrottler(): void {
  if (throttlerInstance) {
    throttlerInstance.dispose();
  }
  throttlerInstance = null;
}
