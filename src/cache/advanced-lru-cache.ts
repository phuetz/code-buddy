/**
 * Advanced LRU Cache with Disk Spillover
 *
 * Features:
 * - Memory-first with automatic disk spillover for large objects
 * - Configurable memory/disk thresholds
 * - Compressed disk storage
 * - Automatic promotion from disk to memory on access
 * - TTL support with lazy expiration
 * - Detailed metrics collection
 *
 * Usage:
 * ```typescript
 * const cache = new AdvancedLRUCache<MyData>({
 *   name: 'my-cache',
 *   maxMemoryEntries: 1000,
 *   maxDiskEntries: 10000,
 *   memoryThresholdBytes: 10 * 1024, // Objects > 10KB go to disk
 *   ttlMs: 60 * 60 * 1000, // 1 hour
 * });
 *
 * await cache.set('key', largeObject);
 * const value = await cache.get('key');
 * ```
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// ============================================================================
// Types
// ============================================================================

export interface AdvancedLRUCacheConfig {
  /** Cache name for identification and disk storage */
  name: string;
  /** Maximum number of entries in memory */
  maxMemoryEntries: number;
  /** Maximum number of entries on disk */
  maxDiskEntries: number;
  /** Objects larger than this (in bytes) are stored on disk */
  memoryThresholdBytes: number;
  /** Time-to-live in milliseconds */
  ttlMs: number;
  /** Base directory for disk cache */
  cacheDir: string;
  /** Enable compression for disk storage */
  compressionEnabled: boolean;
  /** Compression level (1-9) */
  compressionLevel: number;
  /** Enable metrics collection */
  metricsEnabled: boolean;
  /** Auto-promote disk entries to memory on access */
  autoPromote: boolean;
  /** Callback for serialization */
  serialize?: (value: unknown) => string;
  /** Callback for deserialization */
  deserialize?: (data: string) => unknown;
}

export interface CacheEntry<V> {
  key: string;
  value: V;
  sizeBytes: number;
  createdAt: number;
  accessedAt: number;
  expiresAt: number;
  accessCount: number;
  location: 'memory' | 'disk';
}

export interface CacheMetrics {
  name: string;
  memoryEntries: number;
  diskEntries: number;
  memoryHits: number;
  diskHits: number;
  misses: number;
  totalRequests: number;
  hitRate: number;
  memoryHitRate: number;
  diskHitRate: number;
  evictions: number;
  promotions: number;
  demotions: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  totalBytesStored: number;
  compressionRatio: number;
}

interface DiskEntry {
  key: string;
  sizeBytes: number;
  compressedSizeBytes: number;
  createdAt: number;
  accessedAt: number;
  expiresAt: number;
  accessCount: number;
  filePath: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: AdvancedLRUCacheConfig = {
  name: 'default',
  maxMemoryEntries: 1000,
  maxDiskEntries: 5000,
  memoryThresholdBytes: 50 * 1024, // 50KB
  ttlMs: 60 * 60 * 1000, // 1 hour
  cacheDir: '.codebuddy/cache/advanced',
  compressionEnabled: true,
  compressionLevel: 6,
  metricsEnabled: true,
  autoPromote: true,
};

// ============================================================================
// Advanced LRU Cache
// ============================================================================

export class AdvancedLRUCache<V = unknown> extends EventEmitter {
  private config: AdvancedLRUCacheConfig;

  // Memory cache (LRU ordered via Map insertion order)
  private memoryCache: Map<string, CacheEntry<V>> = new Map();

  // Disk entry metadata (actual data stored in files)
  private diskIndex: Map<string, DiskEntry> = new Map();

  // Metrics
  private metrics: {
    memoryHits: number;
    diskHits: number;
    misses: number;
    evictions: number;
    promotions: number;
    demotions: number;
    latencies: number[];
    bytesWritten: number;
    bytesCompressed: number;
  } = {
    memoryHits: 0,
    diskHits: 0,
    misses: 0,
    evictions: 0,
    promotions: 0,
    demotions: 0,
    latencies: [],
    bytesWritten: 0,
    bytesCompressed: 0,
  };

  private diskPath: string;
  private indexPath: string;
  private initialized: boolean = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<AdvancedLRUCacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.diskPath = path.join(this.config.cacheDir, this.config.name);
    this.indexPath = path.join(this.diskPath, 'index.json');
  }

  /**
   * Initialize the cache (creates directories, loads disk index)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create directories
    if (!existsSync(this.diskPath)) {
      mkdirSync(this.diskPath, { recursive: true });
    }

    // Load disk index
    await this.loadDiskIndex();

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Get a value from the cache
   */
  async get(key: string): Promise<V | undefined> {
    const startTime = Date.now();

    try {
      // Check memory first
      const memoryEntry = this.memoryCache.get(key);
      if (memoryEntry && !this.isExpired(memoryEntry)) {
        // Update LRU position
        this.memoryCache.delete(key);
        memoryEntry.accessedAt = Date.now();
        memoryEntry.accessCount++;
        this.memoryCache.set(key, memoryEntry);

        this.metrics.memoryHits++;
        this.recordLatency(startTime);
        this.emit('hit', { key, location: 'memory' });
        return memoryEntry.value;
      }

      // Remove expired memory entry
      if (memoryEntry) {
        this.memoryCache.delete(key);
      }

      // Check disk
      const diskEntry = this.diskIndex.get(key);
      if (diskEntry && !this.isDiskEntryExpired(diskEntry)) {
        const value = await this.readFromDisk(diskEntry);
        if (value !== undefined) {
          diskEntry.accessedAt = Date.now();
          diskEntry.accessCount++;

          // Auto-promote to memory if enabled and fits
          if (this.config.autoPromote && diskEntry.sizeBytes <= this.config.memoryThresholdBytes) {
            await this.promoteToMemory(key, value, diskEntry);
          }

          this.metrics.diskHits++;
          this.recordLatency(startTime);
          this.emit('hit', { key, location: 'disk' });
          return value;
        }
      }

      // Remove expired disk entry
      if (diskEntry) {
        await this.deleteFromDisk(key);
      }

      this.metrics.misses++;
      this.recordLatency(startTime);
      this.emit('miss', { key });
      return undefined;
    } catch (error) {
      this.recordLatency(startTime);
      throw error;
    }
  }

  /**
   * Set a value in the cache
   */
  async set(key: string, value: V, options?: { ttlMs?: number }): Promise<void> {
    const startTime = Date.now();

    try {
      const serialized = this.serialize(value);
      const sizeBytes = Buffer.byteLength(serialized, 'utf-8');
      const ttlMs = options?.ttlMs ?? this.config.ttlMs;
      const now = Date.now();

      // Decide storage location based on size
      if (sizeBytes > this.config.memoryThresholdBytes) {
        // Store on disk
        await this.evictDiskIfNeeded();
        await this.writeToDisk(key, value, sizeBytes, ttlMs);
        this.metrics.demotions++;
        this.emit('set', { key, location: 'disk', sizeBytes });
      } else {
        // Store in memory
        this.evictMemoryIfNeeded();

        // Remove existing entry if present
        this.memoryCache.delete(key);

        const entry: CacheEntry<V> = {
          key,
          value,
          sizeBytes,
          createdAt: now,
          accessedAt: now,
          expiresAt: now + ttlMs,
          accessCount: 0,
          location: 'memory',
        };

        this.memoryCache.set(key, entry);
        this.emit('set', { key, location: 'memory', sizeBytes });
      }

      this.recordLatency(startTime);
    } catch (error) {
      this.recordLatency(startTime);
      throw error;
    }
  }

  /**
   * Delete a key from the cache
   */
  async delete(key: string): Promise<boolean> {
    let deleted = false;

    // Remove from memory
    if (this.memoryCache.delete(key)) {
      deleted = true;
    }

    // Remove from disk
    if (this.diskIndex.has(key)) {
      await this.deleteFromDisk(key);
      deleted = true;
    }

    if (deleted) {
      this.emit('delete', { key });
    }

    return deleted;
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry && !this.isExpired(memoryEntry)) {
      return true;
    }

    const diskEntry = this.diskIndex.get(key);
    if (diskEntry && !this.isDiskEntryExpired(diskEntry)) {
      return true;
    }

    return false;
  }

  /**
   * Get or compute value
   */
  async getOrCompute(
    key: string,
    computeFn: () => Promise<V>,
    options?: { ttlMs?: number }
  ): Promise<{ value: V; cached: boolean }> {
    const cached = await this.get(key);
    if (cached !== undefined) {
      return { value: cached, cached: true };
    }

    const value = await computeFn();
    await this.set(key, value, options);
    return { value, cached: false };
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();

    // Clear disk entries in parallel for better performance
    const keys = Array.from(this.diskIndex.keys());
    await Promise.allSettled(
      keys.map(key => this.deleteFromDisk(key))
    );

    this.emit('clear');
  }

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics {
    const totalRequests = this.metrics.memoryHits + this.metrics.diskHits + this.metrics.misses;
    const totalHits = this.metrics.memoryHits + this.metrics.diskHits;

    // Calculate latency percentiles
    const sortedLatencies = [...this.metrics.latencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);

    const avgLatency = sortedLatencies.length > 0
      ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
      : 0;

    const compressionRatio = this.metrics.bytesWritten > 0
      ? this.metrics.bytesCompressed / this.metrics.bytesWritten
      : 1;

    // Calculate total bytes stored
    let totalBytesStored = 0;
    for (const entry of this.memoryCache.values()) {
      totalBytesStored += entry.sizeBytes;
    }
    for (const entry of this.diskIndex.values()) {
      totalBytesStored += entry.compressedSizeBytes;
    }

    return {
      name: this.config.name,
      memoryEntries: this.memoryCache.size,
      diskEntries: this.diskIndex.size,
      memoryHits: this.metrics.memoryHits,
      diskHits: this.metrics.diskHits,
      misses: this.metrics.misses,
      totalRequests,
      hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
      memoryHitRate: totalRequests > 0 ? this.metrics.memoryHits / totalRequests : 0,
      diskHitRate: totalRequests > 0 ? this.metrics.diskHits / totalRequests : 0,
      evictions: this.metrics.evictions,
      promotions: this.metrics.promotions,
      demotions: this.metrics.demotions,
      averageLatencyMs: avgLatency,
      p95LatencyMs: sortedLatencies[p95Index] || 0,
      p99LatencyMs: sortedLatencies[p99Index] || 0,
      totalBytesStored,
      compressionRatio,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      memoryHits: 0,
      diskHits: 0,
      misses: 0,
      evictions: 0,
      promotions: 0,
      demotions: 0,
      latencies: [],
      bytesWritten: 0,
      bytesCompressed: 0,
    };
  }

  /**
   * Format metrics for display
   */
  formatMetrics(): string {
    const m = this.getMetrics();
    return [
      `Cache: ${m.name}`,
      `  Memory: ${m.memoryEntries} entries`,
      `  Disk: ${m.diskEntries} entries`,
      `  Hit Rate: ${(m.hitRate * 100).toFixed(1)}%`,
      `    Memory: ${(m.memoryHitRate * 100).toFixed(1)}%`,
      `    Disk: ${(m.diskHitRate * 100).toFixed(1)}%`,
      `  Latency: avg=${m.averageLatencyMs.toFixed(2)}ms, p95=${m.p95LatencyMs.toFixed(2)}ms, p99=${m.p99LatencyMs.toFixed(2)}ms`,
      `  Evictions: ${m.evictions}`,
      `  Promotions: ${m.promotions}`,
      `  Demotions: ${m.demotions}`,
      `  Total Size: ${(m.totalBytesStored / 1024 / 1024).toFixed(2)}MB`,
      `  Compression: ${((1 - m.compressionRatio) * 100).toFixed(1)}% reduction`,
    ].join('\n');
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Save disk index
    await this.saveDiskIndex();

    this.memoryCache.clear();
    this.diskIndex.clear();
    this.removeAllListeners();
    this.initialized = false;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private serialize(value: V): string {
    if (this.config.serialize) {
      return this.config.serialize(value);
    }
    return JSON.stringify(value);
  }

  private deserialize(data: string): V {
    if (this.config.deserialize) {
      return this.config.deserialize(data) as V;
    }
    return JSON.parse(data) as V;
  }

  private isExpired(entry: CacheEntry<V>): boolean {
    return Date.now() > entry.expiresAt;
  }

  private isDiskEntryExpired(entry: DiskEntry): boolean {
    return Date.now() > entry.expiresAt;
  }

  private recordLatency(startTime: number): void {
    if (!this.config.metricsEnabled) return;

    const latency = Date.now() - startTime;
    this.metrics.latencies.push(latency);

    // Keep only last 1000 latencies
    if (this.metrics.latencies.length > 1000) {
      this.metrics.latencies = this.metrics.latencies.slice(-1000);
    }
  }

  private evictMemoryIfNeeded(): void {
    while (this.memoryCache.size >= this.config.maxMemoryEntries) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey !== undefined) {
        this.memoryCache.delete(firstKey);
        this.metrics.evictions++;
        this.emit('evict', { key: firstKey, location: 'memory' });
      } else {
        break;
      }
    }
  }

  private async evictDiskIfNeeded(): Promise<void> {
    while (this.diskIndex.size >= this.config.maxDiskEntries) {
      // Find LRU disk entry
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;

      for (const [key, entry] of this.diskIndex) {
        if (entry.accessedAt < oldestAccess) {
          oldestAccess = entry.accessedAt;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        await this.deleteFromDisk(oldestKey);
        this.metrics.evictions++;
        this.emit('evict', { key: oldestKey, location: 'disk' });
      } else {
        break;
      }
    }
  }

  private async writeToDisk(key: string, value: V, sizeBytes: number, ttlMs: number): Promise<void> {
    const serialized = this.serialize(value);
    const keyHash = this.hashKey(key);
    const filePath = path.join(this.diskPath, `${keyHash}.cache`);

    let data: Buffer;
    let compressedSize: number;

    if (this.config.compressionEnabled) {
      data = await gzip(serialized, { level: this.config.compressionLevel });
      compressedSize = data.length;
    } else {
      data = Buffer.from(serialized, 'utf-8');
      compressedSize = data.length;
    }

    await fs.writeFile(filePath, data);

    const now = Date.now();
    const entry: DiskEntry = {
      key,
      sizeBytes,
      compressedSizeBytes: compressedSize,
      createdAt: now,
      accessedAt: now,
      expiresAt: now + ttlMs,
      accessCount: 0,
      filePath,
    };

    this.diskIndex.set(key, entry);
    this.metrics.bytesWritten += sizeBytes;
    this.metrics.bytesCompressed += compressedSize;

    // Save index periodically
    if (this.diskIndex.size % 10 === 0) {
      await this.saveDiskIndex();
    }
  }

  private async readFromDisk(entry: DiskEntry): Promise<V | undefined> {
    try {
      const data = await fs.readFile(entry.filePath);
      let serialized: string;

      if (this.config.compressionEnabled) {
        const decompressed = await gunzip(data);
        serialized = decompressed.toString('utf-8');
      } else {
        serialized = data.toString('utf-8');
      }

      return this.deserialize(serialized);
    } catch {
      // File might have been deleted
      this.diskIndex.delete(entry.key);
      return undefined;
    }
  }

  private async deleteFromDisk(key: string): Promise<void> {
    const entry = this.diskIndex.get(key);
    if (entry) {
      try {
        await fs.unlink(entry.filePath);
      } catch {
        // File might already be deleted
      }
      this.diskIndex.delete(key);
    }
  }

  private async promoteToMemory(key: string, value: V, diskEntry: DiskEntry): Promise<void> {
    this.evictMemoryIfNeeded();

    const entry: CacheEntry<V> = {
      key,
      value,
      sizeBytes: diskEntry.sizeBytes,
      createdAt: diskEntry.createdAt,
      accessedAt: Date.now(),
      expiresAt: diskEntry.expiresAt,
      accessCount: diskEntry.accessCount + 1,
      location: 'memory',
    };

    this.memoryCache.set(key, entry);
    await this.deleteFromDisk(key);
    this.metrics.promotions++;
    this.emit('promote', { key });
  }

  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  }

  private async loadDiskIndex(): Promise<void> {
    try {
      if (existsSync(this.indexPath)) {
        const content = await fs.readFile(this.indexPath, 'utf-8');
        const data = JSON.parse(content);

        if (Array.isArray(data.entries)) {
          const now = Date.now();
          for (const entry of data.entries) {
            // Skip expired entries
            if (entry.expiresAt > now && existsSync(entry.filePath)) {
              this.diskIndex.set(entry.key, entry);
            }
          }
        }
      }
    } catch {
      // Index file doesn't exist or is corrupted
    }
  }

  private async saveDiskIndex(): Promise<void> {
    try {
      const entries = Array.from(this.diskIndex.values());
      await fs.writeFile(
        this.indexPath,
        JSON.stringify({ entries, savedAt: Date.now() }),
        'utf-8'
      );
    } catch {
      // Failed to save index
    }
  }

  private async cleanup(): Promise<void> {
    // Clean expired memory entries
    for (const [key, entry] of this.memoryCache) {
      if (this.isExpired(entry)) {
        this.memoryCache.delete(key);
      }
    }

    // Clean expired disk entries
    for (const [key, entry] of this.diskIndex) {
      if (this.isDiskEntryExpired(entry)) {
        await this.deleteFromDisk(key);
      }
    }

    // Save disk index
    await this.saveDiskIndex();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a cache optimized for embeddings
 */
export function createEmbeddingCache(): AdvancedLRUCache<number[]> {
  return new AdvancedLRUCache<number[]>({
    name: 'embeddings',
    maxMemoryEntries: 5000,
    maxDiskEntries: 50000,
    memoryThresholdBytes: 10 * 1024, // 10KB (~2500 floats)
    ttlMs: 24 * 60 * 60 * 1000, // 24 hours
    compressionEnabled: true,
    compressionLevel: 6,
  });
}

/**
 * Create a cache optimized for API responses
 */
export function createApiResponseCache(): AdvancedLRUCache<unknown> {
  return new AdvancedLRUCache<unknown>({
    name: 'api-responses',
    maxMemoryEntries: 500,
    maxDiskEntries: 2000,
    memoryThresholdBytes: 100 * 1024, // 100KB
    ttlMs: 30 * 60 * 1000, // 30 minutes
    compressionEnabled: true,
    compressionLevel: 9, // Max compression for API responses
  });
}

/**
 * Create a cache optimized for search results
 */
export function createSearchCache(): AdvancedLRUCache<unknown> {
  return new AdvancedLRUCache<unknown>({
    name: 'search-results',
    maxMemoryEntries: 200,
    maxDiskEntries: 1000,
    memoryThresholdBytes: 50 * 1024, // 50KB
    ttlMs: 5 * 60 * 1000, // 5 minutes (searches can become stale)
    compressionEnabled: true,
    compressionLevel: 3, // Fast compression
  });
}
