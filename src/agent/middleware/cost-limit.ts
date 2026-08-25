/**
 * Cost Limit Middleware
 *
 * Replaces inline `isSessionCostLimitReached()` checks in the agent executor.
 *
 * @module agent/middleware
 */

import { ConversationMiddleware, MiddlewareContext, MiddlewareResult } from './types.js';

export class CostLimitMiddleware implements ConversationMiddleware {
  readonly name = 'cost-limit';
  readonly priority = 20;

  private isSessionCostLimitReached: () => boolean;

  constructor(deps: {
    isSessionCostLimitReached: () => boolean;
  }) {
    this.isSessionCostLimitReached = deps.isSessionCostLimitReached;
  }

  afterTurn(context: MiddlewareContext): MiddlewareResult {
    if (this.isSessionCostLimitReached()) {
      return {
        action: 'stop',
        message: `Session cost limit reached ($${context.sessionCost.toFixed(2)} / $${context.sessionCostLimit.toFixed(2)}). Please start a new session.`,
      };
    }

    // Warn at 80% of cost limit
    const warnThreshold = context.sessionCostLimit * 0.8;
    if (context.sessionCost >= warnThreshold) {
      return {
        action: 'warn',
        message: `Session cost approaching limit ($${context.sessionCost.toFixed(2)} / $${context.sessionCostLimit.toFixed(2)}).`,
      };
    }

    return { action: 'continue' };
  }
}
