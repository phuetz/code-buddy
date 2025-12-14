/**
 * Local LLM Providers
 *
 * Native JavaScript/TypeScript LLM providers for offline use:
 * - node-llama-cpp: Native Node.js bindings for llama.cpp
 * - WebLLM: Browser-based LLM with WebGPU
 * - Ollama: HTTP API to local Ollama server
 *
 * These providers allow Grok CLI to function without cloud API dependencies.
 */

import { EventEmitter } from 'events';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export type LocalProviderType = 'ollama' | 'local-llama' | 'webllm';

export interface LocalLLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LocalLLMResponse {
  content: string;
  tokensUsed: number;
  model: string;
  provider: LocalProviderType;
  generationTime: number;
}

export interface LocalProviderConfig {
  model?: string;
  modelPath?: string;
  endpoint?: string;
  maxTokens?: number;
  temperature?: number;
  gpuLayers?: number;
  contextSize?: number;
}

export interface LocalLLMProvider {
  readonly type: LocalProviderType;
  readonly name: string;

  initialize(config: LocalProviderConfig): Promise<void>;
  isReady(): boolean;
  isAvailable(): Promise<boolean>;
  complete(messages: LocalLLMMessage[], options?: Partial<LocalProviderConfig>): Promise<LocalLLMResponse>;
  stream(messages: LocalLLMMessage[], options?: Partial<LocalProviderConfig>): AsyncIterable<string>;
  getModels(): Promise<string[]>;
  dispose(): void;

  // EventEmitter methods
  on(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean;
}

// ============================================================================
// node-llama-cpp Provider
// ============================================================================

/**
 * Native Node.js LLM provider using node-llama-cpp
 *
 * Advantages:
 * - No external dependencies (Ollama not required)
 * - Direct C++ bindings = lowest latency
 * - Fine-grained control over model parameters
 * - Supports CUDA, Metal, and CPU inference
 *
 * Usage:
 * ```typescript
 * const provider = new NodeLlamaCppProvider();
 * await provider.initialize({ modelPath: './models/llama-3.1-8b.gguf' });
 * const response = await provider.complete([{ role: 'user', content: 'Hello!' }]);
 * ```
 */
export class NodeLlamaCppProvider extends EventEmitter implements LocalLLMProvider {
  readonly type: LocalProviderType = 'local-llama';
  readonly name = 'node-llama-cpp';

  private config: LocalProviderConfig | null = null;
  private model: unknown = null;
  private context: unknown = null;
  private ready = false;
  private modelsDir: string;

  constructor() {
    super();
    this.modelsDir = path.join(os.homedir(), '.grok', 'models');
  }

  async initialize(config: LocalProviderConfig): Promise<void> {
    this.config = config;

    // Ensure models directory exists
    await fs.ensureDir(this.modelsDir);

    // Check if model path exists
    const modelPath = config.modelPath || path.join(this.modelsDir, 'llama-3.1-8b-q4_k_m.gguf');

    if (!await fs.pathExists(modelPath)) {
      throw new Error(
        `Model not found at ${modelPath}.\n` +
        `Download a GGUF model from https://huggingface.co/models?search=gguf\n` +
        `Example: wget -P ~/.grok/models/ https://huggingface.co/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf`
      );
    }

    try {
      // Dynamic import of node-llama-cpp (optional dependency)
       
      const nodeLlamaCpp = await import('node-llama-cpp').catch(() => null);

      if (!nodeLlamaCpp) {
        throw new Error(
          'node-llama-cpp is not installed.\n' +
          'Install with: npm install node-llama-cpp\n' +
          'Note: Requires CMake and a C++ compiler for native bindings.'
        );
      }

      const { LlamaModel, LlamaContext } = nodeLlamaCpp;

      this.model = new LlamaModel({
        modelPath,
        gpuLayers: config.gpuLayers ?? 0, // 0 = auto-detect
      });

      this.context = new LlamaContext({
        model: this.model as InstanceType<typeof LlamaModel>,
        contextSize: config.contextSize ?? 4096,
      });

      this.ready = true;
      this.emit('ready', { model: modelPath });
    } catch (error) {
      if ((error as Error).message.includes('not installed')) {
        throw error;
      }
      throw new Error(`Failed to initialize node-llama-cpp: ${(error as Error).message}`);
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const nodeLlamaCpp = await import('node-llama-cpp').catch(() => null);
      return nodeLlamaCpp !== null;
    } catch {
      return false;
    }
  }

  async complete(
    messages: LocalLLMMessage[],
    options?: Partial<LocalProviderConfig>
  ): Promise<LocalLLMResponse> {
    if (!this.ready || !this.context) {
      throw new Error('Provider not initialized');
    }

    const startTime = Date.now();
    const nodeLlamaCpp = await import('node-llama-cpp').catch(() => null);

    if (!nodeLlamaCpp) {
      throw new Error('node-llama-cpp is not installed');
    }

    const { LlamaChatSession } = nodeLlamaCpp;

    const session = new LlamaChatSession({
      context: this.context as ConstructorParameters<typeof LlamaChatSession>[0]['context'],
      systemPrompt: messages.find(m => m.role === 'system')?.content,
    });

    // Build conversation
    let response = '';
    for (const msg of messages) {
      if (msg.role === 'user') {
        response = await session.prompt(msg.content, {
          maxTokens: options?.maxTokens ?? this.config?.maxTokens ?? 2048,
          temperature: options?.temperature ?? this.config?.temperature ?? 0.7,
        });
      }
    }

    return {
      content: response,
      tokensUsed: Math.ceil(response.length / 4), // Rough estimate
      model: this.config?.modelPath || 'unknown',
      provider: this.type,
      generationTime: Date.now() - startTime,
    };
  }

  async *stream(
    messages: LocalLLMMessage[],
    options?: Partial<LocalProviderConfig>
  ): AsyncIterable<string> {
    if (!this.ready || !this.context) {
      throw new Error('Provider not initialized');
    }

    const nodeLlamaCpp = await import('node-llama-cpp').catch(() => null);

    if (!nodeLlamaCpp) {
      throw new Error('node-llama-cpp is not installed');
    }

    const { LlamaChatSession } = nodeLlamaCpp;

    const session = new LlamaChatSession({
      context: this.context as ConstructorParameters<typeof LlamaChatSession>[0]['context'],
      systemPrompt: messages.find(m => m.role === 'system')?.content,
    });

    const userMessage = messages.filter(m => m.role === 'user').pop();
    if (!userMessage) {
      throw new Error('No user message found');
    }

    // Use streaming API
    const responseIterator = session.prompt(userMessage.content, {
      maxTokens: options?.maxTokens ?? this.config?.maxTokens ?? 2048,
      temperature: options?.temperature ?? this.config?.temperature ?? 0.7,
      onToken: undefined, // We'll use the async iterator instead
    });

    // node-llama-cpp returns the full response, but we can simulate streaming
    // For true streaming, we'd need to use the onToken callback
    const response = await responseIterator;

    // Simulate streaming by yielding chunks
    const chunkSize = 10;
    for (let i = 0; i < response.length; i += chunkSize) {
      yield response.slice(i, i + chunkSize);
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay for streaming effect
    }
  }

  async getModels(): Promise<string[]> {
    const models: string[] = [];

    if (await fs.pathExists(this.modelsDir)) {
      const files = await fs.readdir(this.modelsDir);
      for (const file of files) {
        if (file.endsWith('.gguf')) {
          models.push(path.join(this.modelsDir, file));
        }
      }
    }

    return models;
  }

  dispose(): void {
    this.model = null;
    this.context = null;
    this.ready = false;
    this.removeAllListeners();
  }
}

// ============================================================================
// WebLLM Provider
// ============================================================================

/**
 * Browser-based LLM provider using WebLLM
 *
 * Advantages:
 * - Runs in browser with WebGPU
 * - Zero server requirements
 * - Can be used in Electron apps
 * - Progressive model download with caching
 *
 * Limitations:
 * - Requires WebGPU support
 * - Not available in pure Node.js (requires browser/Electron)
 *
 * Usage:
 * ```typescript
 * const provider = new WebLLMProvider();
 * await provider.initialize({ model: 'Llama-3.1-8B-Instruct-q4f16_1-MLC' });
 * const response = await provider.complete([{ role: 'user', content: 'Hello!' }]);
 * ```
 */
export class WebLLMProvider extends EventEmitter implements LocalLLMProvider {
  readonly type: LocalProviderType = 'webllm';
  readonly name = 'WebLLM';

  private config: LocalProviderConfig | null = null;
  private engine: unknown = null;
  private ready = false;

  async initialize(config: LocalProviderConfig): Promise<void> {
    this.config = config;

    try {
      // Dynamic import of WebLLM (optional dependency)
      const webllm = await import('@mlc-ai/web-llm').catch(() => null);

      if (!webllm) {
        throw new Error(
          'WebLLM is not installed.\n' +
          'Install with: npm install @mlc-ai/web-llm\n' +
          'Note: WebLLM requires WebGPU support (browser or Electron).'
        );
      }

      const model = config.model || 'Llama-3.1-8B-Instruct-q4f16_1-MLC';

      this.engine = new webllm.MLCEngine();

      // Progress callback
      const initProgress = (progress: { progress: number; text: string }) => {
        this.emit('progress', progress);
      };

      await (this.engine as { reload: (model: string, opts: { initProgressCallback: typeof initProgress }) => Promise<void> }).reload(model, { initProgressCallback: initProgress });

      this.ready = true;
      this.emit('ready', { model });
    } catch (error) {
      if ((error as Error).message.includes('not installed')) {
        throw error;
      }
      throw new Error(`Failed to initialize WebLLM: ${(error as Error).message}`);
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if WebGPU is available
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        const adapter = await (navigator as any).gpu.requestAdapter();
        return adapter !== null;
      }
      return false;
    } catch {
      return false;
    }
  }

  async complete(
    messages: LocalLLMMessage[],
    options?: Partial<LocalProviderConfig>
  ): Promise<LocalLLMResponse> {
    if (!this.ready || !this.engine) {
      throw new Error('Provider not initialized');
    }

    const startTime = Date.now();

    const response = await (this.engine as any).chat.completions.create({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: options?.maxTokens ?? this.config?.maxTokens ?? 2048,
      temperature: options?.temperature ?? this.config?.temperature ?? 0.7,
      stream: false,
    });

    const content = response.choices[0]?.message?.content || '';

    return {
      content,
      tokensUsed: response.usage?.total_tokens || 0,
      model: this.config?.model || 'unknown',
      provider: this.type,
      generationTime: Date.now() - startTime,
    };
  }

  async *stream(
    messages: LocalLLMMessage[],
    options?: Partial<LocalProviderConfig>
  ): AsyncIterable<string> {
    if (!this.ready || !this.engine) {
      throw new Error('Provider not initialized');
    }

    const response = await (this.engine as any).chat.completions.create({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: options?.maxTokens ?? this.config?.maxTokens ?? 2048,
      temperature: options?.temperature ?? this.config?.temperature ?? 0.7,
      stream: true,
    });

    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  async getModels(): Promise<string[]> {
    // WebLLM supported models
    return [
      'Llama-3.1-8B-Instruct-q4f16_1-MLC',
      'Llama-3.1-70B-Instruct-q4f16_1-MLC',
      'Mistral-7B-Instruct-v0.3-q4f16_1-MLC',
      'Phi-3.5-mini-instruct-q4f16_1-MLC',
      'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    ];
  }

  dispose(): void {
    this.engine = null;
    this.ready = false;
    this.removeAllListeners();
  }
}

// ============================================================================
// Ollama Provider (Enhanced)
// ============================================================================

/**
 * Enhanced Ollama provider with better streaming and model management
 *
 * Advantages:
 * - Most mature local LLM solution
 * - Easy model management (pull, list, remove)
 * - Supports many models out of the box
 * - OpenAI-compatible API
 *
 * Usage:
 * ```typescript
 * const provider = new OllamaProvider();
 * await provider.initialize({ model: 'llama3.1', endpoint: 'http://localhost:11434' });
 * const response = await provider.complete([{ role: 'user', content: 'Hello!' }]);
 * ```
 */
export class OllamaProvider extends EventEmitter implements LocalLLMProvider {
  readonly type: LocalProviderType = 'ollama';
  readonly name = 'Ollama';

  private config: LocalProviderConfig | null = null;
  private ready = false;
  private endpoint: string = 'http://localhost:11434';

  async initialize(config: LocalProviderConfig): Promise<void> {
    this.config = config;
    this.endpoint = config.endpoint || 'http://localhost:11434';

    // Check if Ollama is running
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(
        'Ollama is not running.\n' +
        'Start Ollama with: ollama serve\n' +
        'Or install from: https://ollama.com'
      );
    }

    // Check if model is available
    const model = config.model || 'llama3.1';
    const models = await this.getModels();

    if (!models.includes(model)) {
      this.emit('model:pulling', { model });
      await this.pullModel(model);
    }

    this.ready = true;
    this.emit('ready', { model, endpoint: this.endpoint });
  }

  isReady(): boolean {
    return this.ready;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async pullModel(model: string): Promise<void> {
    const response = await fetch(`${this.endpoint}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const progress = JSON.parse(line);
              this.emit('progress', progress);
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async complete(
    messages: LocalLLMMessage[],
    options?: Partial<LocalProviderConfig>
  ): Promise<LocalLLMResponse> {
    if (!this.ready) {
      throw new Error('Provider not initialized');
    }

    const startTime = Date.now();
    const model = options?.model || this.config?.model || 'llama3.1';

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          num_predict: options?.maxTokens ?? this.config?.maxTokens ?? 2048,
          temperature: options?.temperature ?? this.config?.temperature ?? 0.7,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json() as {
      message: { content: string };
      eval_count?: number;
      model: string;
    };

    return {
      content: data.message.content,
      tokensUsed: data.eval_count || 0,
      model: data.model,
      provider: this.type,
      generationTime: Date.now() - startTime,
    };
  }

  async *stream(
    messages: LocalLLMMessage[],
    options?: Partial<LocalProviderConfig>
  ): AsyncIterable<string> {
    if (!this.ready) {
      throw new Error('Provider not initialized');
    }

    const model = options?.model || this.config?.model || 'llama3.1';

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        options: {
          num_predict: options?.maxTokens ?? this.config?.maxTokens ?? 2048,
          temperature: options?.temperature ?? this.config?.temperature ?? 0.7,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
              if (data.message?.content) {
                yield data.message.content;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET',
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { models?: Array<{ name: string }> };
      return data.models?.map(m => m.name) || [];
    } catch {
      return [];
    }
  }

  dispose(): void {
    this.ready = false;
    this.removeAllListeners();
  }
}

// ============================================================================
// Local Provider Manager
// ============================================================================

/**
 * Manager for local LLM providers
 *
 * Handles provider selection, fallback, and unified interface.
 */
export class LocalProviderManager extends EventEmitter {
  private providers: Map<LocalProviderType, LocalLLMProvider> = new Map();
  private activeProvider: LocalProviderType | null = null;

  /**
   * Register and initialize a provider
   */
  async registerProvider(type: LocalProviderType, config: LocalProviderConfig): Promise<void> {
    const provider = this.createProvider(type);

    provider.on('progress', (progress: unknown) => {
      this.emit('progress', { provider: type, ...(progress as Record<string, unknown>) });
    });

    provider.on('ready', (info: unknown) => {
      this.emit('provider:ready', { type, ...(info as Record<string, unknown>) });
    });

    await provider.initialize(config);
    this.providers.set(type, provider);

    if (!this.activeProvider) {
      this.activeProvider = type;
    }
  }

  /**
   * Create provider instance
   */
  private createProvider(type: LocalProviderType): LocalLLMProvider {
    switch (type) {
      case 'ollama':
        return new OllamaProvider();
      case 'local-llama':
        return new NodeLlamaCppProvider();
      case 'webllm':
        return new WebLLMProvider();
      default:
        throw new Error(`Unknown local provider type: ${type}`);
    }
  }

  /**
   * Get active provider
   */
  getActiveProvider(): LocalLLMProvider | null {
    if (!this.activeProvider) return null;
    return this.providers.get(this.activeProvider) || null;
  }

  /**
   * Set active provider
   */
  setActiveProvider(type: LocalProviderType): void {
    if (!this.providers.has(type)) {
      throw new Error(`Provider ${type} not registered`);
    }
    this.activeProvider = type;
    this.emit('provider:changed', { type });
  }

  /**
   * Auto-detect best available provider
   */
  async autoDetectProvider(): Promise<LocalProviderType | null> {
    // Priority: Ollama > node-llama-cpp > WebLLM

    // Check Ollama first (most common)
    const ollama = new OllamaProvider();
    if (await ollama.isAvailable()) {
      return 'ollama';
    }

    // Check node-llama-cpp
    const nodeLlama = new NodeLlamaCppProvider();
    if (await nodeLlama.isAvailable()) {
      return 'local-llama';
    }

    // Check WebLLM (requires browser/Electron)
    const webllm = new WebLLMProvider();
    if (await webllm.isAvailable()) {
      return 'webllm';
    }

    return null;
  }

  /**
   * Complete with active provider (with fallback)
   */
  async complete(
    messages: LocalLLMMessage[],
    options?: Partial<LocalProviderConfig>
  ): Promise<LocalLLMResponse> {
    const provider = this.getActiveProvider();
    if (!provider) {
      throw new Error('No local provider available');
    }

    try {
      return await provider.complete(messages, options);
    } catch (error) {
      // Try fallback providers
      for (const [type, fallbackProvider] of this.providers) {
        if (type !== this.activeProvider && fallbackProvider.isReady()) {
          this.emit('provider:fallback', { from: this.activeProvider, to: type, error });
          return await fallbackProvider.complete(messages, options);
        }
      }
      throw error;
    }
  }

  /**
   * Stream with active provider
   */
  stream(
    messages: LocalLLMMessage[],
    options?: Partial<LocalProviderConfig>
  ): AsyncIterable<string> {
    const provider = this.getActiveProvider();
    if (!provider) {
      throw new Error('No local provider available');
    }
    return provider.stream(messages, options);
  }

  /**
   * Get all registered providers
   */
  getRegisteredProviders(): LocalProviderType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Dispose all providers
   */
  dispose(): void {
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
    this.activeProvider = null;
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let localProviderManagerInstance: LocalProviderManager | null = null;

export function getLocalProviderManager(): LocalProviderManager {
  if (!localProviderManagerInstance) {
    localProviderManagerInstance = new LocalProviderManager();
  }
  return localProviderManagerInstance;
}

export function resetLocalProviderManager(): void {
  if (localProviderManagerInstance) {
    localProviderManagerInstance.dispose();
  }
  localProviderManagerInstance = null;
}

// ============================================================================
// Auto-configuration
// ============================================================================

/**
 * Auto-configure best available local provider
 */
export async function autoConfigureLocalProvider(
  preferredProvider?: LocalProviderType
): Promise<LocalProviderManager> {
  const manager = getLocalProviderManager();

  // Try preferred provider first
  if (preferredProvider) {
    try {
      await manager.registerProvider(preferredProvider, {});
      return manager;
    } catch (error) {
      console.warn(`Preferred provider ${preferredProvider} not available:`, error);
    }
  }

  // Auto-detect
  const detected = await manager.autoDetectProvider();
  if (detected) {
    await manager.registerProvider(detected, {});
    return manager;
  }

  throw new Error(
    'No local LLM provider available.\n' +
    'Options:\n' +
    '1. Install Ollama: https://ollama.com\n' +
    '2. Install node-llama-cpp: npm install node-llama-cpp\n' +
    '3. Use WebLLM in browser/Electron environment'
  );
}
