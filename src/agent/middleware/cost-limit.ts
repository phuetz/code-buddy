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
  private readonly warningRatio: number;

  constructor(deps: {
    isSessionCostLimitReached: () => boolean;
    warningRatio?: number;
  }) {
    this.isSessionCostLimitReached = deps.isSessionCostLimitReached;
    const ratio = deps.warningRatio;
    this.warningRatio = typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio <= 1
      ? ratio
      : 0.8;
  }

  afterTurn(context: MiddlewareContext): MiddlewareResult {
    if (this.isSessionCostLimitReached()) {
      return {
        action: 'stop',
        message: `Session cost limit reached ($${context.sessionCost.toFixed(2)} / $${context.sessionCostLimit.toFixed(2)}). Please start a new session.`,
      };
    }

    const warnThreshold = context.sessionCostLimit * this.warningRatio;
    if (context.sessionCost >= warnThreshold) {
      return {
        action: 'warn',
        message: `Session cost approaching limit ($${context.sessionCost.toFixed(2)} / $${context.sessionCostLimit.toFixed(2)}).`,
      };
    }

    return { action: 'continue' };
  }
}
