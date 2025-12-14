/**
 * Middleware Implementations
 *
 * Concrete middleware implementations for conversation control:
 * - TurnLimitMiddleware: Prevents conversations from exceeding turn limits
 * - PriceLimitMiddleware: Monitors and limits session costs
 * - AutoCompactMiddleware: Automatically compacts context when needed
 * - ContextWarningMiddleware: Warns when context is filling up
 */

import {
  ConversationMiddleware,
  ConversationContext,
  MiddlewareResult,
  TurnLimitConfig,
  PriceLimitConfig,
  AutoCompactConfig,
  ContextWarningConfig,
  continueResult,
  stopResult,
  compactResult,
  injectMessageResult,
} from './types.js';

// ============================================================================
// Turn Limit Middleware
// ============================================================================

/**
 * Prevents conversations from exceeding a maximum turn count
 */
export class TurnLimitMiddleware implements ConversationMiddleware {
  readonly name = 'turn-limit';
  readonly priority = 10;

  private config: Required<TurnLimitConfig>;
  private warningIssued = false;

  constructor(config: TurnLimitConfig) {
    this.config = {
      maxTurns: config.maxTurns,
      warningThreshold: config.warningThreshold ?? 0.8,
    };
  }

  async beforeTurn(context: ConversationContext): Promise<MiddlewareResult> {
    const { turns } = context.stats;
    const { maxTurns, warningThreshold } = this.config;

    // Check if we've exceeded the limit
    if (turns >= maxTurns) {
      return stopResult(
        `Turn limit reached (${turns}/${maxTurns})`,
        `Conversation stopped: Maximum turn limit of ${maxTurns} reached. Use /clear to start a new conversation.`
      );
    }

    // Issue warning if approaching limit
    const warningTurns = Math.floor(maxTurns * warningThreshold);
    if (turns >= warningTurns && !this.warningIssued) {
      this.warningIssued = true;
      return injectMessageResult(
        `Warning: Approaching turn limit (${turns}/${maxTurns}). Consider summarizing or starting a new conversation.`,
        'Turn limit warning'
      );
    }

    return continueResult();
  }

  async afterTurn(_context: ConversationContext): Promise<MiddlewareResult> {
    return continueResult();
  }

  reset(): void {
    this.warningIssued = false;
  }
}

// ============================================================================
// Price Limit Middleware
// ============================================================================

/**
 * Monitors and limits session costs
 */
export class PriceLimitMiddleware implements ConversationMiddleware {
  readonly name = 'price-limit';
  readonly priority = 20;

  private config: Required<PriceLimitConfig>;
  private warningIssued = false;

  constructor(config: PriceLimitConfig) {
    this.config = {
      maxCost: config.maxCost,
      warningThreshold: config.warningThreshold ?? 0.8,
    };
  }

  async beforeTurn(context: ConversationContext): Promise<MiddlewareResult> {
    const { sessionCost } = context.stats;
    const { maxCost, warningThreshold } = this.config;

    // Check if we've exceeded the cost limit
    if (sessionCost >= maxCost) {
      return stopResult(
        `Cost limit reached ($${sessionCost.toFixed(4)}/$${maxCost.toFixed(2)})`,
        `Conversation stopped: Session cost limit of $${maxCost.toFixed(2)} reached (current: $${sessionCost.toFixed(4)}). Use /clear to start a new session.`
      );
    }

    // Issue warning if approaching limit
    const warningCost = maxCost * warningThreshold;
    if (sessionCost >= warningCost && !this.warningIssued) {
      this.warningIssued = true;
      const remaining = maxCost - sessionCost;
      return injectMessageResult(
        `Warning: Session cost is $${sessionCost.toFixed(4)} of $${maxCost.toFixed(2)} limit. $${remaining.toFixed(4)} remaining.`,
        'Cost limit warning'
      );
    }

    return continueResult();
  }

  async afterTurn(context: ConversationContext): Promise<MiddlewareResult> {
    // Re-check after turn in case we went over
    const { sessionCost } = context.stats;
    const { maxCost } = this.config;

    if (sessionCost >= maxCost) {
      return stopResult(
        `Cost limit exceeded ($${sessionCost.toFixed(4)}/$${maxCost.toFixed(2)})`,
        `Session cost limit exceeded. Current session cost: $${sessionCost.toFixed(4)}`
      );
    }

    return continueResult();
  }

  reset(): void {
    this.warningIssued = false;
  }
}

// ============================================================================
// Auto Compact Middleware
// ============================================================================

/**
 * Automatically triggers context compaction when token usage is high
 */
export class AutoCompactMiddleware implements ConversationMiddleware {
  readonly name = 'auto-compact';
  readonly priority = 30;

  private config: Required<AutoCompactConfig>;
  private lastCompactTokens = 0;

  constructor(config: AutoCompactConfig) {
    this.config = {
      tokenThreshold: config.tokenThreshold,
      contextPercentage: config.contextPercentage ?? 0.75,
      minMessagesToKeep: config.minMessagesToKeep ?? 4,
    };
  }

  async beforeTurn(context: ConversationContext): Promise<MiddlewareResult> {
    const { totalTokens } = context.stats;
    const { maxContextTokens } = context.model;
    const { tokenThreshold, contextPercentage, minMessagesToKeep } = this.config;

    // Calculate effective threshold
    const effectiveThreshold = Math.min(
      tokenThreshold,
      Math.floor(maxContextTokens * contextPercentage)
    );

    // Check if we need to compact
    // Only compact if we've grown significantly since last compaction
    if (totalTokens >= effectiveThreshold && totalTokens > this.lastCompactTokens * 1.5) {
      // Don't compact if we have very few messages
      if (context.messages.length <= minMessagesToKeep) {
        return continueResult();
      }

      this.lastCompactTokens = totalTokens;

      return compactResult(
        `Token usage (${totalTokens}) exceeds threshold (${effectiveThreshold})`,
        {
          previousTokens: totalTokens,
          threshold: effectiveThreshold,
          messageCount: context.messages.length,
        }
      );
    }

    return continueResult();
  }

  async afterTurn(_context: ConversationContext): Promise<MiddlewareResult> {
    return continueResult();
  }

  reset(): void {
    this.lastCompactTokens = 0;
  }
}

// ============================================================================
// Context Warning Middleware
// ============================================================================

/**
 * Issues a warning when context usage reaches a threshold
 */
export class ContextWarningMiddleware implements ConversationMiddleware {
  readonly name = 'context-warning';
  readonly priority = 40;

  private config: Required<ContextWarningConfig>;
  private warningIssued = false;

  constructor(config: ContextWarningConfig) {
    this.config = {
      warningPercentage: config.warningPercentage,
      warnOnce: config.warnOnce ?? true,
    };
  }

  async beforeTurn(context: ConversationContext): Promise<MiddlewareResult> {
    const { totalTokens } = context.stats;
    const { maxContextTokens } = context.model;
    const { warningPercentage, warnOnce } = this.config;

    // Skip if already warned and warnOnce is enabled
    if (warnOnce && this.warningIssued) {
      return continueResult();
    }

    const usagePercentage = (totalTokens / maxContextTokens) * 100;
    const threshold = warningPercentage * 100;

    if (usagePercentage >= threshold) {
      this.warningIssued = true;

      const formattedUsage = usagePercentage.toFixed(1);
      const formattedTokens = totalTokens.toLocaleString();
      const formattedMax = maxContextTokens.toLocaleString();

      return injectMessageResult(
        `Context usage: ${formattedUsage}% (${formattedTokens}/${formattedMax} tokens). Consider using /compact or /clear to free up space.`,
        'Context usage warning'
      );
    }

    return continueResult();
  }

  async afterTurn(_context: ConversationContext): Promise<MiddlewareResult> {
    return continueResult();
  }

  reset(): void {
    this.warningIssued = false;
  }
}

// ============================================================================
// Rate Limit Middleware
// ============================================================================

/**
 * Prevents rapid-fire requests (optional rate limiting)
 */
export class RateLimitMiddleware implements ConversationMiddleware {
  readonly name = 'rate-limit';
  readonly priority = 5;

  private lastRequestTime = 0;
  private minIntervalMs: number;

  constructor(minIntervalMs: number = 500) {
    this.minIntervalMs = minIntervalMs;
  }

  async beforeTurn(_context: ConversationContext): Promise<MiddlewareResult> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < this.minIntervalMs && this.lastRequestTime > 0) {
      // Wait for the remaining time
      await new Promise(resolve => setTimeout(resolve, this.minIntervalMs - elapsed));
    }

    this.lastRequestTime = Date.now();
    return continueResult();
  }

  async afterTurn(_context: ConversationContext): Promise<MiddlewareResult> {
    return continueResult();
  }

  reset(): void {
    this.lastRequestTime = 0;
  }
}

// ============================================================================
// Tool Execution Limit Middleware
// ============================================================================

/**
 * Limits the number of tool executions per turn
 */
export class ToolExecutionLimitMiddleware implements ConversationMiddleware {
  readonly name = 'tool-execution-limit';
  readonly priority = 15;

  private maxToolCallsPerTurn: number;
  private currentTurnToolCalls = 0;

  constructor(maxToolCallsPerTurn: number = 20) {
    this.maxToolCallsPerTurn = maxToolCallsPerTurn;
  }

  async beforeTurn(_context: ConversationContext): Promise<MiddlewareResult> {
    // Reset counter at start of turn
    this.currentTurnToolCalls = 0;
    return continueResult();
  }

  async afterTurn(_context: ConversationContext): Promise<MiddlewareResult> {
    // Check if we've exceeded tool calls this turn
    // This would need integration with tool executor to track per-turn calls
    return continueResult();
  }

  /**
   * Called by tool executor before each tool call
   */
  checkToolCall(): boolean {
    this.currentTurnToolCalls++;
    return this.currentTurnToolCalls <= this.maxToolCallsPerTurn;
  }

  reset(): void {
    this.currentTurnToolCalls = 0;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create default middleware stack
 */
export function createDefaultMiddlewares(options?: {
  maxTurns?: number;
  maxCost?: number;
  autoCompactThreshold?: number;
  contextWarningPercentage?: number;
}): ConversationMiddleware[] {
  const middlewares: ConversationMiddleware[] = [];

  // Turn limit (default: 100 turns)
  middlewares.push(new TurnLimitMiddleware({
    maxTurns: options?.maxTurns ?? 100,
    warningThreshold: 0.8,
  }));

  // Price limit (default: $10)
  middlewares.push(new PriceLimitMiddleware({
    maxCost: options?.maxCost ?? 10,
    warningThreshold: 0.8,
  }));

  // Auto-compact (default: 80k tokens)
  middlewares.push(new AutoCompactMiddleware({
    tokenThreshold: options?.autoCompactThreshold ?? 80000,
    contextPercentage: 0.75,
    minMessagesToKeep: 4,
  }));

  // Context warning (default: 70%)
  middlewares.push(new ContextWarningMiddleware({
    warningPercentage: options?.contextWarningPercentage ?? 0.70,
    warnOnce: true,
  }));

  return middlewares;
}

/**
 * Create YOLO mode middleware stack (relaxed limits)
 */
export function createYoloMiddlewares(options?: {
  maxTurns?: number;
  maxCost?: number;
}): ConversationMiddleware[] {
  const middlewares: ConversationMiddleware[] = [];

  // Higher turn limit for YOLO
  middlewares.push(new TurnLimitMiddleware({
    maxTurns: options?.maxTurns ?? 500,
    warningThreshold: 0.9,
  }));

  // Higher cost limit for YOLO
  middlewares.push(new PriceLimitMiddleware({
    maxCost: options?.maxCost ?? 50,
    warningThreshold: 0.9,
  }));

  // Auto-compact with higher threshold
  middlewares.push(new AutoCompactMiddleware({
    tokenThreshold: 100000,
    contextPercentage: 0.85,
    minMessagesToKeep: 2,
  }));

  return middlewares;
}
