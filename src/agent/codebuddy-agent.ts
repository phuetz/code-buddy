import { CodeBuddyClient, CodeBuddyMessage, CodeBuddyToolCall } from "../codebuddy/client.js";
import {
  getMCPManager,
  initializeMCPServers,
  ToolSelectionResult,
} from "../codebuddy/tools.js";
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
  BrowserTool,
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
import { getToolSelectionStrategy, ToolSelectionStrategy } from "./execution/tool-selection-strategy.js";
import { PromptBuilder } from "../services/prompt-builder.js";
import { reduceStreamChunk } from "./streaming/message-reducer.js";

import { ToolHandler } from "./tool-handler.js";
import { BaseAgent } from "./base-agent.js";
import { RepairEngine, getRepairEngine } from "./repair/index.js";

// Re-export types for backwards compatibility
export type { ChatEntry, StreamingChunk } from "./types.js";
import type { ChatEntry, StreamingChunk } from "./types.js";

/**
 * Main agent class that orchestrates conversation with CodeBuddy AI and tool execution
 *
 * Usage:
 * ```typescript
 * const agent = new CodeBuddyAgent(apiKey);
 * for await (const chunk of agent.processUserMessageStream("Hello")) {
 *   console.log(chunk);
 * }
 *
 * // Clean up when done
 * agent.dispose();
 * ```
 */
export class CodeBuddyAgent extends BaseAgent {
  private codebuddyClient: CodeBuddyClient;
  private toolHandler: ToolHandler;
  private promptBuilder: PromptBuilder;
  
  private _repairEngine: RepairEngine | null = null;

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

  private get repairEngine(): RepairEngine {
    if (!this._repairEngine) {
      // Get API key from environment (same as used by agent)
      const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
      const baseURL = process.env.GROK_BASE_URL;
      this._repairEngine = getRepairEngine(apiKey, baseURL);
      // Set up executors for the repair engine
      this._repairEngine.setExecutors({
        commandExecutor: async (cmd: string) => {
          const result = await this.toolHandler.bash.execute(cmd);
          return {
            success: result.success,
            output: result.output || '',
            error: result.error,
          };
        },
        fileReader: async (path: string) => {
          const result = await this.toolHandler.textEditor.view(path);
          return result.output || '';
        },
        fileWriter: async (path: string, content: string) => {
          // Use edit to write file content
          await this.toolHandler.textEditor.create(path, content);
        },
      });
    }
    return this._repairEngine;
  }

  // Maximum history entries to prevent memory bloat (keep last N entries)
  private static readonly MAX_HISTORY_SIZE = 1000;
  
  private toolSelectionStrategy: ToolSelectionStrategy;

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
    this.toolSelectionStrategy = getToolSelectionStrategy({
      useRAG: useRAGToolSelection
    });
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

    // Initialize ToolHandler
    this.toolHandler = new ToolHandler({
      checkpointManager: this.checkpointManager,
      hooksManager: this.hooksManager,
      marketplace: this.marketplace,
      autoRepairCallback: this.attemptAutoRepair.bind(this),
      autoRepairEnabled: this.autoRepairEnabled
    });

    // Initialize PromptBuilder
    this.promptBuilder = new PromptBuilder({
      yoloMode: this.yoloMode,
      memoryEnabled: this.memoryEnabled,
      morphEditorEnabled: !!this.toolHandler.morphEditor,
      cwd: process.cwd()
    }, this.promptCacheManager, this.memory);

    // Initialize MCP servers if configured
    this.initializeMCP();

    // Load custom instructions and generate system prompt
    const customInstructions = loadCustomInstructions();

    // Initialize system prompt (async operation, handled via IIFE)
    (async () => {
      const systemPrompt = await this.promptBuilder.buildSystemPrompt(systemPromptId, modelToUse, customInstructions);
      this.messages.push({
        role: "system",
        content: systemPrompt,
      });
    })().catch(error => {
      logger.error("Failed to initialize system prompt", error as Error);
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

  async processUserMessage(message: string): Promise<ChatEntry[]> {
    // Reset cached tools for new conversation turn
    this.toolSelectionStrategy.clearCache();

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
      // Strategy handles caching internally
      const selectionResult = await this.toolSelectionStrategy.selectToolsForQuery(message);
      const tools = selectionResult.tools;
      this.toolSelectionStrategy.cacheTools(tools);

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
        this.isGrokModel() && this.toolSelectionStrategy.shouldUseSearchFor(message)
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
          // Use Maps for O(1) lookups instead of O(n) findIndex
          const toolCallHistoryIndices = new Map<string, number>();
          const toolCallNewEntryIndices = new Map<string, number>();

          assistantMessage.tool_calls.forEach((toolCall) => {
            const toolCallEntry: ChatEntry = {
              type: "tool_call",
              content: "Executing...",
              timestamp: new Date(),
              toolCall: toolCall,
            };
            // Record indices before pushing for O(1) lookup later
            toolCallHistoryIndices.set(toolCall.id, this.chatHistory.length);
            toolCallNewEntryIndices.set(toolCall.id, newEntries.length);
            this.chatHistory.push(toolCallEntry);
            newEntries.push(toolCallEntry);
          });

          // Execute tool calls and update the entries
          for (const toolCall of assistantMessage.tool_calls) {
            const result = await this.toolHandler.executeTool(toolCall);

            // Update the existing tool_call entry with the result using O(1) Map lookup
            const entryIndex = toolCallHistoryIndices.get(toolCall.id);

            if (entryIndex !== undefined) {
              const updatedEntry: ChatEntry = {
                ...this.chatHistory[entryIndex],
                type: "tool_result",
                content: result.success
                  ? result.output || "Success"
                  : result.error || "Error occurred",
                toolResult: result,
              };
              this.chatHistory[entryIndex] = updatedEntry;

              // Also update in newEntries for return value using O(1) Map lookup
              const newEntryIndex = toolCallNewEntryIndices.get(toolCall.id);
              if (newEntryIndex !== undefined) {
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
            this.isGrokModel() && this.toolSelectionStrategy.shouldUseSearchFor(message)
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

  async *processUserMessageStream(
    message: string
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    // Create new abort controller for this request
    this.abortController = new AbortController();

    // Reset cached tools for new conversation turn
    this.toolSelectionStrategy.clearCache();

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
        const selectionResult = await this.toolSelectionStrategy.selectToolsForQuery(message);
        const tools = selectionResult.tools;

        // Cache tools for subsequent rounds in this turn
        if (toolRounds === 0) {
          this.toolSelectionStrategy.cacheTools(tools);
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
          this.isGrokModel() && this.toolSelectionStrategy.shouldUseSearchFor(message)
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
          accumulatedMessage = reduceStreamChunk(accumulatedMessage, chunk);

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
              yield {
                type: "content",
                content: sanitizedContent,
              };

              // Throttle token count updates to avoid expensive recounting on every chunk
              const now = Date.now();
              if (now - lastTokenUpdate > 500) {
                // Only compute token count when we're about to emit an update
                const currentOutputTokens =
                  this.tokenCounter.estimateStreamingTokens(accumulatedContent) +
                  (accumulatedMessage.tool_calls
                    ? this.tokenCounter.countTokens(
                        JSON.stringify(accumulatedMessage.tool_calls)
                      )
                    : 0);
                totalOutputTokens = currentOutputTokens;
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

            const result = await this.toolHandler.executeTool(toolCall);

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
    return this.toolHandler.executeTool(toolCall);
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
    return this.toolHandler.bash.getCurrentDirectory();
  }

  async executeBashCommand(command: string): Promise<ToolResult> {
    return await this.toolHandler.bash.execute(command);
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

  // Clear chat and reset
  clearChat(): void {
    super.clearChat();
  }

  // Image methods
  async processImage(imagePath: string): Promise<ToolResult> {
    return this.toolHandler.imageTool.processImage({ type: 'file', data: imagePath });
  }

  isImageFile(filePath: string): boolean {
    return this.toolHandler.imageTool.isImage(filePath);
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
    this.toolSelectionStrategy.updateConfig({ useRAG: enabled });
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
    return this.toolSelectionStrategy.getLastSelection();
  }

  /**
   * Get a formatted summary of the last tool selection
   */
  formatToolSelectionStats(): string {
    return this.toolSelectionStrategy.formatLastSelectionStats();
  }

  /**
   * Classify a query to understand what types of tools might be needed
   */
  classifyUserQuery(query: string) {
    return this.toolSelectionStrategy.classifyQuery(query);
  }

  /**
   * Get tool selection metrics (success rates, missed tools, etc.)
   */
  getToolSelectionMetrics() {
    return this.toolSelectionStrategy.getSelectionMetrics();
  }

  /**
   * Format tool selection metrics as a readable string
   */
  formatToolSelectionMetrics(): string {
    return this.toolSelectionStrategy.formatSelectionMetrics();
  }

  /**
   * Get most frequently missed tools for debugging
   */
  getMostMissedTools(limit: number = 10) {
    return this.toolSelectionStrategy.getMostMissedTools(limit);
  }

  /**
   * Reset tool selection metrics
   */
  resetToolSelectionMetrics(): void {
    this.toolSelectionStrategy.resetMetrics();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.toolSelectionStrategy.getCacheStats();
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.toolSelectionStrategy.clearAllCaches();
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
    this.toolHandler.bash.setSelfHealing(enabled);
  }

  /**
   * Check if self-healing is enabled for bash commands
   */
  isSelfHealingEnabled(): boolean {
    return this.toolHandler.bash.isSelfHealingEnabled();
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

    // Update prompt builder config
    this.promptBuilder.updateConfig({ yoloMode: enabled });

    // Update system prompt for new mode
    const customInstructions = loadCustomInstructions();
    
    (async () => {
      const systemPrompt = await this.promptBuilder.buildSystemPrompt(undefined, this.getCurrentModel(), customInstructions);
      
      // Update the system message
      if (this.messages.length > 0 && this.messages[0].role === "system") {
        this.messages[0].content = systemPrompt;
      }
    })().catch(error => {
      logger.error("Failed to update system prompt for YOLO mode", error as Error);
    });
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

  /**
   * Clean up all resources
   * Should be called when the agent is no longer needed
   */
  dispose(): void {
    super.dispose();
  }
}
