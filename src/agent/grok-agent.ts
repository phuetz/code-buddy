import { GrokClient, GrokMessage, GrokToolCall, ProviderType } from "../grok/client.js";
import {
  getAllGrokTools,
  getRelevantTools,
  initializeMCPServers,
  classifyQuery,
  ToolSelectionResult,
  getToolSelector,
} from "../grok/tools.js";
import {
  MiddlewarePipeline,
  createDefaultMiddlewares,
  createYoloMiddlewares,
  MiddlewareAction,
  ConversationContext,
} from "../middleware/index.js";
import { getInteractionLogger, InteractionLogger } from "../logging/index.js";
import { recordToolRequest, formatToolSelectionMetrics } from "../tools/tool-selector.js";
import { loadMCPConfig } from "../mcp/config.js";
import { ToolResult } from "../types/index.js";
import { EventEmitter } from "events";
import { createTokenCounter, TokenCounter } from "../utils/token-counter.js";
import { loadCustomInstructions } from "../utils/custom-instructions.js";
import { getCheckpointManager, CheckpointManager } from "../checkpoints/checkpoint-manager.js";
import { getSessionStore, SessionStore } from "../persistence/session-store.js";
import { AgentMode } from "./agent-mode.js";
import { getMCPClient, MCPClient } from "../mcp/mcp-client.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { getSystemPromptForMode, getChatOnlySystemPrompt, getPromptManager, autoSelectPromptId } from "../prompts/index.js";
import { getAutonomyManager } from "../utils/autonomy-manager.js";
import { sanitizeLLMOutput, extractCommentaryToolCalls } from "../utils/sanitize.js";
import { getErrorMessage } from "../types/errors.js";

// Import extracted modules
import { ToolExecutor, ToolExecutorDependencies } from "./tool-executor.js";
import { AgentState } from "./agent-state.js";
import {
  TextEditorTool,
  BashTool,
  TodoTool,
  SearchTool,
  WebSearchTool,
  ImageTool,
  MorphEditorTool,
} from "../tools/index.js";

// Re-export types for backwards compatibility
export { ChatEntry, StreamingChunk } from "./types.js";
import type { ChatEntry, StreamingChunk } from "./types.js";

/**
 * Main agent class that orchestrates conversation with Grok AI and tool execution
 *
 * @example
 * ```typescript
 * const agent = new GrokAgent(apiKey, baseURL, model);
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
export class GrokAgent extends EventEmitter {
  private grokClient: GrokClient;
  private chatHistory: ChatEntry[] = [];
  private messages: GrokMessage[] = [];
  private tokenCounter: TokenCounter;

  // Maximum history entries to prevent memory bloat (keep last N entries)
  private static readonly MAX_HISTORY_SIZE = 1000;

  // Cached tools from first round of tool selection
  private cachedSelectedTools: import("../grok/client.js").GrokTool[] | null = null;

  // Extracted modules for better modularity
  private toolExecutor: ToolExecutor;
  private agentState: AgentState;

  // Managers
  private checkpointManager: CheckpointManager;
  private sessionStore: SessionStore;
  private mcpClient: MCPClient;

  // Middleware and logging (Mistral Vibe-style)
  private middlewarePipeline: MiddlewarePipeline;
  private interactionLogger: InteractionLogger;

  // Tool selection state
  private lastToolSelection: ToolSelectionResult | null = null;
  private lastSelectedToolNames: string[] = [];
  private lastQueryForToolSelection: string = '';

  private providerInitialized: boolean = false;

  /**
   * Create a new GrokAgent instance
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
    systemPromptId?: string,  // New: external prompt ID (default, minimal, secure, etc.)
    provider?: ProviderType   // New: provider type (grok, claude-max, etc.)
  ) {
    super();
    const manager = getSettingsManager();
    const savedModel = manager.getCurrentModel();
    const defaultModel = provider === 'claude-max' ? 'claude-sonnet-4-20250514' : 'grok-code-fast-1';

    // For Claude Max, use Claude model unless explicitly specified
    const modelToUse = provider === 'claude-max'
      ? (model || defaultModel)
      : (model || savedModel || defaultModel);

    // Initialize AgentState with configuration
    const autonomyManager = getAutonomyManager();
    const yoloMode = autonomyManager.isYOLOEnabled();

    // Warn if env var is set but YOLO not explicitly enabled
    if (process.env.YOLO_MODE === "true" && !yoloMode) {
      console.warn("⚠️  YOLO_MODE env var set but not enabled via /yolo command or config.");
      console.warn("   Use '/yolo on' to explicitly enable YOLO mode.");
    }

    // Initialize AgentState (handles YOLO mode, cost tracking, etc.)
    this.agentState = new AgentState({
      yoloMode,
      maxToolRounds: maxToolRounds || (yoloMode ? 400 : 50),
      ragToolSelection: useRAGToolSelection,
    });

    if (yoloMode) {
      const config = this.agentState.getConfig();
      console.warn(`🚀 YOLO MODE ACTIVE - Cost limit: $${config.sessionCostLimit}, Max rounds: ${config.maxToolRounds}`);
    }

    // Initialize Grok client
    this.grokClient = new GrokClient(apiKey, modelToUse, baseURL, provider);

    // Initialize Claude Max provider if selected
    if (provider === 'claude-max') {
      this.initializeProvider();
    }

    this.tokenCounter = createTokenCounter(modelToUse);

    // Initialize managers
    this.checkpointManager = getCheckpointManager();
    this.sessionStore = getSessionStore();
    this.mcpClient = getMCPClient();

    // Initialize middleware pipeline (Mistral Vibe-style conversation control)
    const middlewares = yoloMode
      ? createYoloMiddlewares()
      : createDefaultMiddlewares();
    this.middlewarePipeline = new MiddlewarePipeline(middlewares);

    // Initialize interaction logger for session replay
    this.interactionLogger = getInteractionLogger();
    this.interactionLogger.startSession({
      model: modelToUse,
      provider: provider || 'grok',
    });

    // Initialize ToolExecutor with dependencies
    const toolDeps: ToolExecutorDependencies = {
      textEditor: new TextEditorTool(),
      bash: new BashTool(),
      search: new SearchTool(),
      todoTool: new TodoTool(),
      imageTool: new ImageTool(),
      webSearch: new WebSearchTool(),
      checkpointManager: this.checkpointManager,
      morphEditor: process.env.MORPH_API_KEY ? new MorphEditorTool() : null,
    };
    this.toolExecutor = new ToolExecutor(toolDeps);

    // Initialize MCP servers if configured
    this.initializeMCP();

    // Load custom instructions and generate system prompt
    const customInstructions = loadCustomInstructions();
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
          tools: ['view_file', 'str_replace_editor', 'create_file', 'search', 'bash', 'todo'],
        });
        console.log(`📝 Using system prompt: ${systemPromptId}`);
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
        console.log(`📝 Auto-selected prompt: ${autoId} (based on ${modelName})`);
      } else {
        // Use legacy system (current behavior)
        const promptMode = this.agentState.isYoloModeEnabled() ? "yolo" : "default";
        systemPrompt = getSystemPromptForMode(
          promptMode,
          process.env.MORPH_API_KEY !== undefined,
          process.cwd(),
          customInstructions || undefined
        );
      }

      // Initialize with system message
      this.messages.push({
        role: "system",
        content: systemPrompt,
      });
    })().catch(error => {
      // Fallback to legacy prompt on error
      console.warn("⚠️ Failed to load custom prompt, using default:", error);
      const promptMode = this.agentState.isYoloModeEnabled() ? "yolo" : "default";
      const systemPrompt = getSystemPromptForMode(
        promptMode,
        process.env.MORPH_API_KEY !== undefined,
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
   * Initialize the LLM provider (Claude Max requires async OAuth)
   */
  private initializeProvider(): void {
    (async () => {
      try {
        if (this.grokClient.isClaudeMax()) {
          await this.grokClient.initializeClaudeMax();
          this.providerInitialized = true;
          console.log("✅ Claude Max provider initialized");
        }
      } catch (error) {
        console.error("❌ Provider initialization failed:", error);
        throw error;
      }
    })().catch((error) => {
      console.error("Uncaught error in provider initialization:", error);
    });
  }

  /**
   * Ensure provider is initialized before making requests
   */
  async ensureProviderReady(): Promise<void> {
    if (this.grokClient.isClaudeMax() && !this.providerInitialized) {
      await this.grokClient.initializeClaudeMax();
      this.providerInitialized = true;
    }
    if (this.grokClient.isClaudeSDK() && !this.providerInitialized) {
      await this.grokClient.initializeClaudeSDK();
      this.providerInitialized = true;
    }
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
        console.warn("MCP initialization failed:", error);
      }
    })().catch((error) => {
      // This catch handles any uncaught errors from the IIFE
      console.warn("Uncaught error in MCP initialization:", error);
    });
  }

  private isGrokModel(): boolean {
    const currentModel = this.grokClient.getCurrentModel();
    return currentModel.toLowerCase().includes("grok");
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
   * Get tools for a query using RAG selection if enabled
   */
  private async getToolsForQuery(query: string): Promise<{
    tools: import("../grok/client.js").GrokTool[];
    selection: ToolSelectionResult | null;
  }> {
    this.lastQueryForToolSelection = query;

    if (this.agentState.isRAGToolSelectionEnabled()) {
      const selection = await getRelevantTools(query, {
        maxTools: 15,
        useRAG: true,
        alwaysInclude: ['view_file', 'bash', 'search', 'str_replace_editor']
      });
      this.lastToolSelection = selection;
      this.lastSelectedToolNames = selection.selectedTools.map(t => t.function.name);
      return { tools: selection.selectedTools, selection };
    } else {
      const tools = await getAllGrokTools();
      this.lastSelectedToolNames = tools.map(t => t.function.name);
      return { tools, selection: null };
    }
  }

  /**
   * Record tool request for metrics (called when LLM requests a tool)
   */
  private recordToolRequestMetric(toolName: string): void {
    if (this.agentState.isRAGToolSelectionEnabled() && this.lastQueryForToolSelection) {
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
    const maxToolRounds = this.agentState.getMaxToolRounds();
    let toolRounds = 0;

    // Track token usage for cost calculation
    const inputTokens = this.tokenCounter.countMessageTokens(this.messages as Array<{ role: string; content: string | null; [key: string]: unknown }>);
    let totalOutputTokens = 0;

    // Get context manager for message preparation
    const contextManager = this.agentState.getContextManager();

    try {
      // Use RAG-based tool selection for initial query
      const { tools } = await this.getToolsForQuery(message);

      // Apply context management - compress messages if approaching token limits
      const preparedMessages = contextManager.prepareMessages(this.messages);

      // Check for context warnings
      const contextWarning = contextManager.shouldWarn(preparedMessages);
      if (contextWarning.warn) {
        console.warn(contextWarning.message);
      }

      let currentResponse = await this.grokClient.chat(
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

          // Execute tool calls - parallel if enabled, sequential otherwise
          if (this.agentState.isParallelToolExecutionEnabled()) {
            // Parallel execution using ToolExecutor
            const results = await this.toolExecutor.executeParallel(assistantMessage.tool_calls);

            for (const toolCall of assistantMessage.tool_calls) {
              const result = results.get(toolCall.id)!;
              this.updateToolCallEntry(toolCall, result, newEntries);

              // Add tool result to messages
              this.messages.push({
                role: "tool",
                content: result.success ? result.output || "Success" : result.error || "Error",
                tool_call_id: toolCall.id,
              });
            }
          } else {
            // Sequential execution (original behavior)
            for (const toolCall of assistantMessage.tool_calls) {
              const result = await this.executeTool(toolCall);
              this.updateToolCallEntry(toolCall, result, newEntries);

              // Add tool result to messages with proper format (needed for AI context)
              this.messages.push({
                role: "tool",
                content: result.success
                  ? result.output || "Success"
                  : result.error || "Error",
                tool_call_id: toolCall.id,
              });
            }
          }

          // Get next response - this might contain more tool calls
          // Apply context management again for long tool chains
          const nextPreparedMessages = contextManager.prepareMessages(this.messages);
          currentResponse = await this.grokClient.chat(
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
          content: `💸 Session cost limit reached ($${this.agentState.getSessionCost().toFixed(2)} / $${this.agentState.getSessionCostLimit().toFixed(2)}). Please start a new session.`,
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
    this.agentState.createAbortController();

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

    // Log user message for session replay
    this.interactionLogger.logMessage({
      role: 'user',
      content: message,
    });

    // Trim history to prevent memory bloat
    this.trimHistory();

    // Calculate input tokens
    let inputTokens = this.tokenCounter.countMessageTokens(
      this.messages as Array<{ role: string; content: string | null; [key: string]: unknown }>
    );
    yield {
      type: "token_count",
      tokenCount: inputTokens,
    };

    const maxToolRounds = this.agentState.getMaxToolRounds();
    let toolRounds = 0;
    let totalOutputTokens = 0;
    let lastTokenUpdate = 0;

    // Build conversation context for middleware
    const sessionStartTime = new Date();
    const buildMiddlewareContext = (): ConversationContext => ({
      messages: this.messages,
      stats: {
        turns: this.chatHistory.filter(e => e.type === 'user').length,
        totalTokens: inputTokens + totalOutputTokens,
        promptTokens: inputTokens,
        completionTokens: totalOutputTokens,
        sessionCost: this.agentState.getSessionCost(),
        toolCalls: this.chatHistory.filter(e => e.type === 'tool_call').length,
        successfulToolCalls: this.chatHistory.filter(e => e.type === 'tool_result' && e.toolResult?.success).length,
        failedToolCalls: this.chatHistory.filter(e => e.type === 'tool_result' && !e.toolResult?.success).length,
        startTime: sessionStartTime,
        durationMs: Date.now() - sessionStartTime.getTime(),
      },
      model: {
        name: this.grokClient.getCurrentModel(),
        maxContextTokens: 131072, // Default for Grok
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 15.0,
      },
      workingDirectory: process.cwd(),
      sessionId: this.interactionLogger.getCurrentSessionId() || 'unknown',
      autoApprove: this.agentState.getConfig().yoloMode,
      metadata: {},
    });

    try {
      // Run middleware before turn
      const beforeResult = await this.middlewarePipeline.runBefore(buildMiddlewareContext());
      if (beforeResult.action === MiddlewareAction.STOP) {
        yield { type: "content", content: `\n⚠️ ${beforeResult.message}\n` };
        yield { type: "done" };
        return;
      }
      if (beforeResult.action === MiddlewareAction.INJECT_MESSAGE && beforeResult.message) {
        yield { type: "content", content: `\n💡 ${beforeResult.message}\n` };
      }

      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        // Check if operation was cancelled
        if (this.agentState.isAborted()) {
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
        let tools: import("../grok/client.js").GrokTool[];
        if (toolRounds === 0) {
          const selection = await this.getToolsForQuery(message);
          tools = selection.tools;
          this.cachedSelectedTools = tools; // Cache for subsequent rounds
        } else {
          // Use cached tools from first round instead of ALL tools
          tools = this.cachedSelectedTools || await getAllGrokTools();
        }

        // Apply context management - compress messages if approaching token limits
        const contextManager = this.agentState.getContextManager();
        const preparedMessages = contextManager.prepareMessages(this.messages);

        // Check for context warnings and emit to user
        const contextWarning = contextManager.shouldWarn(preparedMessages);
        if (contextWarning.warn) {
          yield {
            type: "content",
            content: `\n${contextWarning.message}\n`,
          };
        }

        const stream = this.grokClient.chatStream(
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
          if (this.agentState.isAborted()) {
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
                toolCalls: toolCalls as GrokToolCall[],
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
        const toolCalls = Array.isArray(accumulatedMessage.tool_calls) ? accumulatedMessage.tool_calls as GrokToolCall[] : undefined;

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

          // Execute tools - parallel if enabled, sequential otherwise
          if (this.agentState.isParallelToolExecutionEnabled()) {
            // Check for cancellation before parallel execution
            if (this.agentState.isAborted()) {
              yield { type: "content", content: "\n\n[Operation cancelled by user]" };
              yield { type: "done" };
              return;
            }

            // Parallel execution using ToolExecutor
            const results = await this.toolExecutor.executeParallel(toolCalls);

            // Yield results in order
            for (const toolCall of toolCalls) {
              const result = results.get(toolCall.id)!;

              const toolResultEntry: ChatEntry = {
                type: "tool_result",
                content: result.success ? result.output || "Success" : result.error || "Error occurred",
                timestamp: new Date(),
                toolCall: toolCall,
                toolResult: result,
              };
              this.chatHistory.push(toolResultEntry);

              yield { type: "tool_result", toolCall, toolResult: result };

              this.messages.push({
                role: "tool",
                content: result.success ? result.output || "Success" : result.error || "Error",
                tool_call_id: toolCall.id,
              });
            }
          } else {
            // Sequential execution (original behavior)
            for (const toolCall of toolCalls) {
              // Check for cancellation before executing each tool
              if (this.agentState.isAborted()) {
                yield { type: "content", content: "\n\n[Operation cancelled by user]" };
                yield { type: "done" };
                return;
              }

              const result = await this.executeTool(toolCall);

              const toolResultEntry: ChatEntry = {
                type: "tool_result",
                content: result.success ? result.output || "Success" : result.error || "Error occurred",
                timestamp: new Date(),
                toolCall: toolCall,
                toolResult: result,
              };
              this.chatHistory.push(toolResultEntry);

              yield { type: "tool_result", toolCall, toolResult: result };

              // Add tool result with proper format (needed for AI context)
              this.messages.push({
                role: "tool",
                content: result.success ? result.output || "Success" : result.error || "Error",
                tool_call_id: toolCall.id,
              });
            }
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
              content: `\n\n💸 Session cost limit reached ($${this.agentState.getSessionCost().toFixed(2)} / $${this.agentState.getSessionCostLimit().toFixed(2)}). Use YOLO_MODE=true or set MAX_COST to increase the limit.`,
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

      // Run middleware after turn completes
      const afterResult = await this.middlewarePipeline.runAfter(buildMiddlewareContext());
      if (afterResult.action === MiddlewareAction.INJECT_MESSAGE && afterResult.message) {
        yield { type: "content", content: `\n💡 ${afterResult.message}\n` };
      }

      yield { type: "done" };
    } catch (error: unknown) {
      // Check if this was a cancellation
      if (this.agentState.isAborted()) {
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
      // Clean up abort controller
      this.agentState.clearAbortController();
    }
  }

  /**
   * Execute a tool call - delegates to ToolExecutor module
   */
  private async executeTool(toolCall: GrokToolCall): Promise<ToolResult> {
    return this.toolExecutor.execute(toolCall);
  }

  /**
   * Update chat history entries with tool result
   */
  private updateToolCallEntry(toolCall: GrokToolCall, result: ToolResult, newEntries: ChatEntry[]): void {
    const entryIndex = this.chatHistory.findIndex(
      (entry) => entry.type === "tool_call" && entry.toolCall?.id === toolCall.id
    );

    if (entryIndex !== -1) {
      const updatedEntry: ChatEntry = {
        ...this.chatHistory[entryIndex],
        type: "tool_result",
        content: result.success ? result.output || "Success" : result.error || "Error occurred",
        toolResult: result,
      };
      this.chatHistory[entryIndex] = updatedEntry;

      // Also update in newEntries for return value
      const newEntryIndex = newEntries.findIndex(
        (entry) => entry.type === "tool_call" && entry.toolCall?.id === toolCall.id
      );
      if (newEntryIndex !== -1) {
        newEntries[newEntryIndex] = updatedEntry;
      }
    }
  }

  getChatHistory(): ChatEntry[] {
    return [...this.chatHistory];
  }

  getCurrentDirectory(): string {
    return this.toolExecutor.getBashTool().getCurrentDirectory();
  }

  async executeBashCommand(command: string): Promise<ToolResult> {
    return await this.toolExecutor.getBashTool().execute(command);
  }

  getCurrentModel(): string {
    return this.grokClient.getCurrentModel();
  }

  getClient(): GrokClient {
    return this.grokClient;
  }

  setModel(model: string): void {
    this.grokClient.setModel(model);
    // Update token counter for new model
    this.tokenCounter.dispose();
    this.tokenCounter = createTokenCounter(model);
    // Update context manager for new model limits
    this.agentState.updateContextConfig({ model });
  }

  /**
   * Probe the model to check if it supports function calling
   * Makes a quick test request with a simple tool
   */
  async probeToolSupport(): Promise<boolean> {
    return this.grokClient.probeToolSupport();
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
    this.agentState.abortCurrentOperation();
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
    this.chatHistory = [];
    // Keep only the system message
    this.messages = this.messages.slice(0, 1);
  }

  // Mode methods - delegate to AgentState
  getMode(): AgentMode {
    return this.agentState.getMode();
  }

  setMode(mode: AgentMode): void {
    this.agentState.setMode(mode);
  }

  getModeStatus(): string {
    return this.agentState.getModeStatus();
  }

  isToolAllowedInCurrentMode(toolName: string): boolean {
    return this.agentState.isToolAllowedInCurrentMode(toolName);
  }

  // Sandbox methods - delegate to AgentState
  getSandboxStatus(): string {
    return this.agentState.getSandboxStatus();
  }

  validateCommand(command: string): { valid: boolean; reason?: string } {
    return this.agentState.validateCommand(command);
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

  // History management methods

  /**
   * Trim chat history and messages to prevent unbounded memory growth
   * Keeps the most recent entries up to MAX_HISTORY_SIZE
   */
  private trimHistory(): void {
    if (this.chatHistory.length > GrokAgent.MAX_HISTORY_SIZE) {
      // Keep the last MAX_HISTORY_SIZE entries
      this.chatHistory = this.chatHistory.slice(-GrokAgent.MAX_HISTORY_SIZE);
    }

    // Also trim messages, keeping system message (first) and last N messages
    const maxMessages = GrokAgent.MAX_HISTORY_SIZE + 1; // +1 for system message
    if (this.messages.length > maxMessages) {
      const systemMessage = this.messages[0];
      const recentMessages = this.messages.slice(-GrokAgent.MAX_HISTORY_SIZE);
      this.messages = [systemMessage, ...recentMessages];
    }
  }

  // Image methods - delegate to ToolExecutor
  async processImage(imagePath: string): Promise<ToolResult> {
    return this.toolExecutor.getImageTool().processImage({ type: 'file', data: imagePath });
  }

  isImageFile(filePath: string): boolean {
    return this.toolExecutor.getImageTool().isImage(filePath);
  }

  // RAG Tool Selection methods

  /**
   * Enable or disable RAG-based tool selection
   */
  setRAGToolSelection(enabled: boolean): void {
    this.agentState.setRAGToolSelection(enabled);
  }

  /**
   * Check if RAG tool selection is enabled
   */
  isRAGToolSelectionEnabled(): boolean {
    return this.agentState.isRAGToolSelectionEnabled();
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
      `RAG Enabled: ${this.agentState.isRAGToolSelectionEnabled() ? '✅' : '❌'}`,
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

  // Parallel Tool Execution methods - delegate to AgentState

  /**
   * Enable or disable parallel tool execution
   */
  setParallelToolExecution(enabled: boolean): void {
    this.agentState.setParallelToolExecution(enabled);
  }

  /**
   * Enable or disable self-healing for bash commands
   */
  setSelfHealing(enabled: boolean): void {
    this.toolExecutor.getBashTool().setSelfHealing(enabled);
  }

  /**
   * Check if self-healing is enabled for bash commands
   */
  isSelfHealingEnabled(): boolean {
    return this.toolExecutor.getBashTool().isSelfHealingEnabled();
  }

  /**
   * Check if parallel tool execution is enabled
   */
  isParallelToolExecutionEnabled(): boolean {
    return this.agentState.isParallelToolExecutionEnabled();
  }

  // YOLO Mode methods - delegate to AgentState

  /**
   * Enable or disable YOLO mode
   */
  setYoloMode(enabled: boolean): void {
    this.agentState.setYoloMode(enabled);

    // Update system prompt for new mode
    const customInstructions = loadCustomInstructions();
    const promptMode = enabled ? "yolo" : "default";
    const systemPrompt = getSystemPromptForMode(
      promptMode,
      process.env.MORPH_API_KEY !== undefined,
      process.cwd(),
      customInstructions || undefined
    );

    if (this.messages.length > 0 && this.messages[0].role === "system") {
      this.messages[0].content = systemPrompt;
    }
  }

  /**
   * Check if YOLO mode is enabled
   */
  isYoloModeEnabled(): boolean {
    return this.agentState.isYoloModeEnabled();
  }

  /**
   * Get current session cost
   */
  getSessionCost(): number {
    return this.agentState.getSessionCost();
  }

  /**
   * Get session cost limit
   */
  getSessionCostLimit(): number {
    return this.agentState.getSessionCostLimit();
  }

  /**
   * Set session cost limit
   */
  setSessionCostLimit(limit: number): void {
    this.agentState.setSessionCostLimit(limit);
  }

  /**
   * Check if session cost limit has been reached
   */
  isSessionCostLimitReached(): boolean {
    return this.agentState.isSessionCostLimitReached();
  }

  /**
   * Record cost for current request
   */
  private recordSessionCost(inputTokens: number, outputTokens: number): void {
    const model = this.grokClient.getCurrentModel();
    this.agentState.recordSessionCost(inputTokens, outputTokens, model);
  }

  /**
   * Format cost status for display
   */
  formatCostStatus(): string {
    return this.agentState.formatCostStatus();
  }

  // Context Management methods - delegate to AgentState

  /**
   * Get current context statistics
   */
  getContextStats() {
    return this.agentState.getContextStats(this.messages);
  }

  /**
   * Format context stats as a readable string
   */
  formatContextStats(): string {
    return this.agentState.formatContextStats(this.messages);
  }

  /**
   * Update context manager configuration
   */
  updateContextConfig(config: {
    maxContextTokens?: number;
    responseReserveTokens?: number;
    recentMessagesCount?: number;
    enableSummarization?: boolean;
    compressionRatio?: number;
  }): void {
    this.agentState.updateContextConfig(config);
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    // Clean up token counter
    if (this.tokenCounter) {
      this.tokenCounter.dispose();
    }

    // Clean up agent state (includes context manager)
    this.agentState.dispose();

    // Clear chat history and messages to free memory
    this.chatHistory = [];
    this.messages = [];
  }
}
