/**
 * Provider Manager
 *
 * Central manager for multi-LLM provider orchestration.
 * Handles provider registration, selection, routing, and lifecycle management.
 * Acts as the single point of entry for the application to access AI capabilities.
 */

import { EventEmitter } from 'events';
import type { AIProvider } from './base-provider.js';
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

/**
 * Manages the lifecycle and selection of AI providers.
 * Allows switching between providers (Grok, Claude, OpenAI) at runtime
 * and selecting the best provider based on task requirements.
 */
export class ProviderManager extends EventEmitter {
  private providers: Map<ProviderType, AIProvider> = new Map();
  private activeProvider: ProviderType = 'grok';
  private configs: Map<ProviderType, ProviderConfig> = new Map();

  /**
   * Registers and initializes a new provider.
   * If the provider is already registered, it will be re-initialized with the new config.
   *
   * @param type - The type of provider to register (e.g., 'grok', 'claude').
   * @param config - The configuration for the provider.
   * @throws Error if initialization fails.
   */
  async registerProvider(type: ProviderType, config: ProviderConfig): Promise<void> {
    this.configs.set(type, config);

    const provider = this.createProvider(type);
    await provider.initialize(config);

    this.providers.set(type, provider);
    this.emit('provider:registered', { type, name: provider.name });
  }

  /**
   * Factory method to create provider instances.
   */
  private createProvider(type: ProviderType): AIProvider {
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
   * Sets the currently active provider for general queries.
   *
   * @param type - The provider type to make active.
   * @throws Error if the provider is not registered.
   */
  setActiveProvider(type: ProviderType): void {
    if (!this.providers.has(type)) {
      throw new Error(`Provider ${type} not registered`);
    }
    this.activeProvider = type;
    this.emit('provider:changed', { type });
  }

  /**
   * Retrieves the currently active provider instance.
   *
   * @returns The active AIProvider.
   * @throws Error if no provider is active.
   */
  getActiveProvider(): AIProvider {
    const provider = this.providers.get(this.activeProvider);
    if (!provider) {
      throw new Error(`No active provider. Register a provider first.`);
    }
    return provider;
  }

  /**
   * Retrieves a specific provider instance by type.
   *
   * @param type - The provider type to retrieve.
   * @returns The provider instance or undefined if not registered.
   */
  getProvider(type: ProviderType): AIProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Returns a list of all currently registered provider types.
   */
  getRegisteredProviders(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Returns the type identifier of the currently active provider.
   */
  getActiveProviderType(): ProviderType {
    return this.activeProvider;
  }

  /**
   * Automatically selects the best provider based on specific requirements.
   * Useful for routing tasks to the most capable or cost-effective model.
   *
   * Logic:
   * 1. Checks for vision requirements.
   * 2. Checks for long context requirements.
   * 3. Checks for cost sensitivity.
   * 4. Fallbacks to the active provider.
   *
   * @param options - Requirements for the task.
   * @returns The type of the selected provider.
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
   * Sends a completion request to the active provider.
   *
   * @param options - Completion options.
   * @returns The LLM response.
   */
  async complete(options: CompletionOptions): Promise<LLMResponse> {
    return this.getActiveProvider().complete(options);
  }

  /**
   * Streams a completion response from the active provider.
   *
   * @param options - Completion options.
   * @returns Async iterable of stream chunks.
   */
  stream(options: CompletionOptions): AsyncIterable<StreamChunk> {
    return this.getActiveProvider().stream(options);
  }

  /**
   * Cleans up all providers and resets the manager.
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

/**
 * Gets the singleton instance of the ProviderManager.
 * Creates a new instance if one doesn't exist.
 */
export function getProviderManager(): ProviderManager {
  if (!providerManagerInstance) {
    providerManagerInstance = new ProviderManager();
  }
  return providerManagerInstance;
}

/**
 * Resets the singleton instance (useful for testing).
 */
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
 * Automatically configures providers based on available environment variables.
 * Scans for GROK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, and GEMINI_API_KEY.
 *
 * @returns The configured ProviderManager instance.
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
