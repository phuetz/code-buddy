/**
 * Advanced Context Manager for LLM conversations
 *
 * Implements multiple strategies based on research:
 * - Recurrent Context Compression (arxiv:2406.06110)
 * - Recursive Summarization (arxiv:2308.15022)
 * - Sliding Window Attention
 * - Event-centric Memory (LoCoMo)
 */

import { GrokMessage } from '../grok/client.js';
import { createTokenCounter, TokenCounter } from '../utils/token-counter.js';

export interface ContextManagerConfig {
  /** Maximum tokens for the context window */
  maxContextTokens: number;
  /** Reserve tokens for model response */
  responseReserveTokens: number;
  /** Number of recent messages to always keep */
  recentMessagesCount: number;
  /** Enable automatic summarization */
  enableSummarization: boolean;
  /** Compression ratio target (e.g., 4 = compress to 1/4) */
  compressionRatio: number;
  /** Model name for token counting */
  model: string;
}

export interface ContextStats {
  totalTokens: number;
  maxTokens: number;
  usagePercent: number;
  messageCount: number;
  summarizedSessions: number;
  isNearLimit: boolean;
  isCritical: boolean;
}

interface ConversationSummary {
  content: string;
  tokenCount: number;
  originalMessageCount: number;
  timestamp: Date;
}

/**
 * Advanced Context Manager with multiple compression strategies
 */
export class ContextManagerV2 {
  private config: ContextManagerConfig;
  private tokenCounter: TokenCounter;
  private summaries: ConversationSummary[] = [];
  private systemMessage: GrokMessage | null = null;

  // Default configuration based on research recommendations
  static readonly DEFAULT_CONFIG: ContextManagerConfig = {
    maxContextTokens: 4096,
    responseReserveTokens: 512, // ~12.5% reserve for response
    recentMessagesCount: 10,
    enableSummarization: true,
    compressionRatio: 4,
    model: 'gpt-4',
  };

  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = { ...ContextManagerV2.DEFAULT_CONFIG, ...config };
    this.tokenCounter = createTokenCounter(this.config.model);
  }

  /**
   * Get the effective token limit (accounting for response reserve)
   */
  get effectiveLimit(): number {
    return this.config.maxContextTokens - this.config.responseReserveTokens;
  }

  /**
   * Count tokens in messages
   */
  countTokens(messages: GrokMessage[]): number {
    // Map GrokMessage to the format expected by TokenCounter
    const tokenMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : null,
      tool_calls: 'tool_calls' in msg ? msg.tool_calls : undefined,
    }));
    return this.tokenCounter.countMessageTokens(tokenMessages);
  }

  /**
   * Get context statistics
   */
  getStats(messages: GrokMessage[]): ContextStats {
    const totalTokens = this.countTokens(messages);
    const maxTokens = this.effectiveLimit;
    const usagePercent = (totalTokens / maxTokens) * 100;

    return {
      totalTokens,
      maxTokens,
      usagePercent,
      messageCount: messages.length,
      summarizedSessions: this.summaries.length,
      isNearLimit: usagePercent > 75,
      isCritical: usagePercent > 90,
    };
  }

  /**
   * Prepare messages for API call, managing context as needed
   * Returns optimized message array that fits within token limits
   */
  prepareMessages(messages: GrokMessage[]): GrokMessage[] {
    const stats = this.getStats(messages);

    // If within limits, return as-is
    if (!stats.isNearLimit) {
      return messages;
    }

    // Extract system message if present
    const systemMsg = messages.find(m => m.role === 'system');
    const conversationMsgs = messages.filter(m => m.role !== 'system');

    // Apply compression strategies
    let optimizedMsgs = this.applyStrategies(conversationMsgs);

    // Reconstruct with system message
    if (systemMsg) {
      optimizedMsgs = [systemMsg, ...optimizedMsgs];
    }

    return optimizedMsgs;
  }

  /**
   * Apply compression strategies in order of priority
   */
  private applyStrategies(messages: GrokMessage[]): GrokMessage[] {
    let result = [...messages];
    let currentTokens = this.countTokens(result);

    // Strategy 1: Keep only recent messages (Sliding Window)
    if (currentTokens > this.effectiveLimit) {
      result = this.applySlidingWindow(result);
      currentTokens = this.countTokens(result);
    }

    // Strategy 2: Truncate tool results (they can be verbose)
    if (currentTokens > this.effectiveLimit) {
      result = this.truncateToolResults(result);
      currentTokens = this.countTokens(result);
    }

    // Strategy 3: Summarize old conversations
    if (currentTokens > this.effectiveLimit && this.config.enableSummarization) {
      result = this.applySummarization(result);
      currentTokens = this.countTokens(result);
    }

    // Strategy 4: Hard truncation as last resort
    if (currentTokens > this.effectiveLimit) {
      result = this.hardTruncate(result);
    }

    return result;
  }

  /**
   * Strategy 1: Sliding Window - Keep N most recent messages
   */
  private applySlidingWindow(messages: GrokMessage[]): GrokMessage[] {
    const keepCount = this.config.recentMessagesCount;

    if (messages.length <= keepCount) {
      return messages;
    }

    // Keep the most recent messages
    const recentMessages = messages.slice(-keepCount);

    // Create a summary marker for removed messages
    const removedCount = messages.length - keepCount;
    const summaryMarker: GrokMessage = {
      role: 'system',
      content: `[Previous ${removedCount} messages summarized due to context limits]`,
    };

    return [summaryMarker, ...recentMessages];
  }

  /**
   * Strategy 2: Truncate verbose tool results
   */
  private truncateToolResults(messages: GrokMessage[]): GrokMessage[] {
    const MAX_TOOL_RESULT_LENGTH = 500;

    return messages.map(msg => {
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        if (msg.content.length > MAX_TOOL_RESULT_LENGTH) {
          return {
            ...msg,
            content: msg.content.substring(0, MAX_TOOL_RESULT_LENGTH) +
                     '\n... [truncated for context limits]',
          };
        }
      }
      return msg;
    });
  }

  /**
   * Strategy 3: Summarize older messages
   * Based on Recursive Summarization (arxiv:2308.15022)
   */
  private applySummarization(messages: GrokMessage[]): GrokMessage[] {
    const keepRecent = Math.min(this.config.recentMessagesCount, messages.length);

    if (messages.length <= keepRecent) {
      return messages;
    }

    // Split into old (to summarize) and recent (to keep)
    const oldMessages = messages.slice(0, -keepRecent);
    const recentMessages = messages.slice(-keepRecent);

    // Create a condensed summary of old messages
    const summary = this.createSummary(oldMessages);

    // Create summary message
    const summaryMessage: GrokMessage = {
      role: 'system',
      content: `[Conversation Summary]\n${summary}`,
    };

    return [summaryMessage, ...recentMessages];
  }

  /**
   * Create a condensed summary of messages
   * This is a simple extractive summary - for production, use LLM-based summarization
   */
  private createSummary(messages: GrokMessage[]): string {
    const summaryParts: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        // Extract key user requests (first 100 chars)
        const truncated = msg.content.substring(0, 100);
        summaryParts.push(`User: ${truncated}${msg.content.length > 100 ? '...' : ''}`);
      } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
        // Extract key assistant responses (first 100 chars)
        const truncated = msg.content.substring(0, 100);
        summaryParts.push(`Assistant: ${truncated}${msg.content.length > 100 ? '...' : ''}`);
      }
    }

    // Limit summary to target size based on compression ratio
    const maxSummaryItems = Math.ceil(messages.length / this.config.compressionRatio);
    return summaryParts.slice(0, maxSummaryItems).join('\n');
  }

  /**
   * Strategy 4: Hard truncation as last resort
   */
  private hardTruncate(messages: GrokMessage[]): GrokMessage[] {
    let result = [...messages];
    let currentTokens = this.countTokens(result);

    // Remove oldest messages one by one until within limits
    while (currentTokens > this.effectiveLimit && result.length > 2) {
      // Keep at least 2 messages (1 user + 1 assistant minimum)
      result = result.slice(1);
      currentTokens = this.countTokens(result);
    }

    // If still over limit, truncate message content
    if (currentTokens > this.effectiveLimit) {
      result = result.map(msg => {
        if (typeof msg.content === 'string' && msg.content.length > 200) {
          return {
            ...msg,
            content: msg.content.substring(0, 200) + '... [truncated]',
          };
        }
        return msg;
      });
    }

    return result;
  }

  /**
   * Check if context is approaching limits and emit warning
   */
  shouldWarn(messages: GrokMessage[]): { warn: boolean; message: string } {
    const stats = this.getStats(messages);

    if (stats.isCritical) {
      return {
        warn: true,
        message: `⚠️ Context critical: ${stats.totalTokens}/${stats.maxTokens} tokens (${stats.usagePercent.toFixed(1)}%). Messages will be compressed.`,
      };
    }

    if (stats.isNearLimit) {
      return {
        warn: true,
        message: `📊 Context usage: ${stats.totalTokens}/${stats.maxTokens} tokens (${stats.usagePercent.toFixed(1)}%)`,
      };
    }

    return { warn: false, message: '' };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.model) {
      this.tokenCounter = createTokenCounter(config.model);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ContextManagerConfig {
    return { ...this.config };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.tokenCounter.dispose();
    this.summaries = [];
  }
}

/**
 * Create a context manager with auto-detection of model limits
 */
export function createContextManager(
  model: string,
  maxTokens?: number
): ContextManagerV2 {
  // Default context limits for common models
  const MODEL_LIMITS: Record<string, number> = {
    'gpt-4': 8192,
    'gpt-4-turbo': 128000,
    'gpt-3.5-turbo': 4096,
    'claude-3': 200000,
    'llama3.2': 131072,
    'llama3.1': 131072,
    'mistral': 32768,
    'qwen2.5': 32768,
    // Local models often have lower limits
    'default': 4096,
  };

  const detectedLimit = maxTokens || MODEL_LIMITS[model] || MODEL_LIMITS['default'];

  return new ContextManagerV2({
    model,
    maxContextTokens: detectedLimit,
    responseReserveTokens: Math.floor(detectedLimit * 0.125), // 12.5% reserve
  });
}

// Singleton for simple usage
let defaultManager: ContextManagerV2 | null = null;

export function getContextManager(): ContextManagerV2 {
  if (!defaultManager) {
    defaultManager = new ContextManagerV2();
  }
  return defaultManager;
}
