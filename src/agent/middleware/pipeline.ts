/**
 * Middleware Pipeline
 *
 * Executes a sequence of ConversationMiddleware instances in priority order.
 * Short-circuits on 'stop' or 'compact' actions.
 *
 * @module agent/middleware
 */

import {
  ConversationMiddleware,
  MiddlewareContext,
  MiddlewareResult,
  MiddlewareAction,
} from './types.js';
import { logger } from '../../utils/logger.js';

/**
 * Manages and executes a pipeline of conversation middlewares.
 */
export class MiddlewarePipeline {
  private middlewares: ConversationMiddleware[] = [];

  /**
   * Register a middleware in the pipeline.
   * Middlewares are kept sorted by priority (lower first).
   */
  use(middleware: ConversationMiddleware): this {
    this.middlewares.push(middleware);
    this.middlewares.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    return this;
  }

  /**
   * Remove a middleware by name.
   */
  remove(name: string): boolean {
    const idx = this.middlewares.findIndex(m => m.name === name);
    if (idx !== -1) {
      this.middlewares.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Run all before_turn middlewares in priority order.
   * Short-circuits on 'stop' or 'compact'.
   */
  async runBeforeTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    return this.runPhase('beforeTurn', context);
  }

  /**
   * Run all after_turn middlewares in priority order.
   * Short-circuits on 'stop' or 'compact'.
   */
  async runAfterTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    return this.runPhase('afterTurn', context);
  }

  hasCompletionHandlers(): boolean {
    return this.middlewares.some(m => typeof m.beforeComplete === 'function');
  }

  async runBeforeComplete(context: MiddlewareContext): Promise<MiddlewareResult> {
    return this.runPhase('beforeComplete', context);
  }

  /**
   * Get list of registered middleware names.
   */
  getMiddlewareNames(): string[] {
    return this.middlewares.map(m => m.name);
  }

  /**
   * Reset every middleware's per-task latching state. The pipeline is built once
   * and reused for every user message, but per-task counters (quality-gate run
   * count, auto-repair attempts) and one-shot warnings (verification "verify
   * before finishing") would otherwise persist for the process lifetime while
   * context.toolRound restarts at 0 each task — silently suppressing the gates
   * on later tasks. Call this at the start of every new task. Never throws.
   */
  resetForNewTask(): void {
    for (const middleware of this.middlewares) {
      try {
        middleware.reset?.();
      } catch (error) {
        logger.error(`Middleware "${middleware.name}" threw in reset`, error as Error);
      }
    }
  }

  private async runPhase(
    phase: 'beforeTurn' | 'afterTurn' | 'beforeComplete',
    context: MiddlewareContext
  ): Promise<MiddlewareResult> {
    const warnings: string[] = [];

    for (const middleware of this.middlewares) {
      const handler = middleware[phase];
      if (!handler) continue;

      try {
        const result = await handler.call(middleware, context);

        if (result.action === 'stop' || result.action === 'compact') {
          logger.debug(`Middleware "${middleware.name}" returned ${result.action} in ${phase}`);
          return result;
        }

        if (result.action === 'warn' && result.message) {
          warnings.push(result.message);
        }
      } catch (error) {
        logger.error(`Middleware "${middleware.name}" threw in ${phase}`, error as Error);
        if (phase === 'beforeComplete') {
          return { action: 'stop', message: `Completion hook "${middleware.name}" failed.` };
        }
        // Don't let a failing middleware break the loop
      }
    }

    // If we collected warnings, return the last one as a warn action
    if (warnings.length > 0) {
      return { action: 'warn', message: warnings.join('\n') };
    }

    return { action: 'continue' };
  }
}
