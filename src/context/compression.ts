/**
 * Context Compression
 * 
 * Provides various strategies to reduce the token count of a conversation
 * while maintaining its coherence and essential instructions.
 */

import { CodeBuddyMessage } from '../codebuddy/client.js';
import { TokenCounter } from './token-counter.js';
import { CompressionResult } from './types.js';

/**
 * Options to control the compression process.
 */
export interface CompressionOptions {
  /** Target ratio to compress the older parts of the conversation. */
  targetRatio?: number;
  /** Whether to ensure the system prompt is never removed. */
  preserveSystemPrompt?: boolean;
  /** Number of most recent messages to protect from any compression. */
  preserveRecentMessages?: number;
}

/**
 * Context Compression Engine.
 * Implements a multi-stage approach to context reduction:
 * 1. Tool Truncation: Shortens long tool outputs (logs, file contents).
 * 2. Sliding Window: Removes the oldest non-system messages.
 * 3. Hard Truncation: Emergency strategy to force-fit into the limit.
 */
export class ContextCompressor {
  /**
   * Creates a new ContextCompressor.
   * @param tokenCounter - Implementation used to measure the impact of compression.
   */
  constructor(private tokenCounter: TokenCounter) {}

  /**
   * Compresses a list of messages to fit within a specific token limit.
   * 
   * @param messages - The messages to compress.
   * @param tokenLimit - The maximum allowed tokens.
   * @param options - Compression constraints.
   * @returns A result object containing the new message list and compression stats.
   */
  compress(
    messages: CodeBuddyMessage[], 
    tokenLimit: number,
    options: CompressionOptions = {}
  ): CompressionResult {
    const initialTokens = this.countTotalTokens(messages);
    if (initialTokens <= tokenLimit) {
      return {
        compressed: false,
        messages,
        tokensReduced: 0,
        strategy: 'none'
      };
    }

    // Clone to avoid mutation
    let processedMessages = [...messages];
    const systemMessage = options.preserveSystemPrompt ? processedMessages.find(m => m.role === 'system') : null;
    const recentCount = options.preserveRecentMessages !== undefined ? options.preserveRecentMessages : 2;
    
    // Filter out system message if we're preserving it separately to add back later
    if (systemMessage) {
      processedMessages = processedMessages.filter(m => m.role !== 'system');
    }

    // Separate recent messages
    const recentMessages = recentCount > 0 ? processedMessages.slice(-recentCount) : [];
    let olderMessages = recentCount > 0 ? processedMessages.slice(0, -recentCount) : processedMessages;

    // Strategy 1: Truncate tool outputs (often very large)
    olderMessages = this.truncateToolOutputs(olderMessages);
    
    // Reassemble to check if we're good
    let currentSet: CodeBuddyMessage[] = [];
    if (systemMessage) {
      currentSet.push(systemMessage as CodeBuddyMessage);
    }
    currentSet.push(...olderMessages, ...recentMessages);
    
    let currentTokens = this.countTotalTokens(currentSet);

    if (currentTokens <= tokenLimit) {
      return {
        compressed: true,
        messages: currentSet,
        tokensReduced: initialTokens - currentTokens,
        strategy: 'tool_truncation'
      };
    }

    // Strategy 2: Sliding Window (Aggressive) - O(n) optimization
    // Pre-calculate token counts for older messages to enable O(1) updates
    // Instead of rebuilding array and recounting on each iteration
    const olderMessageTokens = olderMessages.map(msg => this.countSingleMessageTokens(msg));
    let olderStartIndex = 0;

    while (olderStartIndex < olderMessages.length && currentTokens > tokenLimit) {
      // Subtract tokens of removed message instead of recounting all
      currentTokens -= olderMessageTokens[olderStartIndex];
      olderStartIndex++;
    }

    // Build final array only once after we know which messages to keep
    if (olderStartIndex > 0) {
      olderMessages = olderMessages.slice(olderStartIndex);
      currentSet = [];
      if (systemMessage) {
        currentSet.push(systemMessage as CodeBuddyMessage);
      }
      currentSet.push(...olderMessages, ...recentMessages);
    }

    // If still over limit (extreme case where recent messages are huge), truncate recent messages content
    if (currentTokens > tokenLimit) {
        // This is a hard truncation scenario
        return {
            compressed: true,
            messages: this.hardTruncate(currentSet, tokenLimit),
            tokensReduced: initialTokens - tokenLimit, // Approximate
            strategy: 'hard_truncation'
        };
    }

    return {
      compressed: true,
      messages: currentSet,
      tokensReduced: initialTokens - currentTokens,
      strategy: 'sliding_window'
    };
  }

  /**
   * Helper to count tokens for a list of messages.
   */
  private countTotalTokens(messages: CodeBuddyMessage[]): number {
    const tokenMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : null,
      tool_calls: 'tool_calls' in msg ? msg.tool_calls : undefined,
    }));
    return this.tokenCounter.countMessageTokens(tokenMessages);
  }

  /**
   * Helper to count tokens for a single message (for incremental calculations).
   */
  private countSingleMessageTokens(msg: CodeBuddyMessage): number {
    return this.tokenCounter.countMessageTokens([{
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : null,
      tool_calls: 'tool_calls' in msg ? msg.tool_calls : undefined,
    }]);
  }

  /**
   * Strategy: Truncate long content from tool messages.
   */
  private truncateToolOutputs(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const MAX_TOOL_OUTPUT = 500;
    return messages.map(msg => {
      if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > MAX_TOOL_OUTPUT) {
        return {
          ...msg,
          content: msg.content.slice(0, MAX_TOOL_OUTPUT) + '... [truncated]'
        };
      }
      return msg;
    });
  }

  /**
   * Emergency strategy: remove messages from the middle/end until limit is met.
   * Prioritizes keeping the system prompt and the very latest messages.
   */
  private hardTruncate(messages: CodeBuddyMessage[], limit: number): CodeBuddyMessage[] {
    // Basic implementation: just return what fits, priority to system then recent
    // This is a "save the ship" strategy
    const result: CodeBuddyMessage[] = [];
    let currentTokens = 0;

    // Always keep system if present
    const system = messages.find(m => m.role === 'system');
    if (system) {
        result.push(system);
        currentTokens += this.countTotalTokens([system]);
    }

    // Try to add from most recent backwards
    const reverseMsgs = [...messages].reverse().filter(m => m.role !== 'system');
    
    for (const msg of reverseMsgs) {
        const msgTokens = this.countTotalTokens([msg]);
        if (currentTokens + msgTokens <= limit) {
            result.unshift(msg);
            currentTokens += msgTokens;
        } else {
            break; 
        }
    }
    
    // Ensure system is first
    if (system && result[0] !== system) {
        // Should already be handled but safety check
        const idx = result.indexOf(system);
        if (idx >= 0) result.splice(idx, 1);
        result.unshift(system);
    }

    return result;
  }
}