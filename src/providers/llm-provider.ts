/**
 * Multi-LLM Provider Abstraction
 *
 * Unified interface for multiple LLM providers:
 * - Grok (xAI) - Default
 * - Claude (Anthropic)
 * - GPT (OpenAI)
 * - Gemini (Google)
 *
 * Inspired by VibeKit's multi-provider support.
 *
 * NOTE: This file re-exports from modular files for backwards compatibility.
 * New code should import directly from './types.js', './base-provider.js', etc.
 */

// Re-export all types
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
} from './types.js';

// Re-export base provider
export { LLMProvider, BaseLLMProvider } from './base-provider.js';

// Re-export individual providers
export { GrokProvider } from './grok-provider.js';
export { ClaudeProvider } from './claude-provider.js';
export { OpenAIProvider } from './openai-provider.js';
export { GeminiProvider } from './gemini-provider.js';

// Re-export provider manager
export {
  ProviderManager,
  getProviderManager,
  resetProviderManager,
  autoConfigureProviders,
} from './provider-manager.js';
