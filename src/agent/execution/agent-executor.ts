/**
 * Agent Executor Module
 *
 * Implements the core agentic loop for processing user messages,
 * both sequential and streaming. Handles tool execution rounds,
 * token counting, cost tracking, and context management.
 *
 * @module agent/execution
 */

import { CodeBuddyClient, CodeBuddyMessage } from "../../codebuddy/client.js";
import { ChatEntry, StreamingChunk } from "../types.js";
import { ToolHandler } from "../tool-handler.js";
import { ToolSelectionStrategy } from "./tool-selection-strategy.js";
import { StreamingHandler, RawStreamingChunk } from "../streaming/index.js";
import { ContextManagerV2 } from "../../context/context-manager-v2.js";
import { TokenCounter } from "../../utils/token-counter.js";
import { logger } from "../../utils/logger.js";
import { getErrorMessage } from "../../errors/index.js";
import { sanitizeToolResult } from "../../utils/sanitize.js";
import type { LaneQueue } from "../../concurrency/lane-queue.js";
import type { MiddlewarePipeline, MiddlewareContext } from "../middleware/index.js";
import type { MessageQueue } from "../message-queue.js";
import { semanticTruncate } from "../../utils/head-tail-truncation.js";
import { getTodoTracker } from "../todo-tracker.js";
import { getLessonsTracker } from "../lessons-tracker.js";
import { getObservationVariator } from "../../context/observation-variator.js";
import { getRestorableCompressor } from "../../context/restorable-compression.js";
import { getResponseConstraintStack, resolveToolChoice } from "../response-constraint.js";

/**
 * Register a decision-context provider for the executor.
 * Called externally (e.g., by CodeBuddyAgent) to wire up decision memory
 * without incurring dynamic import cost in the hot loop.
 */
let _decisionContextProvider: ((query: string) => Promise<string | null>) | null = null;
export function setDecisionContextProvider(
  provider: (query: string) => Promise<string | null>
): void {
  _decisionContextProvider = provider;
}

/**
 * Dependencies injected into the AgentExecutor
 */
export interface ExecutorDependencies {
  /** API client for LLM communication */
  client: CodeBuddyClient;
  /** Dispatcher for tool execution */
  toolHandler: ToolHandler;
  /** RAG-based tool selection for query optimization */
  toolSelectionStrategy: ToolSelectionStrategy;
  /** Handles streaming response accumulation */
  streamingHandler: StreamingHandler;
  /** Manages context window and message compression */
  contextManager: ContextManagerV2;
  /** Counts tokens for cost calculation */
  tokenCounter: TokenCounter;
  /** Optional lane queue for serialized tool execution */
  laneQueue?: LaneQueue;
  /** Lane ID for tool execution serialization (defaults to 'default') */
  laneId?: string;
  /** Optional middleware pipeline for composable loop control */
  middlewarePipeline?: MiddlewarePipeline;
  /** Optional message queue for steer/followup/collect modes */
  messageQueue?: MessageQueue;
}

/**
 * Runtime configuration for the AgentExecutor
 */
export interface ExecutorConfig {
  /** Maximum tool execution rounds before stopping (prevents infinite loops) */
  maxToolRounds: number;
  /** Returns true if current model is a Grok model (enables web search) */
  isGrokModel: () => boolean;
  /** Records token usage for cost tracking */
  recordSessionCost: (input: number, output: number) => void;
  /** Returns true if session cost limit has been reached */
  isSessionCostLimitReached: () => boolean;
  /** Returns current accumulated session cost in USD */
  getSessionCost: () => number;
  /** Returns maximum allowed session cost in USD */
  getSessionCostLimit: () => number;
  /** Enable auto-discovery hint when tool confidence is low */
  enableAutoDiscovery?: boolean;
  /** Confidence threshold below which the auto-discovery hint is injected (default: 0.3) */
  skillDiscoveryThreshold?: number;
}

/**
 * AgentExecutor implements the core agentic loop
 *
 * The agentic loop follows this pattern:
 * 1. Select relevant tools for the query (RAG-based)
 * 2. Send message to LLM with selected tools
 * 3. If LLM requests tool calls, execute them
 * 4. Send tool results back to LLM
 * 5. Repeat until LLM responds without tool calls or max rounds reached
 *
 * Supports both sequential (processUserMessage) and streaming
 * (processUserMessageStream) execution modes.
 */
export class AgentExecutor {
  constructor(
    private deps: ExecutorDependencies,
    private config: ExecutorConfig
  ) {}

  /**
   * Get or set the middleware pipeline.
   * Used by CodeBuddyAgent.enableAutoObservation() to inject middleware.
   */
  getMiddlewarePipeline(): MiddlewarePipeline | undefined {
    return this.deps.middlewarePipeline;
  }

  setMiddlewarePipeline(pipeline: MiddlewarePipeline): void {
    this.deps.middlewarePipeline = pipeline;
  }

  /**
   * Build a MiddlewareContext from current loop state.
   */
  private buildMiddlewareContext(
    toolRound: number,
    inputTokens: number,
    outputTokens: number,
    history: ChatEntry[],
    messages: CodeBuddyMessage[],
    isStreaming: boolean,
    abortController?: AbortController | null
  ): MiddlewareContext {
    return {
      toolRound,
      maxToolRounds: this.config.maxToolRounds,
      sessionCost: this.config.getSessionCost(),
      sessionCostLimit: this.config.getSessionCostLimit(),
      inputTokens,
      outputTokens,
      history,
      messages,
      isStreaming,
      abortController,
    };
  }

  /**
   * Execute a tool call, optionally through the LaneQueue for serialization.
   * Read-only tools (grep, glob, read_file) run in parallel; mutating tools run serially.
   */
  private executeToolViaLane(toolCall: Parameters<ToolHandler['executeTool']>[0]): ReturnType<ToolHandler['executeTool']> {
    const laneQueue = this.deps.laneQueue;
    if (!laneQueue) {
      return this.deps.toolHandler.executeTool(toolCall);
    }

    const laneId = this.deps.laneId ?? 'default';
    const readOnlyTools = new Set([
      'grep', 'glob', 'read_file', 'list_files', 'search_files',
      'get_file_info', 'tree', 'find_references',
    ]);
    const isParallel = readOnlyTools.has(toolCall.function.name);

    return laneQueue.enqueue(
      laneId,
      () => this.deps.toolHandler.executeTool(toolCall),
      {
        parallel: isParallel,
        category: toolCall.function.name,
        timeout: 120000,
      }
    );
  }

  /**
   * Tool Result Compaction Guard (OpenClaw / Manus AI #13)
   *
   * Before each model call, scan accumulated tool result messages.
   * If their total size exceeds the threshold (default 70K chars ≈ ~17K tokens),
   * compress the oldest ones using RestorableCompressor — replacing full content
   * with a compact stub referencing the callId. The content remains restorable
   * via the `restore_context` tool.
   *
   * This prevents deep agent chains from silently overflowing the context window.
   */
  private compactLargeToolResults(
    preparedMessages: CodeBuddyMessage[],
    maxToolResultChars = 70_000
  ): CodeBuddyMessage[] {
    // Sum characters from tool result messages
    let totalToolChars = 0;
    for (const m of preparedMessages) {
      if (m.role === 'tool' && typeof m.content === 'string') {
        totalToolChars += m.content.length;
      }
    }

    if (totalToolChars <= maxToolResultChars) return preparedMessages;

    const compressor = getRestorableCompressor();
    // Compress oldest tool results first (front of the list)
    const result = [...preparedMessages];
    let charsToFree = totalToolChars - maxToolResultChars;

    for (let i = 0; i < result.length && charsToFree > 0; i++) {
      const m = result[i];
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 500) {
        const callId = (m as { tool_call_id?: string }).tool_call_id || `tool_${i}`;
        const compressed = compressor.compress([{
          role: m.role,
          content: m.content,
          tool_call_id: callId,
        }]);
        if (compressed.messages[0]) {
          charsToFree -= (m.content.length - (compressed.messages[0].content?.length ?? 0));
          result[i] = { ...m, content: compressed.messages[0].content ?? m.content };
        }
      }
    }

    logger.debug(`ToolResultCompactionGuard: compacted tool results`, {
      before: totalToolChars,
      freed: totalToolChars - charsToFree,
    });

    return result;
  }

  /**
   * Process a user message sequentially (non-streaming)
   *
   * @param message - The user's input message
   * @param history - Chat history array (modified in place)
   * @param messages - LLM message array (modified in place)
   * @returns Array of new chat entries created during this turn
   */
  async processUserMessage(
    message: string,
    history: ChatEntry[],
    messages: CodeBuddyMessage[]
  ): Promise<ChatEntry[]> {
    const newEntries: ChatEntry[] = [];
    const maxToolRounds = this.config.maxToolRounds;
    let toolRounds = 0;

    // Track token usage for cost calculation
    const inputTokens = this.deps.tokenCounter.countMessageTokens(messages as Parameters<typeof this.deps.tokenCounter.countMessageTokens>[0]);
    let totalOutputTokens = 0;

    try {
      // Use RAG-based tool selection for initial query
      const selectionResult = await this.deps.toolSelectionStrategy.selectToolsForQuery(message);
      const tools = selectionResult.tools;
      this.deps.toolSelectionStrategy.cacheTools(tools);

      // Auto-discovery hint: if confidence is low, nudge agent to discover skills
      const enableAutoDiscovery = this.config.enableAutoDiscovery ?? true;
      const threshold = this.config.skillDiscoveryThreshold ?? 0.3;
      if (enableAutoDiscovery && selectionResult.confidence !== undefined && selectionResult.confidence < threshold) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'user' && typeof lastMsg.content === 'string') {
          messages.push({
            role: 'system' as const,
            content: 'Low tool confidence for this query. Consider using the `skill_discover` tool to search the Skills Hub for relevant capabilities.',
          });
        }
      }

      // Auto-select persona based on user message context (fire-and-forget)
      try {
        const { getPersonaManager } = await import('../../personas/persona-manager.js');
        getPersonaManager().autoSelectPersona({ message });
      } catch { /* persona auto-select optional */ }

      // Run before_turn middleware (sequential path)
      const pipeline = this.deps.middlewarePipeline;
      if (pipeline) {
        const ctx = this.buildMiddlewareContext(
          toolRounds, inputTokens, totalOutputTokens, history, messages, false
        );
        const mwResult = await pipeline.runBeforeTurn(ctx);
        if (mwResult.action === 'stop') {
          if (mwResult.message) {
            const stopEntry: ChatEntry = { type: 'assistant', content: mwResult.message, timestamp: new Date() };
            history.push(stopEntry);
            messages.push({ role: 'assistant', content: mwResult.message });
            return [stopEntry];
          }
          return [];
        }
        if (mwResult.action === 'compact') {
          this.deps.contextManager.prepareMessages(messages);
        }
        if (mwResult.action === 'warn' && mwResult.message) {
          logger.warn(`Middleware warning: ${mwResult.message}`);
        }
      }

      // Apply context management
      const preparedMessages = this.deps.contextManager.prepareMessages(messages);

      // --- Lessons context: inject BEFORE todo suffix (stable rules, higher priority) ---
      const lessonsBlock = getLessonsTracker(process.cwd()).buildContextBlock();
      if (lessonsBlock) {
        preparedMessages.push({ role: 'system', content: lessonsBlock });
      }

      // --- Decision memory context: inject relevant past decisions ---
      if (_decisionContextProvider) {
        try {
          const decisionsBlock = await _decisionContextProvider(message);
          if (decisionsBlock) {
            preparedMessages.push({ role: 'system', content: decisionsBlock });
          }
        } catch { /* decision-memory optional */ }
      }

      // --- Manus AI attention bias: append todo.md context at END of messages ---
      const todoSuffix = getTodoTracker(process.cwd()).buildContextSuffix();
      if (todoSuffix) {
        preparedMessages.push({ role: 'system', content: todoSuffix });
      }

      // Check for context warnings
      const contextWarning = this.deps.contextManager.shouldWarn(preparedMessages);
      if (contextWarning.warn) {
        logger.warn(contextWarning.message);

        // --- OpenClaw pre-compaction memory flush (NO_REPLY pattern) ---
        // Run a silent background turn to extract facts to MEMORY.md before context is compacted.
        try {
          const { getPrecompactionFlusher } = await import('../../context/precompaction-flush.js');
          const flusher = getPrecompactionFlusher();
          const flushResult = await flusher.flush(
            preparedMessages.filter(m => m.role !== 'system').map(m => ({
              role: m.role as 'user' | 'assistant',
              content: typeof m.content === 'string' ? m.content : '',
            })),
            async (flushMsgs) => {
              const r = await this.deps.client.chat(
                flushMsgs.map(m => ({ role: m.role, content: m.content })),
                [],
              );
              return r.choices[0]?.message?.content ?? 'NO_REPLY';
            }
          );
          if (flushResult.flushed) {
            logger.info(`Pre-compaction flush: saved ${flushResult.factsCount} facts to ${flushResult.writtenTo}`);
          }
        } catch (flushErr) {
          logger.debug('Pre-compaction flush failed (non-critical)', { flushErr });
        }
      }

      // Apply response constraint (Manus AI response prefill / tool_choice control)
      const activeConstraint = getResponseConstraintStack().current();
      const toolNames = tools.map(t => t.function.name);
      const toolChoiceOverride = resolveToolChoice(activeConstraint, toolNames);

      let currentResponse = await this.deps.client.chat(
        preparedMessages,
        tools,
        { tool_choice: toolChoiceOverride !== 'auto' ? toolChoiceOverride : undefined } as never,
        this.config.isGrokModel() && this.deps.toolSelectionStrategy.shouldUseSearchFor(message)
          ? { search_parameters: { mode: "auto" } }
          : { search_parameters: { mode: "off" } }
      );

      // Agent loop
      while (toolRounds < maxToolRounds) {
        const assistantMessage = currentResponse.choices[0]?.message;

        if (!assistantMessage) {
          throw new Error("No response received from AI. The API may be unavailable or the request was incomplete. Please try again.");
        }

        // Track output tokens
        if (currentResponse.usage) {
          totalOutputTokens += currentResponse.usage.completion_tokens || 0;
        } else if (assistantMessage.content) {
          totalOutputTokens += this.deps.tokenCounter.countTokens(assistantMessage.content);
        }

        // Handle tool calls
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          toolRounds++;

          // Add assistant message with tool calls
          const assistantEntry: ChatEntry = {
            type: "assistant",
            content: assistantMessage.content || "Using tools to help you...",
            timestamp: new Date(),
            toolCalls: assistantMessage.tool_calls,
          };
          history.push(assistantEntry);
          newEntries.push(assistantEntry);

          // Add assistant message to conversation
          messages.push({
            role: "assistant",
            content: assistantMessage.content || "",
            tool_calls: assistantMessage.tool_calls,
          });

          // Pre-check cost limit before executing tools
          this.config.recordSessionCost(inputTokens, totalOutputTokens);
          if (this.config.isSessionCostLimitReached()) {
            const sessionCost = this.config.getSessionCost();
            const sessionCostLimit = this.config.getSessionCostLimit();
            const costEntry: ChatEntry = {
              type: "assistant",
              content: `Session cost limit reached ($${sessionCost.toFixed(2)} / $${sessionCostLimit.toFixed(2)}). Stopping before tool execution.`,
              timestamp: new Date(),
            };
            history.push(costEntry);
            messages.push({ role: "assistant", content: costEntry.content });
            newEntries.push(costEntry);
            break;
          }

          // Execute tool calls
          for (const toolCall of assistantMessage.tool_calls) {
            const toolCallEntry: ChatEntry = {
              type: "tool_call",
              content: "Executing...",
              timestamp: new Date(),
              toolCall: toolCall,
            };
            const histIdx = history.length;
            history.push(toolCallEntry);
            const newIdx = newEntries.length;
            newEntries.push(toolCallEntry);

            const result = await this.executeToolViaLane(toolCall);

            // --- Disk-backed tool result (Manus AI #19) ---
            // Persist full result to .codebuddy/tool-results/<callId>.txt for durable restoration.
            const rawToolContent = sanitizeToolResult(result.success ? result.output || "Success" : result.error || "Error");
            if (toolCall.id) {
              getRestorableCompressor().writeToolResult(toolCall.id, rawToolContent);
            }

            // --- Observation Variator (Manus AI #17) ---
            // Rotate the presentation wrapper for this tool result to prevent repetition drift.
            const variator = getObservationVariator();
            variator.nextTurn();
            const variedContent = variator.wrapToolResult(toolCall.function.name, rawToolContent);

            // Update entry with result
            const updatedEntry: ChatEntry = {
              ...toolCallEntry,
              type: "tool_result",
              content: result.success ? result.output || "Success" : result.error || "Error occurred",
              toolResult: result,
            };

            // Replace in history and newEntries using tracked indices (O(1))
            history[histIdx] = updatedEntry;
            newEntries[newIdx] = updatedEntry;

            // Add tool result to messages (with observation variation applied)
            // Note: 'name' is required for Gemini API to match functionResponse with functionCall
            messages.push({
              role: "tool",
              content: variedContent,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            } as CodeBuddyMessage);
          }

          // Run after_turn middleware (sequential path)
          if (pipeline) {
            const ctx = this.buildMiddlewareContext(
              toolRounds, inputTokens, totalOutputTokens, history, messages, false
            );
            const mwResult = await pipeline.runAfterTurn(ctx);
            if (mwResult.action === 'stop') {
              if (mwResult.message) {
                const stopEntry: ChatEntry = { type: 'assistant', content: mwResult.message, timestamp: new Date() };
                history.push(stopEntry);
                messages.push({ role: 'assistant', content: mwResult.message });
                newEntries.push(stopEntry);
              }
              break;
            }
            if (mwResult.action === 'warn' && mwResult.message) {
              logger.warn(`Middleware after-turn warning: ${mwResult.message}`);
            }
          } else {
            // Legacy inline cost check when no pipeline
            this.config.recordSessionCost(inputTokens, totalOutputTokens);
          }

          // Get next response (with tool result compaction guard)
          const nextPreparedMessages = this.compactLargeToolResults(
            this.deps.contextManager.prepareMessages(messages)
          );

          // Re-inject lessons and todo context for each tool round (mirroring streaming path)
          const lessonsBlockNext = getLessonsTracker(process.cwd()).buildContextBlock();
          if (lessonsBlockNext) {
            nextPreparedMessages.push({ role: 'system', content: lessonsBlockNext });
          }
          const todoSuffixNext = getTodoTracker(process.cwd()).buildContextSuffix();
          if (todoSuffixNext) {
            nextPreparedMessages.push({ role: 'system', content: todoSuffixNext });
          }

          currentResponse = await this.deps.client.chat(
            nextPreparedMessages,
            tools,
            undefined,
            this.config.isGrokModel() && this.deps.toolSelectionStrategy.shouldUseSearchFor(message)
              ? { search_parameters: { mode: "auto" } }
              : { search_parameters: { mode: "off" } }
          );
        } else {
          // No more tool calls
          const finalEntry: ChatEntry = {
            type: "assistant",
            content: assistantMessage.content || "I understand, but I don't have a specific response.",
            timestamp: new Date(),
          };
          history.push(finalEntry);
          messages.push({
            role: "assistant",
            content: assistantMessage.content || "",
          });
          newEntries.push(finalEntry);

          // Fire-and-forget auto-capture on final assistant response
          try {
            const { getAutoCaptureManager } = await import('../../memory/auto-capture.js');
            const acm = getAutoCaptureManager();
            if (acm) {
              acm.processMessage('assistant', assistantMessage.content || '').catch(() => {});
            }
          } catch { /* auto-capture optional */ }

          break;
        }
      }

      if (toolRounds >= maxToolRounds) {
        const warningEntry: ChatEntry = {
          type: "assistant",
          content: "Maximum tool execution rounds reached. Stopping to prevent infinite loops.",
          timestamp: new Date(),
        };
        history.push(warningEntry);
        messages.push({ role: "assistant", content: warningEntry.content });
        newEntries.push(warningEntry);
      }

      // Record session cost
      this.config.recordSessionCost(inputTokens, totalOutputTokens);
      if (this.config.isSessionCostLimitReached()) {
        const sessionCost = this.config.getSessionCost();
        const sessionCostLimit = this.config.getSessionCostLimit();
        const costEntry: ChatEntry = {
          type: "assistant",
          content: `💸 Session cost limit reached ($${sessionCost.toFixed(2)} / $${sessionCostLimit.toFixed(2)}). Please start a new session.`,
          timestamp: new Date(),
        };
        history.push(costEntry);
        messages.push({ role: "assistant", content: costEntry.content });
        newEntries.push(costEntry);
      }

      return newEntries;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date(),
      };
      history.push(errorEntry);
      messages.push({ role: "assistant", content: errorEntry.content });
      return [errorEntry];
    }
  }

  /**
   * Process a user message with streaming response
   *
   * Yields chunks as they arrive from the LLM, enabling real-time UI updates.
   * Chunk types: 'content', 'tool_calls', 'tool_result', 'token_count', 'done'
   *
   * @param message - The user's input message
   * @param history - Chat history array (modified in place)
   * @param messages - LLM message array (modified in place)
   * @param abortController - Controller to cancel the operation
   * @yields Streaming chunks for UI consumption
   */
  async *processUserMessageStream(
    message: string,
    history: ChatEntry[],
    messages: CodeBuddyMessage[],
    abortController: AbortController | null
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    // Calculate input tokens
    let inputTokens = this.deps.tokenCounter.countMessageTokens(messages as Parameters<typeof this.deps.tokenCounter.countMessageTokens>[0]);
    yield {
      type: "token_count",
      tokenCount: inputTokens,
    };

    const maxToolRounds = this.config.maxToolRounds;
    let toolRounds = 0;
    let totalOutputTokens = 0;

    try {
      const pipeline = this.deps.middlewarePipeline;

      // Auto-select persona based on user message context (fire-and-forget, streaming path)
      try {
        const { getPersonaManager } = await import('../../personas/persona-manager.js');
        getPersonaManager().autoSelectPersona({ message });
      } catch { /* persona auto-select optional */ }

      while (toolRounds < maxToolRounds) {
        if (abortController?.signal.aborted) {
          yield { type: "content", content: "\n\n[Operation cancelled by user]" };
          yield { type: "done" };
          return;
        }

        // Run before_turn middleware
        if (pipeline) {
          const ctx = this.buildMiddlewareContext(
            toolRounds, inputTokens, totalOutputTokens, history, messages, true, abortController
          );
          const mwResult = await pipeline.runBeforeTurn(ctx);
          if (mwResult.action === 'stop') {
            if (mwResult.message) yield { type: "content", content: `\n\n${mwResult.message}` };
            yield { type: "done" };
            return;
          }
          if (mwResult.action === 'compact') {
            // Trigger context compaction
            this.deps.contextManager.prepareMessages(messages);
          }
          if (mwResult.action === 'warn' && mwResult.message) {
            yield { type: "content", content: `\n${mwResult.message}\n` };
          }
        }

        const selectionResult = await this.deps.toolSelectionStrategy.selectToolsForQuery(message);
        const tools = selectionResult.tools;
        if (toolRounds === 0) this.deps.toolSelectionStrategy.cacheTools(tools);

        const preparedMessages = this.deps.contextManager.prepareMessages(messages);

        // --- Lessons context: inject BEFORE todo suffix (stable rules, higher priority) ---
        const lessonsBlockStream = getLessonsTracker(process.cwd()).buildContextBlock();
        if (lessonsBlockStream) {
          preparedMessages.push({ role: 'system', content: lessonsBlockStream });
        }

        // --- Decision memory context: inject relevant past decisions (streaming path) ---
        if (_decisionContextProvider) {
          try {
            const decisionsBlockStream = await _decisionContextProvider(message);
            if (decisionsBlockStream) {
              preparedMessages.push({ role: 'system', content: decisionsBlockStream });
            }
          } catch { /* decision-memory optional */ }
        }

        // --- Manus AI attention bias: append todo.md context at END of messages ---
        const todoSuffixStream = getTodoTracker(process.cwd()).buildContextSuffix();
        if (todoSuffixStream) {
          preparedMessages.push({ role: 'system', content: todoSuffixStream });
        }

        // Context warning — always check regardless of pipeline state
        {
          const contextWarning = this.deps.contextManager.shouldWarn(preparedMessages);
          if (contextWarning.warn) {
            yield { type: "content", content: `\n${contextWarning.message}\n` };

            // --- OpenClaw pre-compaction memory flush (streaming path) ---
            try {
              const { getPrecompactionFlusher } = await import('../../context/precompaction-flush.js');
              const flusher = getPrecompactionFlusher();
              await flusher.flush(
                preparedMessages.filter(m => m.role !== 'system').map(m => ({
                  role: m.role as 'user' | 'assistant',
                  content: typeof m.content === 'string' ? m.content : '',
                })),
                async (flushMsgs) => {
                  const r = await this.deps.client.chat(
                    flushMsgs.map(m => ({ role: m.role, content: m.content })),
                    [],
                  );
                  return r.choices[0]?.message?.content ?? 'NO_REPLY';
                }
              );
            } catch {
              // non-critical
            }
          }
        }

        const stream = this.deps.client.chatStream(
          preparedMessages,
          tools,
          undefined,
          this.config.isGrokModel() && this.deps.toolSelectionStrategy.shouldUseSearchFor(message)
            ? { search_parameters: { mode: "auto" } }
            : { search_parameters: { mode: "off" } }
        );
        
        this.deps.streamingHandler.reset();

        for await (const chunk of stream) {
          if (abortController?.signal.aborted) {
            yield { type: "content", content: "\n\n[Operation cancelled by user]" };
            yield { type: "done" };
            return;
          }

          const result = this.deps.streamingHandler.accumulateChunk(chunk as RawStreamingChunk);

          if (result.reasoningContent) {
            yield { type: "reasoning", reasoning: result.reasoningContent };
          }

          if (result.hasNewToolCalls && result.toolCalls) {
            yield { type: "tool_calls", toolCalls: result.toolCalls };
          }

          if (result.displayContent) {
            yield { type: "content", content: result.displayContent };
          }

          if (result.shouldEmitTokenCount && result.tokenCount !== undefined) {
            yield { type: "token_count", tokenCount: inputTokens + result.tokenCount };
          }
        }

        if (!this.deps.streamingHandler.hasYieldedToolCalls()) {
          const extracted = this.deps.streamingHandler.extractToolCalls();
          if (extracted.toolCalls.length > 0) {
            yield { type: "tool_calls", toolCalls: extracted.toolCalls };
          }
        }

        const accumulatedMessage = this.deps.streamingHandler.getAccumulatedMessage();
        const content = accumulatedMessage.content || "Using tools to help you...";
        const toolCalls = accumulatedMessage.tool_calls;

        const assistantEntry: ChatEntry = {
          type: "assistant",
          content: content,
          timestamp: new Date(),
          toolCalls: toolCalls,
        };
        history.push(assistantEntry);
        messages.push({ role: "assistant", content: content, tool_calls: toolCalls });

        if (toolCalls && toolCalls.length > 0) {
          toolRounds++;

          // Pre-check cost limit before executing tools
          this.config.recordSessionCost(inputTokens, totalOutputTokens);
          if (this.config.isSessionCostLimitReached()) {
            const sessionCost = this.config.getSessionCost();
            const sessionCostLimit = this.config.getSessionCostLimit();
            yield { type: "content", content: `\n\nSession cost limit reached ($${sessionCost.toFixed(2)} / $${sessionCostLimit.toFixed(2)}). Stopping before tool execution.` };
            yield { type: "done" };
            return;
          }

          // Check for steering messages (steer mode: interrupt execution)
          const mq = this.deps.messageQueue;
          if (mq?.hasSteeringMessage()) {
            const steering = mq.consumeSteeringMessage();
            if (steering) {
              yield { type: "steer", steer: { content: steering.content, source: steering.source } };
              // Inject as user message and skip remaining tool calls
              messages.push({ role: "user", content: steering.content });
              history.push({
                type: "user",
                content: steering.content,
                timestamp: new Date(),
              });
              continue; // Re-enter loop to get new LLM response
            }
          }

          if (!this.deps.streamingHandler.hasYieldedToolCalls()) {
            yield { type: "tool_calls", toolCalls: toolCalls };
          }

          for (const toolCall of toolCalls) {
            if (abortController?.signal.aborted) {
              yield { type: "content", content: "\n\n[Operation cancelled by user]" };
              yield { type: "done" };
              return;
            }

            // Use streaming execution for tools that support it (bash, reason)
            let result;
            const STREAMING_TOOLS = ['bash', 'reason'];
            if (STREAMING_TOOLS.includes(toolCall.function.name)) {
              const gen = this.deps.toolHandler.executeToolStreaming(toolCall);
              let genResult = await gen.next();
              while (!genResult.done) {
                // Check abort between stream chunks
                if (abortController?.signal.aborted) {
                  await gen.return({ success: false, error: 'Aborted' });
                  yield { type: "content", content: "\n\n[Operation cancelled by user]" };
                  yield { type: "done" };
                  return;
                }
                yield {
                  type: "tool_stream",
                  toolStreamData: {
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    delta: genResult.value,
                  },
                };
                genResult = await gen.next();
              }
              result = genResult.value ?? { success: false, error: 'Tool returned no result' };
            } else {
              result = await this.executeToolViaLane(toolCall);
            }

            // Check abort after tool execution completes
            if (abortController?.signal.aborted) {
              yield { type: "content", content: "\n\n[Operation cancelled by user]" };
              yield { type: "done" };
              return;
            }

            // Apply semantic truncation if tool output is very large (> 20k chars)
            const RAW_OUTPUT_LIMIT = 20_000;
            if (result?.output && result.output.length > RAW_OUTPUT_LIMIT) {
              const truncResult = semanticTruncate(result.output, { maxChars: RAW_OUTPUT_LIMIT });
              if (truncResult.truncated) {
                result = {
                  ...result,
                  output: truncResult.output,
                };
              }
            }

            // --- Disk-backed tool result (Manus AI #19) ---
            const rawStreamContent = sanitizeToolResult(result?.success ? result.output || "Success" : result?.error || "Error");
            if (toolCall.id) {
              getRestorableCompressor().writeToolResult(toolCall.id, rawStreamContent);
            }

            // --- Observation Variator (Manus AI #17) ---
            const streamVariator = getObservationVariator();
            streamVariator.nextTurn();
            const variedStreamContent = streamVariator.wrapToolResult(toolCall.function.name, rawStreamContent);

            const toolResultEntry: ChatEntry = {
              type: "tool_result",
              content: result?.success ? result.output || "Success" : result?.error || "Error occurred",
              timestamp: new Date(),
              toolCall: toolCall,
              toolResult: result,
            };
            history.push(toolResultEntry);
            yield { type: "tool_result", toolCall, toolResult: result };

            // Note: 'name' is required for Gemini API to match functionResponse with functionCall
            messages.push({
              role: "tool",
              content: variedStreamContent,
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
            } as CodeBuddyMessage);
          }

          inputTokens = this.deps.tokenCounter.countMessageTokens(messages as Parameters<typeof this.deps.tokenCounter.countMessageTokens>[0]);
          const currentOutputTokens = this.deps.streamingHandler.getTokenCount() || 0;
          totalOutputTokens += currentOutputTokens;
          yield { type: "token_count", tokenCount: inputTokens + totalOutputTokens };

          // Run after_turn middleware (handles cost recording + limit)
          if (pipeline) {
            const ctx = this.buildMiddlewareContext(
              toolRounds, inputTokens, totalOutputTokens, history, messages, true, abortController
            );
            const mwResult = await pipeline.runAfterTurn(ctx);
            if (mwResult.action === 'stop') {
              if (mwResult.message) yield { type: "content", content: `\n\n${mwResult.message}` };
              yield { type: "done" };
              return;
            }
            if (mwResult.action === 'warn' && mwResult.message) {
              yield { type: "content", content: `\n${mwResult.message}\n` };
            }
          } else {
            // Legacy inline cost check when no pipeline
            this.config.recordSessionCost(inputTokens, totalOutputTokens);
            if (this.config.isSessionCostLimitReached()) {
              const sessionCost = this.config.getSessionCost();
              const sessionCostLimit = this.config.getSessionCostLimit();
              yield {
                type: "content",
                content: `\n\n💸 Session cost limit reached ($${sessionCost.toFixed(2)} / $${sessionCostLimit.toFixed(2)}).`,
              };
              yield { type: "done" };
              return;
            }
          }
        } else {
          // Fire-and-forget auto-capture on final assistant response (streaming)
          try {
            const { getAutoCaptureManager } = await import('../../memory/auto-capture.js');
            const acm = getAutoCaptureManager();
            if (acm) {
              acm.processMessage('assistant', content || '').catch(() => {});
            }
          } catch { /* auto-capture optional */ }

          break;
        }
      }

      if (toolRounds >= maxToolRounds) {
        yield { type: "content", content: "\n\nMaximum tool execution rounds reached." };
      }

      this.config.recordSessionCost(inputTokens, totalOutputTokens);
      if (this.config.isSessionCostLimitReached()) {
        const sessionCost = this.config.getSessionCost();
        const sessionCostLimit = this.config.getSessionCostLimit();
        yield {
          type: "content",
          content: `\n\n💸 Session cost limit reached ($${sessionCost.toFixed(2)} / $${sessionCostLimit.toFixed(2)}).`,
        };
      }

      // Process followup/collect messages if any are queued
      const mqEnd = this.deps.messageQueue;
      if (mqEnd?.hasPendingMessages()) {
        const mode = mqEnd.getMode();
        if (mode === 'followup') {
          const followups = mqEnd.drain();
          for (const msg of followups) {
            messages.push({ role: "user", content: msg.content });
            history.push({ type: "user", content: msg.content, timestamp: msg.timestamp });
          }
          // Signal that followup messages need re-processing (caller handles)
          yield { type: "steer", steer: { content: `${followups.length} followup message(s) queued`, source: 'queue' } };
        } else if (mode === 'collect') {
          const collected = mqEnd.collect();
          if (collected) {
            messages.push({ role: "user", content: collected });
            history.push({ type: "user", content: collected, timestamp: new Date() });
            yield { type: "steer", steer: { content: collected, source: 'collect' } };
          }
        }
      }

      yield { type: "done" };
    } catch (error) {
      if (abortController?.signal.aborted) {
        yield { type: "content", content: "\n\n[Operation cancelled by user]" };
        yield { type: "done" };
        return;
      }

      const errorMessage = getErrorMessage(error);
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date(),
      };
      history.push(errorEntry);
      messages.push({ role: "assistant", content: errorEntry.content });
      yield { type: "content", content: errorEntry.content };
      yield { type: "done" };
    }
  }
}
