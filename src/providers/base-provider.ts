/**
 * Base Provider
 *
 * Abstract base class and interface for AI providers.
 * Defines the contract that all LLM providers (Grok, Claude, OpenAI, etc.) must fulfill.
 *
 * Note: This is Code Buddy's own BaseProvider rather than extending the shared
 * @phuetz/ai-providers BaseProvider directly, because Code Buddy uses
 * LLMMessage.content: string (not string | null) and needs `complete()` as
 * a public abstract method. The shared package's types, retry, and circuit
 * breaker utilities are consumed via types.ts and retry.ts.
 */

import { EventEmitter } from 'events';
import type {
  ProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  StreamChunk,
  ProviderFeature,
  LLMMessage,
} from './types.js';
import {
  measureLatency,
  getStreamingOptimizer,
} from '../optimization/latency-optimizer.js';

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Interface representing a generic AI Provider.
 * This interface abstracts away the differences between various LLM APIs
 * (e.g., Anthropic, OpenAI, XAI) providing a unified way to interact with them.
 */
export interface AIProvider {
  /** The unique identifier for the provider type (e.g., 'grok', 'claude'). */
  readonly type: ProviderType;
  /** The display name of the provider. */
  readonly name: string;
  /** The default model ID used by this provider if none is specified. */
  readonly defaultModel: string;

  /**
   * Initializes the provider with the necessary configuration.
   * This typically involves setting API keys and validating basic settings.
   *
   * @param config - The configuration object containing API keys, model preferences, etc.
   * @returns A promise that resolves when initialization is complete.
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Checks if the provider is fully initialized and ready to accept requests.
   *
   * @returns `true` if the provider is ready, `false` otherwise.
   */
  isReady(): boolean;

  /**
   * Sends a chat completion request to the provider (non-streaming).
   *
   * @param options - The options for the completion request (messages, tools, etc.).
   * @returns A promise resolving to the standardized LLM response.
   */
  chat(options: CompletionOptions): Promise<LLMResponse>;

  /**
   * Legacy alias for `chat`.
   * @deprecated Use `chat` instead.
   */
  complete(options: CompletionOptions): Promise<LLMResponse>;

  /**
   * Sends a chat completion request and returns a stream of chunks.
   * Useful for real-time UIs where the response is displayed as it generates.
   *
   * @param options - The options for the completion request.
   * @returns An async iterable of `StreamChunk` objects.
   */
  stream(options: CompletionOptions): AsyncIterable<StreamChunk>;

  /**
   * Retrieves the list of available models for this provider.
   *
   * @returns A promise resolving to an array of model ID strings.
   */
  getModels(): Promise<string[]>;

  /**
   * Checks if the provider supports a specific feature.
   *
   * @param feature - The feature to check (e.g., 'streaming', 'tools', 'vision').
   * @returns `true` if the feature is supported, `false` otherwise.
   */
  supports(feature: ProviderFeature): boolean;

  /**
   * Estimates the number of tokens in a text string or list of messages.
   * Used for context window management.
   *
   * @param content - The text or messages to estimate.
   * @returns The estimated number of tokens.
   */
  estimateTokens(content: string | LLMMessage[]): number;

  /**
   * Gets the pricing configuration for the current model.
   *
   * @returns An object containing input and output costs per 1k tokens (or similar unit).
   */
  getPricing(): { input: number; output: number };

  /**
   * Cleans up resources, clears listeners, and resets the provider state.
   */
  dispose(): void;
}

// ============================================================================
// Base Provider Implementation
// ============================================================================

/**
 * Abstract base class that implements common functionality for AI providers.
 * Concrete provider implementations should extend this class.
 */
export abstract class BaseProvider extends EventEmitter implements AIProvider {
  abstract readonly type: ProviderType;
  abstract readonly name: string;
  abstract readonly defaultModel: string;

  protected config: ProviderConfig | null = null;
  protected ready = false;

  /**
   * Initializes the provider.
   * Validates configuration and emits a 'ready' event upon success.
   */
  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    await this.validateConfig();
    this.ready = true;
    this.emit('ready');
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Validates the provided configuration.
   * Throws an error if required fields (like apiKey) are missing.
   * Can be overridden by subclasses for specific validation logic.
   */
  protected async validateConfig(): Promise<void> {
    if (!this.config?.apiKey) {
      // Local providers might not need API key
      if (this.type !== 'ollama' && this.type !== 'lm-studio') {
        throw new Error(`${this.name} API key is required`);
      }
    }
  }

  /**
   * Standard chat completion method.
   * Delegates to the abstract `complete` method which must be implemented by subclasses.
   * Wrapped with latency measurement for performance tracking.
   */
  async chat(options: CompletionOptions): Promise<LLMResponse> {
    // Determine if this is a simple or complex response based on message count
    const operationType = (options.messages?.length || 0) > 3 ? 'complex_response' : 'simple_response';
    return measureLatency(operationType, () => this.complete(options));
  }

  /**
   * Abstract method to perform the actual completion request.
   * Must be implemented by concrete providers.
   */
  abstract complete(options: CompletionOptions): Promise<LLMResponse>;

  /**
   * Abstract method to perform streaming completion.
   * Must be implemented by concrete providers.
   */
  abstract stream(options: CompletionOptions): AsyncIterable<StreamChunk>;

  /**
   * Wraps a stream with latency tracking for first-token and total time.
   * Use this in provider implementations to get streaming metrics.
   */
  protected async *trackStreamLatency(
    streamIterable: AsyncIterable<StreamChunk>
  ): AsyncIterable<StreamChunk> {
    const streamingOptimizer = getStreamingOptimizer();
    const startTime = Date.now();
    let firstChunkTime: number | null = null;

    for await (const chunk of streamIterable) {
      if (firstChunkTime === null) {
        firstChunkTime = Date.now() - startTime;
        streamingOptimizer.recordFirstToken(firstChunkTime);
      }
      yield chunk;
    }

    const totalTime = Date.now() - startTime;
    streamingOptimizer.recordTotalTime(totalTime);
  }

  async getModels(): Promise<string[]> {
    return [this.defaultModel];
  }

  supports(feature: ProviderFeature): boolean {
    // Default support for most features, override in specific providers
    switch (feature) {
      case 'streaming':
        return true;
      case 'tools':
      case 'function_calling':
        return true; // Most modern LLMs support tools
      case 'vision':
        return false; // Default to false
      case 'json_mode':
        return false;
      default:
        return false;
    }
  }

  estimateTokens(content: string | LLMMessage[]): number {
    const text = typeof content === 'string'
      ? content
      : content.map(m => m.content).join(' ');

    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  abstract getPricing(): { input: number; output: number };

  dispose(): void {
    this.ready = false;
    this.config = null;
    this.removeAllListeners();
  }
}
