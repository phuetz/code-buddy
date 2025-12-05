/**
 * Semantic Cache for API Responses
 *
 * Based on research showing 68% API call reduction with semantic caching:
 * - Uses cosine similarity to match similar queries
 * - Simple embedding via character n-grams (no external API needed)
 * - LRU eviction with configurable size limits
 * - TTL-based expiration
 *
 * This provides significant cost and latency reduction for repeated queries.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface CacheEntry<T = unknown> {
  key: string;
  query: string;
  response: T;
  embedding: number[];
  timestamp: number;
  expiresAt: number;
  hits: number;
  metadata?: Record<string, unknown>;
}

export interface CacheConfig {
  maxEntries: number;
  ttlMs: number;
  similarityThreshold: number;
  persistToDisk: boolean;
  cachePath: string;
  ngramSize: number;
  embeddingDim: number;
}

export interface CacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  semanticHits: number;
  exactHits: number;
  evictions: number;
  avgSimilarity: number;
}

export interface CacheLookupResult<T = unknown> {
  hit: boolean;
  entry?: CacheEntry<T>;
  similarity?: number;
  isExactMatch?: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 1000,
  ttlMs: 30 * 60 * 1000, // 30 minutes
  similarityThreshold: 0.85,
  persistToDisk: true,
  cachePath: '.grok/cache/semantic-cache.json',
  ngramSize: 3,
  embeddingDim: 128,
};

// ============================================================================
// Semantic Cache
// ============================================================================

export class SemanticCache<T = unknown> extends EventEmitter {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private config: CacheConfig;
  private stats: CacheStats = {
    totalEntries: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    semanticHits: 0,
    exactHits: 0,
    evictions: 0,
    avgSimilarity: 0,
  };
  private similarityScores: number[] = [];
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private saveDebounceMs: number = 1000;

  constructor(config: Partial<CacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadFromDisk();
  }

  /**
   * Get or compute a cached response
   */
  async getOrCompute(
    query: string,
    computeFn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<{ result: T; cached: boolean; similarity?: number }> {
    // Try to find in cache
    const lookup = this.lookup(query);

    if (lookup.hit && lookup.entry) {
      lookup.entry.hits++;
      this.emit('cache:hit', { query, similarity: lookup.similarity });
      return {
        result: lookup.entry.response,
        cached: true,
        similarity: lookup.similarity,
      };
    }

    // Compute new result
    this.stats.misses++;
    this.emit('cache:miss', { query });

    const result = await computeFn();

    // Store in cache
    this.set(query, result, metadata);

    return { result, cached: false };
  }

  /**
   * Look up a query in the cache
   */
  lookup(query: string): CacheLookupResult<T> {
    // Try exact match first
    const exactKey = this.hashQuery(query);
    if (this.cache.has(exactKey)) {
      const entry = this.cache.get(exactKey)!;
      if (!this.isExpired(entry)) {
        this.stats.hits++;
        this.stats.exactHits++;
        this.updateHitRate();
        return { hit: true, entry, similarity: 1.0, isExactMatch: true };
      }
      // Remove expired entry
      this.cache.delete(exactKey);
    }

    // Try semantic match
    const queryEmbedding = this.computeEmbedding(query);
    let bestMatch: CacheEntry<T> | null = null;
    let bestSimilarity = 0;

    for (const entry of this.cache.values()) {
      if (this.isExpired(entry)) continue;

      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity > bestSimilarity && similarity >= this.config.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      this.stats.hits++;
      this.stats.semanticHits++;
      this.similarityScores.push(bestSimilarity);
      this.updateHitRate();
      this.updateAvgSimilarity();
      return { hit: true, entry: bestMatch, similarity: bestSimilarity, isExactMatch: false };
    }

    return { hit: false };
  }

  /**
   * Store a response in the cache
   */
  set(query: string, response: T, metadata?: Record<string, unknown>): void {
    // Evict if at capacity
    if (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }

    const key = this.hashQuery(query);
    const entry: CacheEntry<T> = {
      key,
      query,
      response,
      embedding: this.computeEmbedding(query),
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.ttlMs,
      hits: 0,
      metadata,
    };

    this.cache.set(key, entry);
    this.stats.totalEntries = this.cache.size;
    this.emit('cache:set', { key, query });

    // Persist if enabled (debounced)
    if (this.config.persistToDisk) {
      this.scheduleSave();
    }
  }

  /**
   * Schedule a debounced save to reduce I/O
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
   * Invalidate cache entries matching a pattern
   */
  invalidate(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    let count = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (regex.test(entry.query)) {
        this.cache.delete(key);
        count++;
      }
    }

    this.stats.totalEntries = this.cache.size;
    this.emit('cache:invalidate', { pattern: pattern.toString(), count });
    return count;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    const count = this.cache.size;
    this.cache.clear();
    this.stats.totalEntries = 0;
    this.emit('cache:clear', { count });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Compute simple n-gram based embedding
   * Uses character n-grams for language-agnostic similarity
   */
  private computeEmbedding(text: string): number[] {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const embedding = new Array(this.config.embeddingDim).fill(0);

    // Extract character n-grams
    const ngrams: string[] = [];
    for (let i = 0; i <= normalized.length - this.config.ngramSize; i++) {
      ngrams.push(normalized.slice(i, i + this.config.ngramSize));
    }

    // Hash n-grams into embedding dimensions
    for (const ngram of ngrams) {
      const hash = this.simpleHash(ngram);
      const index = hash % this.config.embeddingDim;
      embedding[index] += 1;
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(
      embedding.reduce((sum, val) => sum + val * val, 0)
    );
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  /**
   * Compute cosine similarity between two embeddings
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  /**
   * Simple hash function for n-grams
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Hash query for exact match key
   */
  private hashQuery(query: string): string {
    const normalized = query.toLowerCase().replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      this.emit('cache:evict', { key: oldestKey });
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
   * Update average similarity statistic
   */
  private updateAvgSimilarity(): void {
    if (this.similarityScores.length > 0) {
      this.stats.avgSimilarity =
        this.similarityScores.reduce((a, b) => a + b, 0) / this.similarityScores.length;
    }
  }

  /**
   * Load cache from disk
   */
  private loadFromDisk(): void {
    if (!this.config.persistToDisk) return;

    // Use async loading
    (async () => {
      try {
        const content = await fs.readFile(this.config.cachePath, 'utf-8');
        const data = JSON.parse(content);

        if (Array.isArray(data.entries)) {
          const now = Date.now();
          for (const entry of data.entries) {
            // Skip expired entries
            if (entry.expiresAt > now) {
              this.cache.set(entry.key, entry);
            }
          }
          this.stats.totalEntries = this.cache.size;
          this.emit('cache:loaded', { count: this.cache.size });
        }
      } catch {
        // File doesn't exist or is invalid - start fresh
      }
    })();
  }

  /**
   * Save cache to disk (async)
   */
  private async saveToDisk(): Promise<void> {
    if (!this.config.persistToDisk) return;

    try {
      const dir = path.dirname(this.config.cachePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const entries = Array.from(this.cache.values());
      await fs.writeFile(
        this.config.cachePath,
        JSON.stringify({ entries, stats: this.stats }, null, 2)
      );
    } catch {
      // Ignore save errors
    }
  }

  /**
   * Dispose and flush pending saves
   */
  dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.saveToDisk();
    this.cache.clear();
    this.removeAllListeners();
  }

  /**
   * Get config
   */
  getConfig(): CacheConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================================================
// Singleton for API response caching
// ============================================================================

let apiCacheInstance: SemanticCache | null = null;

export function getApiCache(config?: Partial<CacheConfig>): SemanticCache {
  if (!apiCacheInstance) {
    apiCacheInstance = new SemanticCache(config);
  }
  return apiCacheInstance;
}

export function resetApiCache(): void {
  if (apiCacheInstance) {
    apiCacheInstance.dispose();
  }
  apiCacheInstance = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a cache key from tool name and arguments
 */
export function createToolCacheKey(
  toolName: string,
  args: Record<string, unknown>
): string {
  const sortedArgs = Object.keys(args)
    .sort()
    .map((k) => `${k}=${JSON.stringify(args[k])}`)
    .join('&');
  return `${toolName}:${sortedArgs}`;
}

/**
 * Check if a tool response is cacheable
 */
export function isCacheable(toolName: string): boolean {
  const cacheableTools = new Set([
    'search',
    'grep',
    'glob',
    'find_files',
    'list_files',
    'web_search',
    'symbol_search',
    'find_references',
  ]);
  return cacheableTools.has(toolName);
}
