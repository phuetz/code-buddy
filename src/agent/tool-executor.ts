/**
 * Tool Executor Module
 *
 * Handles execution of all tools (built-in, MCP, and external).
 * Extracted from CodeBuddyAgent for better modularity and testability.
 *
 * Features:
 * - Parallel execution for independent read-only operations
 * - Configurable concurrency limits with semaphore
 * - Automatic read-only tool identification based on categories
 * - Dependency-aware sequential execution for write operations
 * - Partial error handling with graceful degradation
 * - Detailed parallelization metrics
 */

import {
  TextEditorTool,
  BashTool,
  SearchTool,
  TodoTool,
  ImageTool,
  WebSearchTool,
  MorphEditorTool,
} from "../tools/index.js";
import { ToolResult, getErrorMessage } from "../types/index.js";
import { CheckpointManager } from "../checkpoints/checkpoint-manager.js";
import { getMCPManager } from "../codebuddy/tools.js";
import { logger } from "../utils/logger.js";
import { ToolCategory } from "../tools/types.js";
import {
  safeValidateToolArgs,
  ToolValidationError,
} from "../utils/input-validator.js";

/**
 * Tool call structure from OpenAI/CodeBuddy API
 */
export interface CodeBuddyToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Dependencies required by ToolExecutor
 */
export interface ToolExecutorDependencies {
  textEditor: TextEditorTool;
  bash: BashTool;
  search: SearchTool;
  todoTool: TodoTool;
  imageTool: ImageTool;
  webSearch: WebSearchTool;
  checkpointManager: CheckpointManager;
  morphEditor?: MorphEditorTool | null;
}

/**
 * Configuration for parallel execution
 */
export interface ParallelExecutionConfig {
  /** Enable parallel execution (default: true) */
  enabled: boolean;
  /** Maximum concurrent executions (default: 5) */
  maxConcurrency: number;
  /** Timeout per tool in ms (default: 30000) */
  toolTimeout: number;
  /** Categories considered read-only and safe for parallel execution */
  readOnlyCategories: ToolCategory[];
  /** Additional tool names to treat as read-only */
  additionalReadOnlyTools: string[];
  /** Tool names to always execute sequentially */
  forceSequentialTools: string[];
}

/**
 * Default configuration for parallel execution
 */
export const DEFAULT_PARALLEL_CONFIG: ParallelExecutionConfig = {
  enabled: true,
  maxConcurrency: 5,
  toolTimeout: 30000,
  readOnlyCategories: ['file_read', 'file_search', 'web', 'codebase'],
  additionalReadOnlyTools: ['codebase_map', 'screenshot', 'pdf', 'document', 'ocr'],
  forceSequentialTools: ['bash', 'git', 'docker', 'kubernetes'],
};

/**
 * Result of a parallel execution batch
 */
export interface ParallelExecutionResult {
  results: Map<string, ToolResult>;
  metrics: ParallelExecutionMetrics;
}

/**
 * Metrics specific to parallel execution
 */
export interface ParallelExecutionMetrics {
  /** Total tools in the batch */
  totalTools: number;
  /** Number executed in parallel */
  parallelCount: number;
  /** Number executed sequentially */
  sequentialCount: number;
  /** Total wall-clock time for the batch */
  wallClockTime: number;
  /** Sum of individual tool execution times */
  totalToolTime: number;
  /** Time saved by parallelization */
  timeSaved: number;
  /** Parallelization efficiency (0-1) */
  efficiency: number;
  /** Number of partial failures */
  partialFailures: number;
}

/**
 * Metrics for tool execution
 */
export interface ToolMetrics {
  toolRequestCounts: Map<string, number>;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalExecutionTime: number;
  // Parallelization metrics
  parallelBatches: number;
  totalParallelTools: number;
  totalSequentialTools: number;
  totalTimeSaved: number;
  averageEfficiency: number;
}

/**
 * Simple semaphore for limiting concurrent operations
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.waiting.shift();
    if (next) {
      this.permits--;
      next();
    }
  }

  /**
   * Execute a function with semaphore protection
   */
  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Tool category to name mapping for automatic read-only detection
 */
const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  // File reading
  view_file: 'file_read',
  // File writing
  create_file: 'file_write',
  str_replace_editor: 'file_write',
  edit_file: 'file_write',
  multi_edit: 'file_write',
  // File search
  search: 'file_search',
  // System
  bash: 'system',
  git: 'system',
  docker: 'system',
  kubernetes: 'system',
  // Web
  web_search: 'web',
  web_fetch: 'web',
  browser: 'web',
  // Planning
  create_todo_list: 'planning',
  update_todo_list: 'planning',
  // Codebase
  codebase_map: 'codebase',
  spawn_subagent: 'codebase',
  // Media
  screenshot: 'media',
  audio: 'media',
  video: 'media',
  ocr: 'media',
  clipboard: 'media',
  // Document
  pdf: 'document',
  document: 'document',
  archive: 'document',
  // Utility
  diagram: 'utility',
  export: 'utility',
  qr: 'utility',
};

/**
 * ToolExecutor handles the execution of all tools in the agent.
 * It provides a centralized place for tool dispatch and MCP integration.
 */
export class ToolExecutor {
  private textEditor: TextEditorTool;
  private bash: BashTool;
  private search: SearchTool;
  private todoTool: TodoTool;
  private imageTool: ImageTool;
  private webSearch: WebSearchTool;
  private checkpointManager: CheckpointManager;
  private morphEditor?: MorphEditorTool | null;

  // Parallel execution
  private parallelConfig: ParallelExecutionConfig;
  private semaphore: Semaphore;

  // Metrics tracking
  private toolRequestCounts: Map<string, number> = new Map();
  private totalExecutions = 0;
  private successfulExecutions = 0;
  private failedExecutions = 0;
  private totalExecutionTime = 0;

  // Parallelization metrics
  private parallelBatches = 0;
  private totalParallelTools = 0;
  private totalSequentialTools = 0;
  private totalTimeSaved = 0;
  private efficiencySum = 0;

  constructor(deps: ToolExecutorDependencies, config?: Partial<ParallelExecutionConfig>) {
    this.textEditor = deps.textEditor;
    this.bash = deps.bash;
    this.search = deps.search;
    this.todoTool = deps.todoTool;
    this.imageTool = deps.imageTool;
    this.webSearch = deps.webSearch;
    this.checkpointManager = deps.checkpointManager;
    this.morphEditor = deps.morphEditor;

    // Merge with default config
    this.parallelConfig = { ...DEFAULT_PARALLEL_CONFIG, ...config };
    this.semaphore = new Semaphore(this.parallelConfig.maxConcurrency);
  }

  /**
   * Update parallel execution configuration
   */
  setParallelConfig(config: Partial<ParallelExecutionConfig>): void {
    this.parallelConfig = { ...this.parallelConfig, ...config };
    // Recreate semaphore if concurrency changed
    if (config.maxConcurrency !== undefined) {
      this.semaphore = new Semaphore(config.maxConcurrency);
    }
    logger.debug('Parallel execution config updated', { config: this.parallelConfig });
  }

  /**
   * Get current parallel execution configuration
   */
  getParallelConfig(): ParallelExecutionConfig {
    return { ...this.parallelConfig };
  }

  /**
   * Record a tool request for metrics tracking
   */
  recordToolRequest(toolName: string): void {
    const currentCount = this.toolRequestCounts.get(toolName) || 0;
    this.toolRequestCounts.set(toolName, currentCount + 1);
  }

  /**
   * Execute a tool call and return the result
   */
  async execute(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    const startTime = Date.now();
    const toolName = toolCall.function.name;
    this.recordToolRequest(toolName);
    this.totalExecutions++;

    try {
      // Parse JSON arguments
      let rawArgs: Record<string, unknown>;
      try {
        rawArgs = JSON.parse(toolCall.function.arguments);
      } catch (parseError) {
        this.failedExecutions++;
        this.totalExecutionTime += Date.now() - startTime;
        return {
          success: false,
          error: `Invalid JSON arguments for tool "${toolName}": ${getErrorMessage(parseError)}`,
        };
      }

      // Validate arguments using schema validation
      const validationResult = safeValidateToolArgs<Record<string, unknown>>(toolName, rawArgs);
      if (!validationResult.valid) {
        this.failedExecutions++;
        this.totalExecutionTime += Date.now() - startTime;
        logger.warn(`Validation failed for tool ${toolName}`, { error: validationResult.error });
        return {
          success: false,
          error: validationResult.error || `Validation failed for tool "${toolName}"`,
        };
      }

      // Use validated (and potentially transformed) arguments
      const args = validationResult.value!;
      const result = await this.dispatchTool(toolName, args, toolCall);

      if (result.success) {
        this.successfulExecutions++;
      } else {
        this.failedExecutions++;
      }

      this.totalExecutionTime += Date.now() - startTime;
      return result;
    } catch (error: unknown) {
      this.failedExecutions++;
      this.totalExecutionTime += Date.now() - startTime;

      // Check if this is a validation error for better messaging
      if (error instanceof ToolValidationError) {
        return {
          success: false,
          error: error.message,
        };
      }

      return {
        success: false,
        error: `Tool execution error: ${getErrorMessage(error)}`,
      };
    }
  }

  /**
   * Dispatch tool execution to the appropriate handler
   */
  private async dispatchTool(
    toolName: string,
    args: Record<string, unknown>,
    toolCall: CodeBuddyToolCall
  ): Promise<ToolResult> {
    switch (toolName) {
      case "view_file": {
        const range: [number, number] | undefined =
          args.start_line && args.end_line
            ? [args.start_line as number, args.end_line as number]
            : undefined;
        return await this.textEditor.view(args.path as string, range);
      }

      case "create_file":
        // Create checkpoint before creating file
        this.checkpointManager.checkpointBeforeCreate(args.path as string);
        return await this.textEditor.create(
          args.path as string,
          args.content as string
        );

      case "str_replace_editor":
        // Create checkpoint before editing file
        this.checkpointManager.checkpointBeforeEdit(args.path as string);
        return await this.textEditor.strReplace(
          args.path as string,
          args.old_str as string,
          args.new_str as string,
          args.replace_all as boolean | undefined
        );

      case "edit_file":
        if (!this.morphEditor) {
          return {
            success: false,
            error:
              "Morph Fast Apply not available. Please set MORPH_API_KEY environment variable to use this feature.",
          };
        }
        return await this.morphEditor.editFile(
          args.target_file as string,
          args.instructions as string,
          args.code_edit as string
        );

      case "bash":
        return await this.bash.execute(args.command as string);

      case "create_todo_list":
        // Add default priority if not provided
        const todos = (args.todos as Array<{ id: string; content: string; status: string; priority?: string }>).map(t => ({
          ...t,
          priority: t.priority || 'medium',
        }));
        return await this.todoTool.createTodoList(todos as never);

      case "update_todo_list":
        return await this.todoTool.updateTodoList(
          args.updates as never
        );

      case "search":
        return await this.search.search(args.query as string, {
          includePattern: args.include_pattern as string,
          excludePattern: args.exclude_pattern as string,
          caseSensitive: args.case_sensitive as boolean,
          regex: args.regex as boolean,
          maxResults: args.max_results as number,
        });

      case "web_search":
        return await this.webSearch.search(args.query as string, {
          maxResults: args.max_results as number,
        });

      case "web_fetch":
        return await this.webSearch.fetchPage(args.url as string);

      default:
        // Check if this is an MCP tool
        if (toolName.startsWith("mcp__")) {
          return await this.executeMCPTool(toolCall);
        }

        return {
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }
  }

  /**
   * Execute an MCP tool
   */
  private async executeMCPTool(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const mcpManager = getMCPManager();

      const result = await mcpManager.callTool(toolCall.function.name, args);

      if (result.isError) {
        const errorContent = result.content[0] as { text?: string } | undefined;
        return {
          success: false,
          error: errorContent?.text || "MCP tool error",
        };
      }

      // Extract content from result
      const output = result.content
        .map((item: { type: string; text?: string; resource?: { uri?: string } }) => {
          if (item.type === "text") {
            return item.text;
          } else if (item.type === "resource") {
            return `Resource: ${item.resource?.uri || "Unknown"}`;
          }
          return String(item);
        })
        .join("\n");

      return {
        success: true,
        output: output || "Success",
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `MCP tool execution error: ${getErrorMessage(error)}`,
      };
    }
  }

  /**
   * Determine the category of a tool
   */
  private getToolCategory(toolName: string): ToolCategory | undefined {
    // Check built-in mapping
    if (toolName in TOOL_CATEGORY_MAP) {
      return TOOL_CATEGORY_MAP[toolName];
    }
    // MCP tools are treated as external
    if (toolName.startsWith('mcp__')) {
      return 'mcp';
    }
    return undefined;
  }

  /**
   * Check if a tool can be executed in parallel (read-only)
   * Uses category-based detection with configuration overrides
   */
  canExecuteInParallel(toolName: string): boolean {
    // Check force sequential list first
    if (this.parallelConfig.forceSequentialTools.includes(toolName)) {
      return false;
    }

    // Check additional read-only tools
    if (this.parallelConfig.additionalReadOnlyTools.includes(toolName)) {
      return true;
    }

    // Check by category
    const category = this.getToolCategory(toolName);
    if (category && this.parallelConfig.readOnlyCategories.includes(category)) {
      return true;
    }

    // MCP tools: assume read-only unless in force sequential
    // This is a safe default as most MCP read tools don't modify state
    if (toolName.startsWith('mcp__')) {
      // Check if tool name suggests read-only operation
      const lowerName = toolName.toLowerCase();
      const readOnlyIndicators = ['read', 'get', 'list', 'search', 'fetch', 'query', 'view', 'show'];
      const writeIndicators = ['write', 'create', 'update', 'delete', 'modify', 'set', 'post', 'put'];

      const hasReadIndicator = readOnlyIndicators.some(ind => lowerName.includes(ind));
      const hasWriteIndicator = writeIndicators.some(ind => lowerName.includes(ind));

      // Read-only if has read indicators and no write indicators
      return hasReadIndicator && !hasWriteIndicator;
    }

    return false;
  }

  /**
   * Execute a single tool with timeout protection
   */
  private async executeWithTimeout(
    toolCall: CodeBuddyToolCall,
    timeout: number
  ): Promise<{ result: ToolResult; executionTime: number }> {
    const startTime = Date.now();

    const timeoutPromise = new Promise<ToolResult>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeout}ms`));
      }, timeout);
    });

    try {
      const result = await Promise.race([
        this.execute(toolCall),
        timeoutPromise,
      ]);
      return {
        result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        result: {
          success: false,
          error: `Execution error: ${getErrorMessage(error)}`,
        },
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute multiple tools with intelligent parallelization
   *
   * Features:
   * - Automatic read-only detection based on tool categories
   * - Semaphore-limited concurrency
   * - Partial error handling (continues on individual failures)
   * - Detailed execution metrics
   */
  async executeParallel(toolCalls: CodeBuddyToolCall[]): Promise<Map<string, ToolResult>> {
    const { results } = await this.executeParallelWithMetrics(toolCalls);
    return results;
  }

  /**
   * Execute multiple tools with detailed parallelization metrics
   */
  async executeParallelWithMetrics(
    toolCalls: CodeBuddyToolCall[]
  ): Promise<ParallelExecutionResult> {
    const batchStartTime = Date.now();
    const results = new Map<string, ToolResult>();
    const executionTimes: number[] = [];
    let partialFailures = 0;

    // If parallelization is disabled, execute all sequentially
    if (!this.parallelConfig.enabled) {
      for (const toolCall of toolCalls) {
        const { result, executionTime } = await this.executeWithTimeout(
          toolCall,
          this.parallelConfig.toolTimeout
        );
        results.set(toolCall.id, result);
        executionTimes.push(executionTime);
        if (!result.success) partialFailures++;
      }

      const wallClockTime = Date.now() - batchStartTime;
      const totalToolTime = executionTimes.reduce((a, b) => a + b, 0);

      return {
        results,
        metrics: {
          totalTools: toolCalls.length,
          parallelCount: 0,
          sequentialCount: toolCalls.length,
          wallClockTime,
          totalToolTime,
          timeSaved: 0,
          efficiency: 0,
          partialFailures,
        },
      };
    }

    // Group tools by parallelization capability
    const parallelizable: CodeBuddyToolCall[] = [];
    const sequential: CodeBuddyToolCall[] = [];

    for (const toolCall of toolCalls) {
      if (this.canExecuteInParallel(toolCall.function.name)) {
        parallelizable.push(toolCall);
      } else {
        sequential.push(toolCall);
      }
    }

    logger.debug('Tool execution grouping', {
      parallelizable: parallelizable.map(tc => tc.function.name),
      sequential: sequential.map(tc => tc.function.name),
    });

    // Execute parallelizable tools with semaphore-limited concurrency
    const parallelExecutionTimes: number[] = [];
    if (parallelizable.length > 0) {
      const parallelPromises = parallelizable.map(async (toolCall) => {
        return this.semaphore.withPermit(async () => {
          const { result, executionTime } = await this.executeWithTimeout(
            toolCall,
            this.parallelConfig.toolTimeout
          );
          return { id: toolCall.id, result, executionTime };
        });
      });

      const parallelResults = await Promise.allSettled(parallelPromises);

      for (const settledResult of parallelResults) {
        if (settledResult.status === 'fulfilled') {
          const { id, result, executionTime } = settledResult.value;
          results.set(id, result);
          parallelExecutionTimes.push(executionTime);
          if (!result.success) partialFailures++;
        } else {
          // Promise was rejected (should be rare with our error handling)
          partialFailures++;
          logger.error('Parallel execution promise rejected', {
            reason: settledResult.reason,
          });
        }
      }
    }

    // Execute sequential tools one by one
    const sequentialExecutionTimes: number[] = [];
    for (const toolCall of sequential) {
      const { result, executionTime } = await this.executeWithTimeout(
        toolCall,
        this.parallelConfig.toolTimeout
      );
      results.set(toolCall.id, result);
      sequentialExecutionTimes.push(executionTime);
      if (!result.success) partialFailures++;
    }

    // Calculate metrics
    const wallClockTime = Date.now() - batchStartTime;
    const totalParallelToolTime = parallelExecutionTimes.reduce((a, b) => a + b, 0);
    const totalSequentialToolTime = sequentialExecutionTimes.reduce((a, b) => a + b, 0);
    const totalToolTime = totalParallelToolTime + totalSequentialToolTime;

    // Time saved is the difference between running all sequentially vs parallel
    // For parallel tools, the max execution time is what matters for wall clock
    const maxParallelTime = parallelExecutionTimes.length > 0
      ? Math.max(...parallelExecutionTimes)
      : 0;
    const timeSaved = totalParallelToolTime - maxParallelTime;

    // Efficiency: how much parallelization helped (0 = no help, 1 = perfect parallel)
    const efficiency = totalToolTime > 0
      ? Math.max(0, Math.min(1, timeSaved / totalToolTime))
      : 0;

    // Update global metrics
    this.parallelBatches++;
    this.totalParallelTools += parallelizable.length;
    this.totalSequentialTools += sequential.length;
    this.totalTimeSaved += timeSaved;
    this.efficiencySum += efficiency;

    const metrics: ParallelExecutionMetrics = {
      totalTools: toolCalls.length,
      parallelCount: parallelizable.length,
      sequentialCount: sequential.length,
      wallClockTime,
      totalToolTime,
      timeSaved,
      efficiency,
      partialFailures,
    };

    logger.debug('Parallel execution completed', { metrics });

    return { results, metrics };
  }

  /**
   * Get execution metrics
   */
  getMetrics(): ToolMetrics {
    return {
      toolRequestCounts: new Map(this.toolRequestCounts),
      totalExecutions: this.totalExecutions,
      successfulExecutions: this.successfulExecutions,
      failedExecutions: this.failedExecutions,
      totalExecutionTime: this.totalExecutionTime,
      // Parallelization metrics
      parallelBatches: this.parallelBatches,
      totalParallelTools: this.totalParallelTools,
      totalSequentialTools: this.totalSequentialTools,
      totalTimeSaved: this.totalTimeSaved,
      averageEfficiency: this.parallelBatches > 0 ? this.efficiencySum / this.parallelBatches : 0,
    };
  }

  /**
   * Get tool request counts as a formatted object
   */
  getToolRequestCountsFormatted(): Record<string, number> {
    const formatted: Record<string, number> = {};
    for (const [tool, count] of this.toolRequestCounts) {
      formatted[tool] = count;
    }
    return formatted;
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.toolRequestCounts.clear();
    this.totalExecutions = 0;
    this.successfulExecutions = 0;
    this.failedExecutions = 0;
    this.totalExecutionTime = 0;
    // Reset parallelization metrics
    this.parallelBatches = 0;
    this.totalParallelTools = 0;
    this.totalSequentialTools = 0;
    this.totalTimeSaved = 0;
    this.efficiencySum = 0;
  }

  /**
   * Check if a tool is read-only (safe for parallel execution)
   * @deprecated Use canExecuteInParallel() for more accurate detection
   */
  isReadOnlyTool(toolName: string): boolean {
    return this.canExecuteInParallel(toolName);
  }

  /**
   * Get parallelization statistics summary
   */
  getParallelizationStats(): {
    enabled: boolean;
    maxConcurrency: number;
    totalBatches: number;
    parallelToolsExecuted: number;
    sequentialToolsExecuted: number;
    totalTimeSavedMs: number;
    averageEfficiency: number;
  } {
    return {
      enabled: this.parallelConfig.enabled,
      maxConcurrency: this.parallelConfig.maxConcurrency,
      totalBatches: this.parallelBatches,
      parallelToolsExecuted: this.totalParallelTools,
      sequentialToolsExecuted: this.totalSequentialTools,
      totalTimeSavedMs: this.totalTimeSaved,
      averageEfficiency: this.parallelBatches > 0 ? this.efficiencySum / this.parallelBatches : 0,
    };
  }

  /**
   * Get the bash tool instance
   */
  getBashTool(): BashTool {
    return this.bash;
  }

  /**
   * Get the image tool instance
   */
  getImageTool(): ImageTool {
    return this.imageTool;
  }

  /**
   * Get the checkpoint manager
   */
  getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }
}
