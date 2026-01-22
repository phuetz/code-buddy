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
import { getErrorMessage } from "../../types/errors.js";

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
  /** Current accumulated session cost in USD */
  sessionCost: number;
  /** Maximum allowed session cost in USD */
  sessionCostLimit: number;
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

      // Apply context management
      const preparedMessages = this.deps.contextManager.prepareMessages(messages);

      // Check for context warnings
      const contextWarning = this.deps.contextManager.shouldWarn(preparedMessages);
      if (contextWarning.warn) {
        logger.warn(contextWarning.message);
      }

      let currentResponse = await this.deps.client.chat(
        preparedMessages,
        tools,
        undefined,
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

          // Execute tool calls
          for (const toolCall of assistantMessage.tool_calls) {
            const toolCallEntry: ChatEntry = {
              type: "tool_call",
              content: "Executing...",
              timestamp: new Date(),
              toolCall: toolCall,
            };
            history.push(toolCallEntry);
            newEntries.push(toolCallEntry);

            const result = await this.deps.toolHandler.executeTool(toolCall);

            // Update entry with result
            const updatedEntry: ChatEntry = {
              ...toolCallEntry,
              type: "tool_result",
              content: result.success ? result.output || "Success" : result.error || "Error occurred",
              toolResult: result,
            };
            
            // Replace in history and newEntries
            const histIdx = history.indexOf(toolCallEntry);
            if (histIdx !== -1) history[histIdx] = updatedEntry;
            const newIdx = newEntries.indexOf(toolCallEntry);
            if (newIdx !== -1) newEntries[newIdx] = updatedEntry;

            // Add tool result to messages
            messages.push({
              role: "tool",
              content: result.success ? result.output || "Success" : result.error || "Error",
              tool_call_id: toolCall.id,
            });
          }

          // Get next response
          const nextPreparedMessages = this.deps.contextManager.prepareMessages(messages);
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
        const costEntry: ChatEntry = {
          type: "assistant",
          content: `💸 Session cost limit reached ($${this.config.sessionCost.toFixed(2)} / $${this.config.sessionCostLimit.toFixed(2)}). Please start a new session.`, 
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
      while (toolRounds < maxToolRounds) {
        if (abortController?.signal.aborted) {
          yield { type: "content", content: "\n\n[Operation cancelled by user]" };
          yield { type: "done" };
          return;
        }

        const selectionResult = await this.deps.toolSelectionStrategy.selectToolsForQuery(message);
        const tools = selectionResult.tools;
        if (toolRounds === 0) this.deps.toolSelectionStrategy.cacheTools(tools);

        const preparedMessages = this.deps.contextManager.prepareMessages(messages);
        const contextWarning = this.deps.contextManager.shouldWarn(preparedMessages);
        if (contextWarning.warn) {
          yield { type: "content", content: `\n${contextWarning.message}\n` };
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

        const extracted = this.deps.streamingHandler.extractToolCalls();
        if (extracted.toolCalls.length > 0) {
          yield { type: "tool_calls", toolCalls: extracted.toolCalls };
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

          if (!this.deps.streamingHandler.hasYieldedToolCalls()) {
            yield { type: "tool_calls", toolCalls: toolCalls };
          }

          for (const toolCall of toolCalls) {
            if (abortController?.signal.aborted) {
              yield { type: "content", content: "\n\n[Operation cancelled by user]" };
              yield { type: "done" };
              return;
            }

            const result = await this.deps.toolHandler.executeTool(toolCall);
            const toolResultEntry: ChatEntry = {
              type: "tool_result",
              content: result.success ? result.output || "Success" : result.error || "Error occurred",
              timestamp: new Date(),
              toolCall: toolCall,
              toolResult: result,
            };
            history.push(toolResultEntry);
            yield { type: "tool_result", toolCall, toolResult: result };

            messages.push({
              role: "tool",
              content: result.success ? result.output || "Success" : result.error || "Error",
              tool_call_id: toolCall.id,
            });
          }

          inputTokens = this.deps.tokenCounter.countMessageTokens(messages as Parameters<typeof this.deps.tokenCounter.countMessageTokens>[0]);
          const currentOutputTokens = this.deps.streamingHandler.getTokenCount() || 0;
          totalOutputTokens = currentOutputTokens;
          yield { type: "token_count", tokenCount: inputTokens + totalOutputTokens };

          this.config.recordSessionCost(inputTokens, totalOutputTokens);
          if (this.config.isSessionCostLimitReached()) {
            yield {
              type: "content",
              content: `\n\n💸 Session cost limit reached ($${this.config.sessionCost.toFixed(2)} / $${this.config.sessionCostLimit.toFixed(2)}).`,
            };
            yield { type: "done" };
            return;
          }
        } else {
          break;
        }
      }

      if (toolRounds >= maxToolRounds) {
        yield { type: "content", content: "\n\nMaximum tool execution rounds reached." };
      }

      this.config.recordSessionCost(inputTokens, totalOutputTokens);
      if (this.config.isSessionCostLimitReached()) {
        yield { type: "content", content: `\n\n💸 Session cost limit reached ($${this.config.sessionCost.toFixed(2)} / $${this.config.sessionCostLimit.toFixed(2)}).` };
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
