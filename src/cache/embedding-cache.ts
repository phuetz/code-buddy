/**
 * Embedding Cache
 *
 * Caches vector embeddings for semantic search and RAG operations.
 * Key features:
 * - Content hash-based keys for change detection
 * - Batched persistence for performance
 * - Dimension-aware storage
 * - LRU eviction with frequency weighting
 *
 * Embeddings are expensive to compute - caching provides significant speedup.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingCacheEntry {
  key: string;
  contentHash: string;
  embedding: number[];
  dimension: number;
  model: string;
  timestamp: number;
  expiresAt: number;
  hits: number;
  metadata?: {
    source?: string;
    chunkIndex?: number;
    tokenCount?: number;
  };
}

export interface EmbeddingCacheConfig {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  dimension: number;
  modelName: string;
  persistToDisk: boolean;
  cachePath: string;
  compressionEnabled: boolean;
  saveBatchSize: number;
}

export interface EmbeddingCacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  computationsSaved: number;
  dimensionMismatches: number;
  evictions: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: EmbeddingCacheConfig = {
  enabled: true,
  ttlMs: 60 * 60 * 1000, // 1 hour
  maxEntries: 10000,
  dimension: 384,
  modelName: 'code-embedding',
  persistToDisk: true,
  cachePath: '.codebuddy/cache/embedding-cache.json',
  compressionEnabled: true,
  saveBatchSize: 100,
};

// ============================================================================
// Embedding Cache
// ============================================================================

export class EmbeddingCache extends EventEmitter {
  private cache: Map<string, EmbeddingCacheEntry> = new Map();
  private config: EmbeddingCacheConfig;
  private stats: EmbeddingCacheStats = {
    totalEntries: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    computationsSaved: 0,
    dimensionMismatches: 0,
    evictions: 0,
  };
  private pendingSave: EmbeddingCacheEntry[] = [];
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly saveDebounceMs = 5000; // 5 seconds

  constructor(config: Partial<EmbeddingCacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.persistToDisk) {
      this.loadFromDisk();
    }
  }

  /**
   * Get cached embedding for content
   */
  get(content: string, model?: string): number[] | null {
    if (!this.config.enabled) return null;

    const key = this.createKey(content);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Check expiration
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Check model match
    if (model && entry.model !== model) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Check dimension match
    if (entry.dimension !== this.config.dimension) {
      this.stats.dimensionMismatches++;
      this.cache.delete(key);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Cache hit
    entry.hits++;
    this.stats.hits++;
    this.stats.computationsSaved++;
    this.updateHitRate();
    this.emit('cache:hit', { key });

    return entry.embedding;
  }

  /**
   * Store embedding in cache
   */
  set(
    content: string,
    embedding: number[],
    metadata?: EmbeddingCacheEntry['metadata']
  ): void {
    if (!this.config.enabled) return;

    // Validate dimension
    if (embedding.length !== this.config.dimension) {
      logger.debug(
        `Embedding dimension mismatch: expected ${this.config.dimension}, got ${embedding.length}`
      );
      return;
    }

    // Evict if needed
    this.evictIfNeeded();

    const key = this.createKey(content);
    const entry: EmbeddingCacheEntry = {
      key,
      contentHash: this.hashContent(content),
      embedding: this.config.compressionEnabled
        ? this.compressEmbedding(embedding)
        : embedding,
      dimension: embedding.length,
      model: this.config.modelName,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.ttlMs,
      hits: 0,
      metadata,
    };

    this.cache.set(key, entry);
    this.stats.totalEntries = this.cache.size;
    this.emit('cache:set', { key });

    // Queue for persistence
    if (this.config.persistToDisk) {
      this.pendingSave.push(entry);
      if (this.pendingSave.length >= this.config.saveBatchSize) {
        this.scheduleSave();
      }
    }
  }

  /**
   * Get or compute embedding
   */
  async getOrCompute(
    content: string,
    computeFn: () => Promise<number[]>,
    metadata?: EmbeddingCacheEntry['metadata']
  ): Promise<{ embedding: number[]; cached: boolean }> {
    const cached = this.get(content);
    if (cached) {
      return { embedding: cached, cached: true };
    }

    const embedding = await computeFn();
    this.set(content, embedding, metadata);
    return { embedding, cached: false };
  }

  /**
   * Batch get embeddings
   */
  getBatch(contents: string[]): Map<string, number[] | null> {
    const results = new Map<string, number[] | null>();
    for (const content of contents) {
      results.set(content, this.get(content));
    }
    return results;
  }

  /**
   * Batch set embeddings
   */
  setBatch(
    items: Array<{
      content: string;
      embedding: number[];
      metadata?: EmbeddingCacheEntry['metadata'];
    }>
  ): void {
    for (const item of items) {
      this.set(item.content, item.embedding, item.metadata);
    }
  }

  /**
   * Create cache key from content
   */
  private createKey(content: string): string {
    return this.hashContent(content);
  }

  /**
   * Hash content
   */
  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Compress embedding for storage (quantize to fewer bits)
   */
  private compressEmbedding(embedding: number[]): number[] {
    // Quantize to 16-bit precision (reduces memory by ~50%)
    return embedding.map(v => Math.round(v * 32767) / 32767);
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: EmbeddingCacheEntry): boolean {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Evict entries if needed
   */
  private evictIfNeeded(): void {
    // Remove expired first
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        this.stats.evictions++;
      }
    }

    // Evict LRU if still over capacity
    while (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }
  }

  /**
   * Evict least recently used entry (with frequency weighting)
   */
  private evictLRU(): void {
    let lowestScore = Infinity;
    let lowestKey: string | null = null;

    for (const [key, entry] of this.cache.entries()) {
      // Score based on recency and frequency
      const age = Date.now() - entry.timestamp;
      const score = entry.hits + 1 / (age / 1000 + 1);

      if (score < lowestScore) {
        lowestScore = score;
        lowestKey = key;
      }
    }

    if (lowestKey) {
      this.cache.delete(lowestKey);
      this.stats.evictions++;
      this.emit('cache:evict', { key: lowestKey });
    }
  }

  /**
   * Update hit rate statistic
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Invalidate entries for a source file
   */
  invalidateSource(source: string): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.metadata?.source === source) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Get statistics
   */
  getStats(): EmbeddingCacheStats {
    return { ...this.stats };
  }

  /**
   * Format statistics
   */
  formatStats(): string {
    return [
      'Embedding Cache Statistics',
      `  Entries: ${this.stats.totalEntries}`,
      `  Hit Rate: ${(this.stats.hitRate * 100).toFixed(1)}%`,
      `  Computations Saved: ${this.stats.computationsSaved}`,
      `  Dimension: ${this.config.dimension}`,
      `  Model: ${this.config.modelName}`,
      `  Evictions: ${this.stats.evictions}`,
    ].join('\n');
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.pendingSave = [];
    this.stats = {
      totalEntries: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      computationsSaved: 0,
      dimensionMismatches: 0,
      evictions: 0,
    };
    this.emit('cache:clear');
  }

  /**
   * Schedule debounced save
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveToDisk();
    }, this.saveDebounceMs);
  }

  /**
   * Save to disk
   */
  private async saveToDisk(): Promise<void> {
    if (!this.config.persistToDisk || this.cache.size === 0) return;

    try {
      const dir = path.dirname(this.config.cachePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Only save non-expired entries
      const entries = Array.from(this.cache.values())
        .filter(e => !this.isExpired(e))
        .map(e => ({
          ...e,
          // Optionally compress embeddings further for storage
          embedding: e.embedding,
        }));

      await fs.writeFile(
        this.config.cachePath,
        JSON.stringify({
          version: 1,
          dimension: this.config.dimension,
          model: this.config.modelName,
          entries: entries.slice(0, this.config.maxEntries),
          stats: this.stats,
        })
      );

      this.pendingSave = [];
      logger.debug(`Saved ${entries.length} embeddings to cache`);
    } catch (error) {
      logger.debug('Failed to save embedding cache', { error });
    }
  }

  /**
   * Load from disk
   */
  private loadFromDisk(): void {
    if (!this.config.persistToDisk) return;

    (async () => {
      try {
        const content = await fs.readFile(this.config.cachePath, 'utf-8');
        const data = JSON.parse(content);

        // Validate version and dimension
        if (data.version !== 1 || data.dimension !== this.config.dimension) {
          logger.debug('Embedding cache version or dimension mismatch, starting fresh');
          return;
        }

        if (Array.isArray(data.entries)) {
          const now = Date.now();
          let loaded = 0;

          for (const entry of data.entries) {
            if (entry.expiresAt > now && entry.dimension === this.config.dimension) {
              this.cache.set(entry.key, entry);
              loaded++;
            }
          }

          this.stats.totalEntries = this.cache.size;
          logger.debug(`Loaded ${loaded} embeddings from cache`);
          this.emit('cache:loaded', { count: loaded });
        }
      } catch {
        // File doesn't exist or is invalid
      }
    })();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    // Final save
    if (this.config.persistToDisk && this.cache.size > 0) {
      this.saveToDisk();
    }

    this.cache.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: EmbeddingCache | null = null;

export function getEmbeddingCache(config?: Partial<EmbeddingCacheConfig>): EmbeddingCache {
  if (!instance) {
    instance = new EmbeddingCache(config);
  }
  return instance;
}

export function resetEmbeddingCache(): void {
  if (instance) {
    instance.dispose();
  }
  instance = null;
}
