/**
 * Parallel Tool Executor
 *
 * Research-based implementation of parallel tool execution.
 * Identifies and executes independent tool calls in parallel.
 *
 * Expected Impact:
 * - 2.5-4.6x cost reduction
 * - 1.6-5.4x latency reduction
 *
 * Reference: LLMCompiler, AsyncLM (arXiv 2024)
 */

import { EventEmitter } from "events";

/**
 * Tool call definition
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  dependencies?: string[]; // IDs of tool calls this depends on
}

/**
 * Tool execution result
 */
export interface ToolResult {
  id: string;
  name: string;
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
  startTime: number;
  endTime: number;
}

/**
 * Execution group - tools that can run in parallel
 */
export interface ExecutionGroup {
  level: number;
  calls: ToolCall[];
}

/**
 * Tool executor function type
 */
export type ToolExecutor = (call: ToolCall) => Promise<unknown>;

/**
 * Execution options
 */
export interface ExecutionOptions {
  /** Maximum concurrent executions */
  maxConcurrency: number;

  /** Timeout per tool call in ms */
  timeoutMs: number;

  /** Whether to continue on errors */
  continueOnError: boolean;

  /** Retry count for failed calls */
  retryCount: number;

  /** Delay between retries in ms */
  retryDelayMs: number;
}

/**
 * Default execution options
 */
export const DEFAULT_EXECUTION_OPTIONS: ExecutionOptions = {
  maxConcurrency: 5,
  timeoutMs: 30000,
  continueOnError: true,
  retryCount: 1,
  retryDelayMs: 1000,
};

/**
 * Analyze tool calls to identify dependencies
 */
export function analyzeDependencies(calls: ToolCall[]): Map<string, string[]> {
  const dependencies = new Map<string, string[]>();

  if (!calls || !Array.isArray(calls)) {
    return dependencies;
  }

  // Build a map of what each call produces/consumes
  const producers = new Map<string, string>(); // resource -> producer call ID
  const _consumers = new Map<string, string[]>(); // call ID -> resources it consumes (future use)

  for (const call of calls) {
    if (!call || !call.id) continue;

    dependencies.set(call.id, []);

    // Analyze arguments for file paths or references to other outputs
    const _args = JSON.stringify(call.arguments || {}).toLowerCase();
    const callName = (call.name || "").toLowerCase();

    // Check for file operations - sequential file ops on same file need ordering
    if (callName.includes("write") || callName.includes("edit")) {
      const filePath = extractFilePath(call.arguments);
      if (filePath) {
        // Writing to a file - this produces the file state
        const existingProducer = producers.get(filePath);
        if (existingProducer) {
          // Depends on previous write to same file
          dependencies.get(call.id)?.push(existingProducer);
        }
        producers.set(filePath, call.id);
      }
    }

    if (callName.includes("read")) {
      const filePath = extractFilePath(call.arguments);
      if (filePath) {
        // Reading a file - might depend on a write
        const producer = producers.get(filePath);
        if (producer) {
          dependencies.get(call.id)?.push(producer);
        }
      }
    }

    // Bash commands might have implicit dependencies
    if (callName === "bash") {
      const command = String(call.arguments?.command || "").toLowerCase();

      // Build/test commands should run after file modifications
      if (command.includes("npm test") ||
          command.includes("npm run") ||
          command.includes("build")) {
        // Depends on all previous edits
        for (const [_idx, otherCall] of calls.entries()) {
          if (otherCall.id !== call.id &&
              (otherCall.name.toLowerCase().includes("write") ||
               otherCall.name.toLowerCase().includes("edit"))) {
            dependencies.get(call.id)?.push(otherCall.id);
          }
        }
      }
    }

    // Use explicit dependencies if provided
    if (call.dependencies) {
      const existing = dependencies.get(call.id) || [];
      dependencies.set(call.id, [...existing, ...call.dependencies]);
    }
  }

  return dependencies;
}

/**
 * Extract file path from tool arguments
 */
function extractFilePath(args: Record<string, unknown>): string | null {
  for (const key of ["file_path", "filePath", "path", "file"]) {
    if (typeof args[key] === "string") {
      return args[key] as string;
    }
  }
  return null;
}

/**
 * Group tool calls into execution levels based on dependencies
 */
export function groupByDependency(calls: ToolCall[]): ExecutionGroup[] {
  if (calls.length === 0) return [];

  const dependencies = analyzeDependencies(calls);
  const _callMap = new Map(calls.map((c) => [c.id, c])); // Reserved for future dependency resolution
  const levels: ExecutionGroup[] = [];
  const assigned = new Set<string>();

  let level = 0;
  while (assigned.size < calls.length) {
    const currentLevel: ToolCall[] = [];

    for (const call of calls) {
      if (assigned.has(call.id)) continue;

      const deps = dependencies.get(call.id) || [];
      const allDepsResolved = deps.every((depId) => assigned.has(depId));

      if (allDepsResolved) {
        currentLevel.push(call);
      }
    }

    if (currentLevel.length === 0) {
      // Circular dependency or unreachable - add remaining
      for (const call of calls) {
        if (!assigned.has(call.id)) {
          currentLevel.push(call);
        }
      }
    }

    for (const call of currentLevel) {
      assigned.add(call.id);
    }

    levels.push({ level, calls: currentLevel });
    level++;
  }

  return levels;
}

/**
 * Parallel executor class
 */
export class ParallelExecutor extends EventEmitter {
  private options: ExecutionOptions;
  private executor: ToolExecutor;
  private activeCount: number = 0;
  private results: Map<string, ToolResult> = new Map();

  constructor(executor: ToolExecutor, options: Partial<ExecutionOptions> = {}) {
    super();
    this.executor = executor;
    this.options = { ...DEFAULT_EXECUTION_OPTIONS, ...options };
  }

  /**
   * Execute tool calls with optimal parallelism
   */
  async execute(calls: ToolCall[]): Promise<ToolResult[]> {
    if (calls.length === 0) return [];

    const startTime = Date.now();
    this.results.clear();

    // Group by dependency
    const groups = groupByDependency(calls);

    this.emit("execution:start", {
      totalCalls: calls.length,
      groups: groups.length,
    });

    // Execute groups sequentially, calls within group in parallel
    for (const group of groups) {
      this.emit("group:start", {
        level: group.level,
        callCount: group.calls.length,
      });

      await this.executeGroup(group);

      this.emit("group:complete", {
        level: group.level,
        callCount: group.calls.length,
      });
    }

    const totalTime = Date.now() - startTime;
    const results = Array.from(this.results.values());

    this.emit("execution:complete", {
      totalCalls: calls.length,
      totalTime,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
    });

    return results;
  }

  /**
   * Execute a group of independent calls in parallel
   */
  private async executeGroup(group: ExecutionGroup): Promise<void> {
    const { maxConcurrency } = this.options;

    // Use a semaphore pattern for concurrency control
    const queue = [...group.calls];
    const executing: Promise<void>[] = [];

    while (queue.length > 0 || executing.length > 0) {
      // Start new executions up to concurrency limit
      while (queue.length > 0 && executing.length < maxConcurrency) {
        const call = queue.shift()!;
        const promise = this.executeCall(call).then(() => {
          const index = executing.indexOf(promise);
          if (index > -1) executing.splice(index, 1);
        });
        executing.push(promise);
      }

      // Wait for at least one to complete
      if (executing.length > 0) {
        await Promise.race(executing);
      }
    }
  }

  /**
   * Execute a single tool call with retry and timeout
   */
  private async executeCall(call: ToolCall): Promise<void> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.retryCount; attempt++) {
      try {
        this.emit("call:start", { id: call.id, name: call.name, attempt });

        // Execute with timeout
        const output = await this.executeWithTimeout(call);

        const endTime = Date.now();
        const result: ToolResult = {
          id: call.id,
          name: call.name,
          success: true,
          output,
          duration: endTime - startTime,
          startTime,
          endTime,
        };

        this.results.set(call.id, result);
        this.emit("call:success", result);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        this.emit("call:error", {
          id: call.id,
          name: call.name,
          attempt,
          error: lastError.message,
        });

        if (attempt < this.options.retryCount) {
          await this.delay(this.options.retryDelayMs);
        }
      }
    }

    // All retries failed
    const endTime = Date.now();
    const result: ToolResult = {
      id: call.id,
      name: call.name,
      success: false,
      error: lastError?.message || "Unknown error",
      duration: endTime - startTime,
      startTime,
      endTime,
    };

    this.results.set(call.id, result);
    this.emit("call:failure", result);

    if (!this.options.continueOnError) {
      throw lastError;
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout(call: ToolCall): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout after ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);

      this.executor(call)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get execution statistics
   */
  getStats(): {
    totalDuration: number;
    parallelSavings: number;
    successRate: number;
  } {
    const results = Array.from(this.results.values());
    if (results.length === 0) {
      return { totalDuration: 0, parallelSavings: 0, successRate: 0 };
    }

    // Calculate total duration (wall clock)
    const minStart = Math.min(...results.map((r) => r.startTime));
    const maxEnd = Math.max(...results.map((r) => r.endTime));
    const totalDuration = maxEnd - minStart;

    // Calculate sequential duration (sum of all durations)
    const sequentialDuration = results.reduce((sum, r) => sum + r.duration, 0);

    // Parallel savings
    const parallelSavings =
      sequentialDuration > 0
        ? ((sequentialDuration - totalDuration) / sequentialDuration) * 100
        : 0;

    // Success rate
    const successRate = (results.filter((r) => r.success).length / results.length) * 100;

    return {
      totalDuration,
      parallelSavings,
      successRate,
    };
  }

  /**
   * Update options
   */
  updateOptions(options: Partial<ExecutionOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

/**
 * Estimate parallel execution speedup
 */
export function estimateSpeedup(calls: ToolCall[]): {
  sequentialEstimate: number;
  parallelEstimate: number;
  speedupFactor: number;
} {
  if (calls.length === 0) {
    return { sequentialEstimate: 0, parallelEstimate: 0, speedupFactor: 1 };
  }

  const groups = groupByDependency(calls);

  // Estimate 1 second per call (rough average)
  const avgCallDuration = 1000;

  const sequentialEstimate = calls.length * avgCallDuration;

  // Parallel estimate: max duration in each group level
  const parallelEstimate = groups.reduce((total, group) => {
    // Within a group, max duration is the bottleneck
    return total + avgCallDuration; // Simplified: assumes all calls same duration
  }, 0);

  const speedupFactor =
    parallelEstimate > 0 ? sequentialEstimate / parallelEstimate : 1;

  return {
    sequentialEstimate,
    parallelEstimate,
    speedupFactor,
  };
}

/**
 * Create a simple parallel executor for common use cases
 */
export function createParallelExecutor(
  executor: ToolExecutor,
  options?: Partial<ExecutionOptions>
): ParallelExecutor {
  return new ParallelExecutor(executor, options);
}

export default {
  ParallelExecutor,
  groupByDependency,
  analyzeDependencies,
  estimateSpeedup,
  createParallelExecutor,
  DEFAULT_EXECUTION_OPTIONS,
};
