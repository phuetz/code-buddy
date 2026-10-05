/**
 * @phuetz/ai-providers
 *
 * Shared multi-provider LLM abstraction layer.
 * Used by Code Buddy (CLI agent) and Lisa (AI companion).
 *
 * @example
 * ```ts
 * import { BaseProvider, retry, RetryStrategies, type LLMMessage } from '@phuetz/ai-providers';
 * ```
 */

// Types
export type {
  ProviderType,
  ProviderFeature,
  LLMMessage,
  ToolCall,
  ToolDefinition,
  ToolWrapper,
  ToolResult,
  JSONSchema,
  LLMResponse,
  FinishReason,
  TokenUsage,
  StreamChunk,
  ProviderConfig,
  CompletionOptions,
  ModelCapabilities,
  ProviderPricing,
  ErrorCategory,
  ConnectionState,
} from './types.js';

// Base provider
export { BaseProvider } from './base-provider.js';
export type { AIProvider } from './base-provider.js';

// Retry
export {
  retry,
  retryWithResult,
  RetryStrategies,
  RetryPredicates,
} from './retry.js';
export type { RetryOptions, RetryResult } from './retry.js';

// Circuit breaker
export {
  CircuitBreaker,
  CircuitBreakerError,
  getCircuitBreaker,
  resetAllCircuitBreakers,
} from './circuit-breaker.js';
export type {
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerStats,
} from './circuit-breaker.js';

// Tool format converters
export {
  toOpenAITools,
  toGeminiTools,
  toClaudeTools,
  parseOpenAIToolCalls,
  parseGeminiToolCalls,
  parseClaudeToolCalls,
  toOpenAIToolResult,
  toGeminiFunctionResponse,
  toClaudeToolResult,
  parseToolArguments,
  hasToolCalls,
} from './tool-format.js';
export type {
  GeminiFunctionDeclaration,
  ClaudeTool,
} from './tool-format.js';

// Anthropic message conversion (OpenAI-style → Messages API)
export {
  toAnthropicMessages,
  isValidAnthropicMessageOrder,
} from './anthropic-messages.js';
export type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicFormatted,
  OpenAiStyleMessage,
} from './anthropic-messages.js';

