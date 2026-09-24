/**
 * Turn Limit Middleware
 *
 * Replaces inline `toolRounds >= maxToolRounds` checks in the agent executor.
 *
 * @module agent/middleware
 */

import { ConversationMiddleware, MiddlewareContext, MiddlewareResult } from './types.js';

export class TurnLimitMiddleware implements ConversationMiddleware {
  readonly name = 'turn-limit';
  readonly priority = 10;
  private readonly warningRatio: number;

  constructor(options?: { warningRatio?: number }) {
    const ratio = options?.warningRatio;
    this.warningRatio = typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio <= 1
      ? ratio
      : 0.8;
  }

  beforeTurn(context: MiddlewareContext): MiddlewareResult {
    if (context.toolRound >= context.maxToolRounds) {
      return {
        action: 'stop',
        message: 'Maximum tool execution rounds reached. Stopping to prevent infinite loops.',
      };
    }

    const threshold = Math.floor(context.maxToolRounds * this.warningRatio);
    if (context.toolRound === threshold) {
      return {
        action: 'warn',
        message: `Approaching tool round limit (${context.toolRound}/${context.maxToolRounds}).`,
      };
    }

    return { action: 'continue' };
  }
}
