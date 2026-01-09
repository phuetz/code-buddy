/**
 * Base Provider
 *
 * Abstract base class and interface for AI providers.
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

// ============================================================================
// Provider Interface
// ============================================================================

export interface AIProvider {
  readonly type: ProviderType;
  readonly name: string;
  readonly defaultModel: string;

  /**
   * Initialize the provider
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Check if provider is ready
   */
  isReady(): boolean;

  /**
   * Chat completion (non-streaming)
   */
  chat(options: CompletionOptions): Promise<LLMResponse>;

  /**
   * Complete (alias for chat, legacy support)
   */
  complete(options: CompletionOptions): Promise<LLMResponse>;

  /**
   * Stream chat completion
   */
  stream(options: CompletionOptions): AsyncIterable<StreamChunk>;

  /**
   * Get available models
   */
  getModels(): Promise<string[]>;

  /**
   * Check if provider supports a feature
   */
  supports(feature: ProviderFeature): boolean;

  /**
   * Estimate token count for text or messages
   */
  estimateTokens(content: string | LLMMessage[]): number;

  /**
   * Get pricing info
   */
  getPricing(): { input: number; output: number };

  /**
   * Dispose resources
   */
  dispose(): void;
}

// ============================================================================
// Base Provider Implementation
// ============================================================================

export abstract class BaseProvider extends EventEmitter implements AIProvider {
  abstract readonly type: ProviderType;
  abstract readonly name: string;
  abstract readonly defaultModel: string;

  protected config: ProviderConfig | null = null;
  protected ready = false;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    await this.validateConfig();
    this.ready = true;
    this.emit('ready');
  }

  isReady(): boolean {
    return this.ready;
  }

  protected async validateConfig(): Promise<void> {
    if (!this.config?.apiKey) {
      // Local providers might not need API key
      if (this.type !== 'ollama' && this.type !== 'lm-studio') {
        throw new Error(`${this.name} API key is required`);
      }
    }
  }

  /**
   * Chat completion - implements the AIProvider interface
   * Delegates to abstract complete() method for backward compatibility
   */
  async chat(options: CompletionOptions): Promise<LLMResponse> {
    return this.complete(options);
  }

  // Abstract method for specific implementation
  abstract complete(options: CompletionOptions): Promise<LLMResponse>;
  abstract stream(options: CompletionOptions): AsyncIterable<StreamChunk>;

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