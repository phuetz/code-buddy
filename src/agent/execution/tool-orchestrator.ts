/**
 * Tool Execution Orchestrator Module
 *
 * Manages the agentic tool execution loop, handling:
 * - Tool call batching and execution ordering
 * - Parallel vs sequential execution decisions
 * - Tool result collection and formatting
 * - Execution metrics and cost tracking
 *
 * @module agent/execution
 */

import { EventEmitter } from "events";
import { CodeBuddyToolCall } from "../../codebuddy/client.js";
import { ToolResult } from "../../types/index.js";
import { getErrorMessage } from "../../types/errors.js";
import { logger } from "../../utils/logger.js";

/**
 * Configuration for the ToolExecutionOrchestrator
 */
export interface OrchestratorConfig {
  /** Maximum number of tool execution rounds. Default: 50 */
  maxToolRounds: number;
  /** Enable parallel execution of safe tools. Default: true */
  parallelExecution: boolean;
  /** Timeout for individual tool execution in milliseconds. Default: 120000 */
  toolTimeout: number;
  /** Maximum concurrent tool executions. Default: 5 */
  maxConcurrent: number;
}

/**
 * Default orchestrator configuration
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxToolRounds: 50,
  parallelExecution: true,
  toolTimeout: 120000, // 2 minutes
  maxConcurrent: 5,
};

/**
 * Result of executing a batch of tool calls
 */
export interface BatchExecutionResult {
  /** Map of tool call ID to result */
  results: Map<string, ToolResult>;
  /** Total execution time in milliseconds */
  duration: number;
  /** Number of successful executions */
  successCount: number;
  /** Number of failed executions */
  failureCount: number;
  /** Whether tools were executed in parallel */
  parallel: boolean;
}

/**
 * Tool execution metrics
 */
export interface ExecutionMetrics {
  /** Total tool rounds executed */
  toolRounds: number;
  /** Total individual tool calls */
  totalCalls: number;
  /** Successful tool calls */
  successfulCalls: number;
  /** Failed tool calls */
  failedCalls: number;
  /** Total execution time across all tools */
  totalExecutionTime: number;
  /** Per-tool execution statistics */
  toolStats: Map<string, {
    calls: number;
    successes: number;
    failures: number;
    totalTime: number;
    avgTime: number;
  }>;
}

/**
 * Events emitted by the orchestrator
 */
export interface OrchestratorEvents {
  "round:start": { round: number; toolCount: number };
  "round:complete": { round: number; results: BatchExecutionResult };
  "tool:start": { toolCall: CodeBuddyToolCall };
  "tool:complete": { toolCall: CodeBuddyToolCall; result: ToolResult; duration: number };
  "tool:error": { toolCall: CodeBuddyToolCall; error: string };
  "max_rounds_reached": { rounds: number };
}

/**
 * Type for tool executor function
 */
export type ToolExecutor = (toolCall: CodeBuddyToolCall) => Promise<ToolResult>;

/**
 * Tools that are safe to run in parallel (read-only operations)
 */
const SAFE_PARALLEL_TOOLS = new Set([
  "view_file",
  "search",
  "web_search",
  "web_fetch",
  "codebase_map",
  "pdf",
  "audio",
  "video",
  "document",
  "ocr",
  "qr",
  "archive",
  "clipboard",
]);

/**
 * Tools that modify state (unsafe for parallel execution)
 */
const WRITE_TOOLS = new Set([
  "create_file",
  "str_replace_editor",
  "edit_file",
  "multi_edit",
  "bash",
  "git",
  "create_todo_list",
  "update_todo_list",
  "screenshot",
  "export",
  "diagram",
]);

/**
 * ToolExecutionOrchestrator - Manages the agentic tool execution loop
 *
 * This class handles the orchestration of tool execution during an
 * agent conversation, including:
 * - Deciding when to execute tools in parallel vs sequentially
 * - Managing execution rounds and preventing infinite loops
 * - Collecting and aggregating tool results
 * - Tracking execution metrics
 *
 * @example
 * ```typescript
 * const orchestrator = new ToolExecutionOrchestrator({
 *   maxToolRounds: 50,
 *   parallelExecution: true
 * });
 *
 * orchestrator.setExecutor(async (toolCall) => {
 *   // Execute the tool and return result
 *   return { success: true, output: "done" };
 * });
 *
 * const results = await orchestrator.executeBatch(toolCalls);
 * ```
 */
export class ToolExecutionOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private executor: ToolExecutor | null = null;
  private currentRound: number = 0;
  private metrics: ExecutionMetrics;
  private aborted: boolean = false;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.metrics = this.createEmptyMetrics();
  }

  /**
   * Set the tool executor function
   */
  setExecutor(executor: ToolExecutor): void {
    this.executor = executor;
  }

  /**
   * Check if tool calls can be safely executed in parallel
   *
   * Tools that modify the same files or have side effects should not be parallelized.
   * Read-only operations (view_file, search, web_search) are safe to parallelize.
   */
  canParallelizeToolCalls(toolCalls: CodeBuddyToolCall[]): boolean {
    if (!this.config.parallelExecution || toolCalls.length <= 1) {
      return false;
    }

    // Check if all tools are safe for parallel execution
    const allSafe = toolCalls.every(tc =>
      SAFE_PARALLEL_TOOLS.has(tc.function.name)
    );
    if (allSafe) return true;

    // Check if any write tools target the same file
    const writeToolCalls = toolCalls.filter(tc =>
      WRITE_TOOLS.has(tc.function.name)
    );
    if (writeToolCalls.length > 1) {
      // Extract file paths from arguments
      const filePaths = new Set<string>();
      for (const tc of writeToolCalls) {
        try {
          const args = JSON.parse(tc.function.arguments);
          const path = args.path || args.target_file || args.file_path;
          if (path) {
            if (filePaths.has(path)) {
              return false; // Same file targeted by multiple write tools
            }
            filePaths.add(path);
          }
        } catch {
          return false; // Can't parse args, be safe
        }
      }
      // Multiple write tools to different files - can parallelize
      return true;
    }

    // If there's only one write tool, safe to parallelize with read tools
    return writeToolCalls.length <= 1;
  }

  /**
   * Execute a batch of tool calls
   *
   * @param toolCalls - Array of tool calls to execute
   * @returns BatchExecutionResult with all results
   */
  async executeBatch(
    toolCalls: CodeBuddyToolCall[]
  ): Promise<BatchExecutionResult> {
    if (!this.executor) {
      throw new Error("Tool executor not set. Call setExecutor() first.");
    }

    const startTime = Date.now();
    const results = new Map<string, ToolResult>();

    this.currentRound++;
    this.metrics.toolRounds++;

    this.emit("round:start", {
      round: this.currentRound,
      toolCount: toolCalls.length,
    });

    const canParallelize = this.canParallelizeToolCalls(toolCalls);

    if (canParallelize) {
      // Execute in parallel with proper error handling per tool
      const promises = toolCalls.map(async (toolCall) => {
        const toolStartTime = Date.now();
        this.emit("tool:start", { toolCall });

        try {
          const result = await this.executeWithTimeout(toolCall);
          const duration = Date.now() - toolStartTime;

          this.emit("tool:complete", { toolCall, result, duration });
          this.updateToolStats(toolCall.function.name, result.success, duration);

          return { id: toolCall.id, result };
        } catch (error) {
          const duration = Date.now() - toolStartTime;
          const errorResult: ToolResult = {
            success: false,
            error: `Tool execution failed: ${getErrorMessage(error)}`,
          };

          this.emit("tool:error", {
            toolCall,
            error: getErrorMessage(error),
          });
          this.updateToolStats(toolCall.function.name, false, duration);

          return { id: toolCall.id, result: errorResult };
        }
      });

      const settled = await Promise.all(promises);
      for (const { id, result } of settled) {
        results.set(id, result);
      }
    } else {
      // Execute sequentially
      for (const toolCall of toolCalls) {
        if (this.aborted) {
          results.set(toolCall.id, {
            success: false,
            error: "Execution aborted",
          });
          continue;
        }

        const toolStartTime = Date.now();
        this.emit("tool:start", { toolCall });

        try {
          const result = await this.executeWithTimeout(toolCall);
          const duration = Date.now() - toolStartTime;

          results.set(toolCall.id, result);
          this.emit("tool:complete", { toolCall, result, duration });
          this.updateToolStats(toolCall.function.name, result.success, duration);
        } catch (error) {
          const duration = Date.now() - toolStartTime;
          const errorResult: ToolResult = {
            success: false,
            error: `Tool execution failed: ${getErrorMessage(error)}`,
          };

          results.set(toolCall.id, errorResult);
          this.emit("tool:error", {
            toolCall,
            error: getErrorMessage(error),
          });
          this.updateToolStats(toolCall.function.name, false, duration);
        }
      }
    }

    const duration = Date.now() - startTime;
    let successCount = 0;
    let failureCount = 0;

    for (const result of results.values()) {
      if (result.success) {
        successCount++;
        this.metrics.successfulCalls++;
      } else {
        failureCount++;
        this.metrics.failedCalls++;
      }
    }

    this.metrics.totalCalls += toolCalls.length;
    this.metrics.totalExecutionTime += duration;

    const batchResult: BatchExecutionResult = {
      results,
      duration,
      successCount,
      failureCount,
      parallel: canParallelize,
    };

    this.emit("round:complete", {
      round: this.currentRound,
      results: batchResult,
    });

    return batchResult;
  }

  /**
   * Execute a single tool call with timeout
   */
  private async executeWithTimeout(
    toolCall: CodeBuddyToolCall
  ): Promise<ToolResult> {
    if (!this.executor) {
      throw new Error("Tool executor not set");
    }

    const timeoutPromise = new Promise<ToolResult>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Tool execution timeout after ${this.config.toolTimeout}ms`)),
        this.config.toolTimeout
      );
    });

    return Promise.race([
      this.executor(toolCall),
      timeoutPromise,
    ]);
  }

  /**
   * Check if maximum tool rounds has been reached
   */
  hasReachedMaxRounds(): boolean {
    if (this.currentRound >= this.config.maxToolRounds) {
      this.emit("max_rounds_reached", { rounds: this.currentRound });
      return true;
    }
    return false;
  }

  /**
   * Get current round number
   */
  getCurrentRound(): number {
    return this.currentRound;
  }

  /**
   * Get remaining rounds
   */
  getRemainingRounds(): number {
    return Math.max(0, this.config.maxToolRounds - this.currentRound);
  }

  /**
   * Reset round counter for a new conversation
   */
  resetRounds(): void {
    this.currentRound = 0;
    this.aborted = false;
  }

  /**
   * Abort current execution
   */
  abort(): void {
    this.aborted = true;
    logger.info("Tool execution aborted");
  }

  /**
   * Check if execution was aborted
   */
  isAborted(): boolean {
    return this.aborted;
  }

  /**
   * Get execution metrics
   */
  getMetrics(): ExecutionMetrics {
    return {
      ...this.metrics,
      toolStats: new Map(this.metrics.toolStats),
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.createEmptyMetrics();
  }

  /**
   * Get configuration
   */
  getConfig(): OrchestratorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OrchestratorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Format metrics for display
   */
  formatMetrics(): string {
    const lines: string[] = [
      "Tool Execution Metrics",
      "======================",
      `Total Rounds: ${this.metrics.toolRounds}`,
      `Total Calls: ${this.metrics.totalCalls}`,
      `Successful: ${this.metrics.successfulCalls}`,
      `Failed: ${this.metrics.failedCalls}`,
      `Total Time: ${this.metrics.totalExecutionTime}ms`,
      "",
      "Per-Tool Statistics:",
    ];

    for (const [tool, stats] of this.metrics.toolStats) {
      lines.push(
        `  ${tool}: ${stats.calls} calls, ${stats.successes} success, ` +
        `${stats.failures} failed, avg ${stats.avgTime.toFixed(0)}ms`
      );
    }

    return lines.join("\n");
  }

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): ExecutionMetrics {
    return {
      toolRounds: 0,
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalExecutionTime: 0,
      toolStats: new Map(),
    };
  }

  /**
   * Update per-tool statistics
   */
  private updateToolStats(
    toolName: string,
    success: boolean,
    duration: number
  ): void {
    const existing = this.metrics.toolStats.get(toolName) || {
      calls: 0,
      successes: 0,
      failures: 0,
      totalTime: 0,
      avgTime: 0,
    };

    existing.calls++;
    if (success) {
      existing.successes++;
    } else {
      existing.failures++;
    }
    existing.totalTime += duration;
    existing.avgTime = existing.totalTime / existing.calls;

    this.metrics.toolStats.set(toolName, existing);
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.removeAllListeners();
    this.executor = null;
    this.aborted = true;
  }
}

/**
 * Create a ToolExecutionOrchestrator instance
 */
export function createToolOrchestrator(
  config?: Partial<OrchestratorConfig>
): ToolExecutionOrchestrator {
  return new ToolExecutionOrchestrator(config);
}

// Singleton instance
let orchestratorInstance: ToolExecutionOrchestrator | null = null;

/**
 * Get global orchestrator instance
 */
export function getToolOrchestrator(
  config?: Partial<OrchestratorConfig>
): ToolExecutionOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = createToolOrchestrator(config);
  }
  return orchestratorInstance;
}

/**
 * Reset global orchestrator
 */
export function resetToolOrchestrator(): void {
  if (orchestratorInstance) {
    orchestratorInstance.dispose();
  }
  orchestratorInstance = null;
}
