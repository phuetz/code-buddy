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
  /** Enable adaptive similarity threshold based on context */
  adaptiveThreshold: boolean;
  /** Minimum similarity threshold (used with adaptive) */
  minSimilarityThreshold: number;
  /** Maximum similarity threshold (used with adaptive) */
  maxSimilarityThreshold: number;
  /** Enable locality-sensitive hashing for faster lookup */
  enableLSH: boolean;
  /** Number of LSH hash tables */
  lshTables: number;
  /** Number of LSH hash functions per table */
  lshHashFunctions: number;
  /** Enable query clustering for better cache organization */
  enableClustering: boolean;
  /** Number of clusters for query organization */
  numClusters: number;
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
  /** Number of LSH lookups performed */
  lshLookups: number;
  /** Number of LSH candidates found */
  lshCandidates: number;
  /** Average lookup time in ms */
  avgLookupTimeMs: number;
  /** Memory estimation in bytes */
  memoryEstimateBytes: number;
  /** Number of clusters (if enabled) */
  clusters: number;
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
  cachePath: '.codebuddy/cache/semantic-cache.json',
  ngramSize: 3,
  embeddingDim: 128,
  adaptiveThreshold: true,
  minSimilarityThreshold: 0.75,
  maxSimilarityThreshold: 0.95,
  enableLSH: true,
  lshTables: 5,
  lshHashFunctions: 8,
  enableClustering: false,
  numClusters: 10,
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
    lshLookups: 0,
    lshCandidates: 0,
    avgLookupTimeMs: 0,
    memoryEstimateBytes: 0,
    clusters: 0,
  };
  private similarityScores: number[] = [];
  private lookupTimes: number[] = [];
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private saveDebounceMs: number = 1000;

  // LSH structures for fast approximate nearest neighbor search
  private lshTables: Map<string, Set<string>>[] = [];
  private lshHyperplanes: number[][][] = [];

  // Query clusters for better organization
  private clusters: Map<number, Set<string>> = new Map();
  private clusterCentroids: number[][] = [];

  constructor(config: Partial<CacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize LSH if enabled
    if (this.config.enableLSH) {
      this.initializeLSH();
    }

    this.loadFromDisk();
  }

  /**
   * Initialize LSH hash tables and hyperplanes
   */
  private initializeLSH(): void {
    this.lshTables = [];
    this.lshHyperplanes = [];

    for (let t = 0; t < this.config.lshTables; t++) {
      this.lshTables.push(new Map());
      const tableHyperplanes: number[][] = [];

      for (let h = 0; h < this.config.lshHashFunctions; h++) {
        // Generate random hyperplane
        const hyperplane: number[] = [];
        for (let d = 0; d < this.config.embeddingDim; d++) {
          hyperplane.push(Math.random() * 2 - 1);
        }
        // Normalize
        const magnitude = Math.sqrt(hyperplane.reduce((sum, v) => sum + v * v, 0));
        tableHyperplanes.push(hyperplane.map(v => v / magnitude));
      }

      this.lshHyperplanes.push(tableHyperplanes);
    }
  }

  /**
   * Compute LSH hash for an embedding
   */
  private computeLSHHash(embedding: number[], tableIndex: number): string {
    const hyperplanes = this.lshHyperplanes[tableIndex];
    let hash = '';

    for (const hyperplane of hyperplanes) {
      const dotProduct = embedding.reduce((sum, v, i) => sum + v * hyperplane[i], 0);
      hash += dotProduct >= 0 ? '1' : '0';
    }

    return hash;
  }

  /**
   * Add entry to LSH tables
   */
  private addToLSH(key: string, embedding: number[]): void {
    if (!this.config.enableLSH) return;

    for (let t = 0; t < this.lshTables.length; t++) {
      const hash = this.computeLSHHash(embedding, t);
      if (!this.lshTables[t].has(hash)) {
        this.lshTables[t].set(hash, new Set());
      }
      this.lshTables[t].get(hash)!.add(key);
    }
  }

  /**
   * Remove entry from LSH tables
   */
  private removeFromLSH(key: string, embedding: number[]): void {
    if (!this.config.enableLSH) return;

    for (let t = 0; t < this.lshTables.length; t++) {
      const hash = this.computeLSHHash(embedding, t);
      const bucket = this.lshTables[t].get(hash);
      if (bucket) {
        bucket.delete(key);
        if (bucket.size === 0) {
          this.lshTables[t].delete(hash);
        }
      }
    }
  }

  /**
   * Find LSH candidates for a query embedding
   */
  private findLSHCandidates(embedding: number[]): Set<string> {
    if (!this.config.enableLSH) {
      return new Set(this.cache.keys());
    }

    this.stats.lshLookups++;
    const candidates = new Set<string>();

    for (let t = 0; t < this.lshTables.length; t++) {
      const hash = this.computeLSHHash(embedding, t);
      const bucket = this.lshTables[t].get(hash);
      if (bucket) {
        for (const key of bucket) {
          candidates.add(key);
        }
      }
    }

    this.stats.lshCandidates += candidates.size;
    return candidates;
  }

  /**
   * Get adaptive similarity threshold based on query characteristics
   */
  private getAdaptiveThreshold(query: string): number {
    if (!this.config.adaptiveThreshold) {
      return this.config.similarityThreshold;
    }

    // Shorter queries need higher similarity (more specific)
    // Longer queries can have lower similarity (more context)
    const queryLength = query.length;
    const normalizedLength = Math.min(queryLength / 500, 1); // Normalize to 0-1

    // Interpolate between min and max threshold
    const range = this.config.maxSimilarityThreshold - this.config.minSimilarityThreshold;
    const threshold = this.config.maxSimilarityThreshold - (normalizedLength * range * 0.5);

    // Also consider average similarity of recent hits
    if (this.similarityScores.length > 10) {
      const recentAvg = this.similarityScores.slice(-10).reduce((a, b) => a + b, 0) / 10;
      // Adjust threshold based on recent hit quality
      return Math.max(threshold * 0.95, Math.min(threshold, recentAvg - 0.05));
    }

    return threshold;
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
    const startTime = performance.now();

    // Try exact match first
    const exactKey = this.hashQuery(query);
    if (this.cache.has(exactKey)) {
      const entry = this.cache.get(exactKey)!;
      if (!this.isExpired(entry)) {
        this.stats.hits++;
        this.stats.exactHits++;
        this.updateHitRate();
        this.recordLookupTime(startTime);
        return { hit: true, entry, similarity: 1.0, isExactMatch: true };
      }
      // Remove expired entry
      this.removeEntry(exactKey);
    }

    // Try semantic match using LSH for candidate selection
    const queryEmbedding = this.computeEmbedding(query);
    const threshold = this.getAdaptiveThreshold(query);
    let bestMatch: CacheEntry<T> | null = null;
    let bestSimilarity = 0;

    // Get candidates from LSH or all entries if LSH disabled
    const candidates = this.findLSHCandidates(queryEmbedding);

    for (const key of candidates) {
      const entry = this.cache.get(key);
      if (!entry || this.isExpired(entry)) continue;

      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity > bestSimilarity && similarity >= threshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    // If LSH didn't find good candidates, fall back to full scan for high-value queries
    if (!bestMatch && this.config.enableLSH && candidates.size < this.cache.size * 0.1) {
      for (const entry of this.cache.values()) {
        if (this.isExpired(entry)) continue;

        const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
        if (similarity > bestSimilarity && similarity >= threshold) {
          bestSimilarity = similarity;
          bestMatch = entry;
        }
      }
    }

    if (bestMatch) {
      this.stats.hits++;
      this.stats.semanticHits++;
      this.similarityScores.push(bestSimilarity);
      this.updateHitRate();
      this.updateAvgSimilarity();
      this.recordLookupTime(startTime);
      return { hit: true, entry: bestMatch, similarity: bestSimilarity, isExactMatch: false };
    }

    this.recordLookupTime(startTime);
    return { hit: false };
  }

  /**
   * Record lookup time for metrics
   */
  private recordLookupTime(startTime: number): void {
    const elapsed = performance.now() - startTime;
    this.lookupTimes.push(elapsed);
    if (this.lookupTimes.length > 1000) {
      this.lookupTimes.shift();
    }
    this.stats.avgLookupTimeMs = this.lookupTimes.reduce((a, b) => a + b, 0) / this.lookupTimes.length;
  }

  /**
   * Remove entry and clean up LSH
   */
  private removeEntry(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      this.removeFromLSH(key, entry.embedding);
      this.cache.delete(key);
    }
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
    const embedding = this.computeEmbedding(query);

    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.removeEntry(key);
    }

    const entry: CacheEntry<T> = {
      key,
      query,
      response,
      embedding,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.ttlMs,
      hits: 0,
      metadata,
    };

    this.cache.set(key, entry);

    // Add to LSH index
    this.addToLSH(key, embedding);

    this.stats.totalEntries = this.cache.size;
    this.updateMemoryEstimate();
    this.emit('cache:set', { key, query });

    // Persist if enabled (debounced)
    if (this.config.persistToDisk) {
      this.scheduleSave();
    }
  }

  /**
   * Update memory estimate
   */
  private updateMemoryEstimate(): void {
    // Rough estimate: entry overhead + query string + embedding + response estimate
    let estimate = 0;
    for (const entry of this.cache.values()) {
      estimate += 200; // Object overhead
      estimate += entry.query.length * 2; // Query string (2 bytes per char)
      estimate += entry.embedding.length * 8; // Embedding (float64)
      estimate += JSON.stringify(entry.response).length * 2; // Response estimate
    }
    this.stats.memoryEstimateBytes = estimate;
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
      this.removeEntry(lowestKey);
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
    'rg',
    'glob',
    'find_files',
    'list_files',
    'web_search',
    'symbol_search',
    'find_references',
  ]);
  return cacheableTools.has(toolName);
}
