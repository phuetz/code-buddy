/**
 * Providers Module
 *
 * Multi-LLM provider abstraction with unified interface.
 * Re-exports all provider implementations and utilities.
 */

// Types
export type {
  ProviderType,
  LLMMessage,
  ToolCall,
  ToolDefinition,
  LLMResponse,
  StreamChunk,
  ProviderConfig,
  CompletionOptions,
  AnthropicResponse,
  AnthropicStreamEvent,
  ProviderFeature,
} from './types.js';

// Base provider
export { AIProvider, BaseProvider } from './base-provider.js';

// Legacy exports for backward compatibility
export { BaseProvider as BaseLLMProvider } from './base-provider.js';
export type { AIProvider as LLMProvider } from './base-provider.js';

// Individual providers
export { GrokProvider } from './grok-provider.js';
export { ClaudeProvider } from './claude-provider.js';
export { OpenAIProvider } from './openai-provider.js';
export { GeminiProvider } from './gemini-provider.js';

// Provider manager
export {
  ProviderManager,
  getProviderManager,
  resetProviderManager,
  autoConfigureProviders,
} from './provider-manager.js';

// Local LLM provider
export * from './local-llm-provider.js';

// Fallback chain
export {
  ProviderFallbackChain,
  getFallbackChain,
  resetFallbackChain,
} from './fallback-chain.js';
export type {
  FallbackConfig,
  ProviderHealth,
  FallbackChainEvents,
} from './fallback-chain.js';
