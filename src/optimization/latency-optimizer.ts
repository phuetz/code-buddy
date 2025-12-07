/**
 * Latency Optimizer
 *
 * Research-based implementation for maintaining developer flow state.
 * Targets sub-500ms response times for common operations.
 *
 * Expected Impact:
 * - Preserved developer flow state
 * - Better user experience
 * - Reduced perceived latency
 *
 * Reference: Replit research, Human-AI Interaction studies (2024)
 */

import { EventEmitter } from "events";

/**
 * Latency thresholds (in milliseconds)
 */
export const LATENCY_THRESHOLDS = {
  /** Instant - no perceived delay */
  INSTANT: 100,

  /** Fast - maintains flow state */
  FAST: 300,

  /** Acceptable - still responsive */
  ACCEPTABLE: 500,

  /** Slow - noticeable delay */
  SLOW: 1000,

  /** Very slow - interrupts flow */
  VERY_SLOW: 3000,
} as const;

/**
 * Operation types with target latencies
 */
export const OPERATION_TARGETS: Record<string, number> = {
  // File operations - should be instant
  file_read: 100,
  file_write: 200,
  file_search: 300,

  // Code operations
  symbol_search: 300,
  code_completion: 500,
  code_analysis: 1000,

  // Search operations
  grep_search: 200,
  glob_search: 100,

  // LLM operations
  simple_response: 500,
  complex_response: 3000,
  streaming_start: 300,

  // Tool operations
  tool_execution: 1000,
  bash_command: 5000,
};

/**
 * Latency measurement
 */
export interface LatencyMeasurement {
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  target: number;
  status: "pending" | "met" | "exceeded";
}

/**
 * Pre-computation cache entry
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttlMs: number;
  accessCount: number;
}

/**
 * Latency optimizer class
 */
export class LatencyOptimizer extends EventEmitter {
  private measurements: LatencyMeasurement[] = [];
  private precomputeCache: Map<string, CacheEntry<unknown>> = new Map();
  private pendingPrecomputes: Map<string, Promise<unknown>> = new Map();
  private warmupTasks: Array<() => Promise<void>> = [];
  private isWarmingUp: boolean = false;

  constructor() {
    super();
    this.startPeriodicCleanup();
  }

  /**
   * Start measuring an operation
   */
  startOperation(operation: string): string {
    const startTime = Date.now();
    const randomPart = Math.random().toString(36).slice(2);
    // Use :: as separator to avoid conflicts with operation names containing -
    const id = `${operation}::${startTime}::${randomPart}`;
    const target = OPERATION_TARGETS[operation] || LATENCY_THRESHOLDS.ACCEPTABLE;

    const measurement: LatencyMeasurement = {
      operation,
      startTime,
      target,
      status: "pending",
    };

    this.measurements.push(measurement);
    this.emit("operation:start", { id, operation, target });

    return id;
  }

  /**
   * End measuring an operation
   */
  endOperation(id: string): LatencyMeasurement | null {
    // Support both old format (with -) and new format (with ::)
    const separator = id.includes("::") ? "::" : "-";
    const parts = id.split(separator);

    // For new format: operation::timestamp::random
    // For old format with simple operation: operation-timestamp-random
    let operation: string;
    let startTimeStr: string;

    if (separator === "::") {
      operation = parts[0];
      startTimeStr = parts[1];
    } else {
      // Old format - find the timestamp (13-digit number)
      const timestampIndex = parts.findIndex(p => /^\d{13}$/.test(p));
      if (timestampIndex === -1) {
        // Fallback to old behavior for backward compatibility
        operation = parts[0];
        startTimeStr = parts[1];
      } else {
        operation = parts.slice(0, timestampIndex).join("-");
        startTimeStr = parts[timestampIndex];
      }
    }

    const measurement = this.measurements.find(
      (m) => m.operation === operation && m.startTime.toString() === startTimeStr
    );

    if (!measurement) return null;

    measurement.endTime = Date.now();
    measurement.duration = measurement.endTime - measurement.startTime;
    measurement.status = measurement.duration <= measurement.target ? "met" : "exceeded";

    this.emit("operation:end", {
      operation,
      duration: measurement.duration,
      target: measurement.target,
      status: measurement.status,
    });

    return measurement;
  }

  /**
   * Measure an async operation
   */
  async measure<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const id = this.startOperation(operation);
    try {
      const result = await fn();
      this.endOperation(id);
      return result;
    } catch (error) {
      this.endOperation(id);
      throw error;
    }
  }

  /**
   * Pre-compute and cache a value for faster retrieval
   */
  async precompute<T>(
    key: string,
    compute: () => Promise<T>,
    ttlMs: number = 60000
  ): Promise<T> {
    // Check if already cached
    const cached = this.precomputeCache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttlMs) {
      cached.accessCount++;
      this.emit("cache:hit", { key });
      return cached.value as T;
    }

    // Check if already computing
    const pending = this.pendingPrecomputes.get(key);
    if (pending) {
      return pending as Promise<T>;
    }

    // Compute new value
    this.emit("cache:miss", { key });
    const promise = compute().then((value) => {
      this.precomputeCache.set(key, {
        value,
        timestamp: Date.now(),
        ttlMs,
        accessCount: 1,
      });
      this.pendingPrecomputes.delete(key);
      return value;
    });

    this.pendingPrecomputes.set(key, promise);
    return promise;
  }

  /**
   * Invalidate a cached value
   */
  invalidate(key: string): void {
    this.precomputeCache.delete(key);
    this.emit("cache:invalidate", { key });
  }

  /**
   * Invalidate all cached values matching a pattern
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.precomputeCache.keys()) {
      if (pattern.test(key)) {
        this.precomputeCache.delete(key);
        count++;
      }
    }
    this.emit("cache:invalidate_pattern", { pattern: pattern.toString(), count });
    return count;
  }

  /**
   * Register a warmup task
   */
  registerWarmup(task: () => Promise<void>): void {
    this.warmupTasks.push(task);
  }

  /**
   * Execute all warmup tasks
   */
  async warmup(): Promise<void> {
    if (this.isWarmingUp) return;

    this.isWarmingUp = true;
    this.emit("warmup:start", { taskCount: this.warmupTasks.length });

    try {
      await Promise.all(this.warmupTasks.map((task) => task()));
      this.emit("warmup:complete", { taskCount: this.warmupTasks.length });
    } catch (error) {
      this.emit("warmup:error", { error });
    } finally {
      this.isWarmingUp = false;
    }
  }

  /**
   * Get latency statistics
   */
  getStats(): {
    totalOperations: number;
    metTarget: number;
    exceededTarget: number;
    avgDuration: number;
    p50: number;
    p95: number;
    p99: number;
    byOperation: Record<string, { count: number; avg: number; met: number }>;
  } {
    const completed = this.measurements.filter((m) => m.duration !== undefined);

    if (completed.length === 0) {
      return {
        totalOperations: 0,
        metTarget: 0,
        exceededTarget: 0,
        avgDuration: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        byOperation: {},
      };
    }

    const durations = completed.map((m) => m.duration!).sort((a, b) => a - b);

    const percentile = (p: number): number => {
      const index = Math.ceil((p / 100) * durations.length) - 1;
      return durations[Math.max(0, index)];
    };

    // Group by operation
    const byOperation: Record<string, { count: number; avg: number; met: number }> = {};
    for (const m of completed) {
      if (!byOperation[m.operation]) {
        byOperation[m.operation] = { count: 0, avg: 0, met: 0 };
      }
      const op = byOperation[m.operation];
      op.count++;
      op.avg = (op.avg * (op.count - 1) + m.duration!) / op.count;
      if (m.status === "met") op.met++;
    }

    // Convert met to percentage
    for (const op of Object.values(byOperation)) {
      op.met = op.count > 0 ? (op.met / op.count) * 100 : 0;
    }

    return {
      totalOperations: completed.length,
      metTarget: completed.filter((m) => m.status === "met").length,
      exceededTarget: completed.filter((m) => m.status === "exceeded").length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
      byOperation,
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    totalAccesses: number;
    avgAccessCount: number;
  } {
    let totalAccesses = 0;
    for (const entry of this.precomputeCache.values()) {
      totalAccesses += entry.accessCount;
    }

    return {
      size: this.precomputeCache.size,
      totalAccesses,
      avgAccessCount:
        this.precomputeCache.size > 0
          ? totalAccesses / this.precomputeCache.size
          : 0,
    };
  }

  /**
   * Clean old measurements and expired cache entries
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    // Clean old measurements
    this.measurements = this.measurements.filter(
      (m) => now - m.startTime < maxAge
    );

    // Clean expired cache entries
    for (const [key, entry] of this.precomputeCache) {
      if (now - entry.timestamp > entry.ttlMs) {
        this.precomputeCache.delete(key);
      }
    }
  }

  /**
   * Start periodic cleanup
   */
  private startPeriodicCleanup(): void {
    setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Reset all measurements
   */
  reset(): void {
    this.measurements = [];
    this.precomputeCache.clear();
    this.pendingPrecomputes.clear();
  }
}

/**
 * Streaming response optimizer
 * Ensures first token arrives quickly for better perceived latency
 */
export class StreamingOptimizer {
  private firstTokenTimes: number[] = [];
  private totalTokenTimes: number[] = [];

  /**
   * Record first token latency
   */
  recordFirstToken(latencyMs: number): void {
    this.firstTokenTimes.push(latencyMs);
  }

  /**
   * Record total streaming time
   */
  recordTotalTime(latencyMs: number): void {
    this.totalTokenTimes.push(latencyMs);
  }

  /**
   * Get streaming statistics
   */
  getStats(): {
    avgFirstToken: number;
    avgTotalTime: number;
    firstTokenP50: number;
    firstTokenP95: number;
    meetingTarget: number;
  } {
    if (this.firstTokenTimes.length === 0) {
      return {
        avgFirstToken: 0,
        avgTotalTime: 0,
        firstTokenP50: 0,
        firstTokenP95: 0,
        meetingTarget: 0,
      };
    }

    const sorted = [...this.firstTokenTimes].sort((a, b) => a - b);
    const percentile = (p: number): number => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    const target = OPERATION_TARGETS.streaming_start;
    const meetingTarget = this.firstTokenTimes.filter((t) => t <= target).length;

    return {
      avgFirstToken:
        this.firstTokenTimes.reduce((a, b) => a + b, 0) / this.firstTokenTimes.length,
      avgTotalTime:
        this.totalTokenTimes.length > 0
          ? this.totalTokenTimes.reduce((a, b) => a + b, 0) / this.totalTokenTimes.length
          : 0,
      firstTokenP50: percentile(50),
      firstTokenP95: percentile(95),
      meetingTarget: (meetingTarget / this.firstTokenTimes.length) * 100,
    };
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.firstTokenTimes = [];
    this.totalTokenTimes = [];
  }
}

// Singleton instances
let latencyOptimizer: LatencyOptimizer | null = null;
let streamingOptimizer: StreamingOptimizer | null = null;

/**
 * Get global latency optimizer
 */
export function getLatencyOptimizer(): LatencyOptimizer {
  if (!latencyOptimizer) {
    latencyOptimizer = new LatencyOptimizer();
  }
  return latencyOptimizer;
}

/**
 * Get global streaming optimizer
 */
export function getStreamingOptimizer(): StreamingOptimizer {
  if (!streamingOptimizer) {
    streamingOptimizer = new StreamingOptimizer();
  }
  return streamingOptimizer;
}

/**
 * Convenience function for measuring operations
 */
export async function measureLatency<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  return getLatencyOptimizer().measure(operation, fn);
}

/**
 * Convenience function for pre-computing values
 */
export async function precompute<T>(
  key: string,
  compute: () => Promise<T>,
  ttlMs?: number
): Promise<T> {
  return getLatencyOptimizer().precompute(key, compute, ttlMs);
}

export default {
  LatencyOptimizer,
  StreamingOptimizer,
  getLatencyOptimizer,
  getStreamingOptimizer,
  measureLatency,
  precompute,
  LATENCY_THRESHOLDS,
  OPERATION_TARGETS,
};
