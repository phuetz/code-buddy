/**
 * Turn Limit Middleware
 *
 * Replaces inline `toolRounds >= maxToolRounds` checks in the agent executor.
 *
 * @module agent/middleware
 */

import { ConversationMiddleware, MiddlewareContext, MiddlewareResult } from './types.js';

function usableRatio(ratio: number | undefined): number {
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : 0.8;
}

export class TurnLimitMiddleware implements ConversationMiddleware {
  readonly name = 'turn-limit';
  readonly priority = 10;
  private readonly ratioSource: number | (() => number) | undefined;

  /** Une fonction est relue à chaque tour : l'agent peut changer de projet. */
  constructor(options?: { warningRatio?: number | (() => number) }) {
    this.ratioSource = options?.warningRatio;
  }

  private get warningRatio(): number {
    return usableRatio(typeof this.ratioSource === 'function' ? this.ratioSource() : this.ratioSource);
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
