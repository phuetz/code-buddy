/**
 * Embedding Provider
 *
 * Provides vector embeddings using either:
 * - Local model (@xenova/transformers - all-MiniLM-L6-v2)
 * - API-based (OpenAI, Grok, etc.)
 *
 * Local embeddings are preferred for privacy and cost savings.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type EmbeddingProviderType = 'local' | 'openai' | 'grok' | 'mock';

export interface EmbeddingConfig {
  provider: EmbeddingProviderType;
  modelName?: string;
  apiKey?: string;
  apiEndpoint?: string;
  cacheDir?: string;
  batchSize?: number;
}

export interface EmbeddingResult {
  embedding: Float32Array;
  dimensions: number;
  provider: EmbeddingProviderType;
  cached?: boolean;
}

export interface BatchEmbeddingResult {
  embeddings: Float32Array[];
  dimensions: number;
  provider: EmbeddingProviderType;
  totalTokens?: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: EmbeddingConfig = {
  provider: 'local',
  modelName: 'Xenova/all-MiniLM-L6-v2',
  cacheDir: path.join(os.homedir(), '.codebuddy', 'models'),
  batchSize: 32,
};

// Embedding dimensions by model
const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'Xenova/all-MiniLM-L6-v2': 384,
  'text-embedding-ada-002': 1536,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
};

// ============================================================================
// Embedding Provider Class
// ============================================================================

export class EmbeddingProvider extends EventEmitter {
  private config: EmbeddingConfig;
  private pipeline: unknown = null;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(config: Partial<EmbeddingConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the embedding provider
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      if (this.config.provider === 'local') {
        await this.initializeLocalModel();
      }
      // API providers don't need initialization

      this.initialized = true;
      this.emit('initialized', { provider: this.config.provider });
    } catch (error) {
      this.emit('error', error);
      // Fall back to mock provider if local fails
      if (this.config.provider === 'local') {
        logger.warn('Local embedding model failed to load, using mock embeddings');
        this.config.provider = 'mock';
        this.initialized = true;
      } else {
        throw error;
      }
    }
  }

  private async initializeLocalModel(): Promise<void> {
    // Ensure cache directory exists
    if (this.config.cacheDir && !fs.existsSync(this.config.cacheDir)) {
      fs.mkdirSync(this.config.cacheDir, { recursive: true });
    }

    try {
      // Dynamic import of transformers.js
      const { pipeline } = await import('@xenova/transformers');

      // Set cache directory
      process.env.TRANSFORMERS_CACHE = this.config.cacheDir;

      // Load the embedding pipeline
      this.pipeline = await pipeline('feature-extraction', this.config.modelName, {
        quantized: true, // Use quantized model for better performance
      });

      this.emit('model:loaded', { model: this.config.modelName });
    } catch (error) {
      // If transformers.js is not installed, throw with helpful message
      const err = error as Error;
      if (err.message?.includes('Cannot find module')) {
        throw new Error(
          'Local embeddings require @xenova/transformers. Install with: npm install @xenova/transformers'
        );
      }
      throw error;
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<EmbeddingResult> {
    await this.initialize();

    switch (this.config.provider) {
      case 'local':
        return this.embedLocal(text);
      case 'openai':
        return this.embedOpenAI(text);
      case 'grok':
        return this.embedGrok(text);
      case 'mock':
        return this.embedMock(text);
      default:
        throw new Error(`Unknown embedding provider: ${this.config.provider}`);
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    await this.initialize();

    if (texts.length === 0) {
      return {
        embeddings: [],
        dimensions: this.getDimensions(),
        provider: this.config.provider,
      };
    }

    switch (this.config.provider) {
      case 'local':
        return this.embedBatchLocal(texts);
      case 'openai':
        return this.embedBatchOpenAI(texts);
      case 'grok':
        return this.embedBatchGrok(texts);
      case 'mock':
        return this.embedBatchMock(texts);
      default:
        throw new Error(`Unknown embedding provider: ${this.config.provider}`);
    }
  }

  /**
   * Get embedding dimensions for current model
   */
  getDimensions(): number {
    const model = this.config.modelName || 'Xenova/all-MiniLM-L6-v2';
    return EMBEDDING_DIMENSIONS[model] || 384;
  }

  /**
   * Check if provider is ready
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Get current provider type
   */
  getProviderType(): EmbeddingProviderType {
    return this.config.provider;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  // ============================================================================
  // Local Model Methods
  // ============================================================================

  private async embedLocal(text: string): Promise<EmbeddingResult> {
    if (!this.pipeline) {
      throw new Error('Local model not initialized');
    }

    const pipelineFn = this.pipeline as (text: string, options?: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;
    const result = await pipelineFn(text, { pooling: 'mean', normalize: true });

    return {
      embedding: new Float32Array(result.data),
      dimensions: result.data.length,
      provider: 'local',
    };
  }

  private async embedBatchLocal(texts: string[]): Promise<BatchEmbeddingResult> {
    const embeddings: Float32Array[] = [];
    const batchSize = this.config.batchSize || 32;

    // Process in batches with parallel embedding within each batch
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      // Process batch items in parallel for better performance
      const batchResults = await Promise.all(
        batch.map(text => this.embedLocal(text))
      );

      for (const result of batchResults) {
        embeddings.push(result.embedding);
      }

      this.emit('batch:progress', {
        processed: Math.min(i + batchSize, texts.length),
        total: texts.length,
      });
    }

    return {
      embeddings,
      dimensions: embeddings[0]?.length || this.getDimensions(),
      provider: 'local',
    };
  }

  // ============================================================================
  // OpenAI API Methods
  // ============================================================================

  private async embedOpenAI(text: string): Promise<EmbeddingResult> {
    const result = await this.embedBatchOpenAI([text]);
    return {
      embedding: result.embeddings[0],
      dimensions: result.dimensions,
      provider: 'openai',
    };
  }

  private async embedBatchOpenAI(texts: string[]): Promise<BatchEmbeddingResult> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key required for embeddings');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.config.modelName || 'text-embedding-3-small',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding error: ${error}`);
    }

    const data = await response.json() as {
      data: { embedding: number[]; index: number }[];
      usage: { total_tokens: number };
    };

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);

    return {
      embeddings: sorted.map(d => new Float32Array(d.embedding)),
      dimensions: sorted[0]?.embedding.length || this.getDimensions(),
      provider: 'openai',
      totalTokens: data.usage.total_tokens,
    };
  }

  // ============================================================================
  // CodeBuddy API Methods (uses OpenAI-compatible endpoint)
  // ============================================================================

  private async embedGrok(text: string): Promise<EmbeddingResult> {
    const result = await this.embedBatchGrok([text]);
    return {
      embedding: result.embeddings[0],
      dimensions: result.dimensions,
      provider: 'grok',
    };
  }

  private async embedBatchGrok(texts: string[]): Promise<BatchEmbeddingResult> {
    const apiKey = this.config.apiKey || process.env.GROK_API_KEY;
    if (!apiKey) {
      throw new Error('CodeBuddy API key required for embeddings');
    }

    const endpoint = this.config.apiEndpoint || 'https://api.x.ai/v1/embeddings';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.config.modelName || 'grok-embedding',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Grok embedding error: ${error}`);
    }

    const data = await response.json() as {
      data: { embedding: number[]; index: number }[];
      usage?: { total_tokens: number };
    };

    const sorted = data.data.sort((a, b) => a.index - b.index);

    return {
      embeddings: sorted.map(d => new Float32Array(d.embedding)),
      dimensions: sorted[0]?.embedding.length || this.getDimensions(),
      provider: 'grok',
      totalTokens: data.usage?.total_tokens,
    };
  }

  // ============================================================================
  // Mock Methods (for testing and fallback)
  // ============================================================================

  private embedMock(text: string): EmbeddingResult {
    // Generate deterministic pseudo-random embedding based on text hash
    const dimensions = this.getDimensions();
    const embedding = new Float32Array(dimensions);

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    // Generate pseudo-random values from hash
    const seed = Math.abs(hash);
    for (let i = 0; i < dimensions; i++) {
      // LCG pseudo-random
      const val = ((seed * (i + 1) * 1103515245 + 12345) % (1 << 31)) / (1 << 31);
      embedding[i] = (val * 2) - 1; // Range [-1, 1]
    }

    // Normalize
    let norm = 0;
    for (let i = 0; i < dimensions; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < dimensions; i++) {
      embedding[i] /= norm;
    }

    return {
      embedding,
      dimensions,
      provider: 'mock',
    };
  }

  private embedBatchMock(texts: string[]): BatchEmbeddingResult {
    const embeddings = texts.map(text => this.embedMock(text).embedding);
    return {
      embeddings,
      dimensions: this.getDimensions(),
      provider: 'mock',
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: EmbeddingProvider | null = null;

export function getEmbeddingProvider(config?: Partial<EmbeddingConfig>): EmbeddingProvider {
  if (!instance) {
    instance = new EmbeddingProvider(config);
  }
  return instance;
}

export async function initializeEmbeddingProvider(config?: Partial<EmbeddingConfig>): Promise<EmbeddingProvider> {
  const provider = getEmbeddingProvider(config);
  await provider.initialize();
  return provider;
}

export function resetEmbeddingProvider(): void {
  instance = null;
}
