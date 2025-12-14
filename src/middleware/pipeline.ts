/**
 * Middleware Pipeline
 *
 * Orchestrates middleware execution in priority order.
 * Inspired by Mistral Vibe's elegant middleware architecture.
 */

import {
  ConversationMiddleware,
  ConversationContext,
  MiddlewareResult,
  MiddlewareAction,
  continueResult,
} from './types.js';

// ============================================================================
// Pipeline Events
// ============================================================================

export type PipelineEventType =
  | 'middleware:before'
  | 'middleware:after'
  | 'middleware:action'
  | 'middleware:error'
  | 'pipeline:reset';

export interface PipelineEvent {
  type: PipelineEventType;
  middlewareName?: string;
  action?: MiddlewareAction;
  message?: string;
  error?: Error;
  timestamp: Date;
}

export type PipelineEventHandler = (event: PipelineEvent) => void;

// ============================================================================
// Middleware Pipeline
// ============================================================================

/**
 * Orchestrates middleware execution in priority order
 */
export class MiddlewarePipeline {
  private middlewares: ConversationMiddleware[] = [];
  private eventHandlers: PipelineEventHandler[] = [];
  private enabled = true;

  constructor(middlewares: ConversationMiddleware[] = []) {
    middlewares.forEach(m => this.add(m));
  }

  /**
   * Add middleware to the pipeline (maintains priority order)
   */
  add(middleware: ConversationMiddleware): this {
    this.middlewares.push(middleware);
    this.middlewares.sort((a, b) => a.priority - b.priority);
    return this;
  }

  /**
   * Remove middleware by name
   */
  remove(name: string): boolean {
    const index = this.middlewares.findIndex(m => m.name === name);
    if (index >= 0) {
      this.middlewares.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get middleware by name
   */
  get(name: string): ConversationMiddleware | undefined {
    return this.middlewares.find(m => m.name === name);
  }

  /**
   * Check if middleware exists
   */
  has(name: string): boolean {
    return this.middlewares.some(m => m.name === name);
  }

  /**
   * Get all middleware names in priority order
   */
  getNames(): string[] {
    return this.middlewares.map(m => m.name);
  }

  /**
   * Enable/disable the entire pipeline
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if pipeline is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Subscribe to pipeline events
   */
  on(handler: PipelineEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index >= 0) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: Omit<PipelineEvent, 'timestamp'>): void {
    const fullEvent: PipelineEvent = { ...event, timestamp: new Date() };
    this.eventHandlers.forEach(handler => {
      try {
        handler(fullEvent);
      } catch {
        // Ignore handler errors
      }
    });
  }

  /**
   * Run beforeTurn on all middlewares
   * Stops at first non-continue result
   */
  async runBefore(context: ConversationContext): Promise<MiddlewareResult> {
    if (!this.enabled) {
      return continueResult();
    }

    for (const middleware of this.middlewares) {
      try {
        this.emit({
          type: 'middleware:before',
          middlewareName: middleware.name,
        });

        const result = await middleware.beforeTurn(context);

        if (result.action !== MiddlewareAction.CONTINUE) {
          this.emit({
            type: 'middleware:action',
            middlewareName: middleware.name,
            action: result.action,
            message: result.message,
          });
          return result;
        }
      } catch (error) {
        this.emit({
          type: 'middleware:error',
          middlewareName: middleware.name,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        // Continue on error - don't let one middleware break the pipeline
      }
    }

    return continueResult();
  }

  /**
   * Run afterTurn on all middlewares
   * Stops at first non-continue result
   */
  async runAfter(context: ConversationContext): Promise<MiddlewareResult> {
    if (!this.enabled) {
      return continueResult();
    }

    for (const middleware of this.middlewares) {
      try {
        this.emit({
          type: 'middleware:after',
          middlewareName: middleware.name,
        });

        const result = await middleware.afterTurn(context);

        if (result.action !== MiddlewareAction.CONTINUE) {
          this.emit({
            type: 'middleware:action',
            middlewareName: middleware.name,
            action: result.action,
            message: result.message,
          });
          return result;
        }
      } catch (error) {
        this.emit({
          type: 'middleware:error',
          middlewareName: middleware.name,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        // Continue on error
      }
    }

    return continueResult();
  }

  /**
   * Reset all middlewares
   */
  reset(): void {
    this.middlewares.forEach(m => m.reset());
    this.emit({ type: 'pipeline:reset' });
  }

  /**
   * Clear all middlewares
   */
  clear(): void {
    this.middlewares = [];
  }

  /**
   * Get middleware count
   */
  get count(): number {
    return this.middlewares.length;
  }
}

// ============================================================================
// Pipeline Builder
// ============================================================================

/**
 * Fluent builder for creating middleware pipelines
 */
export class PipelineBuilder {
  private middlewares: ConversationMiddleware[] = [];

  /**
   * Add middleware to the pipeline
   */
  use(middleware: ConversationMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Add multiple middlewares
   */
  useAll(middlewares: ConversationMiddleware[]): this {
    middlewares.forEach(m => this.use(m));
    return this;
  }

  /**
   * Conditionally add middleware
   */
  useIf(condition: boolean, middleware: ConversationMiddleware): this {
    if (condition) {
      this.use(middleware);
    }
    return this;
  }

  /**
   * Build the pipeline
   */
  build(): MiddlewarePipeline {
    return new MiddlewarePipeline(this.middlewares);
  }
}

/**
 * Create a new pipeline builder
 */
export function createPipeline(): PipelineBuilder {
  return new PipelineBuilder();
}
