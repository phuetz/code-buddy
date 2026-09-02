/**
 * Context Manager V3
 *
 * Orchestrates conversation history, token counting, and context compression.
 * Ensures the conversation fits within the LLM's context window while
 * preserving critical information (system prompt, recent messages).
 *
 * @note V3 is used by the server API routes. The main agents use ContextManagerV2
 * from context-manager-v2.ts for backwards compatibility. V3 differs from V2:
 * - Uses external ContextCompressor module instead of inline summarization
 * - Has higher default token limits (128k vs 4k)
 * - Simplified API focused on compression/stats
 */

import { CodeBuddyMessage } from '../codebuddy/client.js';
import { getModelToolConfig } from '../config/model-tools.js';
import { createTokenCounter, TokenCounter } from './token-counter.js';
import { ContextCompressor } from './compression.js';
import { ContextManagerConfig, ContextStats, ContextWarning } from './types.js';
import { logger } from '../utils/logger.js';
import { ContextCompactionError, findLastUserMessage } from './context-manager-v2.js';

/**
 * Advanced manager for handling conversation context.
 * Features:
 * - Accurate token counting via tiktoken.
 * - Multi-stage compression (tool truncation, sliding window).
 * - Proactive warning system for context limits.
 */
export class ContextManagerV3 {
  private config: ContextManagerConfig;
  private tokenCounter: TokenCounter;
  private compressor: ContextCompressor;
  private triggeredWarnings: Set<number> = new Set();

  /** Default configuration values for modern LLMs. */
  static readonly DEFAULT_CONFIG: ContextManagerConfig = {
    maxContextTokens: 128000, // Modern default (GPT-4o, etc)
    responseReserveTokens: 4096,
    recentMessagesCount: 10,
    enableSummarization: true,
    compressionRatio: 2,
    model: 'gpt-4',
    autoCompactThreshold: 100000,
    warningThresholds: [80, 95],
    enableWarnings: true,
  };

  /**
   * Creates a new ContextManager instance.
   * @param config - Optional partial configuration to override defaults.
   */
  constructor(config: Partial<ContextManagerConfig> = {}) {
    const tableWindow = config.model ? getModelToolConfig(config.model).contextWindow : undefined;
    this.config = {
      ...ContextManagerV3.DEFAULT_CONFIG,
      ...(tableWindow !== undefined && config.maxContextTokens === undefined
        ? { maxContextTokens: tableWindow }
        : {}),
      ...config,
    };
    this.tokenCounter = createTokenCounter(this.config.model);
    this.compressor = new ContextCompressor(this.tokenCounter);
  }

  /**
   * Updates the manager's configuration at runtime.
   * Re-initializes the token counter if the model name changes.
   * 
   * @param config - New configuration properties.
   */
  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = { ...this.config, ...config };
    // Re-init token counter if model changed
    if (config.model) {
      this.tokenCounter.dispose();
      this.tokenCounter = createTokenCounter(config.model);
      this.compressor = new ContextCompressor(this.tokenCounter);
    }
  }

  /**
   * Calculates current context statistics for a set of messages.
   * 
   * @param messages - The messages to analyze.
   * @returns Detailed statistics including token count and usage percentage.
   */
  getStats(messages: CodeBuddyMessage[]): ContextStats {
    const tokenMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : null,
      tool_calls: 'tool_calls' in msg ? msg.tool_calls : undefined,
    }));
    const totalTokens = this.tokenCounter.countMessageTokens(tokenMessages);
    const maxTokens = this.config.maxContextTokens;
    const usagePercent = (totalTokens / maxTokens) * 100;

    return {
      totalTokens,
      maxTokens,
      usagePercent,
      messageCount: messages.length,
      summarizedSessions: 0, // V3 calculates dynamically
      isNearLimit: usagePercent >= 80,
      isCritical: usagePercent >= 95
    };
  }

  /**
   * Determines if a warning should be issued based on current usage.
   * Implements a "debounce" mechanism to avoid repeating warnings for the same threshold.
   * 
   * @param messages - The messages to check.
   * @returns A ContextWarning object.
   */
  shouldWarn(messages: CodeBuddyMessage[]): ContextWarning {
    if (!this.config.enableWarnings) return { warn: false };

    const stats = this.getStats(messages);
    const percent = Math.floor(stats.usagePercent);

    // Check thresholds
    for (const threshold of this.config.warningThresholds) {
      if (percent >= threshold && !this.triggeredWarnings.has(threshold)) {
        this.triggeredWarnings.add(threshold);
        return {
          warn: true,
          level: threshold >= 90 ? 'critical' : 'warning',
          message: `Context usage is at ${percent}% (${stats.totalTokens}/${stats.maxTokens} tokens).`,
          percentage: percent
        };
      }
    }

    // Reset warnings if usage drops
    for (const threshold of Array.from(this.triggeredWarnings)) {
      if (percent < threshold) {
        this.triggeredWarnings.delete(threshold);
      }
    }

    return { warn: false };
  }

  /**
   * Prepares messages for an API call by applying compression if necessary.
   * 
   * @param messages - The full conversation history.
   * @returns A potentially reduced set of messages that fits within the limits.
   */
  prepareMessages(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const stats = this.getStats(messages);
    const effectiveLimit = this.config.maxContextTokens - this.config.responseReserveTokens;
    this.rejectIfCurrentRequestExceedsBudget(messages, effectiveLimit);

    if (stats.totalTokens <= effectiveLimit) {
      return messages;
    }

    logger.info(`Context limit exceeded (${stats.totalTokens} > ${effectiveLimit}). Compressing...`);

    const result = this.compressor.compress(messages, effectiveLimit, {
      preserveSystemPrompt: true,
      preserveRecentMessages: this.config.recentMessagesCount
    });

    if (result.compressed) {
      logger.info(`Context compressed: ${result.tokensReduced} tokens removed using ${result.strategy}.`);
    }

    this.assertLastUserPreserved(messages, result.messages, effectiveLimit);
    this.assertFitsTokenLimit(result.messages, effectiveLimit);
    return result.messages;
  }

  private countMessageTokens(messages: CodeBuddyMessage[]): number {
    const tokenMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : null,
      tool_calls: 'tool_calls' in msg ? msg.tool_calls : undefined,
    }));
    return this.tokenCounter.countMessageTokens(tokenMessages);
  }

  private rejectIfCurrentRequestExceedsBudget(
    messages: CodeBuddyMessage[],
    effectiveLimit: number,
  ): void {
    const lastUser = findLastUserMessage(messages);
    if (!lastUser) return;
    const tokens = this.countMessageTokens([lastUser]);
    if (tokens > effectiveLimit) {
      throw new ContextCompactionError(
        'CURRENT_REQUEST_EXCEEDS_BUDGET',
        tokens,
        effectiveLimit,
      );
    }
  }

  private assertLastUserPreserved(
    original: CodeBuddyMessage[],
    prepared: CodeBuddyMessage[],
    effectiveLimit: number,
  ): void {
    const lastUser = findLastUserMessage(original);
    if (!lastUser) return;
    if (prepared.includes(lastUser)) return;
    const intact = prepared.some((message) => (
      message.role === 'user'
      && message.content === lastUser.content
    ));
    if (intact) return;
    throw new ContextCompactionError(
      'CURRENT_REQUEST_DROPPED',
      this.countMessageTokens([lastUser]),
      effectiveLimit,
      'Current user request was dropped during context compaction. The request was not sent to the model.',
    );
  }

  private assertFitsTokenLimit(prepared: CodeBuddyMessage[], effectiveLimit: number): void {
    const tokens = this.countMessageTokens(prepared);
    if (tokens <= effectiveLimit) return;
    throw new ContextCompactionError('COMPACTION_EXCEEDS_LIMIT', tokens, effectiveLimit);
  }

  /**
   * Releases resources (like the tiktoken encoder).
   */
  dispose(): void {
    this.tokenCounter.dispose();
  }
}

/**
 * Factory function to create a ContextManager instance.
 * 
 * @param model - The model name for token counting.
 * @param maxTokens - Optional override for max context tokens.
 * @returns A new ContextManagerV3 instance.
 */
export function createContextManager(model: string, maxTokens?: number): ContextManagerV3 {
  const declaredWindow = getModelToolConfig(model).contextWindow;
  const config = {
    model,
    maxContextTokens: maxTokens ?? declaredWindow ?? ContextManagerV3.DEFAULT_CONFIG.maxContextTokens,
  };
  return new ContextManagerV3(config);
}
