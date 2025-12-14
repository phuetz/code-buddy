/**
 * Middleware Module
 *
 * Conversation middleware system for grok-cli.
 * Provides turn limits, cost limits, auto-compaction, and more.
 */

// Types
export {
  MiddlewareAction,
  ConversationStats,
  ModelInfo,
  ConversationContext,
  MiddlewareResult,
  ConversationMiddleware,
  TurnLimitConfig,
  PriceLimitConfig,
  AutoCompactConfig,
  ContextWarningConfig,
  MiddlewareConfig,
  continueResult,
  stopResult,
  compactResult,
  injectMessageResult,
  createInitialStats,
  defaultModelInfo,
} from './types.js';

// Middleware implementations
export {
  TurnLimitMiddleware,
  PriceLimitMiddleware,
  AutoCompactMiddleware,
  ContextWarningMiddleware,
  RateLimitMiddleware,
  ToolExecutionLimitMiddleware,
  createDefaultMiddlewares,
  createYoloMiddlewares,
} from './middlewares.js';

// Pipeline
export {
  MiddlewarePipeline,
  PipelineBuilder,
  PipelineEvent,
  PipelineEventType,
  PipelineEventHandler,
  createPipeline,
} from './pipeline.js';
