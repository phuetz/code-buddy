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

import * as fs from 'fs';
import * as path from 'path';
import { CodeBuddyMessage } from '../codebuddy/client.js';
import { redactSecrets } from '../fleet/privacy-lint.js';
import { createTokenCounter, TokenCounter } from './token-counter.js';
import { logger } from '../utils/logger.js';
import { getModelToolConfig } from '../config/model-tools.js';
import { RunStore } from '../observability/run-store.js';
import {
  EnhancedContextCompressor,
  EnhancedCompressionConfig,
} from './enhanced-compression.js';
import { ImportanceScorer } from './importance-scorer.js';
import { computeAutoCompactThreshold } from './auto-compact-threshold.js';
import type {
  KeyInformation,
  ContextArchive,
  CompressionMetrics,
  EnhancedCompressionResult,
} from './types.js';
import type { ContextEngine } from './context-engine.js';

// Lazy import memory monitor to avoid circular dependencies
let memoryMonitorModule: typeof import('../utils/memory-monitor.js') | null = null;
async function getMemoryMonitorModule() {
  if (!memoryMonitorModule) {
    memoryMonitorModule = await import('../utils/memory-monitor.js');
  }
  return memoryMonitorModule;
}

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
  /** Auto-compact threshold as percentage of context window (e.g., 80 = 80%). Overrides autoCompactThreshold if set. */
  autoCompactPercent?: number;
  /**
   * Phase post-audit (Claude Code source comparison): when `true`, use
   * the per-model adaptive buffer helper (`computeAutoCompactThreshold`)
   * INSTEAD of the percent/absolute logic. The helper subtracts a
   * model-specific buffer (e.g. 13K for Claude Sonnet, 8K for Haiku)
   * from `maxContextTokens` then optionally applies `autoCompactPercent`.
   * Default `false` to preserve the current backward-compatible behavior.
   */
  useAdaptiveBuffer?: boolean;
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
 * Periodic memory snapshot (WS3-T2) — a compact, persisted view of the
 * session so very long runs (12–15 h) survive crashes and aggressive
 * compaction without losing the thread.
 */
export interface ContextSnapshot {
  sessionId: string;
  takenAt: string;
  stats: {
    messageCount: number;
    tokenCount: number;
    compressionCount: number;
    totalTokensSaved: number;
  };
  /** Extractive, privacy-linted summary of the conversation so far. */
  summary: string;
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
  /** Lazy-loaded importance scorer for sliding window decisions */
  private _importanceScorer: ImportanceScorer | null = null;
  /** Pluggable context engine (Native Engine v2026.3.7 alignment) */
  private contextEngine: ContextEngine | null = null;

  // Memory metrics for monitoring
  /** Maximum number of summaries to keep (prevents unbounded growth) */
  private static readonly MAX_SUMMARIES = 50;
  /** Peak message count seen this session */
  private peakMessageCount: number = 0;
  /** Number of compression operations performed */
  private compressionCount: number = 0;
  /** Total tokens saved by compression */
  private totalTokensSaved: number = 0;
  /** Cached token count for getStats() */
  private _cachedStatsTokenCount = 0;
  /**
   * Content-aware cache key for getStats().
   *
   * Previously this was `messages.length` alone, which produced stale hits
   * when messages were mutated in place (common: tool results populated,
   * assistant content sanitized, tool_calls appended). Now we compute a
   * cheap O(N) fingerprint over the array: length + sum of content char
   * counts + total tool_calls count. Any mutation of content or tool_calls
   * invalidates the cache. The scan is microseconds vs ~20–50 ms for a
   * full tiktoken recount.
   */
  private _cachedStatsFingerprint = '';
  /** Last compression timestamp */
  private lastCompressionTime: Date | null = null;
  /** WS3-T2 — periodic snapshot timer (unref'd, never keeps the process alive) */
  private snapshotTimer: NodeJS.Timeout | null = null;
  /** WS3-T2 — snapshots taken this session */
  private snapshotCount: number = 0;

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
   * Register a pluggable context engine (Native Engine v2026.3.7 alignment).
   * When set, prepareMessages() delegates to engine.assemble().
   */
  setContextEngine(engine: ContextEngine): void {
    this.contextEngine = engine;
    logger.info(`Context engine registered: ${engine.id}`);
  }

  /**
   * Get the active context engine (or null for default behavior)
   */
  getContextEngine(): ContextEngine | null {
    return this.contextEngine;
  }

  /**
   * Raw message preparation — used by DefaultContextEngine to delegate
   * back to the built-in compression pipeline without infinite recursion.
   */
  prepareMessagesRaw(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const stats = this.getStats(messages);
    const shouldSoftCompact =
      this.config.enableSummarization &&
      this.effectiveLimit <= 1000 &&
      messages.length > this.config.recentMessagesCount * 2;
    const shouldCompact = this.shouldAutoCompact(messages) || stats.isNearLimit || shouldSoftCompact;

    if (!shouldCompact) {
      this.lastTokenCount = stats.totalTokens;
      return messages;
    }

    let compacted: CodeBuddyMessage[];
    if (this.config.enableEnhancedCompression && this.enhancedCompressor) {
      compacted = this.prepareMessagesEnhanced(messages, stats);
    } else {
      compacted = this.prepareMessagesLegacy(messages, stats);
    }

    const newStats = this.getStats(compacted);
    if (newStats.totalTokens < stats.totalTokens) {
      try {
        const runStore = RunStore.getInstance();
        const activeRunId = runStore.getCurrentRunId();
        if (activeRunId) {
          runStore.forkRun(activeRunId, 'compaction');
        }
      } catch (err) {
        logger.warn('Failed to fork run on compaction:', { error: String(err) });
      }
    }

    // Re-arm warning thresholds we've dropped below so they can fire again.
    this.rearmWarningsAfterCompaction(stats, compacted);

    return compacted;
  }

  /**
   * Get the effective token limit (accounting for response reserve + estimation safety margin)
   * The 5% safety margin compensates for token counting estimation drift.
   */
  get effectiveLimit(): number {
    const raw = this.config.maxContextTokens - this.config.responseReserveTokens;
    return Math.floor(raw * 0.95);
  }

  /**
   * Count tokens in messages
   */
  countTokens(messages: CodeBuddyMessage[]): number {
    if (messages.length === 0) {
      return 0;
    }

    // Map CodeBuddyMessage to the format expected by TokenCounter
    const tokenMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : null,
      tool_calls: 'tool_calls' in msg ? msg.tool_calls : undefined,
    }));
    return this.tokenCounter.countMessageTokens(tokenMessages);
  }

  /**
   * Compute a cheap fingerprint of the messages array for cache invalidation.
   * Covers additions, in-place content mutation, and tool_call changes.
   */
  private computeStatsFingerprint(messages: CodeBuddyMessage[]): string {
    let contentLen = 0;
    let toolCallsCount = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        contentLen += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        // Multimodal content: count JSON length as a rough signal
        contentLen += JSON.stringify(msg.content).length;
      }
      if ('tool_calls' in msg && Array.isArray(msg.tool_calls)) {
        toolCallsCount += msg.tool_calls.length;
      }
    }
    return `${messages.length}:${contentLen}:${toolCallsCount}`;
  }

  /**
   * Get context statistics
   */
  getStats(messages: CodeBuddyMessage[]): ContextStats {
    let totalTokens: number;
    const fingerprint = this.computeStatsFingerprint(messages);
    if (fingerprint === this._cachedStatsFingerprint) {
      totalTokens = this._cachedStatsTokenCount;
    } else {
      totalTokens = this.countTokens(messages);
      this._cachedStatsTokenCount = totalTokens;
      this._cachedStatsFingerprint = fingerprint;
    }
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
   * Get a breakdown of context budget usage per layer.
   * Useful for diagnosing which layer consumes the most context.
   */
  getContextBudgetBreakdown(messages: CodeBuddyMessage[]): Record<string, { chars: number; tokens: number; percent: number }> {
    const layers: Record<string, number> = {
      system: 0,
      lessons: 0,
      decisions: 0,
      code_graph: 0,
      tool_results: 0,
      user_messages: 0,
      assistant_messages: 0,
      other: 0,
    };

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      const chars = content.length;

      if (msg.role === 'system') {
        if (content.includes('<lessons_context>')) layers.lessons = (layers.lessons ?? 0) + chars;
        else if (content.includes('<decisions_context>')) layers.decisions = (layers.decisions ?? 0) + chars;
        else if (content.includes('code_graph')) layers.code_graph = (layers.code_graph ?? 0) + chars;
        else layers.system = (layers.system ?? 0) + chars;
      } else if (msg.role === 'tool') {
        layers.tool_results = (layers.tool_results ?? 0) + chars;
      } else if (msg.role === 'user') {
        layers.user_messages = (layers.user_messages ?? 0) + chars;
      } else if (msg.role === 'assistant') {
        layers.assistant_messages = (layers.assistant_messages ?? 0) + chars;
      } else {
        layers.other = (layers.other ?? 0) + chars;
      }
    }

    const totalChars = Object.values(layers).reduce((a, b) => a + b, 0);
    const totalTokens = this.countTokens(messages);
    const result: Record<string, { chars: number; tokens: number; percent: number }> = {};

    for (const [layer, chars] of Object.entries(layers)) {
      if (chars === 0) continue;
      const proportion = totalChars > 0 ? chars / totalChars : 0;
      result[layer] = {
        chars,
        tokens: Math.round(totalTokens * proportion),
        percent: Math.round(proportion * 100),
      };
    }

    return result;
  }

  /**
   * Prepare messages for API call, managing context as needed
   * Returns optimized message array that fits within token limits
   *
   * Implements auto-compact like mistral-vibe's AutoCompactMiddleware
   * Now supports enhanced compression with key info preservation
   */
  prepareMessages(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    // Delegate to pluggable context engine if registered (Native Engine v2026.3.7)
    if (this.contextEngine) {
      // ownsCompaction: engine controls compaction — skip built-in auto-compact,
      // delegate directly to engine.assemble() (Native Engine v2026.3.13-1)
      if (this.contextEngine.ownsCompaction) {
        const result = this.contextEngine.assemble(messages, this.effectiveLimit);
        this.lastTokenCount = result.tokenCount;
        return result.messages;
      }

      // Non-owning engine: run built-in compaction first, then assemble
      const compacted = this.prepareMessagesRaw(messages);
      const result = this.contextEngine.assemble(compacted, this.effectiveLimit);
      this.lastTokenCount = result.tokenCount;
      return result.messages;
    }

    // Default pipeline (no engine registered)
    return this.prepareMessagesRaw(messages);
  }

  /**
   * @deprecated Use prepareMessages() — this is kept for backwards compatibility
   */
  private _prepareMessagesInternal(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const stats = this.getStats(messages);
    const shouldSoftCompact =
      this.config.enableSummarization &&
      this.effectiveLimit <= 1000 &&
      messages.length > this.config.recentMessagesCount * 2;

    // Check for auto-compact threshold (like mistral-vibe)
    const shouldCompact = this.shouldAutoCompact(messages) || stats.isNearLimit || shouldSoftCompact;

    // If within limits and below auto-compact threshold, return as-is
    if (!shouldCompact) {
      this.lastTokenCount = stats.totalTokens;
      return messages;
    }

    // Use enhanced compression if available, else legacy.
    const compacted = this.config.enableEnhancedCompression && this.enhancedCompressor
      ? this.prepareMessagesEnhanced(messages, stats)
      : this.prepareMessagesLegacy(messages, stats);

    // Re-arm warning thresholds we've dropped below so they can fire again.
    this.rearmWarningsAfterCompaction(stats, compacted);

    return compacted;
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

    // Guardrail: if enhanced compression cannot produce a usable result,
    // fall back to legacy deterministic strategies.
    const finalTokens = result.metrics.finalTokens;
    const hadToolMessages = messages.some(m => m.role === 'tool');
    const lostToolMessages = hadToolMessages && !result.messages.some(m => m.role === 'tool');
    const shouldPreferLegacySummarization =
      this.config.enableSummarization &&
      this.effectiveLimit <= 1000 &&
      messages.length > this.config.recentMessagesCount * 2 &&
      result.messages.length >= messages.length;
    const shouldFallback =
      (messages.length > 0 && result.messages.length === 0) ||
      (stats.totalTokens > this.effectiveLimit && finalTokens > this.effectiveLimit) ||
      (!result.compressed && stats.totalTokens > this.effectiveLimit) ||
      lostToolMessages ||
      shouldPreferLegacySummarization;

    if (shouldFallback) {
      logger.debug('Enhanced compression fallback to legacy strategy');
      return this.prepareMessagesLegacy(messages, stats);
    }

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

    this.lastTokenCount = finalTokens;
    return result.messages;
  }

  /**
   * Legacy compression (original implementation)
   */
  private prepareMessagesLegacy(
    messages: CodeBuddyMessage[],
    stats: ContextStats
  ): CodeBuddyMessage[] {
    // Extract ALL leading system messages, not just the first: the context
    // pipeline injects several (workspace, lessons, decisions, code_graph,
    // todo). The old `find(...)` kept one and `filter(role !== system)`
    // silently dropped the rest — losing injected guidance on compaction.
    const systemMsgs = messages.filter(m => m.role === 'system');
    const conversationMsgs = messages.filter(m => m.role !== 'system');

    // Apply compression strategies
    let optimizedMsgs = this.applyStrategies(conversationMsgs);

    // Reconstruct with the system messages first, order preserved.
    if (systemMsgs.length > 0) {
      optimizedMsgs = [...systemMsgs, ...optimizedMsgs];
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
    const shouldSoftSummarize =
      this.config.enableSummarization &&
      this.effectiveLimit <= 1000 &&
      result.length > this.config.recentMessagesCount * 2;

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
    if ((currentTokens > this.effectiveLimit || shouldSoftSummarize) && this.config.enableSummarization) {
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
   * Get or create the importance scorer (lazy-loaded).
   */
  private get importanceScorer(): ImportanceScorer {
    if (!this._importanceScorer) {
      this._importanceScorer = new ImportanceScorer();
    }
    return this._importanceScorer;
  }

  /**
   * Strategy 1: Sliding Window - Keep N most recent messages
   * Uses ImportanceScorer to preserve high-importance messages outside the window.
   */
  private applySlidingWindow(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const keepCount = this.config.recentMessagesCount;

    if (messages.length <= keepCount) {
      return messages;
    }

    // Score all messages using the importance scorer
    const scores = this.importanceScorer.scoreMessages(messages);

    // Always keep the most recent messages
    const recentMessages = messages.slice(-keepCount);

    // For messages outside the window, keep any with score > 0.8 (high importance)
    const oldMessages = messages.slice(0, -keepCount);
    const importantOldMessages: CodeBuddyMessage[] = [];
    for (let i = 0; i < oldMessages.length; i++) {
      const score = scores[i];
      const oldMessage = oldMessages[i];
      if (oldMessage !== undefined && (score?.score ?? 0) > 0.8) {
        importantOldMessages.push(oldMessage);
      }
    }

    // Create a summary marker for removed messages
    const removedCount = messages.length - keepCount - importantOldMessages.length;
    const parts: CodeBuddyMessage[] = [];

    if (removedCount > 0) {
      parts.push({
        role: 'system',
        content: `[Previous ${removedCount} messages summarized due to context limits]`,
      });
    }

    return [...parts, ...importantOldMessages, ...recentMessages];
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

    // Remove oldest messages, preserving tool-call/tool-result pairs
    while (currentTokens > this.effectiveLimit && result.length > 2) {
      const first = result[0];
      // result.length > 2 (loop guard above) guarantees result[0] exists; guard for type-safety
      if (first === undefined) break;
      // If removing an assistant message with tool_calls, also remove its paired tool results
      if (first.role === 'assistant' && 'tool_calls' in first && Array.isArray((first as { tool_calls?: unknown[] }).tool_calls)) {
        const toolCallIds = new Set(
          ((first as { tool_calls: Array<{ id: string }> }).tool_calls).map(tc => tc.id)
        );
        // Remove the assistant message + all paired tool results
        result = result.filter((msg, idx) => {
          if (idx === 0) return false; // remove the assistant message
          if (msg.role === 'tool' && toolCallIds.has((msg as { tool_call_id?: string }).tool_call_id ?? '')) return false;
          return true;
        });
      } else if (first.role === 'tool') {
        // Orphaned tool result (its assistant was already removed) — safe to drop
        result = result.slice(1);
      } else {
        result = result.slice(1);
      }
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
   * Check if auto-compact should be triggered.
   *
   * CC17: Supports percentage-based threshold via autoCompactPercent config
   * or CODEBUDDY_AUTOCOMPACT_PCT env var. Falls back to absolute token threshold.
   */
  shouldAutoCompact(messages: CodeBuddyMessage[]): boolean {
    const stats = this.getStats(messages);

    // Phase post-audit V1.3: opt-in adaptive buffer (per-model lookup)
    // Subtracts a model-specific buffer from maxContextTokens before
    // applying optional percent. Default off — backward compat with
    // the existing percent/threshold path below.
    if (this.config.useAdaptiveBuffer) {
      const envPctAdaptive = process.env.CODEBUDDY_AUTOCOMPACT_PCT;
      const pctAdaptive = this.config.autoCompactPercent ?? (envPctAdaptive ? parseFloat(envPctAdaptive) : undefined);
      const threshold = computeAutoCompactThreshold(
        this.config.maxContextTokens,
        this.config.model,
        pctAdaptive !== undefined && !isNaN(pctAdaptive) ? { percent: pctAdaptive } : undefined,
      );
      return stats.totalTokens >= threshold;
    }

    // CC17: Check percentage-based threshold first
    const envPct = process.env.CODEBUDDY_AUTOCOMPACT_PCT;
    const pct = this.config.autoCompactPercent ?? (envPct ? parseFloat(envPct) : undefined);
    if (pct !== undefined && !isNaN(pct) && pct > 0 && pct <= 100) {
      const threshold = Math.floor(this.config.maxContextTokens * (pct / 100));
      return stats.totalTokens >= threshold;
    }

    // Fallback: absolute token threshold
    return stats.totalTokens >= this.config.autoCompactThreshold;
  }

  /**
   * Reset warning triggers (call when starting new conversation)
   */
  resetWarnings(): void {
    this.triggeredWarnings.clear();
  }

  /**
   * After a compaction reduces context usage, re-arm any warning threshold we've
   * now dropped BELOW so it can fire again when usage climbs back up. Without
   * this, `triggeredWarnings` only ever grew, so a threshold warned at most once
   * per conversation — on a long session with multiple compaction cycles the
   * user stopped getting context warnings exactly when they matter most.
   */
  private rearmWarningsAfterCompaction(before: ContextStats, compacted: CodeBuddyMessage[]): void {
    const after = this.getStats(compacted);
    if (after.totalTokens >= before.totalTokens) return; // compaction didn't reduce usage
    for (const threshold of [...this.triggeredWarnings]) {
      if (threshold > after.usagePercent) this.triggeredWarnings.delete(threshold);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.model) {
      this.tokenCounter = createTokenCounter(config.model);
      // The stats cache is keyed only by message shape (length/content/tool
      // calls), not the tokenizer — so a model swap that keeps the same
      // messages would otherwise return a stale count from the OLD tokenizer.
      this._cachedStatsFingerprint = '';
      this._cachedStatsTokenCount = 0;
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
    this.stopPeriodicSnapshot();
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

  /**
   * Check memory pressure and cleanup if needed
   * Returns true if cleanup was performed
   */
  async checkMemoryPressure(): Promise<boolean> {
    try {
      const memModule = await getMemoryMonitorModule();
      const pressure = memModule.getMemoryPressure();

      if (pressure === 'critical' || pressure === 'high') {
        logger.warn(`Memory pressure ${pressure}: triggering context cleanup`);
        const result = this.forceCleanup();
        logger.info(`Cleanup freed ${result.tokensFreed} tokens from ${result.summariesRemoved} summaries`);
        return true;
      }

      return false;
    } catch {
      // Memory module not available, skip check
      return false;
    }
  }

  /**
   * Get combined health metrics including memory
   */
  async getHealthMetrics(): Promise<{
    context: ContextMemoryMetrics;
    memory?: {
      heapUsed: number;
      heapTotal: number;
      pressure: 'low' | 'medium' | 'high' | 'critical';
    };
  }> {
    const contextMetrics = this.getMemoryMetrics();

    try {
      const memModule = await getMemoryMonitorModule();
      const snapshot = memModule.getMemoryUsage();
      const pressure = memModule.getMemoryPressure();

      return {
        context: contextMetrics,
        memory: {
          heapUsed: snapshot.heapUsed,
          heapTotal: snapshot.heapTotal,
          pressure,
        },
      };
    } catch {
      return { context: contextMetrics };
    }
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

  // ==========================================================================
  // WS3-T2 — Periodic memory snapshot
  // ==========================================================================

  /**
   * Take a compact snapshot of the session and persist it to
   * `.codebuddy/context-snapshot.json` (latest wins). Returns null when the
   * conversation is too small to be worth snapshotting.
   *
   * The summary is privacy-linted before it touches disk (WS3 guard-rail).
   */
  takeSnapshot(
    messages: CodeBuddyMessage[],
    workDir: string = process.cwd(),
  ): ContextSnapshot | null {
    if (!messages || messages.length < 4) return null;

    const snapshot: ContextSnapshot = {
      sessionId: this.sessionId,
      takenAt: new Date().toISOString(),
      stats: {
        messageCount: messages.length,
        tokenCount: this.countTokens(messages),
        compressionCount: this.compressionCount,
        totalTokensSaved: this.totalTokensSaved,
      },
      summary: redactSecrets(this.createSummary(messages)),
    };

    try {
      const dir = path.join(workDir, '.codebuddy');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'context-snapshot.json'),
        JSON.stringify(snapshot, null, 2),
        'utf8',
      );
    } catch (err) {
      logger.debug('Context snapshot write failed', { error: String(err) });
      return null;
    }

    this.snapshotCount++;
    try {
      const runStore = RunStore.getInstance();
      if (runStore.getCurrentRunId()) {
        runStore.appendEvent('context_snapshot', {
          sessionId: snapshot.sessionId,
          messageCount: snapshot.stats.messageCount,
          tokenCount: snapshot.stats.tokenCount,
          snapshotCount: this.snapshotCount,
        });
      }
    } catch {
      // Observability must never break the snapshot path.
    }
    return snapshot;
  }

  /**
   * Start the periodic snapshot loop for long sessions (12–15 h).
   *
   * Interval resolution: explicit param → `CODEBUDDY_SNAPSHOT_INTERVAL_MIN`
   * env (minutes) → 45 min default. `0` (or negative) disables. The timer
   * is unref'd so it never keeps a finished process alive.
   */
  startPeriodicSnapshot(
    getMessages: () => CodeBuddyMessage[],
    intervalMs?: number,
    workDir: string = process.cwd(),
  ): void {
    this.stopPeriodicSnapshot();

    let resolved = intervalMs;
    if (resolved === undefined) {
      const envMin = parseInt(process.env.CODEBUDDY_SNAPSHOT_INTERVAL_MIN || '45', 10);
      resolved = (Number.isFinite(envMin) ? envMin : 45) * 60_000;
    }
    if (!resolved || resolved <= 0) return;

    this.snapshotTimer = setInterval(() => {
      try {
        this.takeSnapshot(getMessages(), workDir);
      } catch (err) {
        logger.debug('Periodic context snapshot failed', { error: String(err) });
      }
    }, resolved);
    this.snapshotTimer.unref();
  }

  /** Stop the periodic snapshot loop (idempotent). */
  stopPeriodicSnapshot(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
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
  // Use getModelToolConfig for glob-pattern matching (covers grok-3*, grok-4*, claude-*, etc.)
  const toolConfig = getModelToolConfig(model);
  const detectedLimit = maxTokens || toolConfig.contextWindow || 8192;

  return new ContextManagerV2({
    model,
    maxContextTokens: detectedLimit,
    responseReserveTokens: Math.floor(detectedLimit * 0.125), // 12.5% reserve
    // The absolute auto-compact gate (mistral-vibe style, default 200K) was
    // DEAD for every sub-200K model: the default exceeded the whole window,
    // so shouldAutoCompact() could never fire on it. Clamp it to the window;
    // for ≥200K-window models (grok 2M…) the 200K cap keeps its meaning.
    autoCompactThreshold: Math.min(200_000, detectedLimit),
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
