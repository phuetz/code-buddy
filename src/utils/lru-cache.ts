/**
 * LRU (Least Recently Used) Cache Implementation
 *
 * Features:
 * - O(1) get, set, delete operations
 * - Configurable max size with automatic eviction
 * - Optional TTL (time-to-live) for entries
 * - Event emission for cache operations
 * - Statistics tracking
 *
 * Used to fix unbounded caches throughout the codebase.
 */

import { EventEmitter } from 'events';

export interface LRUCacheOptions<V> {
  maxSize: number;
  ttlMs?: number;
  onEvict?: (key: string, value: V) => void;
}

export interface CacheEntry<V> {
  value: V;
  createdAt: number;
  accessedAt: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

/**
 * LRU Cache with TTL support
 */
export class LRUCache<V = unknown> extends EventEmitter {
  private cache: Map<string, CacheEntry<V>> = new Map();
  private maxSize: number;
  private ttlMs: number | undefined;
  private onEvict: ((key: string, value: V) => void) | undefined;

  // Statistics
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;

  constructor(options: LRUCacheOptions<V>) {
    super();
    this.maxSize = Math.max(1, options.maxSize);
    this.ttlMs = options.ttlMs;
    this.onEvict = options.onEvict;
  }

  /**
   * Get a value from the cache
   */
  get(key: string): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL
    if (this.isExpired(entry)) {
      this.delete(key);
      this.misses++;
      return undefined;
    }

    // Update access time and move to end (most recently used)
    entry.accessedAt = Date.now();
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    return entry.value;
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: V): void {
    // Delete existing entry to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict if at capacity
    while (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const entry: CacheEntry<V> = {
      value,
      createdAt: Date.now(),
      accessedAt: Date.now(),
    };

    this.cache.set(key, entry);
    this.emit('set', { key, value });
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.cache.delete(key);
      this.emit('delete', { key, value: entry.value });
      return true;
    }
    return false;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.emit('clear', { size });
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all values
   */
  values(): V[] {
    return Array.from(this.cache.values())
      .filter(entry => !this.isExpired(entry))
      .map(entry => entry.value);
  }

  /**
   * Get all entries
   */
  entries(): Array<[string, V]> {
    const result: Array<[string, V]> = [];
    for (const [key, entry] of this.cache.entries()) {
      if (!this.isExpired(entry)) {
        result.push([key, entry.value]);
      }
    }
    return result;
  }

  /**
   * Iterate over entries (non-expired only)
   */
  forEach(callback: (value: V, key: string) => void): void {
    for (const [key, entry] of this.cache.entries()) {
      if (!this.isExpired(entry)) {
        callback(entry.value, key);
      }
    }
  }

  /**
   * Symbol.iterator for for...of loops and spread operator
   */
  *[Symbol.iterator](): Iterator<[string, V]> {
    for (const [key, entry] of this.cache.entries()) {
      if (!this.isExpired(entry)) {
        yield [key, entry.value];
      }
    }
  }

  /**
   * Convert to plain object (for JSON serialization)
   */
  toObject(): Record<string, V> {
    const result: Record<string, V> = {};
    for (const [key, value] of this) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Load entries from an object or Map
   */
  fromObject(data: Record<string, V> | Map<string, V>): void {
    if (data instanceof Map) {
      for (const [key, value] of data) {
        this.set(key, value);
      }
    } else {
      for (const [key, value] of Object.entries(data)) {
        this.set(key, value);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Remove expired entries
   */
  prune(): number {
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Update max size (may trigger evictions)
   */
  setMaxSize(maxSize: number): void {
    this.maxSize = Math.max(1, maxSize);
    while (this.cache.size > this.maxSize) {
      this.evictLRU();
    }
  }

  /**
   * Dispose and clean up
   */
  dispose(): void {
    this.clear();
    this.removeAllListeners();
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry<V>): boolean {
    if (!this.ttlMs) return false;
    return Date.now() - entry.createdAt > this.ttlMs;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    // Map maintains insertion order, first entry is LRU
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      const entry = this.cache.get(firstKey);
      this.cache.delete(firstKey);
      this.evictions++;

      if (entry && this.onEvict) {
        this.onEvict(firstKey, entry.value);
      }

      this.emit('evict', { key: firstKey, value: entry?.value });
    }
  }
}

// ============================================================================
// Specialized LRU Caches
// ============================================================================

/**
 * LRU Map - Drop-in replacement for Map with LRU eviction
 */
export class LRUMap<K, V> {
  private cache: LRUCache<V>;
  private keyToString: (key: K) => string;

  constructor(
    maxSize: number,
    options: {
      ttlMs?: number;
      keyToString?: (key: K) => string;
    } = {}
  ) {
    this.cache = new LRUCache<V>({ maxSize, ttlMs: options.ttlMs });
    this.keyToString = options.keyToString || ((k) => String(k));
  }

  get(key: K): V | undefined {
    return this.cache.get(this.keyToString(key));
  }

  set(key: K, value: V): this {
    this.cache.set(this.keyToString(key), value);
    return this;
  }

  has(key: K): boolean {
    return this.cache.has(this.keyToString(key));
  }

  delete(key: K): boolean {
    return this.cache.delete(this.keyToString(key));
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  values(): V[] {
    return this.cache.values();
  }

  getStats(): CacheStats {
    return this.cache.getStats();
  }

  dispose(): void {
    this.cache.dispose();
  }
}

// ============================================================================
// Cache Constants
// ============================================================================

/**
 * Default cache sizes for different use cases
 */
export const CACHE_SIZES = {
  SMALL: 100,
  MEDIUM: 500,
  LARGE: 1000,
  XLARGE: 5000,

  // Specific use cases
  CHECKPOINT: 50,
  CHUNK_STORE: 2000,
  FILE_INDEX: 1000,
  SYMBOL_INDEX: 5000,
  MEMORY: 500,
  ANALYSIS: 200,
  REPAIR_HISTORY: 100,
  CLIENT_POOL: 10,
} as const;

/**
 * Default TTL values in milliseconds
 */
export const CACHE_TTL = {
  SHORT: 60 * 1000,           // 1 minute
  MEDIUM: 5 * 60 * 1000,      // 5 minutes
  LONG: 30 * 60 * 1000,       // 30 minutes
  HOUR: 60 * 60 * 1000,       // 1 hour
  DAY: 24 * 60 * 60 * 1000,   // 24 hours
} as const;

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a checkpoint cache
 */
export function createCheckpointCache<V>(): LRUCache<V> {
  return new LRUCache<V>({
    maxSize: CACHE_SIZES.CHECKPOINT,
    ttlMs: CACHE_TTL.HOUR,
  });
}

/**
 * Create a chunk store cache
 */
export function createChunkStoreCache<V>(): LRUCache<V> {
  return new LRUCache<V>({
    maxSize: CACHE_SIZES.CHUNK_STORE,
    ttlMs: CACHE_TTL.LONG,
  });
}

/**
 * Create a memory cache
 */
export function createMemoryCache<V>(): LRUCache<V> {
  return new LRUCache<V>({
    maxSize: CACHE_SIZES.MEMORY,
    ttlMs: CACHE_TTL.DAY,
  });
}

/**
 * Create an analysis cache
 */
export function createAnalysisCache<V>(): LRUCache<V> {
  return new LRUCache<V>({
    maxSize: CACHE_SIZES.ANALYSIS,
    ttlMs: CACHE_TTL.MEDIUM,
  });
}
