/**
 * Streaming Handler Module
 *
 * Handles message streaming and accumulation for the agent.
 * Implements delta reduction (messageReducer pattern), content sanitization,
 * token counting during streaming, and tool call extraction from content.
 *
 * @module agent/streaming
 */

import { CodeBuddyToolCall } from '../../codebuddy/client.js';
import { TokenCounter, createTokenCounter } from '../../context/token-counter.js';
import { sanitizeLLMOutput, extractCommentaryToolCalls, ExtractedToolCall } from '../../utils/sanitize.js';
import { reduceStreamChunk } from './message-reducer.js';

/**
 * Configuration options for the StreamingHandler.
 */
export interface StreamingConfig {
  /** Whether to sanitize LLM output (remove control tokens). Default: true */
  sanitizeOutput?: boolean;

  /** Whether to extract commentary-style tool calls from content. Default: true */
  extractToolCalls?: boolean;

  /** Whether to track token counts during streaming. Default: true */
  trackTokens?: boolean;

  /** Model name for token counting. Default: 'gpt-4' */
  model?: string;

  /** Minimum interval (ms) between token count updates. Default: 500 */
  tokenUpdateInterval?: number;
}

/**
 * Represents a raw chunk of streaming data from the LLM API.
 * This is the raw chunk format from OpenAI-compatible APIs.
 * Note: This is distinct from the agent's StreamingChunk in types.ts
 * which is the processed chunk yielded by the agent.
 */
export interface RawStreamingChunk {
  /** Unique identifier for the chunk */
  id?: string;

  /** Object type (usually 'chat.completion.chunk') */
  object?: string;

  /** Timestamp of creation */
  created?: number;

  /** Model that generated the chunk */
  model?: string;

  /** Array of choices containing delta updates */
  choices?: Array<{
    /** Index of the choice */
    index?: number;

    /** Delta update containing incremental content */
    delta?: {
      /** Role of the message (usually only in first chunk) */
      role?: string;

      /** Content delta (text fragment) */
      content?: string;

      /** Tool calls delta (incremental tool call data) */
      tool_calls?: Array<{
        /** Index of the tool call in the array */
        index?: number;

        /** Unique identifier for the tool call */
        id?: string;

        /** Type of tool call (usually 'function') */
        type?: string;

        /** Function details */
        function?: {
          /** Function name (usually only in first chunk for this tool) */
          name?: string;

          /** Arguments string (accumulated across chunks) */
          arguments?: string;
        };
      }>;
    };

    /** Reason for finishing (null while streaming) */
    finish_reason?: string | null;
  }>;

  /** Usage information (may be provided at end of stream) */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Result of processing a streaming chunk.
 */
export interface ProcessedChunk {
  /** Sanitized content to display (may be empty if only control tokens) */
  displayContent: string;

  /** Raw content before sanitization */
  rawContent: string;

  /** Whether new tool calls were detected */
  hasNewToolCalls: boolean;

  /** Current accumulated tool calls (if any) */
  toolCalls?: CodeBuddyToolCall[];

  /** Current token count estimate */
  tokenCount?: number;

  /** Whether a token count update should be emitted */
  shouldEmitTokenCount: boolean;
}

/**
 * Result of tool call extraction from accumulated content.
 */
export interface ExtractedToolCallsResult {
  /** Tool calls in OpenAI format */
  toolCalls: CodeBuddyToolCall[];

  /** Content with tool call patterns removed */
  remainingContent: string;
}

/**
 * Accumulated message state during streaming.
 */
export interface AccumulatedMessage {
  /** Role of the message */
  role?: string;

  /** Accumulated content string */
  content?: string;

  /** Accumulated tool calls */
  tool_calls?: CodeBuddyToolCall[];

  /** Any additional fields from the API */
  [key: string]: unknown;
}

/**
 * StreamingHandler manages the accumulation and processing of streaming
 * responses from LLM APIs. It handles:
 *
 * - Delta reduction: Accumulating incremental updates into a complete message
 * - Content sanitization: Removing LLM control tokens from output
 * - Token counting: Real-time estimation of token usage
 * - Tool call extraction: Detecting tool calls from both native format and commentary patterns
 *
 * @example
 * ```typescript
 * const handler = new StreamingHandler({ sanitizeOutput: true });
 *
 * for await (const chunk of stream) {
 *   const result = handler.accumulateChunk(chunk);
 *   if (result.displayContent) {
 *     console.log(result.displayContent);
 *   }
 *   if (result.hasNewToolCalls) {
 *     console.log('Tool calls:', result.toolCalls);
 *   }
 * }
 *
 * const finalMessage = handler.getAccumulatedMessage();
 * handler.reset();
 * ```
 */
export class StreamingHandler {
  private config: Required<StreamingConfig>;
  private accumulatedMessage: AccumulatedMessage = {};
  private accumulatedRawContent: string = '';
  private tokenCounter: TokenCounter | null = null;
  private lastTokenUpdate: number = 0;
  private toolCallsYielded: boolean = false;

  /**
   * Creates a new StreamingHandler instance.
   *
   * @param config - Configuration options for the handler
   */
  constructor(config: StreamingConfig = {}) {
    this.config = {
      sanitizeOutput: config.sanitizeOutput ?? true,
      extractToolCalls: config.extractToolCalls ?? true,
      trackTokens: config.trackTokens ?? true,
      model: config.model ?? 'gpt-4',
      tokenUpdateInterval: config.tokenUpdateInterval ?? 500,
    };

    if (this.config.trackTokens) {
      this.tokenCounter = createTokenCounter(this.config.model);
    }
  }

  /**
   * Processes a streaming chunk and accumulates it into the message.
   *
   * @param chunk - The streaming chunk from the API
   * @returns Processed chunk with display content and metadata
   */
  accumulateChunk(chunk: RawStreamingChunk): ProcessedChunk {
    // Skip chunks without choices
    if (!chunk.choices?.[0]) {
      return {
        displayContent: '',
        rawContent: '',
        hasNewToolCalls: false,
        shouldEmitTokenCount: false,
      };
    }

    // Accumulate the message using reducer
    this.accumulatedMessage = reduceStreamChunk(
      this.accumulatedMessage,
      chunk
    ) as AccumulatedMessage;

    // Extract content delta
    const rawContentDelta = chunk.choices[0].delta?.content || '';
    this.accumulatedRawContent += rawContentDelta;

    // Sanitize content for display
    const displayContent = this.config.sanitizeOutput
      ? sanitizeLLMOutput(rawContentDelta)
      : rawContentDelta;

    // Check for tool calls
    const toolCalls = this.accumulatedMessage.tool_calls;
    let hasNewToolCalls = false;

    if (!this.toolCallsYielded && Array.isArray(toolCalls) && toolCalls.length > 0) {
      // Check if we have at least one complete tool call with a function name
      const hasCompleteTool = toolCalls.some(
        (tc: unknown) =>
          typeof tc === 'object' &&
          tc !== null &&
          'function' in tc &&
          typeof (tc as CodeBuddyToolCall).function === 'object' &&
          (tc as CodeBuddyToolCall).function !== null &&
          'name' in (tc as CodeBuddyToolCall).function
      );

      if (hasCompleteTool) {
        hasNewToolCalls = true;
        this.toolCallsYielded = true;
      }
    }

    // Calculate token count if enabled
    let tokenCount: number | undefined;
    let shouldEmitTokenCount = false;

    if (this.config.trackTokens && this.tokenCounter && displayContent) {
      const contentTokens = this.tokenCounter.estimateStreamingTokens(
        this.accumulatedRawContent
      );
      const toolCallTokens = this.accumulatedMessage.tool_calls
        ? this.tokenCounter.countTokens(
            JSON.stringify(this.accumulatedMessage.tool_calls)
          )
        : 0;

      tokenCount = contentTokens + toolCallTokens;

      // Check if we should emit a token count update
      const now = Date.now();
      if (now - this.lastTokenUpdate > this.config.tokenUpdateInterval) {
        this.lastTokenUpdate = now;
        shouldEmitTokenCount = true;
      }
    }

    return {
      displayContent,
      rawContent: rawContentDelta,
      hasNewToolCalls,
      toolCalls: hasNewToolCalls ? (toolCalls as CodeBuddyToolCall[]) : undefined,
      tokenCount,
      shouldEmitTokenCount,
    };
  }

  /**
   * Extracts tool calls from commentary patterns in the accumulated content.
   * This handles models that don't support native OpenAI tool calls.
   *
   * Supported patterns:
   * - "commentary to=tool_name {...}"
   * - "commentary to=tool_name <|constrain|>json<|message|>{...}"
   * - Direct tool patterns: "web_search {...}"
   *
   * @returns Extracted tool calls and remaining content
   */
  extractToolCalls(): ExtractedToolCallsResult {
    if (!this.config.extractToolCalls || !this.accumulatedRawContent) {
      return {
        toolCalls: [],
        remainingContent: this.accumulatedRawContent,
      };
    }

    // Check if we already have native tool calls
    const existingToolCalls = this.accumulatedMessage.tool_calls;
    if (Array.isArray(existingToolCalls) && existingToolCalls.length > 0) {
      return {
        toolCalls: [],
        remainingContent: this.accumulatedRawContent,
      };
    }

    // Extract commentary-style tool calls
    const { toolCalls: extractedCalls, remainingContent } =
      extractCommentaryToolCalls(this.accumulatedRawContent);

    if (extractedCalls.length === 0) {
      return {
        toolCalls: [],
        remainingContent: this.accumulatedRawContent,
      };
    }

    // Convert extracted calls to OpenAI tool call format
    const convertedCalls: CodeBuddyToolCall[] = extractedCalls.map(
      (tc: ExtractedToolCall, index: number) => ({
        id: `commentary_${Date.now()}_${index}`,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })
    );

    // Update accumulated message state
    this.accumulatedMessage.tool_calls = convertedCalls;
    this.accumulatedMessage.content = remainingContent;
    this.accumulatedRawContent = remainingContent;
    this.toolCallsYielded = true;

    return {
      toolCalls: convertedCalls,
      remainingContent,
    };
  }

  /**
   * Gets the current accumulated message state.
   *
   * @returns The accumulated message with all processed content and tool calls
   */
  getAccumulatedMessage(): AccumulatedMessage {
    return { ...this.accumulatedMessage };
  }

  /**
   * Gets the raw accumulated content before sanitization.
   * Useful for tool call extraction that needs the original patterns.
   *
   * @returns The raw accumulated content string
   */
  getRawContent(): string {
    return this.accumulatedRawContent;
  }

  /**
   * Gets the sanitized accumulated content.
   *
   * @returns The sanitized content string
   */
  getSanitizedContent(): string {
    if (this.config.sanitizeOutput) {
      return sanitizeLLMOutput(this.accumulatedRawContent);
    }
    return this.accumulatedRawContent;
  }

  /**
   * Gets the current token count estimate.
   *
   * @returns Token count or undefined if tracking is disabled
   */
  getTokenCount(): number | undefined {
    if (!this.config.trackTokens || !this.tokenCounter) {
      return undefined;
    }

    const contentTokens = this.tokenCounter.estimateStreamingTokens(
      this.accumulatedRawContent
    );
    const toolCallTokens = this.accumulatedMessage.tool_calls
      ? this.tokenCounter.countTokens(
          JSON.stringify(this.accumulatedMessage.tool_calls)
        )
      : 0;

    return contentTokens + toolCallTokens;
  }

  /**
   * Checks if tool calls have been yielded/detected.
   *
   * @returns True if tool calls have been detected and yielded
   */
  hasYieldedToolCalls(): boolean {
    return this.toolCallsYielded;
  }

  /**
   * Resets the handler state for a new streaming session.
   * Call this before processing a new response stream.
   */
  reset(): void {
    this.accumulatedMessage = {};
    this.accumulatedRawContent = '';
    this.lastTokenUpdate = 0;
    this.toolCallsYielded = false;
  }

  /**
   * Disposes of resources used by the handler.
   * Call this when the handler is no longer needed.
   */
  dispose(): void {
    if (this.tokenCounter) {
      this.tokenCounter.dispose();
      this.tokenCounter = null;
    }
  }
}

// Re-export utility functions for convenience
export { sanitizeLLMOutput, extractCommentaryToolCalls };
export type { ExtractedToolCall };
