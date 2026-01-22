/**
 * Context Types
 * 
 * Type definitions for the context management system, including
 * configuration, statistics, and compression results.
 */

import { CodeBuddyMessage } from '../codebuddy/client.js';

/**
 * Configuration options for the ContextManager.
 * Controls how the conversation context is monitored and compressed.
 */
export interface ContextManagerConfig {
  /** Maximum number of tokens allowed in the context window. */
  maxContextTokens: number;
  /** Number of tokens to reserve for the model's response. */
  responseReserveTokens: number;
  /** Number of most recent messages to always keep during compression. */
  recentMessagesCount: number;
  /** Whether to enable automatic summarization of old messages. */
  enableSummarization: boolean;
  /** Target compression ratio when summarizing or truncating. */
  compressionRatio: number;
  /** The model identifier used for accurate token counting. */
  model: string;
  /** Threshold (in tokens) at which automatic compaction is triggered. */
  autoCompactThreshold: number;
  /** Percentage thresholds for triggering context warnings (e.g., [80, 95]). */
  warningThresholds: number[];
  /** Whether context usage warnings are enabled. */
  enableWarnings: boolean;
}

/**
 * Statistical overview of the current context usage.
 */
export interface ContextStats {
  /** Total number of tokens currently in the context. */
  totalTokens: number;
  /** The maximum token limit defined in the config. */
  maxTokens: number;
  /** Percentage of the context window currently used. */
  usagePercent: number;
  /** Total number of messages in the context. */
  messageCount: number;
  /** Number of sessions that have been summarized (if applicable). */
  summarizedSessions: number;
  /** Whether the usage is near the limit (usually > 80%). */
  isNearLimit: boolean;
  /** Whether the usage is critical (usually > 95%). */
  isCritical: boolean;
}

/**
 * Represents a summary of a portion of the conversation.
 */
export interface ConversationSummary {
  /** The textual summary of the messages. */
  content: string;
  /** Estimated token count of the summary. */
  tokenCount: number;
  /** Number of original messages replaced by this summary. */
  originalMessageCount: number;
  /** When the summary was generated. */
  timestamp: Date;
}

/**
 * Result of a context warning check.
 */
export interface ContextWarning {
  /** Whether a warning should be displayed. */
  warn: boolean;
  /** Severity level of the warning. */
  level?: 'warning' | 'critical';
  /** Human-readable warning message. */
  message?: string;
  /** The usage percentage that triggered the warning. */
  percentage?: number;
}

/**
 * Result of a context compression operation.
 */
export interface CompressionResult {
  /** Whether any compression was actually performed. */
  compressed: boolean;
  /** The new set of messages (possibly truncated or summarized). */
  messages: CodeBuddyMessage[];
  /** Number of tokens removed from the context. */
  tokensReduced: number;
  /** The primary strategy used for compression. */
  strategy: 'none' | 'sliding_window' | 'tool_truncation' | 'summarization' | 'hard_truncation' | 'importance_weighted';
  /** Quality metrics for the compression (if available). */
  qualityMetrics?: CompressionQualityMetrics;
}

/**
 * Importance score for a message in the conversation.
 * Used to determine which messages to preserve during compression.
 */
export interface MessageImportance {
  /** The message being scored. */
  message: CodeBuddyMessage;
  /** Index in the original message array. */
  index: number;
  /** Overall importance score (0-1, higher = more important). */
  score: number;
  /** Breakdown of individual importance factors. */
  factors: ImportanceFactors;
}

/**
 * Individual factors contributing to message importance.
 * Each factor is scored 0-1 and weighted to produce the final score.
 */
export interface ImportanceFactors {
  /** Recency factor: more recent messages score higher. */
  recency: number;
  /** Semantic relevance: messages related to current task/topic. */
  semanticRelevance: number;
  /** Structural importance: system prompts, key decisions, errors. */
  structuralImportance: number;
  /** Information density: ratio of unique/meaningful content. */
  informationDensity: number;
  /** Reference factor: messages referenced by later messages. */
  referenceScore: number;
}

/**
 * Weights for importance factors.
 * Can be tuned based on use case.
 */
export interface ImportanceWeights {
  recency: number;
  semanticRelevance: number;
  structuralImportance: number;
  informationDensity: number;
  referenceScore: number;
}

/**
 * Quality metrics to evaluate compression effectiveness.
 */
export interface CompressionQualityMetrics {
  /** Compression ratio achieved (original / compressed). */
  compressionRatio: number;
  /** Estimated information retention (0-1). */
  informationRetention: number;
  /** Average importance of preserved messages. */
  preservedImportanceAvg: number;
  /** Average importance of removed messages. */
  removedImportanceAvg: number;
  /** Number of high-importance messages preserved. */
  highImportancePreserved: number;
  /** Number of high-importance messages removed (ideally 0). */
  highImportanceRemoved: number;
  /** Time taken for compression in milliseconds. */
  compressionTimeMs: number;
}

/**
 * Configuration for intelligent summarization.
 */
export interface SummarizationConfig {
  /** Maximum tokens for the summary. */
  maxSummaryTokens: number;
  /** Whether to preserve key entities (file names, function names, etc.). */
  preserveKeyEntities: boolean;
  /** Whether to preserve error messages and stack traces. */
  preserveErrors: boolean;
  /** Whether to preserve user decisions and confirmations. */
  preserveDecisions: boolean;
  /** Minimum messages before summarization kicks in. */
  minMessagesForSummarization: number;
}

/**
 * Configuration for sliding window with overlap.
 */
export interface SlidingWindowConfig {
  /** Number of recent messages to always keep in full. */
  windowSize: number;
  /** Number of messages to overlap between windows for continuity. */
  overlapSize: number;
  /** Whether to create summaries for messages outside the window. */
  summarizeOldMessages: boolean;
}

/**
 * Key information extracted from messages for preservation.
 */
export interface KeyInformation {
  /** User decisions and confirmations. */
  decisions: Array<{ message: string; timestamp: Date; index: number }>;
  /** Error messages and stack traces. */
  errors: Array<{ message: string; timestamp: Date; index: number }>;
  /** Modified files with their paths. */
  modifiedFiles: Array<{ path: string; operation: 'create' | 'edit' | 'delete'; index: number }>;
  /** Important code snippets. */
  codeSnippets: Array<{ content: string; language?: string; index: number }>;
  /** Tool calls and their results. */
  toolCalls: Array<{ name: string; args: string; result?: string; index: number }>;
}

/**
 * Content type classification for messages.
 */
export type ContentType =
  | 'code'           // Code blocks or programming content
  | 'explanation'    // Explanations or descriptions
  | 'error'          // Error messages or stack traces
  | 'decision'       // User decisions or confirmations
  | 'tool_result'    // Tool execution results
  | 'file_content'   // File contents
  | 'command'        // Shell commands
  | 'conversation'   // General conversation
  | 'system';        // System instructions

/**
 * Message with content type classification.
 */
export interface ClassifiedMessage {
  /** Original message. */
  message: CodeBuddyMessage;
  /** Detected content type. */
  contentType: ContentType;
  /** Importance score (0-1). */
  importance: number;
  /** Whether this message should be preserved during compression. */
  preserve: boolean;
}

/**
 * Extended compression result with detailed metrics.
 */
export interface EnhancedCompressionResult extends CompressionResult {
  /** Detailed metrics about the compression. */
  metrics: CompressionMetrics;
  /** Key information that was preserved. */
  preservedInfo: KeyInformation;
  /** Archive of full context before compression. */
  fullContextArchive?: ContextArchive;
}

/**
 * Metrics for tracking compression effectiveness.
 */
export interface CompressionMetrics {
  /** Original token count before compression. */
  originalTokens: number;
  /** Final token count after compression. */
  finalTokens: number;
  /** Compression ratio (original / final). */
  compressionRatio: number;
  /** Number of messages removed. */
  messagesRemoved: number;
  /** Number of messages summarized. */
  messagesSummarized: number;
  /** Number of tool results truncated. */
  toolResultsTruncated: number;
  /** Time taken for compression in milliseconds. */
  compressionTimeMs: number;
  /** Estimated information retention (0-1). */
  estimatedRetention: number;
  /** Strategies applied during compression. */
  strategiesApplied: string[];
}

/**
 * Archive of full context for recovery.
 */
export interface ContextArchive {
  /** Unique archive identifier. */
  id: string;
  /** Timestamp when archived. */
  timestamp: Date;
  /** Full messages before compression. */
  messages: CodeBuddyMessage[];
  /** Token count at time of archival. */
  tokenCount: number;
  /** Session identifier. */
  sessionId?: string;
  /** Reason for archival. */
  reason: 'compression' | 'manual' | 'checkpoint';
}

