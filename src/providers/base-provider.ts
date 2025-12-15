/**
 * Base Provider
 *
 * Abstract base class and interface for LLM providers.
 */

import { EventEmitter } from 'events';
import type {
  ProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  StreamChunk,
} from './types.js';

// ============================================================================
// Provider Interface
// ============================================================================

export interface LLMProvider {
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
   * Get completion (non-streaming)
   */
  complete(options: CompletionOptions): Promise<LLMResponse>;

  /**
   * Get streaming completion
   */
  stream(options: CompletionOptions): AsyncIterable<StreamChunk>;

  /**
   * Get available models
   */
  getModels(): Promise<string[]>;

  /**
   * Estimate token count for text
   */
  estimateTokens(text: string): number;

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

export abstract class BaseLLMProvider extends EventEmitter implements LLMProvider {
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
      throw new Error(`${this.name} API key is required`);
    }
  }

  abstract complete(options: CompletionOptions): Promise<LLMResponse>;
  abstract stream(options: CompletionOptions): AsyncIterable<StreamChunk>;

  async getModels(): Promise<string[]> {
    return [this.defaultModel];
  }

  estimateTokens(text: string): number {
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
