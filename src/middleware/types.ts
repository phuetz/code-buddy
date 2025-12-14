/**
 * Middleware Types
 *
 * Core types for the conversation middleware pipeline.
 * Inspired by Mistral Vibe's elegant middleware architecture.
 */

import type { GrokMessage } from '../grok/client.js';

// ============================================================================
// Middleware Actions
// ============================================================================

/**
 * Actions that middleware can return to control conversation flow
 */
export enum MiddlewareAction {
  /** Continue normal execution */
  CONTINUE = 'continue',
  /** Stop the conversation immediately */
  STOP = 'stop',
  /** Trigger context compaction */
  COMPACT = 'compact',
  /** Inject a message into the conversation */
  INJECT_MESSAGE = 'inject_message',
}

// ============================================================================
// Conversation Context
// ============================================================================

/**
 * Statistics about the current conversation
 */
export interface ConversationStats {
  /** Number of conversation turns (user + assistant pairs) */
  turns: number;
  /** Total tokens used in the conversation */
  totalTokens: number;
  /** Prompt tokens */
  promptTokens: number;
  /** Completion tokens */
  completionTokens: number;
  /** Session cost in USD */
  sessionCost: number;
  /** Number of tool calls executed */
  toolCalls: number;
  /** Number of successful tool executions */
  successfulToolCalls: number;
  /** Number of failed tool executions */
  failedToolCalls: number;
  /** Start time of the session */
  startTime: Date;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Model information for context calculations
 */
export interface ModelInfo {
  /** Model name/ID */
  name: string;
  /** Maximum context window in tokens */
  maxContextTokens: number;
  /** Price per million input tokens */
  inputPricePerMillion: number;
  /** Price per million output tokens */
  outputPricePerMillion: number;
}

/**
 * Context passed to middleware for decision making
 */
export interface ConversationContext {
  /** Current message history */
  messages: GrokMessage[];
  /** Conversation statistics */
  stats: ConversationStats;
  /** Model information */
  model: ModelInfo;
  /** Current working directory */
  workingDirectory: string;
  /** Session ID */
  sessionId: string;
  /** Whether auto-approve is enabled (YOLO mode) */
  autoApprove: boolean;
  /** Custom metadata */
  metadata: Record<string, unknown>;
}

// ============================================================================
// Middleware Result
// ============================================================================

/**
 * Result returned by middleware execution
 */
export interface MiddlewareResult {
  /** Action to take */
  action: MiddlewareAction;
  /** Optional message to inject or display */
  message?: string;
  /** Reason for the action (for logging) */
  reason?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Middleware Interface
// ============================================================================

/**
 * Base interface for conversation middleware
 */
export interface ConversationMiddleware {
  /** Unique name for this middleware */
  readonly name: string;

  /** Priority (lower = runs first) */
  readonly priority: number;

  /**
   * Called before each LLM turn
   * @param context Current conversation context
   * @returns Middleware result with action to take
   */
  beforeTurn(context: ConversationContext): Promise<MiddlewareResult>;

  /**
   * Called after each LLM turn completes
   * @param context Updated conversation context
   * @returns Middleware result with action to take
   */
  afterTurn(context: ConversationContext): Promise<MiddlewareResult>;

  /**
   * Reset middleware state (called on conversation reset)
   */
  reset(): void;
}

// ============================================================================
// Middleware Configuration
// ============================================================================

/**
 * Configuration for turn limit middleware
 */
export interface TurnLimitConfig {
  /** Maximum number of turns allowed */
  maxTurns: number;
  /** Warning threshold (percentage of max) */
  warningThreshold?: number;
}

/**
 * Configuration for price limit middleware
 */
export interface PriceLimitConfig {
  /** Maximum session cost in USD */
  maxCost: number;
  /** Warning threshold (percentage of max) */
  warningThreshold?: number;
}

/**
 * Configuration for auto-compact middleware
 */
export interface AutoCompactConfig {
  /** Token threshold to trigger compaction */
  tokenThreshold: number;
  /** Percentage of context to use before compacting */
  contextPercentage?: number;
  /** Minimum messages to keep after compaction */
  minMessagesToKeep?: number;
}

/**
 * Configuration for context warning middleware
 */
export interface ContextWarningConfig {
  /** Percentage of context usage to trigger warning */
  warningPercentage: number;
  /** Only warn once per session */
  warnOnce?: boolean;
}

/**
 * Combined middleware configuration
 */
export interface MiddlewareConfig {
  turnLimit?: TurnLimitConfig;
  priceLimit?: PriceLimitConfig;
  autoCompact?: AutoCompactConfig;
  contextWarning?: ContextWarningConfig;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a default "continue" result
 */
export function continueResult(): MiddlewareResult {
  return { action: MiddlewareAction.CONTINUE };
}

/**
 * Create a "stop" result with reason
 */
export function stopResult(reason: string, message?: string): MiddlewareResult {
  return {
    action: MiddlewareAction.STOP,
    reason,
    message,
  };
}

/**
 * Create a "compact" result
 */
export function compactResult(reason: string, metadata?: Record<string, unknown>): MiddlewareResult {
  return {
    action: MiddlewareAction.COMPACT,
    reason,
    metadata,
  };
}

/**
 * Create an "inject message" result
 */
export function injectMessageResult(message: string, reason?: string): MiddlewareResult {
  return {
    action: MiddlewareAction.INJECT_MESSAGE,
    message,
    reason,
  };
}

/**
 * Create initial conversation stats
 */
export function createInitialStats(): ConversationStats {
  return {
    turns: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    sessionCost: 0,
    toolCalls: 0,
    successfulToolCalls: 0,
    failedToolCalls: 0,
    startTime: new Date(),
    durationMs: 0,
  };
}

/**
 * Default model info (conservative estimates)
 */
export function defaultModelInfo(): ModelInfo {
  return {
    name: 'unknown',
    maxContextTokens: 128000,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.60,
  };
}
