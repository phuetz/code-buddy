import { CodeBuddyClient, CodeBuddyMessage, CodeBuddyToolCall } from "../codebuddy/client.js";
import {
  getAllCodeBuddyTools,
  getRelevantTools,
  getMCPManager,
  initializeMCPServers,
  classifyQuery,
  ToolSelectionResult,
  getToolSelector,
} from "../codebuddy/tools.js";
import { recordToolRequest, formatToolSelectionMetrics } from "../tools/tool-selector.js";
import { loadMCPConfig } from "../mcp/config.js";
import {
  TextEditorTool,
  MorphEditorTool,
  BashTool,
  TodoTool,
  SearchTool,
  WebSearchTool,
  ImageTool,
  ReasoningTool,
} from "../tools/index.js";
import { ToolResult } from "../types/index.js";
import { EventEmitter } from "events";
import { createTokenCounter, TokenCounter } from "../utils/token-counter.js";
import { loadCustomInstructions } from "../utils/custom-instructions.js";
import { getCheckpointManager, CheckpointManager } from "../checkpoints/checkpoint-manager.js";
import { getSessionStore, SessionStore } from "../persistence/session-store.js";
import { getAgentModeManager, AgentModeManager, AgentMode } from "./agent-mode.js";
import { getSandboxManager, SandboxManager } from "../security/sandbox.js";
import { getMCPClient, MCPClient } from "../mcp/mcp-client.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { getSystemPromptForMode, getChatOnlySystemPrompt, getPromptManager, autoSelectPromptId } from "../prompts/index.js";
import { getCostTracker, CostTracker } from "../utils/cost-tracker.js";
import { getAutonomyManager } from "../utils/autonomy-manager.js";
import { ContextManagerV2, createContextManager } from "../context/context-manager-v2.js";
import { sanitizeLLMOutput, extractCommentaryToolCalls } from "../utils/sanitize.js";
import { getErrorMessage } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import { getPromptCacheManager, PromptCacheManager } from "../optimization/prompt-cache.js";
import { getHooksManager, HooksManager } from "../hooks/lifecycle-hooks.js";
import { getModelRouter, ModelRouter, type RoutingDecision } from "../optimization/model-routing.js";
import { getPluginMarketplace, PluginMarketplace } from "../plugins/marketplace.js";

import { BaseAgent } from "./base-agent.js";
import { RepairEngine, getRepairEngine } from "./repair/index.js";
import {
  EnhancedMemory,
  getEnhancedMemory,
  type MemoryEntry,
  type MemoryType,
} from "../memory/index.js";

// Re-export types for backwards compatibility
export { ChatEntry, StreamingChunk } from "./types.js";
import type { ChatEntry, StreamingChunk } from "./types.js";

/**
 * Main agent class that orchestrates conversation with CodeBuddy AI and tool execution
 *
 * @example
 * ```typescript
 * const agent = new CodeBuddyAgent(apiKey, baseURL, model);
 *
 * // Process a message with streaming
 * for await (const chunk of agent.processUserMessageStream("Show me package.json")) {
 *   if (chunk.type === "content") {
 *     console.log(chunk.content);
 *   }
 * }
 *
 * // Clean up when done
 * agent.dispose();
 * ```
 */
export class CodeBuddyAgent extends BaseAgent {
  private codebuddyClient: CodeBuddyClient;
  // Lazy-loaded tool instances (improves startup time)
  private _textEditor: TextEditorTool | null = null;
  private _morphEditor: MorphEditorTool | null | undefined = undefined; // undefined = not checked yet
  private _bash: BashTool | null = null;
  private _todoTool: TodoTool | null = null;
  private _search: SearchTool | null = null;
  private _webSearch: WebSearchTool | null = null;
  private _imageTool: ImageTool | null = null;
  private _reasoningTool: ReasoningTool | null = null;
  private _repairEngine: RepairEngine | null = null;
  private _memory: EnhancedMemory | null = null;

  // Memory system configuration
  private memoryEnabled = true;

  // Auto-repair configuration
  private autoRepairEnabled = true;
  private autoRepairPatterns = [
    /error TS\d+:/i,           // TypeScript errors
    /SyntaxError:/i,           // Syntax errors
    /ReferenceError:/i,        // Reference errors
    /TypeError:/i,             // Type errors
    /eslint.*error/i,          // ESLint errors
    /FAIL.*test/i,             // Test failures
    /npm ERR!/i,               // npm errors
    /Build failed/i,           // Build failures
  ];

  // Lazy tool getters - only instantiate when first accessed
  private get textEditor(): TextEditorTool {
    if (!this._textEditor) {
      this._textEditor = new TextEditorTool();
    }
    return this._textEditor;
  }

  private get morphEditor(): MorphEditorTool | null {
    if (this._morphEditor === undefined) {
      this._morphEditor = process.env.MORPH_API_KEY ? new MorphEditorTool() : null;
    }
    return this._morphEditor;
  }

  private get bash(): BashTool {
    if (!this._bash) {
      this._bash = new BashTool();
    }
    return this._bash;
  }

  private get todoTool(): TodoTool {
    if (!this._todoTool) {
      this._todoTool = new TodoTool();
    }
    return this._todoTool;
  }

  private get search(): SearchTool {
    if (!this._search) {
      this._search = new SearchTool();
    }
    return this._search;
  }

  private get webSearch(): WebSearchTool {
    if (!this._webSearch) {
      this._webSearch = new WebSearchTool();
    }
    return this._webSearch;
  }

  private get imageTool(): ImageTool {
    if (!this._imageTool) {
      this._imageTool = new ImageTool();
    }
    return this._imageTool;
  }

  private get reasoningTool(): ReasoningTool {
    if (!this._reasoningTool) {
      this._reasoningTool = new ReasoningTool();
    }
    return this._reasoningTool;
  }

  private get repairEngine(): RepairEngine {
    if (!this._repairEngine) {
      // Get API key from environment (same as used by agent)
      const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
      const baseURL = process.env.GROK_BASE_URL;
      this._repairEngine = getRepairEngine(apiKey, baseURL);
      // Set up executors for the repair engine
      this._repairEngine.setExecutors({
        commandExecutor: async (cmd: string) => {
          const result = await this.bash.execute(cmd);
          return {
            success: result.success,
            output: result.output || '',
            error: result.error,
          };
        },
        fileReader: async (path: string) => {
          const result = await this.textEditor.view(path);
          return result.output || '';
        },
        fileWriter: async (path: string, content: string) => {
          // Use edit to write file content
          await this.textEditor.create(path, content);
        },
      });
    }
    return this._repairEngine;
  }

  /**
   * Lazy-loaded memory system for cross-session context persistence
   */
  private get memory(): EnhancedMemory {
    if (!this._memory) {
      this._memory = getEnhancedMemory({
        enabled: this.memoryEnabled,
        embeddingEnabled: true,
        useSQLite: true,
        maxMemories: 10000,
        autoSummarize: true,
      });

      // Set project context if we have a working directory
      const cwd = process.cwd();
      if (cwd) {
        this._memory.setProjectContext(cwd).catch(err => {
          logger.warn('Failed to set project context for memory', { error: getErrorMessage(err) });
        });
      }
    }
    return this._memory;
  }

  // Maximum history entries to prevent memory bloat (keep last N entries)
  private static readonly MAX_HISTORY_SIZE = 1000;
  // Cached tools from first round of tool selection
  private cachedSelectedTools: import("../codebuddy/client.js").CodeBuddyTool[] | null = null;
  
  private lastToolSelection: ToolSelectionResult | null = null;
  private lastSelectedToolNames: string[] = [];
  private lastQueryForToolSelection: string = '';

  /**
   * Create a new CodeBuddyAgent instance
   *
   * @param apiKey - API key for authentication
   * @param baseURL - Optional base URL for the API endpoint
   * @param model - Optional model name (defaults to saved model or grok-code-fast-1)
   * @param maxToolRounds - Maximum tool execution rounds (default: depends on YOLO mode)
   * @param useRAGToolSelection - Enable RAG-based tool selection (default: true)
   */
  constructor(
    apiKey: string,
    baseURL?: string,
    model?: string,
    maxToolRounds?: number,
    useRAGToolSelection: boolean = true,
    systemPromptId?: string  // New: external prompt ID (default, minimal, secure, etc.)
  ) {
    super();
    const manager = getSettingsManager();
    const savedModel = manager.getCurrentModel();
    const modelToUse = model || savedModel || "grok-code-fast-1";

    // YOLO mode: requires BOTH env var AND explicit config confirmation
    // This prevents accidental activation via env var alone
    const autonomyManager = getAutonomyManager();
    const envYoloMode = process.env.YOLO_MODE === "true";
    const configYoloMode = autonomyManager.isYOLOEnabled();

    // YOLO mode requires explicit enablement through autonomy manager
    // Env var alone only triggers a warning, doesn't enable YOLO
    if (envYoloMode && !configYoloMode) {
      logger.warn("YOLO_MODE env var set but not enabled via /yolo command or config. Use '/yolo on' to explicitly enable YOLO mode.");
      this.yoloMode = false;
    } else {
      this.yoloMode = configYoloMode;
    }

    this.maxToolRounds = maxToolRounds || (this.yoloMode ? 400 : 50);

    // Session cost limit: ALWAYS have a hard limit, even in YOLO mode
    // Default $10, YOLO mode gets $100 max (prevents runaway costs)
    const YOLO_HARD_LIMIT = 100; // $100 max even in YOLO mode
    const maxCostEnv = process.env.MAX_COST ? parseFloat(process.env.MAX_COST) : null;

    if (this.yoloMode) {
      // In YOLO mode, use env var if set, otherwise $100 hard limit
      this.sessionCostLimit = maxCostEnv !== null
        ? Math.min(maxCostEnv, YOLO_HARD_LIMIT * 10) // Allow up to $1000 if explicitly set
        : YOLO_HARD_LIMIT;
      logger.warn(`YOLO MODE ACTIVE - Cost limit: $${this.sessionCostLimit}, Max rounds: ${this.maxToolRounds}`);
    } else {
      this.sessionCostLimit = maxCostEnv !== null ? maxCostEnv : 10;
    }

    this.costTracker = getCostTracker();
    this.useRAGToolSelection = useRAGToolSelection;
    this.codebuddyClient = new CodeBuddyClient(apiKey, modelToUse, baseURL);
    // Tools are now lazy-loaded via getters (see lazy tool getters above)
    this.tokenCounter = createTokenCounter(modelToUse);

    // Initialize context manager with model-specific limits
    // Detect max tokens from environment or use model default
    const envMaxContext = Number(process.env.CODEBUDDY_MAX_CONTEXT);
    const maxContextTokens = Number.isFinite(envMaxContext) && envMaxContext > 0
      ? envMaxContext
      : undefined;
    this.contextManager = createContextManager(modelToUse, maxContextTokens);

    this.checkpointManager = getCheckpointManager();
    this.sessionStore = getSessionStore();
    this.modeManager = getAgentModeManager();
    this.sandboxManager = getSandboxManager();
    this.mcpClient = getMCPClient();
    this.promptCacheManager = getPromptCacheManager();
    this.hooksManager = getHooksManager(process.cwd());
    this.modelRouter = getModelRouter();
    this.marketplace = getPluginMarketplace();

    // Initialize MCP servers if configured
    this.initializeMCP();

    // Load custom instructions and generate system prompt
    const customInstructions = loadCustomInstructions();

    // Initialize system prompt (async operation, handled via IIFE)
    this.initializeSystemPrompt(systemPromptId, modelToUse, customInstructions);
  }

  /**
   * Initialize system prompt - supports external Markdown prompts (mistral-vibe style)
   */
  private initializeSystemPrompt(
    systemPromptId: string | undefined,
    modelName: string,
    customInstructions: string | null
  ): void {
    // Use IIFE to handle async in constructor
    (async () => {
      let systemPrompt: string;

      if (systemPromptId) {
        // Use external prompt system (new)
        const promptManager = getPromptManager();
        systemPrompt = await promptManager.buildSystemPrompt({
          promptId: systemPromptId,
          includeModelInfo: true,
          includeOsInfo: true,
          includeProjectContext: false, // Don't include by default (expensive)
          includeToolPrompts: true,
          userInstructions: customInstructions || undefined,
          cwd: process.cwd(),
          modelName,
          tools: ['view_file', 'str_replace_editor', 'create_file', 'search', 'bash', 'todo', 'reason'],
        });
        logger.debug(`Using system prompt: ${systemPromptId}`);
      } else if (systemPromptId === 'auto') {
        // Auto-select based on model alignment
        const autoId = autoSelectPromptId(modelName);
        const promptManager = getPromptManager();
        systemPrompt = await promptManager.buildSystemPrompt({
          promptId: autoId,
          includeModelInfo: true,
          includeOsInfo: true,
          userInstructions: customInstructions || undefined,
          cwd: process.cwd(),
          modelName,
        });
        logger.debug(`Auto-selected prompt: ${autoId} (based on ${modelName})`);
      } else {
        // Use legacy system (current behavior)
        const promptMode = this.yoloMode ? "yolo" : "default";
        systemPrompt = getSystemPromptForMode(
          promptMode,
          !!this.morphEditor,
          process.cwd(),
          customInstructions || undefined
        );
      }

      // Cache system prompt for optimization
      this.promptCacheManager.cacheSystemPrompt(systemPrompt);

      // Initialize with system message
      this.messages.push({
        role: "system",
        content: systemPrompt,
      });
    })().catch(error => {
      // Fallback to legacy prompt on error
      logger.warn("Failed to load custom prompt, using default", { error: getErrorMessage(error) });
      const promptMode = this.yoloMode ? "yolo" : "default";
      const systemPrompt = getSystemPromptForMode(
        promptMode,
        !!this.morphEditor,
        process.cwd(),
        customInstructions || undefined
      );
      this.messages.push({
        role: "system",
        content: systemPrompt,
      });
    });
  }

  /**
   * Initialize MCP servers in the background
   * Properly handles errors and doesn't create unhandled promise rejections
   */
  private initializeMCP(): void {
    // Initialize MCP in the background without blocking
    // Using IIFE with .catch() to properly handle any errors
    (async () => {
      try {
        const config = loadMCPConfig();
        if (config.servers.length > 0) {
          await initializeMCPServers();
        }
      } catch (error) {
        logger.warn("MCP initialization failed", { error: getErrorMessage(error) });
      }
    })().catch((error) => {
      // This catch handles any uncaught errors from the IIFE
      logger.warn("Uncaught error in MCP initialization", { error: getErrorMessage(error) });
    });
  }

  private isGrokModel(): boolean {
    const currentModel = this.codebuddyClient.getCurrentModel();
    return currentModel.toLowerCase().includes("codebuddy");
  }

  // Heuristic: enable web search only when likely needed
  private shouldUseSearchFor(message: string): boolean {
    const q = message.toLowerCase();
    const keywords = [
      "today",
      "latest",
      "news",
      "trending",
      "breaking",
      "current",
      "now",
      "recent",
      "x.com",
      "twitter",
      "tweet",
      "what happened",
      "as of",
      "update on",
      "release notes",
      "changelog",
      "price",
    ];
    if (keywords.some((k) => q.includes(k))) return true;
    // crude date pattern (e.g., 2024/2025) may imply recency
    if (/(20\d{2})/.test(q)) return true;
    return false;
  }

  /**
   * Check if tool calls can be safely executed in parallel
   *
   * Tools that modify the same files or have side effects should not be parallelized.
   * Read-only operations (view_file, search, web_search) are safe to parallelize.
   */
  private canParallelizeToolCalls(toolCalls: CodeBuddyToolCall[]): boolean {
    if (!this.parallelToolExecution || toolCalls.length <= 1) {
      return false;
    }

    // Tools that are safe to run in parallel (read-only)
    const safeParallelTools = new Set([
      'view_file',
      'search',
      'web_search',
      'web_fetch',
      'codebase_map',
      'pdf',
      'audio',
      'video',
      'document',
      'ocr',
      'qr',
      'archive',
      'clipboard' // read operations
    ]);

    // Tools that modify state (unsafe for parallel)
    const writeTools = new Set([
      'create_file',
      'str_replace_editor',
      'edit_file',
      'multi_edit',
      'bash',
      'git',
      'create_todo_list',
      'update_todo_list',
      'screenshot',
      'export',
      'diagram'
    ]);

    // Check if all tools are safe for parallel execution
    const allSafe = toolCalls.every(tc => safeParallelTools.has(tc.function.name));
    if (allSafe) return true;

    // Check if any write tools target the same file
    const writeToolCalls = toolCalls.filter(tc => writeTools.has(tc.function.name));
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
   * Execute multiple tool calls, potentially in parallel
   */
  private async _executeToolCallsParallel(
    toolCalls: CodeBuddyToolCall[]
  ): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>();

    if (this.canParallelizeToolCalls(toolCalls)) {
      // Execute in parallel with proper error handling per tool
      const promises = toolCalls.map(async (toolCall) => {
        try {
          const result = await this.executeTool(toolCall);
          return { id: toolCall.id, result };
        } catch (error) {
          // Individual tool failure doesn't crash other parallel tools
          return {
            id: toolCall.id,
            result: {
              success: false,
              error: `Tool execution failed: ${getErrorMessage(error)}`,
            } as ToolResult,
          };
        }
      });

      const settled = await Promise.all(promises);
      for (const { id, result } of settled) {
        results.set(id, result);
      }
    } else {
      // Execute sequentially
      for (const toolCall of toolCalls) {
        const result = await this.executeTool(toolCall);
        results.set(toolCall.id, result);
      }
    }

    return results;
  }

  /**
   * Get tools for a query using RAG selection if enabled
   */
  private async getToolsForQuery(query: string): Promise<{
    tools: import("../codebuddy/client.js").CodeBuddyTool[];
    selection: ToolSelectionResult | null;
  }> {
    this.lastQueryForToolSelection = query;

    if (this.useRAGToolSelection) {
      const selection = await getRelevantTools(query, {
        maxTools: 15,
        useRAG: true,
        alwaysInclude: ['view_file', 'bash', 'search', 'str_replace_editor']
      });
      this.lastToolSelection = selection;
      this.lastSelectedToolNames = selection.selectedTools.map(t => t.function.name);

      // Cache tools for prompt caching optimization
      this.promptCacheManager.cacheTools(selection.selectedTools);

      return { tools: selection.selectedTools, selection };
    } else {
      const tools = await getAllCodeBuddyTools();
      this.lastSelectedToolNames = tools.map(t => t.function.name);

      // Cache tools for prompt caching optimization
      this.promptCacheManager.cacheTools(tools);

      return { tools, selection: null };
    }
  }

  /**
   * Record tool request for metrics (called when LLM requests a tool)
   */
  private recordToolRequestMetric(toolName: string): void {
    if (this.useRAGToolSelection && this.lastQueryForToolSelection) {
      recordToolRequest(
        toolName,
        this.lastSelectedToolNames,
        this.lastQueryForToolSelection
      );
    }
  }

  async processUserMessage(message: string): Promise<ChatEntry[]> {
    // Reset cached tools for new conversation turn
    this.cachedSelectedTools = null;

    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: "user", content: message });

    // Trim history to prevent memory bloat
    this.trimHistory();

    const newEntries: ChatEntry[] = [userEntry];
    const maxToolRounds = this.maxToolRounds; // Prevent infinite loops
    let toolRounds = 0;

    // Track token usage for cost calculation
    const inputTokens = this.tokenCounter.countMessageTokens(this.messages as Array<{ role: string; content: string | null; [key: string]: unknown }>);
    let totalOutputTokens = 0;

    try {
      // Use RAG-based tool selection for initial query
      const { tools } = await this.getToolsForQuery(message);

      // Apply context management - compress messages if approaching token limits
      const preparedMessages = this.contextManager.prepareMessages(this.messages);

      // Check for context warnings
      const contextWarning = this.contextManager.shouldWarn(preparedMessages);
      if (contextWarning.warn) {
        logger.warn(contextWarning.message);
      }

      let currentResponse = await this.codebuddyClient.chat(
        preparedMessages,
        tools,
        undefined,
        this.isGrokModel() && this.shouldUseSearchFor(message)
          ? { search_parameters: { mode: "auto" } }
          : { search_parameters: { mode: "off" } }
      );

      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        const assistantMessage = currentResponse.choices[0]?.message;

        if (!assistantMessage) {
          throw new Error("No response from Grok");
        }

        // Track output tokens from response
        if (currentResponse.usage) {
          totalOutputTokens += currentResponse.usage.completion_tokens || 0;
        } else if (assistantMessage.content) {
          // Estimate if usage not provided
          totalOutputTokens += this.tokenCounter.countTokens(assistantMessage.content);
        }

        // Handle tool calls
        if (
          assistantMessage.tool_calls &&
          assistantMessage.tool_calls.length > 0
        ) {
          toolRounds++;

          // Add assistant message with tool calls
          const assistantEntry: ChatEntry = {
            type: "assistant",
            content: assistantMessage.content || "Using tools to help you...",
            timestamp: new Date(),
            toolCalls: assistantMessage.tool_calls,
          };
          this.chatHistory.push(assistantEntry);
          newEntries.push(assistantEntry);

          // Add assistant message to conversation
          this.messages.push({
            role: "assistant",
            content: assistantMessage.content || "",
            tool_calls: assistantMessage.tool_calls,
          });

          // Create initial tool call entries to show tools are being executed
          assistantMessage.tool_calls.forEach((toolCall) => {
            const toolCallEntry: ChatEntry = {
              type: "tool_call",
              content: "Executing...",
              timestamp: new Date(),
              toolCall: toolCall,
            };
            this.chatHistory.push(toolCallEntry);
            newEntries.push(toolCallEntry);
          });

          // Execute tool calls and update the entries
          for (const toolCall of assistantMessage.tool_calls) {
            const result = await this.executeTool(toolCall);

            // Update the existing tool_call entry with the result
            const entryIndex = this.chatHistory.findIndex(
              (entry) =>
                entry.type === "tool_call" && entry.toolCall?.id === toolCall.id
            );

            if (entryIndex !== -1) {
              const updatedEntry: ChatEntry = {
                ...this.chatHistory[entryIndex],
                type: "tool_result",
                content: result.success
                  ? result.output || "Success"
                  : result.error || "Error occurred",
                toolResult: result,
              };
              this.chatHistory[entryIndex] = updatedEntry;

              // Also update in newEntries for return value
              const newEntryIndex = newEntries.findIndex(
                (entry) =>
                  entry.type === "tool_call" &&
                  entry.toolCall?.id === toolCall.id
              );
              if (newEntryIndex !== -1) {
                newEntries[newEntryIndex] = updatedEntry;
              }
            }

            // Add tool result to messages with proper format (needed for AI context)
            this.messages.push({
              role: "tool",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error",
              tool_call_id: toolCall.id,
            });
          }

          // Get next response - this might contain more tool calls
          // Apply context management again for long tool chains
          const nextPreparedMessages = this.contextManager.prepareMessages(this.messages);
          currentResponse = await this.codebuddyClient.chat(
            nextPreparedMessages,
            tools,
            undefined,
            this.isGrokModel() && this.shouldUseSearchFor(message)
              ? { search_parameters: { mode: "auto" } }
              : { search_parameters: { mode: "off" } }
          );
        } else {
          // No more tool calls, add final response
          const finalEntry: ChatEntry = {
            type: "assistant",
            content:
              assistantMessage.content ||
              "I understand, but I don't have a specific response.",
            timestamp: new Date(),
          };
          this.chatHistory.push(finalEntry);
          this.messages.push({
            role: "assistant",
            content: assistantMessage.content || "",
          });
          newEntries.push(finalEntry);
          break; // Exit the loop
        }
      }

      if (toolRounds >= maxToolRounds) {
        const warningEntry: ChatEntry = {
          type: "assistant",
          content:
            "Maximum tool execution rounds reached. Stopping to prevent infinite loops.",
          timestamp: new Date(),
        };
        this.chatHistory.push(warningEntry);
        this.messages.push({ role: "assistant", content: warningEntry.content });
        newEntries.push(warningEntry);
      }

      // Record session cost and check limit
      this.recordSessionCost(inputTokens, totalOutputTokens);
      if (this.isSessionCostLimitReached()) {
        const costEntry: ChatEntry = {
          type: "assistant",
          content: `💸 Session cost limit reached ($${this.sessionCost.toFixed(2)} / $${this.sessionCostLimit.toFixed(2)}). Please start a new session.`,
          timestamp: new Date(),
        };
        this.chatHistory.push(costEntry);
        this.messages.push({ role: "assistant", content: costEntry.content });
        newEntries.push(costEntry);
      }

      return newEntries;
    } catch (error: unknown) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${getErrorMessage(error)}`,
        timestamp: new Date(),
      };
      this.chatHistory.push(errorEntry);
      // Add error response to messages to maintain valid conversation structure
      this.messages.push({
        role: "assistant",
        content: errorEntry.content,
      });
      return [userEntry, errorEntry];
    }
  }

  private messageReducer(previous: Record<string, unknown>, item: unknown): Record<string, unknown> {
    const reduce = (acc: Record<string, unknown>, delta: unknown): Record<string, unknown> => {
      if (!delta || typeof delta !== 'object') {
        return acc;
      }
      acc = { ...acc };
      for (const [key, value] of Object.entries(delta)) {
        if (acc[key] === undefined || acc[key] === null) {
          acc[key] = value;
          // Clean up index properties from tool calls
          if (Array.isArray(acc[key])) {
            for (const arr of acc[key]) {
              if (arr && typeof arr === 'object' && 'index' in arr) {
                delete arr.index;
              }
            }
          }
        } else if (typeof acc[key] === "string" && typeof value === "string") {
          (acc[key] as string) += value;
        } else if (Array.isArray(acc[key]) && Array.isArray(value)) {
          const accArray = acc[key] as Array<Record<string, unknown>>;
          for (let i = 0; i < value.length; i++) {
            if (!accArray[i]) accArray[i] = {};
            accArray[i] = reduce(accArray[i], value[i]);
          }
        } else if (typeof acc[key] === "object" && typeof value === "object" && acc[key] !== null && value !== null) {
          acc[key] = reduce(acc[key] as Record<string, unknown>, value);
        }
      }
      return acc;
    };

    const itemObj = item as { choices?: Array<{ delta?: unknown }> };
    return reduce(previous, itemObj.choices?.[0]?.delta || {});
  }

  /**
   * Process a user message with streaming response
   *
   * This method runs an agentic loop that can execute multiple tool rounds.
   * It yields chunks as they arrive, including content, tool calls, and results.
   *
   * @param message - The user's message to process
   * @yields StreamingChunk objects containing different types of data
   * @throws Error if processing fails
   *
   * @example
   * ```typescript
   * for await (const chunk of agent.processUserMessageStream("List files")) {
   *   switch (chunk.type) {
   *     case "content":
   *       console.log(chunk.content);
   *       break;
   *     case "tool_calls":
   *       console.log("Tools:", chunk.toolCalls);
   *       break;
   *     case "done":
   *       console.log("Completed");
   *       break;
   *   }
   * }
   * ```
   */
  async *processUserMessageStream(
    message: string
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    // Create new abort controller for this request
    this.abortController = new AbortController();

    // Reset cached tools for new conversation turn
    this.cachedSelectedTools = null;

    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: "user", content: message });

    // Trim history to prevent memory bloat
    this.trimHistory();

    // Model routing - select optimal model based on task complexity
    let originalModel: string | null = null;
    if (this.useModelRouting) {
      const conversationContext = this.chatHistory
        .slice(-5)
        .map(e => e.content)
        .filter((c): c is string => typeof c === 'string');

      const routingDecision = this.modelRouter.route(
        message,
        conversationContext,
        this.codebuddyClient.getCurrentModel()
      );
      this.lastRoutingDecision = routingDecision;

      // Switch model if different from current
      if (routingDecision.recommendedModel !== this.codebuddyClient.getCurrentModel()) {
        originalModel = this.codebuddyClient.getCurrentModel();
        this.codebuddyClient.setModel(routingDecision.recommendedModel);
        logger.debug(`Model routing: ${originalModel} → ${routingDecision.recommendedModel} (${routingDecision.reason})`);
      }
    }

    // Calculate input tokens
    let inputTokens = this.tokenCounter.countMessageTokens(
      this.messages as Array<{ role: string; content: string | null; [key: string]: unknown }>
    );
    yield {
      type: "token_count",
      tokenCount: inputTokens,
    };

    const maxToolRounds = this.maxToolRounds; // Prevent infinite loops
    let toolRounds = 0;
    let totalOutputTokens = 0;
    let lastTokenUpdate = 0;

    try {
      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        // Check if operation was cancelled
        if (this.abortController?.signal.aborted) {
          yield {
            type: "content",
            content: "\n\n[Operation cancelled by user]",
          };
          yield { type: "done" };
          return;
        }

        // Stream response and accumulate
        // Use RAG-based tool selection on first round, then cache and reuse tools for consistency
        // This saves ~9000 tokens on multi-round queries
        let tools: import("../codebuddy/client.js").CodeBuddyTool[];
        if (toolRounds === 0) {
          const selection = await this.getToolsForQuery(message);
          tools = selection.tools;
          this.cachedSelectedTools = tools; // Cache for subsequent rounds
        } else {
          // Use cached tools from first round instead of ALL tools
          tools = this.cachedSelectedTools || await getAllCodeBuddyTools();
        }

        // Apply context management - compress messages if approaching token limits
        const preparedMessages = this.contextManager.prepareMessages(this.messages);

        // Check for context warnings and emit to user
        const contextWarning = this.contextManager.shouldWarn(preparedMessages);
        if (contextWarning.warn) {
          yield {
            type: "content",
            content: `\n${contextWarning.message}\n`,
          };
        }

        const stream = this.codebuddyClient.chatStream(
          preparedMessages,
          tools,
          undefined,
          this.isGrokModel() && this.shouldUseSearchFor(message)
            ? { search_parameters: { mode: "auto" } }
            : { search_parameters: { mode: "off" } }
        );
        let accumulatedMessage: Record<string, unknown> = {};
        let accumulatedContent = "";
        let toolCallsYielded = false;

        for await (const chunk of stream) {
          // Check for cancellation in the streaming loop
          if (this.abortController?.signal.aborted) {
            yield {
              type: "content",
              content: "\n\n[Operation cancelled by user]",
            };
            yield { type: "done" };
            return;
          }

          if (!chunk.choices?.[0]) continue;

          // Accumulate the message using reducer
          accumulatedMessage = this.messageReducer(accumulatedMessage, chunk);

          // Check for tool calls - yield when we have complete tool calls with function names
          const toolCalls = accumulatedMessage.tool_calls;
          if (!toolCallsYielded && Array.isArray(toolCalls) && toolCalls.length > 0) {
            // Check if we have at least one complete tool call with a function name
            const hasCompleteTool = toolCalls.some(
              (tc: unknown) => typeof tc === 'object' && tc !== null && 'function' in tc && typeof tc.function === 'object' && tc.function !== null && 'name' in tc.function
            );
            if (hasCompleteTool) {
              yield {
                type: "tool_calls",
                toolCalls: toolCalls as CodeBuddyToolCall[],
              };
              toolCallsYielded = true;
            }
          }

          // Stream content as it comes
          if (chunk.choices[0].delta?.content) {
            // Keep raw content for tool call extraction (commentary patterns)
            const rawContent = chunk.choices[0].delta.content;
            // Sanitize content to remove LLM control tokens (e.g., <|channel|>, <|message|>)
            const sanitizedContent = sanitizeLLMOutput(rawContent);

            // Accumulate raw content for potential tool call extraction later
            // (sanitization removes "commentary to=" patterns that we need)
            accumulatedContent += rawContent;

            // Only display sanitized content
            if (sanitizedContent) {

              // Update token count in real-time including accumulated content and any tool calls
              const currentOutputTokens =
                this.tokenCounter.estimateStreamingTokens(accumulatedContent) +
                (accumulatedMessage.tool_calls
                  ? this.tokenCounter.countTokens(
                      JSON.stringify(accumulatedMessage.tool_calls)
                    )
                  : 0);
              totalOutputTokens = currentOutputTokens;

              yield {
                type: "content",
                content: sanitizedContent,
              };

              // Emit token count update
              const now = Date.now();
              if (now - lastTokenUpdate > 500) {
                lastTokenUpdate = now;
                yield {
                  type: "token_count",
                  tokenCount: inputTokens + totalOutputTokens,
                };
              }
            }
          }
        }

        // Check for "commentary" style tool calls in content (for models without native tool call support)
        // This handles patterns like: "commentary to=web_search {"query":"..."}"
        const existingToolCalls = accumulatedMessage.tool_calls;
        const hasToolCalls = Array.isArray(existingToolCalls) && existingToolCalls.length > 0;
        if (!hasToolCalls && accumulatedContent) {
          const { toolCalls: extractedCalls, remainingContent } = extractCommentaryToolCalls(accumulatedContent);

          if (extractedCalls.length > 0) {
            // Convert extracted calls to OpenAI tool call format
            const convertedCalls = extractedCalls.map((tc, index) => ({
              id: `commentary_${Date.now()}_${index}`,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            }));
            accumulatedMessage.tool_calls = convertedCalls;

            // Update content to remove the tool call text
            accumulatedMessage.content = remainingContent;
            accumulatedContent = remainingContent;

            // Yield the extracted tool calls
            yield {
              type: "tool_calls",
              toolCalls: convertedCalls,
            };
            toolCallsYielded = true;
          }
        }

        // Add assistant entry to history
        const content = typeof accumulatedMessage.content === 'string' ? accumulatedMessage.content : "Using tools to help you...";
        const toolCalls = Array.isArray(accumulatedMessage.tool_calls) ? accumulatedMessage.tool_calls as CodeBuddyToolCall[] : undefined;

        const assistantEntry: ChatEntry = {
          type: "assistant",
          content: content,
          timestamp: new Date(),
          toolCalls: toolCalls,
        };
        this.chatHistory.push(assistantEntry);

        // Add accumulated message to conversation
        this.messages.push({
          role: "assistant",
          content: content,
          tool_calls: toolCalls,
        });

        // Handle tool calls if present
        if (toolCalls && toolCalls.length > 0) {
          toolRounds++;

          // Only yield tool_calls if we haven't already yielded them during streaming
          if (!toolCallsYielded) {
            yield {
              type: "tool_calls",
              toolCalls: toolCalls,
            };
          }

          // Execute tools
          for (const toolCall of toolCalls) {
            // Check for cancellation before executing each tool
            if (this.abortController?.signal.aborted) {
              yield {
                type: "content",
                content: "\n\n[Operation cancelled by user]",
              };
              yield { type: "done" };
              return;
            }

            const result = await this.executeTool(toolCall);

            const toolResultEntry: ChatEntry = {
              type: "tool_result",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error occurred",
              timestamp: new Date(),
              toolCall: toolCall,
              toolResult: result,
            };
            this.chatHistory.push(toolResultEntry);

            yield {
              type: "tool_result",
              toolCall,
              toolResult: result,
            };

            // Add tool result with proper format (needed for AI context)
            this.messages.push({
              role: "tool",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error",
              tool_call_id: toolCall.id,
            });
          }

          // Update token count after processing all tool calls to include tool results
          inputTokens = this.tokenCounter.countMessageTokens(
            this.messages as Array<{ role: string; content: string | null; [key: string]: unknown }>
          );
          // Final token update after tools processed
          yield {
            type: "token_count",
            tokenCount: inputTokens + totalOutputTokens,
          };

          // Record session cost and check limit
          this.recordSessionCost(inputTokens, totalOutputTokens);
          if (this.isSessionCostLimitReached()) {
            yield {
              type: "content",
              content: `\n\n💸 Session cost limit reached ($${this.sessionCost.toFixed(2)} / $${this.sessionCostLimit.toFixed(2)}). Use YOLO_MODE=true or set MAX_COST to increase the limit.`,
            };
            yield { type: "done" };
            return;
          }

          // Continue the loop to get the next response (which might have more tool calls)
        } else {
          // No tool calls, we're done
          break;
        }
      }

      if (toolRounds >= maxToolRounds) {
        yield {
          type: "content",
          content:
            "\n\nMaximum tool execution rounds reached. Stopping to prevent infinite loops.",
        };
      }

      // Record final session cost (for cases without tool calls)
      this.recordSessionCost(inputTokens, totalOutputTokens);
      if (this.isSessionCostLimitReached()) {
        yield {
          type: "content",
          content: `\n\n💸 Session cost limit reached ($${this.sessionCost.toFixed(2)} / $${this.sessionCostLimit.toFixed(2)}). Use YOLO_MODE=true or set MAX_COST to increase the limit.`,
        };
      }

      yield { type: "done" };
    } catch (error: unknown) {
      // Check if this was a cancellation
      if (this.abortController?.signal.aborted) {
        yield {
          type: "content",
          content: "\n\n[Operation cancelled by user]",
        };
        yield { type: "done" };
        return;
      }

      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${getErrorMessage(error)}`,
        timestamp: new Date(),
      };
      this.chatHistory.push(errorEntry);
      // Add error response to messages to maintain valid conversation structure
      this.messages.push({
        role: "assistant",
        content: errorEntry.content,
      });
      yield {
        type: "content",
        content: errorEntry.content,
      };
      yield { type: "done" };
    } finally {
      // Restore original model if it was changed by routing
      if (originalModel) {
        this.codebuddyClient.setModel(originalModel);
        logger.debug(`Model routing: restored to ${originalModel}`);
      }

      // Record usage with model router for cost tracking
      if (this.useModelRouting && this.lastRoutingDecision) {
        this.modelRouter.recordUsage(
          this.lastRoutingDecision.recommendedModel,
          inputTokens + totalOutputTokens,
          this.lastRoutingDecision.estimatedCost
        );
      }

      // Clean up abort controller
      this.abortController = null;
    }
  }

  protected async executeTool(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    // Record this tool request for metrics tracking
    this.recordToolRequestMetric(toolCall.function.name);

    try {
      const args = JSON.parse(toolCall.function.arguments);

      switch (toolCall.function.name) {
        case "view_file":
          const range: [number, number] | undefined =
            args.start_line && args.end_line
              ? [args.start_line, args.end_line]
              : undefined;
          return await this.textEditor.view(args.path, range);

        case "create_file": {
          // Create checkpoint before creating file
          this.checkpointManager.checkpointBeforeCreate(args.path);

          // Execute pre-edit hooks
          await this.hooksManager.executeHooks("pre-edit", {
            file: args.path,
            content: args.content,
          });

          const createResult = await this.textEditor.create(args.path, args.content);

          // Execute post-edit hooks
          await this.hooksManager.executeHooks("post-edit", {
            file: args.path,
            content: args.content,
            output: createResult.output,
          });

          return createResult;
        }

        case "str_replace_editor": {
          // Create checkpoint before editing file
          this.checkpointManager.checkpointBeforeEdit(args.path);

          // Execute pre-edit hooks
          await this.hooksManager.executeHooks("pre-edit", {
            file: args.path,
            content: args.new_str,
          });

          const editResult = await this.textEditor.strReplace(
            args.path,
            args.old_str,
            args.new_str,
            args.replace_all
          );

          // Execute post-edit hooks
          await this.hooksManager.executeHooks("post-edit", {
            file: args.path,
            content: args.new_str,
            output: editResult.output,
          });

          return editResult;
        }

        case "edit_file":
          if (!this.morphEditor) {
            return {
              success: false,
              error:
                "Morph Fast Apply not available. Please set MORPH_API_KEY environment variable to use this feature.",
            };
          }
          return await this.morphEditor.editFile(
            args.target_file,
            args.instructions,
            args.code_edit
          );

        case "bash": {
          // Execute pre-bash hooks (gracefully handle failures)
          try {
            await this.hooksManager.executeHooks("pre-bash", {
              command: args.command,
            });
          } catch (hookError) {
            logger.warn("Pre-bash hook failed, continuing with execution", { error: getErrorMessage(hookError) });
          }

          let bashResult = await this.bash.execute(args.command);

          // INTEGRATION: Auto-repair on failure
          if (!bashResult.success && bashResult.error && this.autoRepairEnabled) {
            const repairResult = await this.attemptAutoRepair(bashResult.error, args.command);
            
            if (repairResult.success) {
              // If repair succeeded, retry the command once
              logger.info(`Retrying command after successful repair: ${args.command}`);
              const retryResult = await this.bash.execute(args.command);
              
              if (retryResult.success) {
                bashResult = {
                  ...retryResult,
                  output: `[Auto-repaired: ${repairResult.fixes.join(', ')}]\n\n${retryResult.output}`
                };
              } else {
                bashResult.output = (bashResult.output || '') + 
                  `\n\n[Auto-repair applied but command still fails: ${repairResult.fixes.join(', ')}]`;
              }
            }
          }

          // Execute post-bash hooks (gracefully handle failures)
          try {
            await this.hooksManager.executeHooks("post-bash", {
              command: args.command,
              output: bashResult.output,
              error: bashResult.error,
            });
          } catch (hookError) {
            logger.warn("Post-bash hook failed", { error: getErrorMessage(hookError) });
          }

          return bashResult;
        }

        case "create_todo_list":
          return await this.todoTool.createTodoList(args.todos);

        case "update_todo_list":
          return await this.todoTool.updateTodoList(args.updates);

        case "search":
          return await this.search.search(args.query, {
            searchType: args.search_type,
            includePattern: args.include_pattern,
            excludePattern: args.exclude_pattern,
            caseSensitive: args.case_sensitive,
            wholeWord: args.whole_word,
            regex: args.regex,
            maxResults: args.max_results,
            fileTypes: args.file_types,
            includeHidden: args.include_hidden,
          });

        case "find_symbols":
          return await this.search.findSymbols(args.name, {
            types: args.types,
            exportedOnly: args.exported_only,
          });

        case "find_references":
          return await this.search.findReferences(
            args.symbol_name,
            args.context_lines ?? 2
          );

        case "find_definition":
          return await this.search.findDefinition(args.symbol_name);

        case "search_multi":
          return await this.search.searchMultiple(
            args.patterns,
            args.operator ?? "OR"
          );

        case "web_search":
          return await this.webSearch.search(args.query, {
            maxResults: args.max_results,
          });

        case "web_fetch":
          return await this.webSearch.fetchPage(args.url);

        case "reason":
          return await this.reasoningTool.execute({
            problem: args.problem,
            context: args.context,
            mode: args.mode,
            constraints: args.constraints,
          });

        default:
          // Check if this is an MCP tool
          if (toolCall.function.name.startsWith("mcp__")) {
            return await this.executeMCPTool(toolCall);
          }

          // Check if this is a plugin tool
          if (toolCall.function.name.startsWith("plugin__")) {
            return await this.executePluginTool(toolCall);
          }

          return {
            success: false,
            error: `Unknown tool: ${toolCall.function.name}`,
          };
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `Tool execution error: ${getErrorMessage(error)}`,
      };
    }
  }

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
        .map((item) => {
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

  private async executePluginTool(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const toolName = toolCall.function.name.replace("plugin__", "");
      
      const result = await this.marketplace.executeTool(toolName, args);

      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `Plugin tool execution error: ${getErrorMessage(error)}`,
      };
    }
  }

  /**
   * Check if an error output is repairable
   */
  private isRepairableError(output: string): boolean {
    if (!this.autoRepairEnabled) return false;
    return this.autoRepairPatterns.some(pattern => pattern.test(output));
  }

  /**
   * Attempt autonomous repair of errors
   * @returns Repair result with success status and any fixes applied
   */
  async attemptAutoRepair(errorOutput: string, command?: string): Promise<{
    attempted: boolean;
    success: boolean;
    fixes: string[];
    message: string;
  }> {
    if (!this.isRepairableError(errorOutput)) {
      return {
        attempted: false,
        success: false,
        fixes: [],
        message: 'Error not recognized as repairable',
      };
    }

    this.emit('repair:start', { errorOutput, command });
    logger.info('Attempting auto-repair', { command });

    try {
      const results = await this.repairEngine.repair(errorOutput, command);

      const successfulFixes = results.filter(r => r.success);
      const fixDescriptions = successfulFixes.map(r =>
        r.appliedPatch?.explanation || 'Fix applied'
      );

      if (successfulFixes.length > 0) {
        this.emit('repair:success', { fixes: fixDescriptions });
        logger.info('Auto-repair successful', {
          fixCount: successfulFixes.length,
          fixes: fixDescriptions
        });

        return {
          attempted: true,
          success: true,
          fixes: fixDescriptions,
          message: `Successfully applied ${successfulFixes.length} fix(es)`,
        };
      }

      this.emit('repair:failed', { reason: 'No successful fixes found' });
      return {
        attempted: true,
        success: false,
        fixes: [],
        message: 'Auto-repair attempted but no fixes were successful',
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.emit('repair:error', { error: errorMessage });
      logger.warn('Auto-repair failed', { error: errorMessage });

      return {
        attempted: true,
        success: false,
        fixes: [],
        message: `Auto-repair error: ${errorMessage}`,
      };
    }
  }

  /**
   * Enable or disable auto-repair
   */
  setAutoRepair(enabled: boolean): void {
    this.autoRepairEnabled = enabled;
    logger.info('Auto-repair setting changed', { enabled });
  }

  /**
   * Check if auto-repair is enabled
   */
  isAutoRepairEnabled(): boolean {
    return this.autoRepairEnabled;
  }

  getChatHistory(): ChatEntry[] {
    return super.getChatHistory();
  }

  getCurrentDirectory(): string {
    return this.bash.getCurrentDirectory();
  }

  async executeBashCommand(command: string): Promise<ToolResult> {
    return await this.bash.execute(command);
  }

  getCurrentModel(): string {
    return this.codebuddyClient.getCurrentModel();
  }

  getClient(): CodeBuddyClient {
    return this.codebuddyClient;
  }

  setModel(model: string): void {
    this.codebuddyClient.setModel(model);
    // Update token counter for new model
    this.tokenCounter.dispose();
    this.tokenCounter = createTokenCounter(model);
    // Update context manager for new model limits
    this.contextManager.updateConfig({ model });
  }

  /**
   * Probe the model to check if it supports function calling
   * Makes a quick test request with a simple tool
   */
  async probeToolSupport(): Promise<boolean> {
    return this.codebuddyClient.probeToolSupport();
  }

  /**
   * Switch to chat-only mode (no tools)
   * Updates the system prompt to a simpler version suitable for models without tool support
   */
  switchToChatOnlyMode(): void {
    const customInstructions = loadCustomInstructions();
    const chatOnlyPrompt = getChatOnlySystemPrompt(process.cwd(), customInstructions || undefined);

    // Replace the system message
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0].content = chatOnlyPrompt;
    } else {
      // Insert at the beginning if no system message exists
      this.messages.unshift({
        role: 'system',
        content: chatOnlyPrompt,
      });
    }
  }

  abortCurrentOperation(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  // Checkpoint methods
  createCheckpoint(description: string): void {
    this.checkpointManager.createCheckpoint(description);
  }

  rewindToLastCheckpoint(): { success: boolean; message: string } {
    const result = this.checkpointManager.rewindToLast();
    if (result.success) {
      return {
        success: true,
        message: result.checkpoint
          ? `Rewound to: ${result.checkpoint.description}\nRestored: ${result.restored.join(', ')}`
          : 'No checkpoint found'
      };
    }
    return {
      success: false,
      message: result.errors.join('\n') || 'Failed to rewind'
    };
  }

  getCheckpointList(): string {
    return this.checkpointManager.formatCheckpointList();
  }

  getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }

  // Session methods
  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  saveCurrentSession(): void {
    this.sessionStore.updateCurrentSession(this.chatHistory);
  }

  getSessionList(): string {
    return this.sessionStore.formatSessionList();
  }

  exportCurrentSession(outputPath?: string): string | null {
    const currentId = this.sessionStore.getCurrentSessionId();
    if (!currentId) return null;
    return this.sessionStore.exportSessionToFile(currentId, outputPath);
  }

  // Clear chat and reset
  clearChat(): void {
    super.clearChat();
  }

  // Mode methods
  getMode(): AgentMode {
    return super.getMode();
  }

  setMode(mode: AgentMode): void {
    super.setMode(mode);
  }

  getModeStatus(): string {
    return this.modeManager.formatModeStatus();
  }

  isToolAllowedInCurrentMode(toolName: string): boolean {
    return this.modeManager.isToolAllowed(toolName);
  }

  // Sandbox methods
  getSandboxStatus(): string {
    return this.sandboxManager.formatStatus();
  }

  validateCommand(command: string): { valid: boolean; reason?: string } {
    return this.sandboxManager.validateCommand(command);
  }

  // MCP methods
  async connectMCPServers(): Promise<void> {
    await this.mcpClient.connectAll();
  }

  getMCPStatus(): string {
    return this.mcpClient.formatStatus();
  }

  async getMCPTools(): Promise<Map<string, unknown[]>> {
    return this.mcpClient.getAllTools();
  }

  getMCPClient(): MCPClient {
    return this.mcpClient;
  }


  // Image methods
  async processImage(imagePath: string): Promise<ToolResult> {
    return this.imageTool.processImage({ type: 'file', data: imagePath });
  }

  isImageFile(filePath: string): boolean {
    return this.imageTool.isImage(filePath);
  }

  // RAG Tool Selection methods

  /**
   * Enable or disable RAG-based tool selection
   *
   * When enabled, only semantically relevant tools are sent to the LLM,
   * reducing prompt bloat and improving tool selection accuracy.
   *
   * @param enabled - Whether to enable RAG tool selection
   */
  setRAGToolSelection(enabled: boolean): void {
    this.useRAGToolSelection = enabled;
  }

  /**
   * Check if RAG tool selection is enabled
   */
  isRAGToolSelectionEnabled(): boolean {
    return this.useRAGToolSelection;
  }

  /**
   * Get the last tool selection result
   *
   * Contains information about which tools were selected,
   * their scores, and token savings.
   */
  getLastToolSelection(): ToolSelectionResult | null {
    return this.lastToolSelection;
  }

  /**
   * Get a formatted summary of the last tool selection
   */
  formatToolSelectionStats(): string {
    const selection = this.lastToolSelection;
    if (!selection) {
      return 'No tool selection data available';
    }

    const { selectedTools, classification, reducedTokens, originalTokens } = selection;
    const tokenSavings = originalTokens > 0
      ? Math.round((1 - reducedTokens / originalTokens) * 100)
      : 0;

    const lines = [
      '📊 Tool Selection Statistics',
      '─'.repeat(30),
      `RAG Enabled: ${this.useRAGToolSelection ? '✅' : '❌'}`,
      `Selected Tools: ${selectedTools.length}`,
      `Categories: ${classification.categories.join(', ')}`,
      `Confidence: ${Math.round(classification.confidence * 100)}%`,
      `Token Savings: ~${tokenSavings}% (${originalTokens} → ${reducedTokens})`,
      '',
      'Selected Tools:',
      ...selectedTools.map(t => `  • ${t.function.name}`)
    ];

    return lines.join('\n');
  }

  /**
   * Classify a query to understand what types of tools might be needed
   */
  classifyUserQuery(query: string) {
    return classifyQuery(query);
  }

  /**
   * Get tool selection metrics (success rates, missed tools, etc.)
   */
  getToolSelectionMetrics() {
    return getToolSelector().getMetrics();
  }

  /**
   * Format tool selection metrics as a readable string
   */
  formatToolSelectionMetrics(): string {
    return formatToolSelectionMetrics();
  }

  /**
   * Get most frequently missed tools for debugging
   */
  getMostMissedTools(limit: number = 10) {
    return getToolSelector().getMostMissedTools(limit);
  }

  /**
   * Reset tool selection metrics
   */
  resetToolSelectionMetrics(): void {
    getToolSelector().resetMetrics();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return getToolSelector().getCacheStats();
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    getToolSelector().clearAllCaches();
  }

  // Parallel Tool Execution methods

  /**
   * Enable or disable parallel tool execution
   *
   * When enabled, multiple read-only tool calls (view_file, search, web_search, etc.)
   * will be executed in parallel for faster response times.
   *
   * Write operations are automatically serialized to prevent conflicts.
   *
   * @param enabled - Whether to enable parallel tool execution
   */
  setParallelToolExecution(enabled: boolean): void {
    this.parallelToolExecution = enabled;
  }

  /**
   * Enable or disable self-healing for bash commands
   *
   * When enabled, failed bash commands will attempt automatic remediation.
   * When disabled (via --no-self-heal flag), commands fail without auto-fix attempts.
   *
   * @param enabled - Whether to enable self-healing
   */
  setSelfHealing(enabled: boolean): void {
    this.bash.setSelfHealing(enabled);
  }

  /**
   * Check if self-healing is enabled for bash commands
   */
  isSelfHealingEnabled(): boolean {
    return this.bash.isSelfHealingEnabled();
  }

  /**
   * Set a custom system prompt (for custom agents)
   *
   * This replaces the current system prompt with a custom one.
   * Used by --agent flag to load custom agent configurations.
   *
   * @param prompt - The custom system prompt content
   */
  setSystemPrompt(prompt: string): void {
    // Find and update the system message
    const systemMessageIndex = this.messages.findIndex(m => m.role === 'system');
    if (systemMessageIndex >= 0) {
      this.messages[systemMessageIndex].content = prompt;
    } else {
      // Add system message if none exists
      this.messages.unshift({
        role: 'system',
        content: prompt,
      });
    }
  }

  /**
   * Get the current system prompt
   */
  getSystemPrompt(): string | null {
    const systemMessage = this.messages.find(m => m.role === 'system');
    return systemMessage?.content as string || null;
  }

  /**
   * Check if parallel tool execution is enabled
   */
  isParallelToolExecutionEnabled(): boolean {
    return this.parallelToolExecution;
  }

  // YOLO Mode methods

  /**
   * Enable or disable YOLO mode
   *
   * YOLO mode enables full autonomy with:
   * - 400 max tool rounds (vs 50 in normal mode)
   * - No session cost limit
   * - Aggressive system prompt for autonomous operation
   *
   * @param enabled - Whether to enable YOLO mode
   */
  setYoloMode(enabled: boolean): void {
    this.yoloMode = enabled;
    this.maxToolRounds = enabled ? 400 : 50;
    this.sessionCostLimit = enabled ? Infinity : 10;

    // Update system prompt for new mode
    const customInstructions = loadCustomInstructions();
    const promptMode = enabled ? "yolo" : "default";
    const systemPrompt = getSystemPromptForMode(
      promptMode,
      !!this.morphEditor,
      process.cwd(),
      customInstructions || undefined
    );

    // Update the system message
    if (this.messages.length > 0 && this.messages[0].role === "system") {
      this.messages[0].content = systemPrompt;
    }
  }

  /**
   * Check if YOLO mode is enabled
   */
  isYoloModeEnabled(): boolean {
    return super.isYoloModeEnabled();
  }

  /**
   * Get current session cost
   */
  getSessionCost(): number {
    return super.getSessionCost();
  }

  /**
   * Get session cost limit
   */
  getSessionCostLimit(): number {
    return super.getSessionCostLimit();
  }

  /**
   * Set session cost limit
   * @param limit - Maximum cost in dollars (use Infinity for unlimited)
   */
  setSessionCostLimit(limit: number): void {
    super.setSessionCostLimit(limit);
  }

  /**
   * Check if session cost limit has been reached
   */
  isSessionCostLimitReached(): boolean {
    return super.isSessionCostLimitReached();
  }

  /**
   * Record cost for current request
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   */
  private recordSessionCost(inputTokens: number, outputTokens: number): void {
    const model = this.codebuddyClient.getCurrentModel();
    const cost = this.costTracker.calculateCost(inputTokens, outputTokens, model);
    this.sessionCost += cost;
    this.costTracker.recordUsage(inputTokens, outputTokens, model);
  }

  /**
   * Format cost status for display
   */
  formatCostStatus(): string {
    const limitStr = this.sessionCostLimit === Infinity
      ? "unlimited"
      : `$${this.sessionCostLimit.toFixed(2)}`;
    const modeStr = this.yoloMode ? "🔥 YOLO" : "🛡️ Safe";

    return `${modeStr} | Session: $${this.sessionCost.toFixed(4)} / ${limitStr} | Rounds: ${this.maxToolRounds} max`;
  }

  // Context Management methods

  /**
   * Get current context statistics
   */
  getContextStats() {
    return this.contextManager.getStats(this.messages);
  }

  /**
   * Format context stats as a readable string
   */
  formatContextStats(): string {
    const stats = this.contextManager.getStats(this.messages);
    const status = stats.isCritical ? '🔴 Critical' :
                   stats.isNearLimit ? '🟡 Warning' : '🟢 Normal';
    return `Context: ${stats.totalTokens}/${stats.maxTokens} tokens (${stats.usagePercent.toFixed(1)}%) ${status} | Messages: ${stats.messageCount} | Summaries: ${stats.summarizedSessions}`;
  }

  /**
   * Update context manager configuration
   * @param config - Partial configuration to update
   */
  updateContextConfig(config: {
    maxContextTokens?: number;
    responseReserveTokens?: number;
    recentMessagesCount?: number;
    enableSummarization?: boolean;
    compressionRatio?: number;
  }): void {
    this.contextManager.updateConfig(config);
  }

  // Prompt Cache methods

  /**
   * Get prompt cache manager
   */
  getPromptCacheManager(): PromptCacheManager {
    return this.promptCacheManager;
  }

  /**
   * Get prompt cache statistics
   */
  getPromptCacheStats() {
    return this.promptCacheManager.getStats();
  }

  /**
   * Format prompt cache stats for display
   */
  formatPromptCacheStats(): string {
    return this.promptCacheManager.formatStats();
  }

  // Lifecycle Hooks methods

  /**
   * Get hooks manager
   */
  getHooksManager(): HooksManager {
    return this.hooksManager;
  }

  /**
   * Get hooks status
   */
  getHooksStatus(): string {
    return this.hooksManager.formatStatus();
  }

  // Model Routing methods

  /**
   * Enable or disable automatic model routing
   *
   * When enabled, requests are routed to optimal models based on task complexity:
   * - Simple tasks → mini model (cost-effective)
   * - Complex tasks → standard model (balanced)
   * - Reasoning tasks → reasoning model (deep analysis)
   * - Vision tasks → vision model (image understanding)
   *
   * Research: FrugalGPT shows 30-70% cost reduction with routing
   *
   * @param enabled - Whether to enable model routing
   */
  setModelRouting(enabled: boolean): void {
    this.useModelRouting = enabled;
    logger.debug(`Model routing ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if model routing is enabled
   */
  isModelRoutingEnabled(): boolean {
    return this.useModelRouting;
  }

  /**
   * Get the model router instance
   */
  getModelRouter(): ModelRouter {
    return this.modelRouter;
  }

  /**
   * Get the last routing decision
   */
  getLastRoutingDecision(): RoutingDecision | null {
    return this.lastRoutingDecision;
  }

  /**
   * Get model routing statistics
   */
  getModelRoutingStats() {
    return {
      enabled: this.useModelRouting,
      totalCost: this.modelRouter.getTotalCost(),
      savings: this.modelRouter.getEstimatedSavings(),
      usageByModel: Object.fromEntries(this.modelRouter.getUsageStats()),
      lastDecision: this.lastRoutingDecision,
    };
  }

  /**
   * Format model routing stats for display
   */
  formatModelRoutingStats(): string {
    const stats = this.getModelRoutingStats();
    const lines = [
      '🧭 Model Routing Statistics',
      `├─ Enabled: ${stats.enabled ? '✅' : '❌'}`,
      `├─ Total Cost: $${stats.totalCost.toFixed(4)}`,
      `├─ Savings: $${stats.savings.saved.toFixed(4)} (${stats.savings.percentage.toFixed(1)}%)`,
    ];

    if (stats.lastDecision) {
      lines.push(`├─ Last Model: ${stats.lastDecision.recommendedModel}`);
      lines.push(`└─ Reason: ${stats.lastDecision.reason}`);
    } else {
      lines.push('└─ No routing decisions yet');
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Memory System Methods
  // ============================================================================

  /**
   * Store a memory for cross-session persistence
   *
   * @param type - Type of memory (fact, preference, decision, pattern, etc.)
   * @param content - Content to remember
   * @param options - Additional options (tags, importance, etc.)
   * @returns The stored memory entry
   */
  async remember(
    type: MemoryType,
    content: string,
    options: {
      summary?: string;
      importance?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<MemoryEntry> {
    if (!this.memoryEnabled) {
      throw new Error('Memory system is disabled');
    }
    return this.memory.store({
      type,
      content,
      ...options,
    });
  }

  /**
   * Recall memories matching a query
   *
   * @param query - Search query
   * @param options - Filter options
   * @returns Matching memories
   */
  async recall(
    query?: string,
    options: {
      types?: MemoryType[];
      tags?: string[];
      limit?: number;
      minImportance?: number;
    } = {}
  ): Promise<MemoryEntry[]> {
    if (!this.memoryEnabled) {
      return [];
    }
    return this.memory.recall({
      query,
      ...options,
    });
  }

  /**
   * Build memory context for system prompt augmentation
   *
   * @param query - Optional query to find relevant memories
   * @returns Context string to add to system prompt
   */
  async getMemoryContext(query?: string): Promise<string> {
    if (!this.memoryEnabled) {
      return '';
    }
    return this.memory.buildContext({
      query,
      includePreferences: true,
      includeProject: true,
      includeRecentSummaries: true,
    });
  }

  /**
   * Store a conversation summary for later recall
   *
   * @param summary - Summary text
   * @param topics - Key topics discussed
   * @param decisions - Decisions made
   */
  async storeConversationSummary(
    summary: string,
    topics: string[],
    decisions?: string[]
  ): Promise<void> {
    if (!this.memoryEnabled) return;

    const sessionId = this.sessionStore.getCurrentSessionId?.() || `session-${Date.now()}`;
    await this.memory.storeSummary({
      sessionId,
      summary,
      topics,
      decisions,
      messageCount: this.messages.length,
    });
  }

  /**
   * Enable or disable memory system
   */
  setMemoryEnabled(enabled: boolean): void {
    this.memoryEnabled = enabled;
    if (!enabled && this._memory) {
      this._memory.dispose();
      this._memory = null;
    }
  }

  /**
   * Check if memory system is enabled
   */
  isMemoryEnabled(): boolean {
    return this.memoryEnabled;
  }

  /**
   * Get memory system statistics
   */
  getMemoryStats(): { totalMemories: number; byType: Record<string, number>; projects: number; summaries: number } | null {
    if (!this.memoryEnabled || !this._memory) {
      return null;
    }
    return this.memory.getStats();
  }

  /**
   * Format memory status for display
   */
  formatMemoryStatus(): string {
    if (!this.memoryEnabled) {
      return '🧠 Memory: Disabled';
    }
    if (!this._memory) {
      return '🧠 Memory: Not initialized';
    }
    return this.memory.formatStatus();
  }

  /**
   * Clean up all resources
   * Should be called when the agent is no longer needed
   */
  dispose(): void {
    // Dispose memory system
    if (this._memory) {
      this._memory.dispose();
      this._memory = null;
    }
    super.dispose();
  }
}
