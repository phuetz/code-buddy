/**
 * Tool Executor Module
 *
 * Handles execution of all tools (built-in, MCP, and external).
 * Extracted from GrokAgent for better modularity and testability.
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
import type { ToolResult } from "../types/index.js";
import { CheckpointManager } from "../checkpoints/checkpoint-manager.js";
import { getMCPManager } from "../grok/tools.js";

/**
 * Tool call structure from OpenAI/Grok API
 */
export interface GrokToolCall {
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
 * Metrics for tool execution
 */
export interface ToolMetrics {
  toolRequestCounts: Map<string, number>;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalExecutionTime: number;
}

/**
 * Get error message from unknown error
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

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

  // Metrics tracking
  private toolRequestCounts: Map<string, number> = new Map();
  private totalExecutions = 0;
  private successfulExecutions = 0;
  private failedExecutions = 0;
  private totalExecutionTime = 0;

  constructor(deps: ToolExecutorDependencies) {
    this.textEditor = deps.textEditor;
    this.bash = deps.bash;
    this.search = deps.search;
    this.todoTool = deps.todoTool;
    this.imageTool = deps.imageTool;
    this.webSearch = deps.webSearch;
    this.checkpointManager = deps.checkpointManager;
    this.morphEditor = deps.morphEditor;
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
  async execute(toolCall: GrokToolCall): Promise<ToolResult> {
    const startTime = Date.now();
    this.recordToolRequest(toolCall.function.name);
    this.totalExecutions++;

    try {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await this.dispatchTool(toolCall.function.name, args, toolCall);

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
    toolCall: GrokToolCall
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
  private async executeMCPTool(toolCall: GrokToolCall): Promise<ToolResult> {
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
   * Execute multiple tools in parallel (for read-only operations)
   */
  async executeParallel(toolCalls: GrokToolCall[]): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>();

    // Group tools by whether they can be parallelized
    const readOnlyTools = new Set([
      "view_file",
      "search",
      "web_search",
      "web_fetch",
    ]);

    const parallelizable: GrokToolCall[] = [];
    const sequential: GrokToolCall[] = [];

    for (const toolCall of toolCalls) {
      if (readOnlyTools.has(toolCall.function.name)) {
        parallelizable.push(toolCall);
      } else {
        sequential.push(toolCall);
      }
    }

    // Execute parallelizable tools concurrently
    if (parallelizable.length > 0) {
      const parallelResults = await Promise.all(
        parallelizable.map(async (tc) => ({
          id: tc.id,
          result: await this.execute(tc),
        }))
      );

      for (const { id, result } of parallelResults) {
        results.set(id, result);
      }
    }

    // Execute sequential tools one by one
    for (const toolCall of sequential) {
      const result = await this.execute(toolCall);
      results.set(toolCall.id, result);
    }

    return results;
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
  }

  /**
   * Check if a tool is read-only (safe for parallel execution)
   */
  isReadOnlyTool(toolName: string): boolean {
    const readOnlyTools = new Set([
      "view_file",
      "search",
      "web_search",
      "web_fetch",
    ]);
    return readOnlyTools.has(toolName);
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
