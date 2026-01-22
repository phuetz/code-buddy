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
  /** Minimum TTL in ms - entries won't expire before this time */
  minTtlMs?: number;
  /** Maximum TTL in ms - entries always expire after this time */
  maxTtlMs?: number;
  /** Enable adaptive TTL based on access frequency */
  adaptiveTtl?: boolean;
  /** TTL multiplier for frequently accessed entries (default: 2) */
  frequencyTtlMultiplier?: number;
  /** Threshold for "frequently accessed" entries (default: 3) */
  frequencyThreshold?: number;
  onEvict?: (key: string, value: V) => void;
  /** Enable detailed metrics collection */
  enableMetrics?: boolean;
  /** Name for metrics identification */
  cacheName?: string;
}

export interface CacheEntry<V> {
  value: V;
  createdAt: number;
  accessedAt: number;
  /** Dynamic TTL for this entry (can be extended for hot entries) */
  ttlMs?: number;
  /** Number of times this entry has been accessed */
  accessCount: number;
  /** Size in bytes (if tracked) */
  sizeBytes?: number;
}

export interface CacheStats {
  name?: string;
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
  /** Average time entries stay in cache (ms) */
  avgResidenceTimeMs: number;
  /** Average access count per entry */
  avgAccessCount: number;
  /** Hot entries (accessed >= frequencyThreshold times) */
  hotEntries: number;
  /** Cold entries (accessed < frequencyThreshold times) */
  coldEntries: number;
  /** Total bytes stored (if size tracking enabled) */
  totalBytes: number;
  /** Latency metrics */
  latency: {
    avgGetMs: number;
    avgSetMs: number;
    p95GetMs: number;
    p99GetMs: number;
  };
}

/**
 * LRU Cache with TTL support and advanced metrics
 */
export class LRUCache<V = unknown> extends EventEmitter {
  private cache: Map<string, CacheEntry<V>> = new Map();
  private maxSize: number;
  private ttlMs: number | undefined;
  private minTtlMs: number | undefined;
  private maxTtlMs: number | undefined;
  private adaptiveTtl: boolean;
  private frequencyTtlMultiplier: number;
  private frequencyThreshold: number;
  private onEvict: ((key: string, value: V) => void) | undefined;
  private enableMetrics: boolean;
  private cacheName: string;

  // Statistics
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;
  private totalBytes: number = 0;

  // Latency tracking
  private getLatencies: number[] = [];
  private setLatencies: number[] = [];
  private readonly maxLatencySamples = 1000;

  constructor(options: LRUCacheOptions<V>) {
    super();
    this.maxSize = Math.max(1, options.maxSize);
    this.ttlMs = options.ttlMs;
    this.minTtlMs = options.minTtlMs;
    this.maxTtlMs = options.maxTtlMs;
    this.adaptiveTtl = options.adaptiveTtl ?? false;
    this.frequencyTtlMultiplier = options.frequencyTtlMultiplier ?? 2;
    this.frequencyThreshold = options.frequencyThreshold ?? 3;
    this.onEvict = options.onEvict;
    this.enableMetrics = options.enableMetrics ?? true;
    this.cacheName = options.cacheName ?? 'unnamed';
  }

  /**
   * Get a value from the cache
   */
  get(key: string): V | undefined {
    const startTime = this.enableMetrics ? performance.now() : 0;
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      this.recordGetLatency(startTime);
      return undefined;
    }

    // Check TTL
    if (this.isExpired(entry)) {
      this.delete(key);
      this.misses++;
      this.recordGetLatency(startTime);
      return undefined;
    }

    // Update access time and move to end (most recently used)
    entry.accessedAt = Date.now();
    entry.accessCount++;

    // Adaptive TTL: extend TTL for frequently accessed entries
    if (this.adaptiveTtl && entry.accessCount >= this.frequencyThreshold) {
      this.extendTtl(entry);
    }

    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    this.recordGetLatency(startTime);
    return entry.value;
  }

  /**
   * Extend TTL for hot entries
   */
  private extendTtl(entry: CacheEntry<V>): void {
    if (!this.ttlMs) return;

    const currentTtl = entry.ttlMs ?? this.ttlMs;
    const newTtl = currentTtl * this.frequencyTtlMultiplier;

    // Respect max TTL if set
    if (this.maxTtlMs) {
      entry.ttlMs = Math.min(newTtl, this.maxTtlMs);
    } else {
      entry.ttlMs = newTtl;
    }
  }

  /**
   * Record get latency for metrics
   */
  private recordGetLatency(startTime: number): void {
    if (!this.enableMetrics || startTime === 0) return;
    const latency = performance.now() - startTime;
    this.getLatencies.push(latency);
    if (this.getLatencies.length > this.maxLatencySamples) {
      this.getLatencies.shift();
    }
  }

  /**
   * Record set latency for metrics
   */
  private recordSetLatency(startTime: number): void {
    if (!this.enableMetrics || startTime === 0) return;
    const latency = performance.now() - startTime;
    this.setLatencies.push(latency);
    if (this.setLatencies.length > this.maxLatencySamples) {
      this.setLatencies.shift();
    }
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: V, options?: { ttlMs?: number; sizeBytes?: number }): void {
    const startTime = this.enableMetrics ? performance.now() : 0;

    // Delete existing entry to update position
    const existing = this.cache.get(key);
    if (existing) {
      if (existing.sizeBytes) {
        this.totalBytes -= existing.sizeBytes;
      }
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
      accessCount: 0,
      ttlMs: options?.ttlMs,
      sizeBytes: options?.sizeBytes,
    };

    if (options?.sizeBytes) {
      this.totalBytes += options.sizeBytes;
    }

    this.cache.set(key, entry);
    this.recordSetLatency(startTime);
    this.emit('set', { key, value });
  }

  /**
   * Set with custom TTL (convenience method)
   */
  setWithTtl(key: string, value: V, ttlMs: number): void {
    this.set(key, value, { ttlMs });
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
    const now = Date.now();

    // Calculate average residence time and access count
    let totalResidenceTime = 0;
    let totalAccessCount = 0;
    let hotEntries = 0;
    let coldEntries = 0;

    for (const entry of this.cache.values()) {
      totalResidenceTime += now - entry.createdAt;
      totalAccessCount += entry.accessCount;

      if (entry.accessCount >= this.frequencyThreshold) {
        hotEntries++;
      } else {
        coldEntries++;
      }
    }

    const cacheSize = this.cache.size || 1;

    return {
      name: this.cacheName,
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? this.hits / total : 0,
      avgResidenceTimeMs: totalResidenceTime / cacheSize,
      avgAccessCount: totalAccessCount / cacheSize,
      hotEntries,
      coldEntries,
      totalBytes: this.totalBytes,
      latency: this.calculateLatencyStats(),
    };
  }

  /**
   * Calculate latency percentiles
   */
  private calculateLatencyStats(): CacheStats['latency'] {
    const avgGetMs = this.getLatencies.length > 0
      ? this.getLatencies.reduce((a, b) => a + b, 0) / this.getLatencies.length
      : 0;
    const avgSetMs = this.setLatencies.length > 0
      ? this.setLatencies.reduce((a, b) => a + b, 0) / this.setLatencies.length
      : 0;

    // Calculate percentiles
    const sortedGet = [...this.getLatencies].sort((a, b) => a - b);
    const p95GetIdx = Math.floor(sortedGet.length * 0.95);
    const p99GetIdx = Math.floor(sortedGet.length * 0.99);

    return {
      avgGetMs,
      avgSetMs,
      p95GetMs: sortedGet[p95GetIdx] || 0,
      p99GetMs: sortedGet[p99GetIdx] || 0,
    };
  }

  /**
   * Format statistics for display
   */
  formatStats(): string {
    const stats = this.getStats();
    const lines = [
      `Cache: ${stats.name}`,
      `  Size: ${stats.size}/${stats.maxSize}`,
      `  Hit Rate: ${(stats.hitRate * 100).toFixed(1)}%`,
      `  Hits/Misses: ${stats.hits}/${stats.misses}`,
      `  Evictions: ${stats.evictions}`,
      `  Hot/Cold Entries: ${stats.hotEntries}/${stats.coldEntries}`,
      `  Avg Residence: ${(stats.avgResidenceTimeMs / 1000).toFixed(1)}s`,
      `  Avg Accesses: ${stats.avgAccessCount.toFixed(1)}`,
    ];

    if (stats.totalBytes > 0) {
      lines.push(`  Total Bytes: ${(stats.totalBytes / 1024).toFixed(1)}KB`);
    }

    if (stats.latency.avgGetMs > 0) {
      lines.push(`  Latency: avg=${stats.latency.avgGetMs.toFixed(2)}ms, p95=${stats.latency.p95GetMs.toFixed(2)}ms`);
    }

    return lines.join('\n');
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
   * Check if entry is expired (supports adaptive TTL)
   */
  private isExpired(entry: CacheEntry<V>): boolean {
    // No TTL configured - never expires
    if (!this.ttlMs && !entry.ttlMs) return false;

    const age = Date.now() - entry.createdAt;
    const effectiveTtl = entry.ttlMs ?? this.ttlMs!;

    // Check minimum TTL - entry never expires before minTtl
    if (this.minTtlMs && age < this.minTtlMs) {
      return false;
    }

    // Check maximum TTL - entry always expires after maxTtl
    if (this.maxTtlMs && age > this.maxTtlMs) {
      return true;
    }

    return age > effectiveTtl;
  }

  /**
   * Get remaining TTL for an entry
   */
  getRemainingTtl(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const effectiveTtl = entry.ttlMs ?? this.ttlMs;
    if (!effectiveTtl) return Infinity;

    const remaining = effectiveTtl - (Date.now() - entry.createdAt);
    return Math.max(0, remaining);
  }

  /**
   * Manually refresh TTL for an entry
   */
  touch(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry || this.isExpired(entry)) return false;

    entry.accessedAt = Date.now();
    entry.createdAt = Date.now(); // Reset TTL timer
    entry.accessCount++;

    // Move to end
    this.cache.delete(key);
    this.cache.set(key, entry);

    return true;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    // Map maintains insertion order, first entry is LRU
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      const entry = this.cache.get(firstKey);
      if (entry?.sizeBytes) {
        this.totalBytes -= entry.sizeBytes;
      }
      this.cache.delete(firstKey);
      this.evictions++;

      if (entry && this.onEvict) {
        this.onEvict(firstKey, entry.value);
      }

      this.emit('evict', { key: firstKey, value: entry?.value });
    }
  }

  /**
   * Get or compute a value (cache-aside pattern)
   */
  async getOrCompute(key: string, computeFn: () => Promise<V>, options?: { ttlMs?: number }): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await computeFn();
    this.set(key, value, options);
    return value;
  }

  /**
   * Get or compute (sync version)
   */
  getOrComputeSync(key: string, computeFn: () => V, options?: { ttlMs?: number }): V {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = computeFn();
    this.set(key, value, options);
    return value;
  }

  /**
   * Export cache state for persistence
   */
  export(): { entries: Array<[string, CacheEntry<V>]>; stats: CacheStats } {
    const entries: Array<[string, CacheEntry<V>]> = [];
    for (const [key, entry] of this.cache.entries()) {
      if (!this.isExpired(entry)) {
        entries.push([key, entry]);
      }
    }
    return { entries, stats: this.getStats() };
  }

  /**
   * Import cache state from persistence
   */
  import(data: { entries: Array<[string, CacheEntry<V>]> }): number {
    let imported = 0;
    const now = Date.now();

    for (const [key, entry] of data.entries) {
      // Recalculate expiration based on original TTL
      const age = now - entry.createdAt;
      const effectiveTtl = entry.ttlMs ?? this.ttlMs;

      if (!effectiveTtl || age < effectiveTtl) {
        this.cache.set(key, entry);
        if (entry.sizeBytes) {
          this.totalBytes += entry.sizeBytes;
        }
        imported++;
      }
    }

    return imported;
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
