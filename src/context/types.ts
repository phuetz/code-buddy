import { CodeBuddyMessage } from '../codebuddy/client.js';

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
  /** Auto-compact threshold in tokens */
  autoCompactThreshold: number;
  /** Warning thresholds as percentages (e.g., [50, 75, 90]) */
  warningThresholds: number[];
  /** Enable context warnings */
  enableWarnings: boolean;
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

export interface ConversationSummary {
  content: string;
  tokenCount: number;
  originalMessageCount: number;
  timestamp: Date;
}

export interface ContextWarning {
  warn: boolean;
  level?: 'warning' | 'critical';
  message?: string;
  percentage?: number;
}

export interface CompressionResult {
  compressed: boolean;
  messages: CodeBuddyMessage[];
  tokensReduced: number;
  strategy: 'none' | 'sliding_window' | 'tool_truncation' | 'summarization' | 'hard_truncation';
}
