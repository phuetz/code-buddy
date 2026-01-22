/**
 * Enhanced Context Compression
 *
 * Advanced compression strategies that preserve important information:
 * - Sliding window with overlap for continuity
 * - Intelligent summarization of old messages
 * - Key information preservation (decisions, errors, modified files)
 * - Content-type-aware compression
 * - Compression metrics tracking
 * - Full context recovery capability
 */

import { CodeBuddyMessage } from '../codebuddy/client.js';
import { TokenCounter } from './token-counter.js';
import {
  CompressionResult,
  ContentType,
  ClassifiedMessage,
  KeyInformation,
  EnhancedCompressionResult,
  CompressionMetrics,
  ContextArchive,
  SlidingWindowConfig,
  SummarizationConfig,
} from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Configuration for the enhanced compression engine.
 */
export interface EnhancedCompressionConfig {
  /** Sliding window configuration. */
  slidingWindow: SlidingWindowConfig;
  /** Summarization configuration. */
  summarization: SummarizationConfig;
  /** Maximum length for tool outputs before truncation. */
  maxToolOutputLength: number;
  /** Whether to archive full context before compression. */
  enableArchiving: boolean;
  /** Maximum archives to keep in memory. */
  maxArchives: number;
  /** Importance threshold for preservation (0-1). */
  preservationThreshold: number;
}

/**
 * Default configuration for enhanced compression.
 */
export const DEFAULT_ENHANCED_CONFIG: EnhancedCompressionConfig = {
  slidingWindow: {
    windowSize: 15,
    overlapSize: 3,
    summarizeOldMessages: true,
  },
  summarization: {
    maxSummaryTokens: 500,
    preserveKeyEntities: true,
    preserveErrors: true,
    preserveDecisions: true,
    minMessagesForSummarization: 5,
  },
  maxToolOutputLength: 800,
  enableArchiving: true,
  maxArchives: 5,
  preservationThreshold: 0.7,
};

/**
 * Patterns for detecting various content types.
 */
const CONTENT_PATTERNS = {
  code: [
    /```[\s\S]*?```/,                    // Fenced code blocks
    /^\s{4,}[^\s]/m,                      // Indented code
    /^(function|const|let|var|class|import|export|def|async|public|private)\s/m,
    /[{};]\s*$/m,                         // Code-like line endings
  ],
  error: [
    /error/i,
    /exception/i,
    /failed/i,
    /traceback/i,
    /stack trace/i,
    /at\s+[\w.]+\s*\(/i,                 // Stack trace lines
    /^\s*at\s+/m,
  ],
  decision: [
    /\b(yes|no|confirm|approve|deny|accept|reject)\b/i,
    /\b(decided|decision|chose|selected)\b/i,
    /\b(will|won't|should|shouldn't)\s+(do|use|implement)/i,
  ],
  fileContent: [
    /^(file|path|filename):\s*/im,
    /^---\s*$/m,                          // File separators
    /^\+\+\+\s/m,                         // Diff markers
    /^@@\s/m,
  ],
  command: [
    /^\$\s+/m,                            // Shell prompts
    /^>\s+/m,
    /\b(npm|yarn|git|docker|kubectl|curl|wget)\s/,
    /^(cd|ls|mkdir|rm|cp|mv|cat|echo)\s/m,
  ],
};

/**
 * Patterns for extracting key information.
 */
const KEY_INFO_PATTERNS = {
  filePath: /(?:^|\s|['"`])([/\\]?(?:[\w.-]+[/\\])+[\w.-]+\.\w+)(?:['"`]|\s|$)/g,
  fileOperation: /(?:creat|edit|modif|delet|writ|read|updat)(?:ed?|ing)\s+(?:file\s+)?(['"`]?)([/\\]?(?:[\w.-]+[/\\])*[\w.-]+\.\w+)\1/gi,
  errorMessage: /(?:error|exception|failed):\s*(.+?)(?:\n|$)/gi,
  decision: /(?:decided|chose|will|confirmed?)(?:\s+to)?\s+(.+?)(?:\.|$)/gi,
};

/**
 * Enhanced Context Compression Engine.
 *
 * Implements advanced compression strategies while preserving
 * important context and enabling recovery of full history.
 */
export class EnhancedContextCompressor {
  private config: EnhancedCompressionConfig;
  private tokenCounter: TokenCounter;
  private archives: ContextArchive[] = [];
  private archiveIdCounter = 0;

  constructor(
    tokenCounter: TokenCounter,
    config: Partial<EnhancedCompressionConfig> = {}
  ) {
    this.tokenCounter = tokenCounter;
    this.config = {
      ...DEFAULT_ENHANCED_CONFIG,
      ...config,
      slidingWindow: { ...DEFAULT_ENHANCED_CONFIG.slidingWindow, ...config.slidingWindow },
      summarization: { ...DEFAULT_ENHANCED_CONFIG.summarization, ...config.summarization },
    };
  }

  /**
   * Compress messages with enhanced strategies and preservation.
   *
   * @param messages - Messages to compress.
   * @param tokenLimit - Maximum allowed tokens.
   * @param sessionId - Optional session identifier for archiving.
   * @returns Enhanced compression result with metrics and preserved info.
   */
  compress(
    messages: CodeBuddyMessage[],
    tokenLimit: number,
    sessionId?: string
  ): EnhancedCompressionResult {
    const startTime = Date.now();
    const originalTokens = this.countTokens(messages);
    const strategiesApplied: string[] = [];

    // Early exit if already within limits
    if (originalTokens <= tokenLimit) {
      return this.createResult(messages, originalTokens, startTime, [], 'none', sessionId);
    }

    // Archive full context before compression
    let archive: ContextArchive | undefined;
    if (this.config.enableArchiving) {
      archive = this.archiveContext(messages, originalTokens, sessionId);
    }

    // Extract key information to preserve
    const keyInfo = this.extractKeyInformation(messages);

    // Classify messages by content type
    const classified = this.classifyMessages(messages);

    // Separate system message
    const systemMsg = messages.find(m => m.role === 'system');
    const conversationMsgs = messages.filter(m => m.role !== 'system');

    let compressed: CodeBuddyMessage[] = [...conversationMsgs];
    let currentTokens = this.countTokens(compressed);

    // Strategy 1: Sliding window with overlap
    if (currentTokens > tokenLimit) {
      compressed = this.applySlidingWindowWithOverlap(compressed, classified) as CodeBuddyMessage[];
      currentTokens = this.countTokens(compressed);
      strategiesApplied.push('sliding_window_overlap');
    }

    // Strategy 2: Content-aware tool result truncation
    if (currentTokens > tokenLimit) {
      compressed = this.truncateToolResultsSmart(compressed, classified);
      currentTokens = this.countTokens(compressed);
      strategiesApplied.push('smart_tool_truncation');
    }

    // Strategy 3: Intelligent summarization
    if (currentTokens > tokenLimit && this.config.summarization.minMessagesForSummarization <= compressed.length) {
      compressed = this.applyIntelligentSummarization(compressed, classified, keyInfo);
      currentTokens = this.countTokens(compressed);
      strategiesApplied.push('intelligent_summarization');
    }

    // Strategy 4: Importance-based removal
    if (currentTokens > tokenLimit) {
      compressed = this.removeByImportance(compressed, classified, tokenLimit);
      currentTokens = this.countTokens(compressed);
      strategiesApplied.push('importance_removal');
    }

    // Strategy 5: Hard truncation as last resort
    if (currentTokens > tokenLimit) {
      compressed = this.hardTruncate(compressed, tokenLimit);
      strategiesApplied.push('hard_truncation');
    }

    // Reconstruct with system message
    if (systemMsg) {
      compressed = [systemMsg, ...compressed];
    }

    return this.createResult(
      compressed,
      originalTokens,
      startTime,
      strategiesApplied,
      strategiesApplied[strategiesApplied.length - 1] || 'none',
      sessionId,
      keyInfo,
      archive
    );
  }

  /**
   * Apply sliding window with overlap for continuity.
   * Keeps a window of recent messages plus overlap from previous context.
   */
  private applySlidingWindowWithOverlap(
    messages: CodeBuddyMessage[],
    classified: Map<number, ClassifiedMessage>
  ): CodeBuddyMessage[] {
    const { windowSize, overlapSize, summarizeOldMessages } = this.config.slidingWindow;

    if (messages.length <= windowSize) {
      return messages;
    }

    // Find important messages to preserve beyond the window
    const importantOldMessages: CodeBuddyMessage[] = [];
    const oldMessageCount = messages.length - windowSize;

    for (let i = 0; i < oldMessageCount; i++) {
      const classInfo = classified.get(i);
      if (classInfo && classInfo.preserve) {
        importantOldMessages.push(messages[i]);
      }
    }

    // Get overlap messages (transition zone)
    const overlapStart = Math.max(0, messages.length - windowSize - overlapSize);
    const overlapMessages = messages.slice(overlapStart, messages.length - windowSize);

    // Get window messages (most recent)
    const windowMessages = messages.slice(-windowSize);

    // Create summary of old messages if enabled
    let result: CodeBuddyMessage[] = [];

    if (summarizeOldMessages && oldMessageCount > overlapSize) {
      const oldMessages = messages.slice(0, overlapStart);
      if (oldMessages.length > 0) {
        const summary = this.createContextSummary(oldMessages, classified);
        result.push({
          role: 'system',
          content: `[Context Summary - ${oldMessages.length} earlier messages]\n${summary}`,
        });
      }
    }

    // Add important old messages
    result = result.concat(importantOldMessages);

    // Add overlap for continuity
    if (overlapMessages.length > 0) {
      result.push({
        role: 'system',
        content: '[Transition context follows]',
      });
      result = result.concat(overlapMessages);
    }

    // Add recent window
    result = result.concat(windowMessages);

    return result;
  }

  /**
   * Smart truncation of tool results based on content type.
   * Preserves more information from error outputs and code.
   */
  private truncateToolResultsSmart(
    messages: CodeBuddyMessage[],
    classified: Map<number, ClassifiedMessage>
  ): CodeBuddyMessage[] {
    return messages.map((msg, index) => {
      if (msg.role !== 'tool' || typeof msg.content !== 'string') {
        return msg;
      }

      const classInfo = classified.get(index);
      const contentType = classInfo?.contentType || 'tool_result';
      const content = msg.content;

      // Determine max length based on content type
      let maxLength = this.config.maxToolOutputLength;
      if (contentType === 'error') {
        maxLength = Math.floor(maxLength * 1.5); // Keep more error context
      } else if (contentType === 'code') {
        maxLength = Math.floor(maxLength * 1.2); // Keep more code
      }

      if (content.length <= maxLength) {
        return msg;
      }

      // Smart truncation: keep beginning and end for context
      const keepStart = Math.floor(maxLength * 0.6);
      const keepEnd = Math.floor(maxLength * 0.3);

      const truncated = [
        content.slice(0, keepStart),
        '\n... [truncated ' + (content.length - keepStart - keepEnd) + ' chars] ...\n',
        content.slice(-keepEnd),
      ].join('');

      return {
        ...msg,
        content: truncated,
      };
    });
  }

  /**
   * Apply intelligent summarization that preserves key information.
   */
  private applyIntelligentSummarization(
    messages: CodeBuddyMessage[],
    classified: Map<number, ClassifiedMessage>,
    keyInfo: KeyInformation
  ): CodeBuddyMessage[] {
    const { maxSummaryTokens, preserveKeyEntities, preserveErrors, preserveDecisions } = this.config.summarization;
    const windowSize = this.config.slidingWindow.windowSize;

    // Split into messages to summarize and messages to keep
    const toSummarize = messages.slice(0, -windowSize);
    const toKeep = messages.slice(-windowSize);

    if (toSummarize.length === 0) {
      return messages;
    }

    // Build intelligent summary
    const summaryParts: string[] = [];

    // Add conversation flow summary
    const flowSummary = this.summarizeConversationFlow(toSummarize);
    summaryParts.push(`## Conversation Flow\n${flowSummary}`);

    // Preserve key entities if configured
    if (preserveKeyEntities) {
      const files = Array.from(new Set(keyInfo.modifiedFiles.map(f => f.path)));
      if (files.length > 0) {
        summaryParts.push(`## Files Modified\n${files.map(f => `- ${f}`).join('\n')}`);
      }
    }

    // Preserve errors if configured
    if (preserveErrors && keyInfo.errors.length > 0) {
      const errorSummary = keyInfo.errors
        .slice(-5) // Keep last 5 errors
        .map(e => `- ${e.message.slice(0, 200)}`)
        .join('\n');
      summaryParts.push(`## Recent Errors\n${errorSummary}`);
    }

    // Preserve decisions if configured
    if (preserveDecisions && keyInfo.decisions.length > 0) {
      const decisionSummary = keyInfo.decisions
        .slice(-5)
        .map(d => `- ${d.message.slice(0, 200)}`)
        .join('\n');
      summaryParts.push(`## Key Decisions\n${decisionSummary}`);
    }

    // Combine and limit summary
    let summary = summaryParts.join('\n\n');
    const summaryTokens = this.countTokens([{ role: 'system', content: summary }]);

    if (summaryTokens > maxSummaryTokens) {
      // Truncate summary to fit
      const ratio = maxSummaryTokens / summaryTokens;
      summary = summary.slice(0, Math.floor(summary.length * ratio)) + '\n[Summary truncated]';
    }

    const summaryMessage: CodeBuddyMessage = {
      role: 'system',
      content: `[Intelligent Summary of ${toSummarize.length} messages]\n${summary}`,
    };

    return [summaryMessage, ...toKeep];
  }

  /**
   * Remove messages by importance score when other strategies insufficient.
   */
  private removeByImportance(
    messages: CodeBuddyMessage[],
    classified: Map<number, ClassifiedMessage>,
    tokenLimit: number
  ): CodeBuddyMessage[] {
    // Sort messages by importance (preserve indices)
    const indexed = messages.map((msg, i) => ({
      msg,
      index: i,
      importance: classified.get(i)?.importance || 0.5,
    }));

    // Sort by importance descending, but keep relative order for same importance
    indexed.sort((a, b) => {
      if (b.importance !== a.importance) {
        return b.importance - a.importance;
      }
      return a.index - b.index;
    });

    // Keep messages until we exceed limit
    const kept: typeof indexed = [];
    let currentTokens = 0;

    for (const item of indexed) {
      const msgTokens = this.countTokens([item.msg]);
      if (currentTokens + msgTokens <= tokenLimit) {
        kept.push(item);
        currentTokens += msgTokens;
      }
    }

    // Restore original order
    kept.sort((a, b) => a.index - b.index);

    return kept.map(item => item.msg);
  }

  /**
   * Hard truncation as last resort - keeps most recent messages.
   */
  private hardTruncate(messages: CodeBuddyMessage[], tokenLimit: number): CodeBuddyMessage[] {
    const result: CodeBuddyMessage[] = [];
    let currentTokens = 0;

    // Process from most recent backwards
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = this.countTokens([messages[i]]);
      if (currentTokens + msgTokens <= tokenLimit) {
        result.unshift(messages[i]);
        currentTokens += msgTokens;
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * Classify all messages by content type and importance.
   */
  private classifyMessages(messages: CodeBuddyMessage[]): Map<number, ClassifiedMessage> {
    const result = new Map<number, ClassifiedMessage>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const contentType = this.detectContentType(msg);
      const importance = this.calculateImportance(msg, i, messages.length, contentType);
      const preserve = importance >= this.config.preservationThreshold ||
                       contentType === 'error' ||
                       contentType === 'decision' ||
                       msg.role === 'system';

      result.set(i, {
        message: msg,
        contentType,
        importance,
        preserve,
      });
    }

    return result;
  }

  /**
   * Detect the content type of a message.
   */
  private detectContentType(msg: CodeBuddyMessage): ContentType {
    if (msg.role === 'system') return 'system';
    if (msg.role === 'tool') return 'tool_result';

    const content = typeof msg.content === 'string' ? msg.content : '';

    // Check for each content type using patterns
    for (const [type, patterns] of Object.entries(CONTENT_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          return type as ContentType;
        }
      }
    }

    return 'conversation';
  }

  /**
   * Calculate importance score for a message.
   */
  private calculateImportance(
    msg: CodeBuddyMessage,
    index: number,
    totalMessages: number,
    contentType: ContentType
  ): number {
    let score = 0.5; // Base score

    // Recency factor (0-0.3)
    const recency = index / Math.max(1, totalMessages - 1);
    score += recency * 0.3;

    // Content type bonus
    const contentTypeBonus: Record<ContentType, number> = {
      system: 0.3,
      error: 0.25,
      decision: 0.2,
      code: 0.15,
      command: 0.1,
      file_content: 0.1,
      tool_result: 0.05,
      explanation: 0.05,
      conversation: 0,
    };
    score += contentTypeBonus[contentType] || 0;

    // Role bonus
    if (msg.role === 'user') score += 0.1;
    if (msg.role === 'system') score += 0.2;

    // Length penalty for very long messages (likely verbose output)
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.length > 5000) score -= 0.1;

    return Math.min(1, Math.max(0, score));
  }

  /**
   * Extract key information from messages.
   */
  private extractKeyInformation(messages: CodeBuddyMessage[]): KeyInformation {
    const keyInfo: KeyInformation = {
      decisions: [],
      errors: [],
      modifiedFiles: [],
      codeSnippets: [],
      toolCalls: [],
    };

    for (let index = 0; index < messages.length; index++) {
      const msg = messages[index];
      const content = typeof msg.content === 'string' ? msg.content : '';
      const now = new Date();

      // Extract file operations
      const fileOpMatches = Array.from(content.matchAll(KEY_INFO_PATTERNS.fileOperation));
      for (const match of fileOpMatches) {
        const path = match[2];
        const opText = match[0].toLowerCase();
        let operation: 'create' | 'edit' | 'delete' = 'edit';
        if (opText.includes('creat') || opText.includes('writ')) operation = 'create';
        if (opText.includes('delet')) operation = 'delete';
        keyInfo.modifiedFiles.push({ path, operation, index });
      }

      // Extract errors
      const errorMatches = Array.from(content.matchAll(KEY_INFO_PATTERNS.errorMessage));
      for (const match of errorMatches) {
        keyInfo.errors.push({
          message: match[1].trim(),
          timestamp: now,
          index,
        });
      }

      // Extract decisions
      const decisionMatches = Array.from(content.matchAll(KEY_INFO_PATTERNS.decision));
      for (const match of decisionMatches) {
        keyInfo.decisions.push({
          message: match[1].trim(),
          timestamp: now,
          index,
        });
      }

      // Extract tool calls from assistant messages
      if (msg.role === 'assistant' && 'tool_calls' in msg && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc.type === 'function') {
            keyInfo.toolCalls.push({
              name: tc.function.name,
              args: tc.function.arguments,
              index,
            });
          }
        }
      }

      // Extract code snippets
      const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
      const codeMatches = Array.from(content.matchAll(codeBlockRegex));
      for (const match of codeMatches) {
        keyInfo.codeSnippets.push({
          content: match[2].slice(0, 500), // Limit size
          language: match[1] || undefined,
          index,
        });
      }
    }

    return keyInfo;
  }

  /**
   * Create a summary of conversation flow.
   */
  private summarizeConversationFlow(messages: CodeBuddyMessage[]): string {
    const flows: string[] = [];
    let currentTopic = '';

    for (const msg of messages) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        // Extract first line as topic indicator
        const firstLine = msg.content.split('\n')[0].slice(0, 100);
        if (firstLine !== currentTopic) {
          currentTopic = firstLine;
          flows.push(`- User asked: ${firstLine}${msg.content.length > 100 ? '...' : ''}`);
        }
      } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
        // Summarize assistant response
        const words = msg.content.split(/\s+/).slice(0, 10).join(' ');
        if (words.length > 0) {
          flows.push(`  Assistant: ${words}...`);
        }
      }
    }

    // Limit to reasonable size
    return flows.slice(0, 20).join('\n');
  }

  /**
   * Create a context summary for old messages.
   */
  private createContextSummary(
    messages: CodeBuddyMessage[],
    _classified: Map<number, ClassifiedMessage>
  ): string {
    const parts: string[] = [];

    // Count message types
    const typeCounts: Record<string, number> = {};
    for (const msg of messages) {
      typeCounts[msg.role] = (typeCounts[msg.role] || 0) + 1;
    }

    parts.push(`Messages: ${messages.length} (${Object.entries(typeCounts).map(([k, v]) => `${k}: ${v}`).join(', ')})`);

    // Extract key topics
    const topics = new Set<string>();
    for (const msg of messages) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        const topic = msg.content.split('\n')[0].slice(0, 50);
        if (topic.length > 10) topics.add(topic);
      }
    }
    if (topics.size > 0) {
      parts.push(`Topics discussed: ${Array.from(topics).slice(0, 5).join('; ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Archive the full context before compression.
   */
  private archiveContext(
    messages: CodeBuddyMessage[],
    tokenCount: number,
    sessionId?: string
  ): ContextArchive {
    const archive: ContextArchive = {
      id: `archive-${++this.archiveIdCounter}-${Date.now()}`,
      timestamp: new Date(),
      messages: [...messages], // Deep copy would be better but this is simpler
      tokenCount,
      sessionId,
      reason: 'compression',
    };

    this.archives.push(archive);

    // Limit number of archives
    while (this.archives.length > this.config.maxArchives) {
      this.archives.shift();
    }

    logger.debug(`Context archived: ${archive.id} (${messages.length} messages, ${tokenCount} tokens)`);

    return archive;
  }

  /**
   * Recover full context from an archive.
   *
   * @param archiveId - The archive ID to recover, or undefined for most recent.
   * @returns The archived messages, or undefined if not found.
   */
  recoverContext(archiveId?: string): CodeBuddyMessage[] | undefined {
    if (!archiveId) {
      // Return most recent archive
      const latest = this.archives[this.archives.length - 1];
      return latest?.messages;
    }

    const archive = this.archives.find(a => a.id === archiveId);
    return archive?.messages;
  }

  /**
   * List available archives.
   */
  listArchives(): Array<{ id: string; timestamp: Date; messageCount: number; tokenCount: number }> {
    return this.archives.map(a => ({
      id: a.id,
      timestamp: a.timestamp,
      messageCount: a.messages.length,
      tokenCount: a.tokenCount,
    }));
  }

  /**
   * Clear all archives.
   */
  clearArchives(): void {
    this.archives = [];
    this.archiveIdCounter = 0;
  }

  /**
   * Get current configuration.
   */
  getConfig(): EnhancedCompressionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<EnhancedCompressionConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      slidingWindow: { ...this.config.slidingWindow, ...config.slidingWindow },
      summarization: { ...this.config.summarization, ...config.summarization },
    };
  }

  /**
   * Count tokens in messages.
   */
  private countTokens(messages: CodeBuddyMessage[]): number {
    const tokenMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : null,
      tool_calls: 'tool_calls' in msg ? msg.tool_calls : undefined,
    }));
    return this.tokenCounter.countMessageTokens(tokenMessages);
  }

  /**
   * Create the compression result object.
   */
  private createResult(
    messages: CodeBuddyMessage[],
    originalTokens: number,
    startTime: number,
    strategiesApplied: string[],
    strategy: string,
    sessionId?: string,
    keyInfo?: KeyInformation,
    archive?: ContextArchive
  ): EnhancedCompressionResult {
    const finalTokens = this.countTokens(messages);
    const compressionTimeMs = Date.now() - startTime;

    const metrics: CompressionMetrics = {
      originalTokens,
      finalTokens,
      compressionRatio: originalTokens / Math.max(1, finalTokens),
      messagesRemoved: 0, // Would need tracking
      messagesSummarized: strategiesApplied.includes('intelligent_summarization') ? 1 : 0,
      toolResultsTruncated: 0, // Would need tracking
      compressionTimeMs,
      estimatedRetention: finalTokens / originalTokens,
      strategiesApplied,
    };

    const preservedInfo: KeyInformation = keyInfo || {
      decisions: [],
      errors: [],
      modifiedFiles: [],
      codeSnippets: [],
      toolCalls: [],
    };

    return {
      compressed: originalTokens > finalTokens,
      messages,
      tokensReduced: originalTokens - finalTokens,
      strategy: strategy as CompressionResult['strategy'],
      qualityMetrics: {
        compressionRatio: metrics.compressionRatio,
        informationRetention: metrics.estimatedRetention,
        preservedImportanceAvg: 0.7, // Placeholder
        removedImportanceAvg: 0.3,
        highImportancePreserved: preservedInfo.decisions.length + preservedInfo.errors.length,
        highImportanceRemoved: 0,
        compressionTimeMs,
      },
      metrics,
      preservedInfo,
      fullContextArchive: archive,
    };
  }
}
