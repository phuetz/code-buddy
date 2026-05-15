import { CodeBuddyClient, CodeBuddyMessage, CodeBuddyToolCall } from "../codebuddy/client.js";
import { EventEmitter } from "events";
import { ToolResult, getErrorMessage } from "../types/index.js";
import { formatToolResultContent } from "../utils/tool-result-content.js";

export interface SubagentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  /** Allowed tools (empty/undefined = all available, specific names = whitelist) */
  tools?: string[];
  /**
   * Tool names this subagent CANNOT use (blacklist enforcement).
   *
   * Complements `tools` whitelist — when both are set, the result is
   * `tools - disallowedTools`. Provides defense-in-depth for read-only
   * subagents (Explore, audit-only reviewers) where accidentally allowing
   * an edit tool would be a silent correctness bug.
   *
   * Pattern from Claude Code's `BuiltInAgentDefinition.disallowedTools`
   * (see `D:\CascadeProjects\claude-code-source-code-main\src\tools\AgentTool\built-in\exploreAgent.ts:67-73`).
   */
  disallowedTools?: string[];
  model?: string;
  maxRounds?: number;
  timeout?: number;  // in milliseconds
}

/**
 * Read-only system prompt used by `Explore` and `explorer` (alias)
 * subagents. Adapted from Claude Code's exploreAgent.ts (READ-ONLY MODE
 * directive repeated 5-6× to make the constraint maximally salient to
 * the LLM). Combined with `tools` whitelist + `disallowedTools` blacklist
 * for defense-in-depth: even if the LLM tries to call a write tool, it
 * never reaches the executor.
 */
const EXPLORE_READONLY_SYSTEM_PROMPT = `You are a file search specialist for Code Buddy. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no create_file, no touch, no file creation of any kind)
- Modifying existing files (no str_replace_editor, no apply_patch, no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Running ANY commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code. Attempting to use write tools will fail (blacklist enforcement at the dispatcher level).

Your strengths:
- Rapidly finding files and patterns via \`search\`
- Reading file contents via \`view_file\`

Guidelines:
- Use \`search\` for both file pattern matching and content search (regex supported)
- Use \`view_file\` when you know the specific file path you need to read
- NEVER attempt write operations: no mkdir, touch, rm, cp, mv, npm install, git add, git commit
- Adapt your search depth based on the thoroughness level the caller specifies
- Communicate your final report directly as a regular message

NOTE: You are meant to be a fast agent that returns output as quickly as possible. To achieve this:
- Make efficient use of the tools you have at your disposal
- Wherever possible, spawn multiple parallel tool calls (search + view_file simultaneously)
- Do not over-explore; stop when you have answered the caller's question

Complete the user's search request efficiently and report your findings clearly.`;

export interface SubagentResult {
  success: boolean;
  output: string;
  toolsUsed: string[];
  rounds: number;
  duration: number;
}

// Predefined subagent configurations
export const PREDEFINED_SUBAGENTS: Record<string, SubagentConfig> = {
  "code-reviewer": {
    name: "code-reviewer",
    description: "Expert code reviewer for analyzing code quality, security, and best practices. Read-only by design — defense-in-depth via tools whitelist + disallowedTools blacklist.",
    systemPrompt: `You are an expert code reviewer. Your task is to review code changes and provide constructive feedback.

=== READ-ONLY MODE ===
You analyze and report only. You CANNOT modify files (no str_replace_editor, no create_file, no apply_patch). Attempting to use write tools will fail at the dispatcher level. If you spot a bug, report it; do not try to fix it inline.

Focus on:
1. Code quality and readability
2. Potential bugs or edge cases
3. Security vulnerabilities
4. Performance considerations
5. Best practices and patterns
6. Test coverage suggestions

Be specific in your feedback, referencing line numbers when possible.
Prioritize issues by severity: CRITICAL, WARNING, SUGGESTION.
End with a summary and overall assessment.`,
    tools: ["view_file", "search"],
    // Defense-in-depth: even if a caller extends `tools` in a custom config,
    // the blacklist below removes write tools. Pattern from Claude Code's
    // BuiltInAgentDefinition.disallowedTools (see also Explore subagent below).
    disallowedTools: [
      "str_replace_editor",
      "create_file",
      "apply_patch",
      "delete_file",
      "bash",
    ],
    model: "grok-3-latest",
    maxRounds: 10,
  },

  "debugger": {
    name: "debugger",
    description: "Debugging specialist for identifying and fixing errors",
    systemPrompt: `You are a debugging specialist. Your task is to identify the root cause of errors and suggest fixes.

Approach:
1. Analyze error messages and stack traces
2. Trace the execution flow
3. Identify the root cause
4. Propose specific fixes
5. Suggest preventive measures

Be methodical and thorough. Use the available tools to investigate the codebase.`,
    tools: ["view_file", "search", "bash"],
    model: "grok-code-fast-1",
    maxRounds: 20,
  },

  "test-runner": {
    name: "test-runner",
    description: "Test runner and analyzer for running tests and interpreting results",
    systemPrompt: `You are a test specialist. Your task is to run tests and analyze results.

Responsibilities:
1. Run the appropriate test commands
2. Parse and interpret test output
3. Identify failing tests and their causes
4. Suggest fixes for failing tests
5. Report on test coverage if available

Be clear about which tests pass and fail.`,
    tools: ["bash", "view_file"],
    model: "grok-code-fast-1",
    maxRounds: 15,
  },

  // Capital-E `Explore` aligns with Claude Code's subagent_type naming
  // convention. Strict read-only enforcement via system prompt + whitelist
  // + blacklist (defense-in-depth).
  "Explore": {
    name: "Explore",
    description:
      "Fast read-only codebase exploration. Strict no-write enforcement (system prompt + tool whitelist + blacklist defense-in-depth). Use when you need to find files, search patterns, or understand the codebase without risk of accidental modification.",
    systemPrompt: EXPLORE_READONLY_SYSTEM_PROMPT,
    tools: ["view_file", "search"],
    disallowedTools: [
      "str_replace_editor",
      "create_file",
      "apply_patch",
      "delete_file",
      "bash",
    ],
    model: "grok-code-fast-1",
    maxRounds: 10,
  },

  // Backward-compatible lowercase alias. Existing callers (`spawn("explorer", ...)`)
  // continue to work; new callers should prefer `"Explore"` for clarity.
  // Same restrictions as `Explore` — bash removed from whitelist (was a
  // silent loophole pre-rc.4: bash allowed mkdir/rm/etc. on a "read-only"
  // agent).
  "explorer": {
    name: "explorer",
    description: "Fast codebase explorer (alias for `Explore`, kept for backward compat)",
    systemPrompt: EXPLORE_READONLY_SYSTEM_PROMPT,
    tools: ["view_file", "search"],
    disallowedTools: [
      "str_replace_editor",
      "create_file",
      "apply_patch",
      "delete_file",
      "bash",
    ],
    model: "grok-code-fast-1",
    maxRounds: 10,
  },

  "refactorer": {
    name: "refactorer",
    description: "Code refactoring specialist for improving code structure",
    systemPrompt: `You are a refactoring specialist. Your task is to improve code without changing its behavior.

Focus on:
1. Reducing code duplication (DRY)
2. Improving naming and readability
3. Simplifying complex logic
4. Extracting reusable functions/components
5. Applying design patterns where appropriate

Always verify that refactoring maintains existing behavior.`,
    tools: ["view_file", "search", "str_replace_editor", "create_file"],
    model: "grok-3-latest",
    maxRounds: 25,
  },

  "documenter": {
    name: "documenter",
    description: "Documentation writer for code and APIs",
    systemPrompt: `You are a documentation specialist. Your task is to write clear, comprehensive documentation.

Create documentation that includes:
1. Overview and purpose
2. Installation/setup instructions
3. Usage examples
4. API reference
5. Configuration options
6. Troubleshooting tips

Write in clear, concise language accessible to developers of all levels.`,
    tools: ["view_file", "search", "create_file", "str_replace_editor"],
    model: "grok-3-latest",
    maxRounds: 15,
  },
};

export class Subagent extends EventEmitter {
  private client: CodeBuddyClient;
  private config: SubagentConfig;
  private isRunning: boolean = false;
  private startTime: number = 0;

  constructor(
    apiKey: string,
    config: SubagentConfig,
    baseURL?: string,
    defaultModel?: string
  ) {
    super();
    this.config = {
      maxRounds: 20,
      timeout: 300000,  // 5 minutes default
      ...config,
    };
    const model = this.resolveModel(this.config.model, defaultModel);
    this.client = new CodeBuddyClient(
      apiKey,
      model,
      baseURL
    );
  }

  private resolveModel(configModel?: string, defaultModel?: string): string {
    if (!configModel) {
      return defaultModel || "grok-code-fast-1";
    }
    if (defaultModel && configModel.startsWith("grok-") && !defaultModel.startsWith("grok-")) {
      return defaultModel;
    }
    return configModel;
  }

  async run(
    task: string,
    context?: string,
    tools?: import("../codebuddy/client.js").CodeBuddyTool[],
    executeTool?: (toolCall: CodeBuddyToolCall) => Promise<ToolResult>,
    options?: {
      progressCallback?: (round: number, maxRounds: number) => void;
      sharedContext?: Map<string, string>;
    }
  ): Promise<SubagentResult> {
    this.isRunning = true;
    this.startTime = Date.now();
    const toolsUsed: string[] = [];
    let rounds = 0;

    this.emit("subagent:start", {
      name: this.config.name,
      task,
    });

    // Filter tools if restricted (whitelist)
    let filteredTools = tools;
    if (this.config.tools && this.config.tools.length > 0 && tools) {
      filteredTools = tools.filter((t) =>
        this.config.tools!.includes(t.function?.name || "")
      );
    }

    // Apply disallowedTools blacklist (defense-in-depth pattern from Claude Code's
    // BuiltInAgentDefinition). Even if a tool slips into the whitelist OR if no
    // whitelist is set, the blacklist kicks them out. Critical for read-only
    // subagents (Explore, audit reviewers) where a write tool would be a silent
    // correctness bug.
    if (
      this.config.disallowedTools &&
      this.config.disallowedTools.length > 0 &&
      filteredTools
    ) {
      filteredTools = filteredTools.filter(
        (t) => !this.config.disallowedTools!.includes(t.function?.name || "")
      );
    }

    // Build context including shared context from orchestrator
    let fullContext = context || '';
    if (options?.sharedContext && options.sharedContext.size > 0) {
      const sharedEntries = Array.from(options.sharedContext.entries())
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      fullContext = fullContext
        ? `${fullContext}\n\nShared Context:\n${sharedEntries}`
        : `Shared Context:\n${sharedEntries}`;
    }

    const messages: CodeBuddyMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      {
        role: "user",
        content: fullContext ? `Context:\n${fullContext}\n\nTask:\n${task}` : task,
      },
    ];

    try {
      while (this.isRunning && rounds < this.config.maxRounds!) {
        const remainingTime = this.config.timeout! - (Date.now() - this.startTime);
        if (remainingTime <= 0) {
          throw new Error("Subagent timed out");
        }

        rounds++;
        this.emit("subagent:round", { round: rounds });
        options?.progressCallback?.(rounds, this.config.maxRounds!);

        // Add timeout to chat call
        const response = await Promise.race([
          this.client.chat(messages, filteredTools),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error("Subagent timed out")), remainingTime)
          )
        ]);
        
        const assistantMessage = response.choices[0]?.message;

        if (!assistantMessage) {
          throw new Error("No response from subagent");
        }

        const toolCalls = assistantMessage.tool_calls ?? [];
        const hasToolCalls = toolCalls.length > 0;
        if (!assistantMessage.content?.trim() && !hasToolCalls) {
          throw new Error("Subagent returned no content or tool calls");
        }

        // Add assistant message to history
        messages.push({
          role: "assistant",
          content: assistantMessage.content || "",
          tool_calls: assistantMessage.tool_calls,
        });

        // Handle tool calls
        if (hasToolCalls) {
          for (const toolCall of toolCalls) {
            toolsUsed.push(toolCall.function.name);
            this.emit("subagent:tool", {
              name: toolCall.function.name,
              args: toolCall.function.arguments,
            });

            if (executeTool) {
              const result = await executeTool(toolCall);
              messages.push({
                role: "tool",
                content: formatToolResultContent(result),
                tool_call_id: toolCall.id,
              });
            }
          }
        } else {
          // No more tool calls, we're done
          const duration = Date.now() - this.startTime;

          this.emit("subagent:complete", {
            name: this.config.name,
            output: assistantMessage.content,
            duration,
          });

          return {
            success: true,
            output: assistantMessage.content || "",
            toolsUsed: [...new Set(toolsUsed)],
            rounds,
            duration,
          };
        }
      }

      // Max rounds reached
      const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
      const duration = Date.now() - this.startTime;

      return {
        success: false,
        output:
          (lastAssistantMessage && typeof lastAssistantMessage.content === 'string' && lastAssistantMessage.content)
            ? lastAssistantMessage.content
            : "Maximum rounds reached without completion",
        toolsUsed: [...new Set(toolsUsed)],
        rounds,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - this.startTime;
      const errorMessage = getErrorMessage(error);
      this.emit("subagent:error", { error: errorMessage });

      return {
        success: false,
        output: `Error: ${errorMessage}`,
        toolsUsed: [...new Set(toolsUsed)],
        rounds,
        duration,
      };
    } finally {
      this.isRunning = false;
    }
  }

  stop(): void {
    this.isRunning = false;
    this.emit("subagent:stop");
  }

  getConfig(): SubagentConfig {
    return { ...this.config };
  }
}

export class SubagentManager {
  private apiKey: string;
  private baseURL?: string;
  private defaultModel?: string;
  private runningAgents: Map<string, Subagent> = new Map();
  private customConfigs: Map<string, SubagentConfig> = new Map();

  constructor(apiKey: string, baseURL?: string, defaultModel?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.defaultModel = defaultModel;
  }

  registerSubagent(config: SubagentConfig): void {
    this.customConfigs.set(config.name, config);
  }

  getAvailableSubagents(): string[] {
    return [
      ...Object.keys(PREDEFINED_SUBAGENTS),
      ...this.customConfigs.keys(),
    ];
  }

  getSubagentConfig(name: string): SubagentConfig | null {
    return (
      PREDEFINED_SUBAGENTS[name] ||
      this.customConfigs.get(name) ||
      null
    );
  }

  createSubagent(name: string): Subagent | null {
    const config = this.getSubagentConfig(name);
    if (!config) {
      return null;
    }

    const agent = new Subagent(this.apiKey, config, this.baseURL, this.defaultModel);
    this.runningAgents.set(`${name}-${Date.now()}`, agent);
    return agent;
  }

  async spawn(
    name: string,
    task: string,
    options: {
      context?: string;
      tools?: import("../codebuddy/client.js").CodeBuddyTool[];
      executeTool?: (toolCall: CodeBuddyToolCall) => Promise<ToolResult>;
    } = {}
  ): Promise<SubagentResult> {
    const agent = this.createSubagent(name);
    if (!agent) {
      return {
        success: false,
        output: `Unknown subagent: ${name}`,
        toolsUsed: [],
        rounds: 0,
        duration: 0,
      };
    }

    return agent.run(
      task,
      options.context,
      options.tools,
      options.executeTool
    );
  }

  stopAll(): void {
    for (const agent of this.runningAgents.values()) {
      agent.stop();
    }
    this.runningAgents.clear();
  }

  formatAvailableSubagents(): string {
    let output = "Available Subagents:\n\n";

    const allConfigs = [
      ...Object.entries(PREDEFINED_SUBAGENTS),
      ...this.customConfigs.entries(),
    ];

    for (const [name, config] of allConfigs) {
      output += `  🤖 ${name}\n`;
      output += `     ${config.description}\n`;
      if (config.tools && config.tools.length > 0) {
        output += `     Tools: ${config.tools.join(", ")}\n`;
      }
      output += "\n";
    }

    return output;
  }
}

// Parallel execution types
export interface ParallelTask {
  id: string;
  agentType: string;
  task: string;
  context?: string;
  priority?: number;
}

export interface ParallelExecutionOptions {
  maxConcurrent?: number;      // Default 10
  batchSize?: number;          // Process in batches
  stopOnFirstError?: boolean;  // Stop all if one fails
  timeout?: number;            // Overall timeout
  onProgress?: (completed: number, total: number, result: SubagentResult) => void;
}

export interface ParallelExecutionResult {
  success: boolean;
  results: Map<string, SubagentResult>;
  totalDuration: number;
  completedCount: number;
  failedCount: number;
  errors: string[];
}

/**
 * Parallel Subagent Runner - Execute multiple subagents concurrently
 * Advanced enterprise architecture for parallel subagent execution (max 10 concurrent)
 */
export class ParallelSubagentRunner extends EventEmitter {
  private manager: SubagentManager;
  private maxConcurrent: number;
  private queue: ParallelTask[] = [];
  private isRunning: boolean = false;

  constructor(manager: SubagentManager, maxConcurrent: number = 10) {
    super();
    this.manager = manager;
    this.maxConcurrent = Math.min(maxConcurrent, 10); // Cap at 10
  }

  /**
   * Run multiple subagents in parallel with batching
   */
  async runParallel(
    tasks: ParallelTask[],
    options: ParallelExecutionOptions = {},
    sharedOptions: {
      tools?: import("../codebuddy/client.js").CodeBuddyTool[];
      executeTool?: (toolCall: CodeBuddyToolCall) => Promise<ToolResult>;
    } = {}
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    const {
      maxConcurrent = this.maxConcurrent,
      batchSize = maxConcurrent,
      stopOnFirstError = false,
      timeout = 600000, // 10 minutes default
      onProgress,
    } = options;

    const results = new Map<string, SubagentResult>();
    const errors: string[] = [];
    let completedCount = 0;
    let failedCount = 0;
    this.isRunning = true;

    this.emit("parallel:start", { taskCount: tasks.length, maxConcurrent });

    // Sort by priority (higher first)
    const sortedTasks = [...tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Process in batches
    const batches = this.chunk(sortedTasks, batchSize);

    try {
      for (const batch of batches) {
        if (!this.isRunning) break;

        // Check timeout
        if (Date.now() - startTime > timeout) {
          errors.push("Parallel execution timed out");
          break;
        }

        this.emit("parallel:batch", { batchSize: batch.length, remaining: sortedTasks.length - completedCount });

        // Run batch in parallel
        const batchPromises = batch.map(async (task) => {
          try {
            const result = await this.manager.spawn(task.agentType, task.task, {
              context: task.context,
              tools: sharedOptions.tools,
              executeTool: sharedOptions.executeTool,
            });

            results.set(task.id, result);

            if (result.success) {
              completedCount++;
            } else {
              failedCount++;
              if (stopOnFirstError) {
                this.isRunning = false;
              }
            }

            if (onProgress) {
              onProgress(completedCount + failedCount, tasks.length, result);
            }

            this.emit("parallel:task-complete", {
              taskId: task.id,
              success: result.success,
              completedCount,
              failedCount,
            });

            return { taskId: task.id, result };
          } catch (error) {
            const errorMessage = getErrorMessage(error);
            const errorResult: SubagentResult = {
              success: false,
              output: `Error: ${errorMessage}`,
              toolsUsed: [],
              rounds: 0,
              duration: 0,
            };
            results.set(task.id, errorResult);
            failedCount++;
            errors.push(`Task ${task.id}: ${errorMessage}`);

            if (stopOnFirstError) {
              this.isRunning = false;
            }

            return { taskId: task.id, result: errorResult };
          }
        });

        await Promise.all(batchPromises);
      }
    } finally {
      this.isRunning = false;
    }

    const totalDuration = Date.now() - startTime;

    this.emit("parallel:complete", {
      completedCount,
      failedCount,
      totalDuration,
    });

    return {
      success: failedCount === 0,
      results,
      totalDuration,
      completedCount,
      failedCount,
      errors,
    };
  }

  /**
   * Run tasks with different agent types exploring different aspects
   * Useful for codebase exploration with multiple specialized agents
   */
  async exploreParallel(
    baseTask: string,
    agentTypes: string[],
    options: ParallelExecutionOptions = {},
    sharedOptions: {
      tools?: import("../codebuddy/client.js").CodeBuddyTool[];
      executeTool?: (toolCall: CodeBuddyToolCall) => Promise<ToolResult>;
    } = {}
  ): Promise<ParallelExecutionResult> {
    const tasks: ParallelTask[] = agentTypes.map((agentType, index) => ({
      id: `explore-${agentType}-${index}`,
      agentType,
      task: baseTask,
      priority: 0,
    }));

    return this.runParallel(tasks, options, sharedOptions);
  }

  /**
   * Stop all running tasks
   */
  stop(): void {
    this.isRunning = false;
    this.manager.stopAll();
    this.emit("parallel:stopped");
  }

  /**
   * Get current status
   */
  getStatus(): { isRunning: boolean; queueLength: number } {
    return {
      isRunning: this.isRunning,
      queueLength: this.queue.length,
    };
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  formatResults(result: ParallelExecutionResult): string {
    let output = `\n🔄 Parallel Execution Results\n${"═".repeat(50)}\n\n`;
    output += `✅ Completed: ${result.completedCount}\n`;
    output += `❌ Failed: ${result.failedCount}\n`;
    output += `⏱️  Duration: ${(result.totalDuration / 1000).toFixed(2)}s\n\n`;

    if (result.errors.length > 0) {
      output += `⚠️  Errors:\n`;
      for (const error of result.errors) {
        output += `   • ${error}\n`;
      }
      output += "\n";
    }

    output += `📋 Task Results:\n`;
    for (const [taskId, taskResult] of result.results) {
      const status = taskResult.success ? "✅" : "❌";
      output += `\n${status} ${taskId}:\n`;
      output += `   Rounds: ${taskResult.rounds} | Tools: ${taskResult.toolsUsed.join(", ") || "none"}\n`;
      output += `   Output: ${taskResult.output.slice(0, 200)}${taskResult.output.length > 200 ? "..." : ""}\n`;
    }

    output += `\n${"═".repeat(50)}\n`;
    return output;
  }
}

// Singleton instance
let subagentManagerInstance: SubagentManager | null = null;
let parallelRunnerInstance: ParallelSubagentRunner | null = null;
let subagentManagerKey: string | null = null;

export function getSubagentManager(
  apiKey: string,
  baseURL?: string,
  defaultModel?: string
): SubagentManager {
  const key = `${apiKey}\0${baseURL || ""}\0${defaultModel || ""}`;
  if (!subagentManagerInstance || subagentManagerKey !== key) {
    subagentManagerInstance = new SubagentManager(apiKey, baseURL, defaultModel);
    subagentManagerKey = key;
    parallelRunnerInstance = null;
  }
  return subagentManagerInstance;
}

export function getParallelSubagentRunner(
  apiKey: string,
  baseURL?: string,
  defaultModel?: string,
  maxConcurrent: number = 10
): ParallelSubagentRunner {
  const manager = getSubagentManager(apiKey, baseURL, defaultModel);
  if (!parallelRunnerInstance) {
    parallelRunnerInstance = new ParallelSubagentRunner(manager, maxConcurrent);
  }
  return parallelRunnerInstance;
}

export function resetParallelRunner(): void {
  if (parallelRunnerInstance) {
    parallelRunnerInstance.stop();
    parallelRunnerInstance.removeAllListeners();
  }
  parallelRunnerInstance = null;
  subagentManagerInstance = null;
  subagentManagerKey = null;
}
