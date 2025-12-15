/**
 * Provider Manager
 *
 * Central manager for multi-LLM provider orchestration.
 * Handles provider registration, selection, and routing.
 */

import { EventEmitter } from 'events';
import type { LLMProvider } from './base-provider.js';
import type {
  ProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  StreamChunk,
} from './types.js';
import { GrokProvider } from './grok-provider.js';
import { ClaudeProvider } from './claude-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { GeminiProvider } from './gemini-provider.js';

// ============================================================================
// Provider Manager
// ============================================================================

export class ProviderManager extends EventEmitter {
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private activeProvider: ProviderType = 'grok';
  private configs: Map<ProviderType, ProviderConfig> = new Map();

  /**
   * Register a provider
   */
  async registerProvider(type: ProviderType, config: ProviderConfig): Promise<void> {
    this.configs.set(type, config);

    const provider = this.createProvider(type);
    await provider.initialize(config);

    this.providers.set(type, provider);
    this.emit('provider:registered', { type, name: provider.name });
  }

  /**
   * Create provider instance
   */
  private createProvider(type: ProviderType): LLMProvider {
    switch (type) {
      case 'grok':
        return new GrokProvider();
      case 'claude':
        return new ClaudeProvider();
      case 'openai':
        return new OpenAIProvider();
      case 'gemini':
        return new GeminiProvider();
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

  /**
   * Set active provider
   */
  setActiveProvider(type: ProviderType): void {
    if (!this.providers.has(type)) {
      throw new Error(`Provider ${type} not registered`);
    }
    this.activeProvider = type;
    this.emit('provider:changed', { type });
  }

  /**
   * Get active provider
   */
  getActiveProvider(): LLMProvider {
    const provider = this.providers.get(this.activeProvider);
    if (!provider) {
      throw new Error(`No active provider. Register a provider first.`);
    }
    return provider;
  }

  /**
   * Get specific provider
   */
  getProvider(type: ProviderType): LLMProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Get all registered providers
   */
  getRegisteredProviders(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get active provider type
   */
  getActiveProviderType(): ProviderType {
    return this.activeProvider;
  }

  /**
   * Auto-select best provider based on task
   */
  async selectBestProvider(options: {
    requiresToolUse?: boolean;
    requiresVision?: boolean;
    requiresLongContext?: boolean;
    costSensitive?: boolean;
  }): Promise<ProviderType> {
    const available = this.getRegisteredProviders();

    // Vision requirements
    if (options.requiresVision) {
      if (available.includes('gemini')) return 'gemini';
      if (available.includes('openai')) return 'openai';
      if (available.includes('claude')) return 'claude';
    }

    // Long context requirements
    if (options.requiresLongContext) {
      if (available.includes('gemini')) return 'gemini'; // 2M context
      if (available.includes('claude')) return 'claude'; // 200k context
    }

    // Cost sensitive
    if (options.costSensitive) {
      if (available.includes('gemini')) return 'gemini'; // Cheapest
      if (available.includes('openai')) return 'openai'; // GPT-4o-mini
    }

    // Default to active provider
    return this.activeProvider;
  }

  /**
   * Complete with active provider
   */
  async complete(options: CompletionOptions): Promise<LLMResponse> {
    return this.getActiveProvider().complete(options);
  }

  /**
   * Stream with active provider
   */
  stream(options: CompletionOptions): AsyncIterable<StreamChunk> {
    return this.getActiveProvider().stream(options);
  }

  /**
   * Dispose all providers
   */
  dispose(): void {
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
    this.configs.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let providerManagerInstance: ProviderManager | null = null;

export function getProviderManager(): ProviderManager {
  if (!providerManagerInstance) {
    providerManagerInstance = new ProviderManager();
  }
  return providerManagerInstance;
}

export function resetProviderManager(): void {
  if (providerManagerInstance) {
    providerManagerInstance.dispose();
  }
  providerManagerInstance = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Auto-configure providers from environment
 */
export async function autoConfigureProviders(): Promise<ProviderManager> {
  const manager = getProviderManager();

  // Grok (xAI)
  if (process.env.GROK_API_KEY || process.env.XAI_API_KEY) {
    await manager.registerProvider('grok', {
      apiKey: process.env.GROK_API_KEY || process.env.XAI_API_KEY || '',
    });
  }

  // Claude (Anthropic)
  if (process.env.ANTHROPIC_API_KEY) {
    await manager.registerProvider('claude', {
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  // OpenAI
  if (process.env.OPENAI_API_KEY) {
    await manager.registerProvider('openai', {
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // Gemini (Google)
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    await manager.registerProvider('gemini', {
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
    });
  }

  return manager;
}
