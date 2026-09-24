/**
 * Cost Limit Middleware
 *
 * Replaces inline `isSessionCostLimitReached()` checks in the agent executor.
 *
 * @module agent/middleware
 */

import { ConversationMiddleware, MiddlewareContext, MiddlewareResult } from './types.js';

function usableRatio(ratio: number | undefined): number {
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : 0.8;
}

export class CostLimitMiddleware implements ConversationMiddleware {
  readonly name = 'cost-limit';
  readonly priority = 20;

  private isSessionCostLimitReached: () => boolean;
  private readonly ratioSource: number | (() => number) | undefined;

  /** Une fonction est relue à chaque tour : l'agent peut changer de projet. */
  constructor(deps: {
    isSessionCostLimitReached: () => boolean;
    warningRatio?: number | (() => number);
  }) {
    this.isSessionCostLimitReached = deps.isSessionCostLimitReached;
    this.ratioSource = deps.warningRatio;
  }

  private get warningRatio(): number {
    return usableRatio(typeof this.ratioSource === 'function' ? this.ratioSource() : this.ratioSource);
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
