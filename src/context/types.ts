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
  strategy: 'none' | 'sliding_window' | 'tool_truncation' | 'summarization' | 'hard_truncation';
}

