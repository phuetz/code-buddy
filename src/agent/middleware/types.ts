/**
 * Middleware Pipeline Types
 *
 * Defines the interfaces for composable middleware that intercepts
 * the agentic loop at before_turn and after_turn points.
 *
 * @module agent/middleware
 */

import { ChatEntry } from '../types.js';
import { CodeBuddyMessage } from '../../codebuddy/client.js';

/**
 * Action returned by a middleware to control loop execution.
 * - `continue`: Proceed to next middleware / next turn
 * - `stop`: Halt the agentic loop immediately
 * - `compact`: Trigger context compaction before next turn
 * - `warn`: Emit a warning but continue
 */
export type MiddlewareAction = 'continue' | 'stop' | 'compact' | 'warn';

/**
 * Result of a middleware execution.
 */
export interface MiddlewareResult {
  /** Action to take after this middleware */
  action: MiddlewareAction;
  /** Optional message to surface to the user (for warn/stop) */
  message?: string;
}

/**
 * Context passed to each middleware during execution.
 */
export interface MiddlewareContext {
  /** Current tool round number (0-indexed) */
  toolRound: number;
  /** Maximum allowed tool rounds */
  maxToolRounds: number;
  /** Current accumulated session cost in USD */
  sessionCost: number;
  /** Maximum allowed session cost in USD */
  sessionCostLimit: number;
  /** Current input token count */
  inputTokens: number;
  /** Current output token count */
  outputTokens: number;
  /** Chat history entries */
  history: ChatEntry[];
  /** LLM message array */
  messages: CodeBuddyMessage[];
  /** Whether this is a streaming execution */
  isStreaming: boolean;
  /** Abort controller for cancellation (streaming only) */
  abortController?: AbortController | null;
  /** Files changed during this session (for quality gates) */
  changedFiles?: string[];
  /** Recent tool execution results (for auto-repair) */
  lastToolResults?: Array<{ toolName: string; success: boolean; output: string }>;
}

/**
 * A composable middleware that intercepts the agentic loop.
 */
export interface ConversationMiddleware {
  /** Unique identifier for this middleware */
  readonly name: string;
  /** Priority for ordering (lower runs first, default: 100) */
  readonly priority?: number;
  /**
   * Called before each tool execution round.
   * Return `stop` to halt the loop, `compact` to trigger compaction,
   * `warn` to emit a warning, or `continue` to proceed.
   */
  beforeTurn?(context: MiddlewareContext): Promise<MiddlewareResult> | MiddlewareResult;
  /**
   * Called after each tool execution round completes.
   */
  afterTurn?(context: MiddlewareContext): Promise<MiddlewareResult> | MiddlewareResult;
}
