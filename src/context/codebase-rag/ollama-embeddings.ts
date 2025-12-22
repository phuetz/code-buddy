/**
 * Ollama Embedding Provider
 *
 * Uses Ollama's /api/embeddings endpoint for high-quality
 * neural embeddings. 100% local, no external API needed.
 *
 * Recommended models:
 * - nomic-embed-text (768 dim, best quality)
 * - mxbai-embed-large (1024 dim, high quality)
 * - all-minilm (384 dim, fast)
 *
 * Benefits over TF-IDF:
 * - Semantic understanding (synonyms, concepts)
 * - Better code similarity matching
 * - Cross-language understanding
 */

import { EventEmitter } from "events";
import { logger } from "../../utils/logger.js";
import type { CodeChunk } from "./types.js";

/**
 * Ollama embedding configuration
 */
export interface OllamaEmbeddingConfig {
  /** Ollama server URL */
  baseUrl: string;
  /** Embedding model to use */
  model: string;
  /** Request timeout in ms */
  timeout: number;
  /** Batch size for embedding multiple texts */
  batchSize: number;
  /** Retry attempts on failure */
  retryAttempts: number;
  /** Retry delay in ms */
  retryDelay: number;
  /** Keep model loaded in memory */
  keepAlive: string;
}

/**
 * Default configuration
 */
export const DEFAULT_OLLAMA_EMBEDDING_CONFIG: OllamaEmbeddingConfig = {
  baseUrl: "http://localhost:11434",
  model: "nomic-embed-text",
  timeout: 30000,
  batchSize: 32,
  retryAttempts: 3,
  retryDelay: 1000,
  keepAlive: "5m",
};

/**
 * Ollama embedding response
 */
interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * Model information
 */
export interface EmbeddingModelInfo {
  name: string;
  dimensions: number;
  description: string;
  sizeGB: number;
}

/**
 * Known embedding models with their dimensions
 */
export const EMBEDDING_MODELS: Record<string, EmbeddingModelInfo> = {
  "nomic-embed-text": {
    name: "nomic-embed-text",
    dimensions: 768,
    description: "Best quality, good for code",
    sizeGB: 0.27,
  },
  "mxbai-embed-large": {
    name: "mxbai-embed-large",
    dimensions: 1024,
    description: "High quality, larger vectors",
    sizeGB: 0.67,
  },
  "all-minilm": {
    name: "all-minilm",
    dimensions: 384,
    description: "Fast, lightweight",
    sizeGB: 0.045,
  },
  "snowflake-arctic-embed": {
    name: "snowflake-arctic-embed",
    dimensions: 1024,
    description: "State-of-the-art retrieval",
    sizeGB: 0.67,
  },
  "bge-m3": {
    name: "bge-m3",
    dimensions: 1024,
    description: "Multilingual, dense+sparse",
    sizeGB: 1.2,
  },
};

/**
 * Ollama Embedding Provider
 *
 * Provides high-quality neural embeddings via Ollama.
 * Falls back gracefully if Ollama is unavailable.
 */
export class OllamaEmbeddingProvider extends EventEmitter {
  private config: OllamaEmbeddingConfig;
  private dimensions: number;
  private isAvailable: boolean = false;
  private modelLoaded: boolean = false;

  constructor(config: Partial<OllamaEmbeddingConfig> = {}) {
    super();
    this.config = { ...DEFAULT_OLLAMA_EMBEDDING_CONFIG, ...config };

    // Get dimensions from known models or default
    const modelInfo = EMBEDDING_MODELS[this.config.model];
    this.dimensions = modelInfo?.dimensions || 768;
  }

  /**
   * Initialize provider and check Ollama availability
   */
  async initialize(): Promise<boolean> {
    try {
      // Check if Ollama is running
      const response = await this.fetchWithTimeout(
        `${this.config.baseUrl}/api/tags`,
        { method: "GET" },
        5000
      );

      if (!response.ok) {
        throw new Error(`Ollama not responding: ${response.status}`);
      }

      const data = await response.json();
      const models = data.models || [];

      // Check if embedding model is available
      const hasModel = models.some((m: { name: string }) =>
        m.name.startsWith(this.config.model)
      );

      if (!hasModel) {
        logger.info(`Embedding model ${this.config.model} not found, pulling...`);
        await this.pullModel();
      }

      // Test embedding to verify it works
      await this.embed("test");

      this.isAvailable = true;
      this.modelLoaded = true;
      this.emit("ready");

      logger.debug(`Ollama embeddings ready: ${this.config.model} (${this.dimensions}d)`);
      return true;
    } catch (error) {
      logger.warn(`Ollama embeddings unavailable: ${error}`);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Pull embedding model from Ollama
   */
  private async pullModel(): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/api/pull`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.config.model }),
      },
      300000 // 5 minutes for download
    );

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.status}`);
    }

    // Stream the response to track progress
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        const lines = text.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.status) {
              this.emit("pull:progress", data);
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    logger.info(`Model ${this.config.model} pulled successfully`);
  }

  /**
   * Generate embedding for text
   */
  async embed(text: string): Promise<number[]> {
    if (!this.isAvailable) {
      // Return zero vector if not available
      return new Array(this.dimensions).fill(0);
    }

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const response = await this.fetchWithTimeout(
          `${this.config.baseUrl}/api/embeddings`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: this.config.model,
              prompt: text,
              keep_alive: this.config.keepAlive,
            }),
          },
          this.config.timeout
        );

        if (!response.ok) {
          throw new Error(`Embedding request failed: ${response.status}`);
        }

        const data: OllamaEmbeddingResponse = await response.json();
        return data.embedding;
      } catch (_error) {
        if (attempt < this.config.retryAttempts - 1) {
          await this.delay(this.config.retryDelay);
        } else {
          logger.warn(`Embedding failed after ${this.config.retryAttempts} attempts`);
          return new Array(this.dimensions).fill(0);
        }
      }
    }

    return new Array(this.dimensions).fill(0);
  }

  /**
   * Generate embeddings for multiple texts (batched)
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.config.batchSize) {
      const batch = texts.slice(i, i + this.config.batchSize);

      // Parallel embedding within batch
      const batchResults = await Promise.all(
        batch.map((text) => this.embed(text))
      );

      results.push(...batchResults);

      // Emit progress
      this.emit("batch:progress", {
        completed: Math.min(i + this.config.batchSize, texts.length),
        total: texts.length,
      });
    }

    return results;
  }

  /**
   * Embed a code chunk with metadata enhancement
   */
  async embedChunk(chunk: CodeChunk): Promise<number[]> {
    // Enhance text with metadata for better semantic matching
    const enhancedText = this.enhanceChunkText(chunk);
    return this.embed(enhancedText);
  }

  /**
   * Enhance chunk text with metadata
   */
  private enhanceChunkText(chunk: CodeChunk): string {
    const parts: string[] = [];

    // Add file path context
    if (chunk.filePath) {
      parts.push(`File: ${chunk.filePath}`);
    }

    // Add language
    if (chunk.language) {
      parts.push(`Language: ${chunk.language}`);
    }

    // Add type and name from metadata
    if (chunk.type) {
      parts.push(`Type: ${chunk.type}`);
    }

    if (chunk.metadata?.name) {
      // Use chunk type to provide context for the name
      if (chunk.type === "function" || chunk.type === "method") {
        parts.push(`Function: ${chunk.metadata.name}`);
      } else if (chunk.type === "class") {
        parts.push(`Class: ${chunk.metadata.name}`);
      } else if (chunk.type === "interface" || chunk.type === "type") {
        parts.push(`Type: ${chunk.metadata.name}`);
      } else {
        parts.push(`Name: ${chunk.metadata.name}`);
      }
    }

    // Add content
    parts.push(chunk.content);

    return parts.join("\n");
  }

  /**
   * Calculate similarity between two embeddings (cosine similarity)
   */
  similarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have same dimensions");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Check if provider is available
   */
  isReady(): boolean {
    return this.isAvailable;
  }

  /**
   * Get model information
   */
  getModelInfo(): EmbeddingModelInfo | null {
    return EMBEDDING_MODELS[this.config.model] || null;
  }

  /**
   * List available embedding models
   */
  static getAvailableModels(): EmbeddingModelInfo[] {
    return Object.values(EMBEDDING_MODELS);
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OllamaEmbeddingConfig>): void {
    this.config = { ...this.config, ...config };

    // Update dimensions if model changed
    if (config.model) {
      const modelInfo = EMBEDDING_MODELS[config.model];
      this.dimensions = modelInfo?.dimensions || 768;
    }
  }

  /**
   * Get configuration
   */
  getConfig(): OllamaEmbeddingConfig {
    return { ...this.config };
  }

  /**
   * Format status for display
   */
  formatStatus(): string {
    const modelInfo = this.getModelInfo();
    const lines = [
      "🧠 Ollama Embeddings",
      "",
      `  Status: ${this.isAvailable ? "✅ Ready" : "❌ Unavailable"}`,
      `  Model: ${this.config.model}`,
      `  Dimensions: ${this.dimensions}`,
      `  Server: ${this.config.baseUrl}`,
    ];

    if (modelInfo) {
      lines.push(`  Size: ${modelInfo.sizeGB}GB`);
      lines.push(`  Description: ${modelInfo.description}`);
    }

    return lines.join("\n");
  }

  /**
   * Dispose provider
   */
  dispose(): void {
    this.removeAllListeners();
    this.isAvailable = false;
  }
}

// Singleton instance
let ollamaEmbeddingInstance: OllamaEmbeddingProvider | null = null;

/**
 * Get or create Ollama embedding provider
 */
export function getOllamaEmbeddings(
  config?: Partial<OllamaEmbeddingConfig>
): OllamaEmbeddingProvider {
  if (!ollamaEmbeddingInstance) {
    ollamaEmbeddingInstance = new OllamaEmbeddingProvider(config);
  }
  return ollamaEmbeddingInstance;
}

/**
 * Initialize Ollama embeddings (async)
 */
export async function initializeOllamaEmbeddings(
  config?: Partial<OllamaEmbeddingConfig>
): Promise<OllamaEmbeddingProvider> {
  const provider = getOllamaEmbeddings(config);
  await provider.initialize();
  return provider;
}

/**
 * Reset Ollama embedding singleton
 */
export function resetOllamaEmbeddings(): void {
  if (ollamaEmbeddingInstance) {
    ollamaEmbeddingInstance.dispose();
    ollamaEmbeddingInstance = null;
  }
}

export default {
  OllamaEmbeddingProvider,
  getOllamaEmbeddings,
  initializeOllamaEmbeddings,
  resetOllamaEmbeddings,
  EMBEDDING_MODELS,
  DEFAULT_OLLAMA_EMBEDDING_CONFIG,
};
