/**
 * Advanced Context Manager for LLM conversations (Primary)
 *
 * This is the main context manager used by all agents (CodeBuddyAgent, BaseAgent).
 * For the server API routes, see context-manager-v3.ts.
 *
 * Implements multiple strategies based on research:
 * - Recurrent Context Compression (arxiv:2406.06110)
 * - Recursive Summarization (arxiv:2308.15022)
 * - Sliding Window Attention with Overlap
 * - Event-centric Memory (LoCoMo)
 * - Content-type-aware Compression
 * - Key Information Preservation
 */

import { CodeBuddyMessage } from '../codebuddy/client.js';
import { createTokenCounter, TokenCounter } from './token-counter.js';
import { logger } from '../utils/logger.js';
import {
  EnhancedContextCompressor,
  EnhancedCompressionConfig,
} from './enhanced-compression.js';
import type {
  KeyInformation,
  ContextArchive,
  CompressionMetrics,
  EnhancedCompressionResult,
} from './types.js';

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
  /** Auto-compact threshold in tokens (like mistral-vibe's 200K) */
  autoCompactThreshold: number;
  /** Warning thresholds as percentages (e.g., [50, 75, 90]) */
  warningThresholds: number[];
  /** Enable context warnings */
  enableWarnings: boolean;
  /** Enable enhanced compression with key info preservation */
  enableEnhancedCompression: boolean;
  /** Configuration for enhanced compression */
  enhancedCompressionConfig?: Partial<EnhancedCompressionConfig>;
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
 * Memory metrics for monitoring context manager health
 */
export interface ContextMemoryMetrics {
  /** Current number of stored summaries */
  summaryCount: number;
  /** Total tokens in summaries */
  summaryTokens: number;
  /** Peak message count seen this session */
  peakMessageCount: number;
  /** Number of compression operations performed */
  compressionCount: number;
  /** Total tokens saved by compression */
  totalTokensSaved: number;
  /** Last compression timestamp */
  lastCompressionTime: Date | null;
  /** Number of warning thresholds triggered */
  warningsTriggered: number;
}

/**
 * Advanced Context Manager with multiple compression strategies
 */
export class ContextManagerV2 {
  private config: ContextManagerConfig;
  private tokenCounter: TokenCounter;
  private summaries: ConversationSummary[] = [];
  private systemMessage: CodeBuddyMessage | null = null;
  /** Track which warning thresholds have been triggered (to avoid duplicate warnings) */
  private triggeredWarnings: Set<number> = new Set();
  /** Last token count for auto-compact tracking */
  private lastTokenCount: number = 0;
  /** Enhanced compressor for advanced compression strategies */
  private enhancedCompressor: EnhancedContextCompressor | null = null;
  /** Last enhanced compression result */
  private lastEnhancedResult: EnhancedCompressionResult | null = null;
  /** Session ID for archiving */
  private sessionId: string;

  // Memory metrics for monitoring
  /** Maximum number of summaries to keep (prevents unbounded growth) */
  private static readonly MAX_SUMMARIES = 50;
  /** Peak message count seen this session */
  private peakMessageCount: number = 0;
  /** Number of compression operations performed */
  private compressionCount: number = 0;
  /** Total tokens saved by compression */
  private totalTokensSaved: number = 0;
  /** Last compression timestamp */
  private lastCompressionTime: Date | null = null;

  // Default configuration based on research recommendations
  static readonly DEFAULT_CONFIG: ContextManagerConfig = {
    maxContextTokens: 4096,
    responseReserveTokens: 512, // ~12.5% reserve for response
    recentMessagesCount: 10,
    enableSummarization: true,
    compressionRatio: 4,
    model: 'gpt-4',
    autoCompactThreshold: 200000, // Like mistral-vibe's 200K default
    warningThresholds: [50, 75, 90], // Warn at 50%, 75%, and 90%
    enableWarnings: true,
    enableEnhancedCompression: true, // Enable by default
  };

  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = { ...ContextManagerV2.DEFAULT_CONFIG, ...config };
    this.tokenCounter = createTokenCounter(this.config.model);
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Initialize enhanced compressor if enabled
    if (this.config.enableEnhancedCompression) {
      this.enhancedCompressor = new EnhancedContextCompressor(
        this.tokenCounter,
        this.config.enhancedCompressionConfig
      );
    }
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
  countTokens(messages: CodeBuddyMessage[]): number {
    // Map CodeBuddyMessage to the format expected by TokenCounter
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
  getStats(messages: CodeBuddyMessage[]): ContextStats {
    const totalTokens = this.countTokens(messages);
    const maxTokens = this.effectiveLimit;
    const usagePercent = (totalTokens / maxTokens) * 100;

    // Track peak message count for memory metrics
    if (messages.length > this.peakMessageCount) {
      this.peakMessageCount = messages.length;
    }

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
   *
   * Implements auto-compact like mistral-vibe's AutoCompactMiddleware
   * Now supports enhanced compression with key info preservation
   */
  prepareMessages(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const stats = this.getStats(messages);

    // Check for auto-compact threshold (like mistral-vibe)
    const shouldCompact = this.shouldAutoCompact(messages) || stats.isNearLimit;

    // If within limits and below auto-compact threshold, return as-is
    if (!shouldCompact) {
      this.lastTokenCount = stats.totalTokens;
      return messages;
    }

    // Use enhanced compression if available
    if (this.config.enableEnhancedCompression && this.enhancedCompressor) {
      return this.prepareMessagesEnhanced(messages, stats);
    }

    // Fall back to legacy compression
    return this.prepareMessagesLegacy(messages, stats);
  }

  /**
   * Prepare messages using enhanced compression with key info preservation
   */
  private prepareMessagesEnhanced(
    messages: CodeBuddyMessage[],
    stats: ContextStats
  ): CodeBuddyMessage[] {
    if (!this.enhancedCompressor) {
      return this.prepareMessagesLegacy(messages, stats);
    }

    // Use enhanced compression
    const result = this.enhancedCompressor.compress(
      messages,
      this.effectiveLimit,
      this.sessionId
    );

    // Store result for later access
    this.lastEnhancedResult = result;

    // Track metrics
    if (result.compressed) {
      const tokensReduced = result.tokensReduced;
      logger.info(
        `Enhanced compression: Reduced ${tokensReduced.toLocaleString()} tokens ` +
        `(${stats.totalTokens.toLocaleString()} -> ${result.metrics.finalTokens.toLocaleString()}) ` +
        `using ${result.metrics.strategiesApplied.join(', ')}`
      );

      // Log preserved key information
      const preserved = result.preservedInfo;
      const preservedCount =
        preserved.decisions.length +
        preserved.errors.length +
        preserved.modifiedFiles.length;
      if (preservedCount > 0) {
        logger.debug(
          `Preserved: ${preserved.decisions.length} decisions, ` +
          `${preserved.errors.length} errors, ` +
          `${preserved.modifiedFiles.length} file operations`
        );
      }

      // Update memory metrics
      this.compressionCount++;
      this.totalTokensSaved += tokensReduced;
      this.lastCompressionTime = new Date();
    }

    this.lastTokenCount = result.metrics.finalTokens;
    return result.messages;
  }

  /**
   * Legacy compression (original implementation)
   */
  private prepareMessagesLegacy(
    messages: CodeBuddyMessage[],
    stats: ContextStats
  ): CodeBuddyMessage[] {
    // Extract system message if present
    const systemMsg = messages.find(m => m.role === 'system');
    const conversationMsgs = messages.filter(m => m.role !== 'system');

    // Apply compression strategies
    let optimizedMsgs = this.applyStrategies(conversationMsgs);

    // Reconstruct with system message
    if (systemMsg) {
      optimizedMsgs = [systemMsg, ...optimizedMsgs];
    }

    // Track token reduction for metrics
    const newStats = this.getStats(optimizedMsgs);
    const tokensReduced = stats.totalTokens - newStats.totalTokens;
    if (tokensReduced > 0) {
      logger.info(`Auto-compact: Reduced ${tokensReduced.toLocaleString()} tokens (${stats.totalTokens.toLocaleString()} -> ${newStats.totalTokens.toLocaleString()})`);

      // Update memory metrics
      this.compressionCount++;
      this.totalTokensSaved += tokensReduced;
      this.lastCompressionTime = new Date();
    }

    this.lastTokenCount = newStats.totalTokens;
    return optimizedMsgs;
  }

  /**
   * Apply compression strategies in order of priority
   */
  private applyStrategies(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
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
  private applySlidingWindow(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const keepCount = this.config.recentMessagesCount;

    if (messages.length <= keepCount) {
      return messages;
    }

    // Keep the most recent messages
    const recentMessages = messages.slice(-keepCount);

    // Create a summary marker for removed messages
    const removedCount = messages.length - keepCount;
    const summaryMarker: CodeBuddyMessage = {
      role: 'system',
      content: `[Previous ${removedCount} messages summarized due to context limits]`,
    };

    return [summaryMarker, ...recentMessages];
  }

  /**
   * Strategy 2: Truncate verbose tool results
   */
  private truncateToolResults(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
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
  private applySummarization(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const keepRecent = Math.min(this.config.recentMessagesCount, messages.length);

    if (messages.length <= keepRecent) {
      return messages;
    }

    // Split into old (to summarize) and recent (to keep)
    const oldMessages = messages.slice(0, -keepRecent);
    const recentMessages = messages.slice(-keepRecent);

    // Create a condensed summary of old messages
    const summaryContent = this.createSummary(oldMessages);

    // Store summary for metrics tracking (with bounded array)
    const summaryTokenCount = this.tokenCounter.countTokens(summaryContent);
    this.summaries.push({
      content: summaryContent,
      tokenCount: summaryTokenCount,
      originalMessageCount: oldMessages.length,
      timestamp: new Date(),
    });

    // Enforce maximum summaries limit to prevent memory leak
    if (this.summaries.length > ContextManagerV2.MAX_SUMMARIES) {
      // Remove oldest summaries, keeping the most recent
      const removeCount = this.summaries.length - ContextManagerV2.MAX_SUMMARIES;
      this.summaries.splice(0, removeCount);
      logger.debug(`Cleaned up ${removeCount} old summaries to prevent memory growth`);
    }

    // Create summary message
    const summaryMessage: CodeBuddyMessage = {
      role: 'system',
      content: `[Conversation Summary]\n${summaryContent}`,
    };

    return [summaryMessage, ...recentMessages];
  }

  /**
   * Create a condensed summary of messages
   * This is a simple extractive summary - for production, use LLM-based summarization
   */
  private createSummary(messages: CodeBuddyMessage[]): string {
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
  private hardTruncate(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
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
   * Implements multi-threshold warnings with deduplication (like mistral-vibe's ContextWarningMiddleware)
   */
  shouldWarn(messages: CodeBuddyMessage[]): { warn: boolean; message: string; threshold?: number } {
    if (!this.config.enableWarnings) {
      return { warn: false, message: '' };
    }

    const stats = this.getStats(messages);

    // Check each threshold in descending order (highest first)
    const sortedThresholds = [...this.config.warningThresholds].sort((a, b) => b - a);

    for (const threshold of sortedThresholds) {
      if (stats.usagePercent >= threshold && !this.triggeredWarnings.has(threshold)) {
        // Mark this threshold as triggered (don't warn again)
        this.triggeredWarnings.add(threshold);

        // Generate appropriate message based on threshold level
        let emoji = '📊';
        let level = 'Info';
        if (threshold >= 90) {
          emoji = '🔴';
          level = 'Critical';
        } else if (threshold >= 75) {
          emoji = '🟡';
          level = 'Warning';
        } else if (threshold >= 50) {
          emoji = '🟢';
          level = 'Notice';
        }

        const message = `${emoji} Context ${level}: You have used ${stats.usagePercent.toFixed(1)}% of your total context (${stats.totalTokens.toLocaleString()}/${stats.maxTokens.toLocaleString()} tokens)`;

        return {
          warn: true,
          message,
          threshold,
        };
      }
    }

    return { warn: false, message: '' };
  }

  /**
   * Check if auto-compact should be triggered
   * Returns true if token count exceeds autoCompactThreshold
   */
  shouldAutoCompact(messages: CodeBuddyMessage[]): boolean {
    const stats = this.getStats(messages);
    return stats.totalTokens >= this.config.autoCompactThreshold;
  }

  /**
   * Reset warning triggers (call when starting new conversation)
   */
  resetWarnings(): void {
    this.triggeredWarnings.clear();
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
    this.triggeredWarnings.clear();
    this.lastTokenCount = 0;
  }

  /**
   * Get last token count (useful for tracking auto-compact effectiveness)
   */
  getLastTokenCount(): number {
    return this.lastTokenCount;
  }

  /**
   * Get memory metrics for monitoring context manager health
   * Useful for detecting potential memory leaks and understanding compression behavior
   */
  getMemoryMetrics(): ContextMemoryMetrics {
    // Calculate total tokens in all stored summaries
    const summaryTokens = this.summaries.reduce((total, s) => total + s.tokenCount, 0);

    return {
      summaryCount: this.summaries.length,
      summaryTokens,
      peakMessageCount: this.peakMessageCount,
      compressionCount: this.compressionCount,
      totalTokensSaved: this.totalTokensSaved,
      lastCompressionTime: this.lastCompressionTime,
      warningsTriggered: this.triggeredWarnings.size,
    };
  }

  /**
   * Format memory metrics as a human-readable string
   */
  formatMemoryMetrics(): string {
    const metrics = this.getMemoryMetrics();
    const lines = [
      'Context Manager Memory Metrics:',
      `  Summaries stored: ${metrics.summaryCount}/${ContextManagerV2.MAX_SUMMARIES}`,
      `  Summary tokens: ${metrics.summaryTokens.toLocaleString()}`,
      `  Peak messages: ${metrics.peakMessageCount}`,
      `  Compressions: ${metrics.compressionCount}`,
      `  Tokens saved: ${metrics.totalTokensSaved.toLocaleString()}`,
      `  Last compression: ${metrics.lastCompressionTime?.toISOString() || 'Never'}`,
      `  Warnings triggered: ${metrics.warningsTriggered}`,
    ];
    return lines.join('\n');
  }

  /**
   * Force cleanup of old summaries and reset metrics
   * Call this to reclaim memory during long sessions
   */
  forceCleanup(): { summariesRemoved: number; tokensFreed: number } {
    const summariesRemoved = this.summaries.length;
    const tokensFreed = this.summaries.reduce((total, s) => total + s.tokenCount, 0);

    // Clear all summaries
    this.summaries = [];

    // Reset metrics that can be recalculated
    this.peakMessageCount = 0;
    this.triggeredWarnings.clear();

    // Clear enhanced compressor archives
    if (this.enhancedCompressor) {
      this.enhancedCompressor.clearArchives();
    }

    logger.info(`Force cleanup: removed ${summariesRemoved} summaries, freed ~${tokensFreed} tokens`);

    return { summariesRemoved, tokensFreed };
  }

  // ==========================================
  // Enhanced Compression Features
  // ==========================================

  /**
   * Get the last enhanced compression result (if available)
   * Contains detailed metrics and preserved key information
   */
  getLastCompressionResult(): EnhancedCompressionResult | null {
    return this.lastEnhancedResult;
  }

  /**
   * Get the last compression metrics
   */
  getLastCompressionMetrics(): CompressionMetrics | null {
    return this.lastEnhancedResult?.metrics || null;
  }

  /**
   * Get key information preserved from the last compression
   */
  getPreservedKeyInfo(): KeyInformation | null {
    return this.lastEnhancedResult?.preservedInfo || null;
  }

  /**
   * Recover full context from an archive
   *
   * @param archiveId - Optional archive ID, or undefined for most recent
   * @returns The full context messages, or undefined if not available
   */
  recoverFullContext(archiveId?: string): CodeBuddyMessage[] | undefined {
    if (!this.enhancedCompressor) {
      logger.warn('Enhanced compression not enabled - no archives available');
      return undefined;
    }

    const messages = this.enhancedCompressor.recoverContext(archiveId);
    if (messages) {
      logger.info(`Recovered full context: ${messages.length} messages`);
    } else {
      logger.warn('No context archive found');
    }
    return messages;
  }

  /**
   * List available context archives
   */
  listContextArchives(): Array<{
    id: string;
    timestamp: Date;
    messageCount: number;
    tokenCount: number;
  }> {
    if (!this.enhancedCompressor) {
      return [];
    }
    return this.enhancedCompressor.listArchives();
  }

  /**
   * Get enhanced compression configuration
   */
  getEnhancedCompressionConfig(): Partial<EnhancedCompressionConfig> | null {
    if (!this.enhancedCompressor) {
      return null;
    }
    return this.enhancedCompressor.getConfig();
  }

  /**
   * Update enhanced compression configuration
   */
  updateEnhancedCompressionConfig(config: Partial<EnhancedCompressionConfig>): void {
    if (this.enhancedCompressor) {
      this.enhancedCompressor.updateConfig(config);
    }
  }

  /**
   * Enable or disable enhanced compression
   */
  setEnhancedCompressionEnabled(enabled: boolean): void {
    this.config.enableEnhancedCompression = enabled;

    if (enabled && !this.enhancedCompressor) {
      this.enhancedCompressor = new EnhancedContextCompressor(
        this.tokenCounter,
        this.config.enhancedCompressionConfig
      );
      logger.info('Enhanced compression enabled');
    } else if (!enabled) {
      logger.info('Enhanced compression disabled');
    }
  }

  /**
   * Get detailed compression statistics
   */
  getCompressionStats(): {
    totalCompressions: number;
    totalTokensSaved: number;
    averageCompressionRatio: number;
    lastCompression: Date | null;
    archivesAvailable: number;
    lastStrategiesUsed: string[];
  } {
    const archives = this.listContextArchives();
    const lastResult = this.lastEnhancedResult;

    return {
      totalCompressions: this.compressionCount,
      totalTokensSaved: this.totalTokensSaved,
      averageCompressionRatio: lastResult?.metrics.compressionRatio || 1,
      lastCompression: this.lastCompressionTime,
      archivesAvailable: archives.length,
      lastStrategiesUsed: lastResult?.metrics.strategiesApplied || [],
    };
  }

  /**
   * Format compression statistics as human-readable string
   */
  formatCompressionStats(): string {
    const stats = this.getCompressionStats();
    const lines = [
      'Context Compression Statistics:',
      `  Total compressions: ${stats.totalCompressions}`,
      `  Total tokens saved: ${stats.totalTokensSaved.toLocaleString()}`,
      `  Average compression ratio: ${stats.averageCompressionRatio.toFixed(2)}x`,
      `  Last compression: ${stats.lastCompression?.toISOString() || 'Never'}`,
      `  Archives available: ${stats.archivesAvailable}`,
      `  Last strategies used: ${stats.lastStrategiesUsed.join(', ') || 'None'}`,
    ];

    // Add preserved info if available
    const preserved = this.getPreservedKeyInfo();
    if (preserved) {
      lines.push('');
      lines.push('Last Compression Preserved:');
      lines.push(`  Decisions: ${preserved.decisions.length}`);
      lines.push(`  Errors: ${preserved.errors.length}`);
      lines.push(`  File operations: ${preserved.modifiedFiles.length}`);
      lines.push(`  Tool calls: ${preserved.toolCalls.length}`);
    }

    return lines.join('\n');
  }
}

// Re-export types for convenience
export type {
  KeyInformation,
  ContextArchive,
  CompressionMetrics,
  EnhancedCompressionResult,
};

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
