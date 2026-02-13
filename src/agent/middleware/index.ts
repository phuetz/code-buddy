/**
 * Middleware Module
 *
 * Composable middleware pipeline for the agentic loop.
 *
 * @module agent/middleware
 */

export type {
  ConversationMiddleware,
  MiddlewareContext,
  MiddlewareResult,
  MiddlewareAction,
} from './types.js';

export { MiddlewarePipeline } from './pipeline.js';
export { TurnLimitMiddleware } from './turn-limit.js';
export { CostLimitMiddleware } from './cost-limit.js';
export { ContextWarningMiddleware } from './context-warning.js';
export { AutoObservationMiddleware } from './auto-observation.js';
export type { AutoObservationConfig } from './auto-observation.js';
