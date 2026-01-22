/**
 * Search Results Cache
 *
 * Caches search and grep results with file-change-aware invalidation.
 * Key features:
 * - Query normalization for better hit rates
 * - File dependency tracking for invalidation
 * - Concurrent request deduplication
 * - Pattern-based invalidation
 *
 * Search operations are expensive - caching provides significant speedup
 * for repeated queries.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface SearchCacheEntry<T = unknown> {
  key: string;
  queryHash: string;
  normalizedQuery: string;
  results: T;
  affectedFiles: string[];
  timestamp: number;
  expiresAt: number;
  hits: number;
  searchType: 'text' | 'file' | 'symbol' | 'reference';
  metadata?: {
    resultCount?: number;
    executionTimeMs?: number;
    options?: Record<string, unknown>;
  };
}

export interface SearchCacheConfig {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  invalidateOnFileChange: boolean;
  deduplicateRequests: boolean;
  normalizeQueries: boolean;
  /** Enable tiered TTL based on result freshness importance */
  tieredTtl: boolean;
  /** TTL for text search (most volatile) */
  textSearchTtlMs: number;
  /** TTL for file search (moderately volatile) */
  fileSearchTtlMs: number;
  /** TTL for symbol search (least volatile) */
  symbolSearchTtlMs: number;
  /** Enable result ranking optimization */
  enableRankingOptimization: boolean;
  /** Minimum execution time to cache (ms) - skip caching fast queries */
  minExecutionTimeToCache: number;
  /** Enable partial match fallback */
  enablePartialMatch: boolean;
  /** Similarity threshold for partial matching */
  partialMatchThreshold: number;
}

export interface SearchCacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  deduplicatedRequests: number;
  invalidations: number;
  evictions: number;
  byType: {
    text: number;
    file: number;
    symbol: number;
    reference: number;
  };
  /** Partial match hits */
  partialHits: number;
  /** Average execution time saved (ms) */
  avgTimeSavedMs: number;
  /** Total execution time saved (ms) */
  totalTimeSavedMs: number;
  /** Cache efficiency score (0-1) */
  efficiencyScore: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SearchCacheConfig = {
  enabled: true,
  ttlMs: 2 * 60 * 1000, // 2 minutes (searches can become stale quickly)
  maxEntries: 200,
  invalidateOnFileChange: true,
  deduplicateRequests: true,
  normalizeQueries: true,
  tieredTtl: true,
  textSearchTtlMs: 1 * 60 * 1000, // 1 minute - text content changes frequently
  fileSearchTtlMs: 5 * 60 * 1000, // 5 minutes - file structure changes less
  symbolSearchTtlMs: 10 * 60 * 1000, // 10 minutes - symbols change rarely
  enableRankingOptimization: true,
  minExecutionTimeToCache: 50, // Don't cache queries faster than 50ms
  enablePartialMatch: true,
  partialMatchThreshold: 0.75,
};

// ============================================================================
// Search Results Cache
// ============================================================================

export class SearchResultsCache<T = unknown> extends EventEmitter {
  private cache: Map<string, SearchCacheEntry<T>> = new Map();
  private config: SearchCacheConfig;
  private stats: SearchCacheStats = {
    totalEntries: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    deduplicatedRequests: 0,
    invalidations: 0,
    evictions: 0,
    byType: {
      text: 0,
      file: 0,
      symbol: 0,
      reference: 0,
    },
    partialHits: 0,
    avgTimeSavedMs: 0,
    totalTimeSavedMs: 0,
    efficiencyScore: 0,
  };

  // Pending requests for deduplication
  private pendingRequests: Map<string, Promise<T>> = new Map();

  // File -> cache keys mapping for invalidation
  private fileToKeys: Map<string, Set<string>> = new Map();

  // Time savings tracking
  private timeSavings: number[] = [];

  // Query frequency tracking for ranking optimization
  private queryFrequency: Map<string, number> = new Map();

  constructor(config: Partial<SearchCacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get TTL based on search type
   */
  private getTtlForType(searchType: SearchCacheEntry['searchType']): number {
    if (!this.config.tieredTtl) {
      return this.config.ttlMs;
    }

    switch (searchType) {
      case 'text':
        return this.config.textSearchTtlMs;
      case 'file':
        return this.config.fileSearchTtlMs;
      case 'symbol':
      case 'reference':
        return this.config.symbolSearchTtlMs;
      default:
        return this.config.ttlMs;
    }
  }

  /**
   * Get cached search result
   */
  get(
    query: string,
    searchType: SearchCacheEntry['searchType'],
    options?: Record<string, unknown>
  ): T | null {
    if (!this.config.enabled) return null;

    const key = this.createKey(query, searchType, options);
    const entry = this.cache.get(key);

    // Track query frequency for ranking
    if (this.config.enableRankingOptimization) {
      const normalizedQuery = this.normalizeQuery(query);
      this.queryFrequency.set(normalizedQuery, (this.queryFrequency.get(normalizedQuery) || 0) + 1);
    }

    if (entry && !this.isExpired(entry)) {
      entry.hits++;
      this.stats.hits++;
      this.stats.byType[searchType]++;

      // Track time saved
      if (entry.metadata?.executionTimeMs) {
        this.recordTimeSaved(entry.metadata.executionTimeMs);
      }

      this.updateHitRate();
      this.updateEfficiencyScore();
      this.emit('cache:hit', { key, searchType });
      return entry.results;
    }

    // Try partial match if enabled
    if (this.config.enablePartialMatch) {
      const partialMatch = this.findPartialMatch(query, searchType, options);
      if (partialMatch) {
        this.stats.partialHits++;
        this.stats.hits++;
        this.stats.byType[searchType]++;
        this.updateHitRate();
        this.updateEfficiencyScore();
        this.emit('cache:partial-hit', { key, searchType, similarity: partialMatch.similarity });
        return partialMatch.entry.results;
      }
    }

    // Remove expired entry if present
    if (entry) {
      this.removeEntry(key, entry);
    }

    this.stats.misses++;
    this.updateHitRate();
    this.updateEfficiencyScore();
    return null;
  }

  /**
   * Find a partial match for a query
   */
  private findPartialMatch(
    query: string,
    searchType: SearchCacheEntry['searchType'],
    _options?: Record<string, unknown>
  ): { entry: SearchCacheEntry<T>; similarity: number } | null {
    const normalizedQuery = this.normalizeQuery(query);
    const queryWords = new Set(normalizedQuery.split(/\s+/));

    let bestMatch: SearchCacheEntry<T> | null = null;
    let bestSimilarity = 0;

    for (const entry of this.cache.values()) {
      if (entry.searchType !== searchType) continue;
      if (this.isExpired(entry)) continue;

      // Calculate Jaccard similarity
      const entryWords = new Set(entry.normalizedQuery.split(/\s+/));
      const intersection = new Set([...queryWords].filter(w => entryWords.has(w)));
      const union = new Set([...queryWords, ...entryWords]);
      const similarity = intersection.size / union.size;

      if (similarity >= this.config.partialMatchThreshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    return bestMatch ? { entry: bestMatch, similarity: bestSimilarity } : null;
  }

  /**
   * Record time saved for metrics
   */
  private recordTimeSaved(timeMs: number): void {
    this.timeSavings.push(timeMs);
    if (this.timeSavings.length > 1000) {
      this.timeSavings.shift();
    }

    this.stats.totalTimeSavedMs += timeMs;
    this.stats.avgTimeSavedMs = this.timeSavings.reduce((a, b) => a + b, 0) / this.timeSavings.length;
  }

  /**
   * Update efficiency score
   */
  private updateEfficiencyScore(): void {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) {
      this.stats.efficiencyScore = 0;
      return;
    }

    // Efficiency = weighted combination of hit rate, partial hit rate, and deduplication
    const hitRate = this.stats.hits / total;
    const partialRate = this.stats.partialHits / Math.max(1, this.stats.hits);
    const dedupeRate = this.stats.deduplicatedRequests / Math.max(1, total);

    this.stats.efficiencyScore = hitRate * 0.6 + partialRate * 0.2 + dedupeRate * 0.2;
  }

  /**
   * Store search result in cache
   */
  set(
    query: string,
    searchType: SearchCacheEntry['searchType'],
    results: T,
    options?: {
      affectedFiles?: string[];
      executionTimeMs?: number;
      options?: Record<string, unknown>;
    }
  ): void {
    if (!this.config.enabled) return;

    // Skip caching fast queries if configured
    if (options?.executionTimeMs !== undefined &&
        options.executionTimeMs < this.config.minExecutionTimeToCache) {
      return;
    }

    // Evict if needed
    this.evictIfNeeded();

    const key = this.createKey(query, searchType, options?.options);
    const normalizedQuery = this.config.normalizeQueries ? this.normalizeQuery(query) : query;
    const affectedFiles = options?.affectedFiles || [];

    // Use tiered TTL based on search type
    const ttl = this.getTtlForType(searchType);

    const entry: SearchCacheEntry<T> = {
      key,
      queryHash: this.hashString(query),
      normalizedQuery,
      results,
      affectedFiles,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
      hits: 0,
      searchType,
      metadata: {
        resultCount: Array.isArray(results) ? results.length : undefined,
        executionTimeMs: options?.executionTimeMs,
        options: options?.options,
      },
    };

    // Remove old entry if exists
    const existing = this.cache.get(key);
    if (existing) {
      this.removeFileMapping(key, existing.affectedFiles);
    }

    this.cache.set(key, entry);

    // Track file dependencies
    if (this.config.invalidateOnFileChange) {
      this.addFileMapping(key, affectedFiles);
    }

    this.stats.totalEntries = this.cache.size;
    this.emit('cache:set', { key, searchType, ttl });
  }

  /**
   * Get or compute search result with deduplication
   */
  async getOrCompute(
    query: string,
    searchType: SearchCacheEntry['searchType'],
    computeFn: () => Promise<T>,
    options?: {
      affectedFiles?: string[];
      options?: Record<string, unknown>;
    }
  ): Promise<{ results: T; cached: boolean }> {
    // Try cache first
    const cached = this.get(query, searchType, options?.options);
    if (cached !== null) {
      return { results: cached, cached: true };
    }

    // Deduplicate concurrent requests
    if (this.config.deduplicateRequests) {
      const key = this.createKey(query, searchType, options?.options);
      const pending = this.pendingRequests.get(key);

      if (pending) {
        this.stats.deduplicatedRequests++;
        const results = await pending;
        return { results, cached: false };
      }

      // Execute and cache
      const promise = (async () => {
        const startTime = Date.now();
        const results = await computeFn();
        const executionTimeMs = Date.now() - startTime;

        this.set(query, searchType, results, {
          ...options,
          executionTimeMs,
        });

        return results;
      })();

      this.pendingRequests.set(key, promise);

      try {
        const results = await promise;
        return { results, cached: false };
      } finally {
        this.pendingRequests.delete(key);
      }
    }

    // No deduplication
    const startTime = Date.now();
    const results = await computeFn();
    const executionTimeMs = Date.now() - startTime;

    this.set(query, searchType, results, {
      ...options,
      executionTimeMs,
    });

    return { results, cached: false };
  }

  /**
   * Invalidate cache entries affected by a file change
   */
  invalidateForFile(filePath: string): number {
    if (!this.config.invalidateOnFileChange) return 0;

    const keys = this.fileToKeys.get(filePath);
    if (!keys) return 0;

    let count = 0;
    for (const key of keys) {
      const entry = this.cache.get(key);
      if (entry) {
        this.removeEntry(key, entry);
        count++;
      }
    }

    this.stats.invalidations += count;
    this.emit('cache:invalidate', { file: filePath, count });
    return count;
  }

  /**
   * Invalidate entries matching a pattern
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (pattern.test(entry.normalizedQuery)) {
        this.removeEntry(key, entry);
        count++;
      }
    }
    this.stats.invalidations += count;
    return count;
  }

  /**
   * Invalidate entries by search type
   */
  invalidateByType(searchType: SearchCacheEntry['searchType']): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.searchType === searchType) {
        this.removeEntry(key, entry);
        count++;
      }
    }
    this.stats.invalidations += count;
    return count;
  }

  /**
   * Create cache key
   */
  private createKey(
    query: string,
    searchType: string,
    options?: Record<string, unknown>
  ): string {
    const normalizedQuery = this.config.normalizeQueries ? this.normalizeQuery(query) : query;
    const parts = [searchType, this.hashString(normalizedQuery)];

    if (options) {
      const sortedOptions = Object.keys(options)
        .sort()
        .map(k => `${k}=${JSON.stringify(options[k])}`)
        .join('&');
      parts.push(this.hashString(sortedOptions));
    }

    return parts.join(':');
  }

  /**
   * Normalize query for better cache hits
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Hash string
   */
  private hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 12);
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: SearchCacheEntry<T>): boolean {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Remove entry and its file mappings
   */
  private removeEntry(key: string, entry: SearchCacheEntry<T>): void {
    this.removeFileMapping(key, entry.affectedFiles);
    this.cache.delete(key);
  }

  /**
   * Add file -> key mapping
   */
  private addFileMapping(key: string, files: string[]): void {
    for (const file of files) {
      let keys = this.fileToKeys.get(file);
      if (!keys) {
        keys = new Set();
        this.fileToKeys.set(file, keys);
      }
      keys.add(key);
    }
  }

  /**
   * Remove file -> key mapping
   */
  private removeFileMapping(key: string, files: string[]): void {
    for (const file of files) {
      const keys = this.fileToKeys.get(file);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) {
          this.fileToKeys.delete(file);
        }
      }
    }
  }

  /**
   * Evict entries if needed
   */
  private evictIfNeeded(): void {
    // Remove expired first
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.removeEntry(key, entry);
        this.stats.evictions++;
      }
    }

    // Evict LRU if still over capacity
    while (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      const score = entry.timestamp + entry.hits * 1000;
      if (score < oldestTime) {
        oldestTime = score;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey);
      if (entry) {
        this.removeEntry(oldestKey, entry);
      }
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
   * Get statistics
   */
  getStats(): SearchCacheStats {
    return { ...this.stats };
  }

  /**
   * Format statistics
   */
  formatStats(): string {
    return [
      'Search Results Cache Statistics',
      `  Entries: ${this.stats.totalEntries}`,
      `  Hit Rate: ${(this.stats.hitRate * 100).toFixed(1)}%`,
      `  Deduplicated: ${this.stats.deduplicatedRequests}`,
      `  Invalidations: ${this.stats.invalidations}`,
      `  By Type:`,
      `    Text: ${this.stats.byType.text}`,
      `    File: ${this.stats.byType.file}`,
      `    Symbol: ${this.stats.byType.symbol}`,
      `    Reference: ${this.stats.byType.reference}`,
    ].join('\n');
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.fileToKeys.clear();
    this.pendingRequests.clear();
    this.timeSavings = [];
    this.queryFrequency.clear();
    this.stats = {
      totalEntries: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      deduplicatedRequests: 0,
      invalidations: 0,
      evictions: 0,
      byType: {
        text: 0,
        file: 0,
        symbol: 0,
        reference: 0,
      },
      partialHits: 0,
      avgTimeSavedMs: 0,
      totalTimeSavedMs: 0,
      efficiencyScore: 0,
    };
    this.emit('cache:clear');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.cache.clear();
    this.fileToKeys.clear();
    this.pendingRequests.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SearchResultsCache | null = null;

export function getSearchResultsCache<T = unknown>(
  config?: Partial<SearchCacheConfig>
): SearchResultsCache<T> {
  if (!instance) {
    instance = new SearchResultsCache(config);
  }
  return instance as SearchResultsCache<T>;
}

export function resetSearchResultsCache(): void {
  if (instance) {
    instance.dispose();
  }
  instance = null;
}
