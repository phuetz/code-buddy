/**
 * File Content Cache
 *
 * Caches file contents with hash-based invalidation.
 * Key features:
 * - Content hash for change detection
 * - mtime-based quick validation
 * - Size limits to prevent memory bloat
 * - Automatic cleanup of stale entries
 *
 * This significantly reduces disk I/O for frequently accessed files.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { existsSync, statSync, Stats } from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface FileCacheEntry {
  path: string;
  content: string;
  hash: string;
  mtime: number;
  size: number;
  timestamp: number;
  expiresAt: number;
  hits: number;
  encoding: BufferEncoding;
}

export interface FileCacheConfig {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  validateOnRead: boolean;
  watchForChanges: boolean;
}

export interface FileCacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  bytesServed: number;
  bytesRead: number;
  totalCacheSize: number;
  evictions: number;
  invalidations: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: FileCacheConfig = {
  enabled: true,
  ttlMs: 5 * 60 * 1000, // 5 minutes
  maxEntries: 1000,
  maxFileSizeBytes: 1024 * 1024, // 1MB
  maxTotalSizeBytes: 100 * 1024 * 1024, // 100MB total cache size
  validateOnRead: true, // Check mtime on each read
  watchForChanges: false, // File watchers (can be expensive)
};

// ============================================================================
// File Content Cache
// ============================================================================

export class FileContentCache extends EventEmitter {
  private cache: Map<string, FileCacheEntry> = new Map();
  private config: FileCacheConfig;
  private stats: FileCacheStats = {
    totalEntries: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    bytesServed: 0,
    bytesRead: 0,
    totalCacheSize: 0,
    evictions: 0,
    invalidations: 0,
  };
  private totalCacheSize: number = 0;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<FileCacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000); // Every minute
  }

  /**
   * Read file with caching
   */
  async read(
    filePath: string,
    encoding: BufferEncoding = 'utf-8'
  ): Promise<{ content: string; cached: boolean; hash: string }> {
    if (!this.config.enabled) {
      const content = await fs.readFile(filePath, encoding);
      const hash = this.hashContent(content);
      return { content, cached: false, hash };
    }

    const cached = this.cache.get(filePath);

    // Check if cached and valid
    if (cached && !this.isExpired(cached)) {
      // Optionally validate against mtime
      if (this.config.validateOnRead) {
        const isValid = await this.validateEntry(cached);
        if (!isValid) {
          this.cache.delete(filePath);
          this.totalCacheSize -= cached.size;
          this.stats.invalidations++;
        } else {
          cached.hits++;
          this.stats.hits++;
          this.stats.bytesServed += cached.size;
          this.updateHitRate();
          this.emit('cache:hit', { path: filePath });
          return { content: cached.content, cached: true, hash: cached.hash };
        }
      } else {
        cached.hits++;
        this.stats.hits++;
        this.stats.bytesServed += cached.size;
        this.updateHitRate();
        this.emit('cache:hit', { path: filePath });
        return { content: cached.content, cached: true, hash: cached.hash };
      }
    }

    // Read from disk
    this.stats.misses++;
    this.updateHitRate();

    const stat = await fs.stat(filePath);

    // Check file size
    if (stat.size > this.config.maxFileSizeBytes) {
      const content = await fs.readFile(filePath, encoding);
      const hash = this.hashContent(content);
      this.emit('cache:skip', { path: filePath, reason: 'file too large' });
      return { content, cached: false, hash };
    }

    const content = await fs.readFile(filePath, encoding);
    const hash = this.hashContent(content);
    this.stats.bytesRead += stat.size;

    // Store in cache
    this.set(filePath, content, hash, stat, encoding);

    this.emit('cache:miss', { path: filePath });
    return { content, cached: false, hash };
  }

  /**
   * Store file in cache
   */
  private set(
    filePath: string,
    content: string,
    hash: string,
    stat: Stats,
    encoding: BufferEncoding
  ): void {
    // Evict if needed
    this.evictIfNeeded(stat.size);

    const entry: FileCacheEntry = {
      path: filePath,
      content,
      hash,
      mtime: stat.mtime.getTime(),
      size: stat.size,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.ttlMs,
      hits: 0,
      encoding,
    };

    // Remove old entry if exists
    const existing = this.cache.get(filePath);
    if (existing) {
      this.totalCacheSize -= existing.size;
    }

    this.cache.set(filePath, entry);
    this.totalCacheSize += stat.size;
    this.stats.totalEntries = this.cache.size;
    this.stats.totalCacheSize = this.totalCacheSize;
  }

  /**
   * Validate entry against current file state
   */
  private async validateEntry(entry: FileCacheEntry): Promise<boolean> {
    try {
      const stat = await fs.stat(entry.path);
      return stat.mtime.getTime() === entry.mtime && stat.size === entry.size;
    } catch {
      return false;
    }
  }

  /**
   * Invalidate cache for a file
   */
  invalidate(filePath: string): boolean {
    const entry = this.cache.get(filePath);
    if (entry) {
      this.cache.delete(filePath);
      this.totalCacheSize -= entry.size;
      this.stats.invalidations++;
      this.emit('cache:invalidate', { path: filePath });
      return true;
    }
    return false;
  }

  /**
   * Invalidate entries matching pattern
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const [path, entry] of this.cache.entries()) {
      if (pattern.test(path)) {
        this.cache.delete(path);
        this.totalCacheSize -= entry.size;
        count++;
      }
    }
    this.stats.invalidations += count;
    return count;
  }

  /**
   * Invalidate entries in a directory
   */
  invalidateDirectory(dirPath: string): number {
    const normalizedDir = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    let count = 0;

    for (const [path, entry] of this.cache.entries()) {
      if (path.startsWith(normalizedDir) || path === dirPath.slice(0, -1)) {
        this.cache.delete(path);
        this.totalCacheSize -= entry.size;
        count++;
      }
    }

    this.stats.invalidations += count;
    return count;
  }

  /**
   * Check if file content has changed
   */
  async hasChanged(filePath: string): Promise<boolean> {
    const cached = this.cache.get(filePath);
    if (!cached) return true;

    try {
      const stat = await fs.stat(filePath);
      if (stat.mtime.getTime() !== cached.mtime || stat.size !== cached.size) {
        return true;
      }

      // Content hash check for critical files
      const content = await fs.readFile(filePath, cached.encoding);
      const hash = this.hashContent(content);
      return hash !== cached.hash;
    } catch {
      return true;
    }
  }

  /**
   * Get file hash without reading full content if cached
   */
  getHash(filePath: string): string | null {
    const cached = this.cache.get(filePath);
    return cached && !this.isExpired(cached) ? cached.hash : null;
  }

  /**
   * Preload files into cache
   */
  async preload(filePaths: string[]): Promise<number> {
    let loaded = 0;
    for (const filePath of filePaths) {
      try {
        if (existsSync(filePath)) {
          const stat = statSync(filePath);
          if (stat.isFile() && stat.size <= this.config.maxFileSizeBytes) {
            await this.read(filePath);
            loaded++;
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }
    return loaded;
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: FileCacheEntry): boolean {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Evict entries if needed
   */
  private evictIfNeeded(newSize: number): void {
    // First remove expired entries
    for (const [path, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(path);
        this.totalCacheSize -= entry.size;
        this.stats.evictions++;
      }
    }

    // Check max entries
    while (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }

    // Check total size
    while (this.totalCacheSize + newSize > this.config.maxTotalSizeBytes && this.cache.size > 0) {
      this.evictLRU();
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestPath: string | null = null;
    let oldestTime = Infinity;
    let lowestHits = Infinity;

    for (const [path, entry] of this.cache.entries()) {
      // Prefer evicting entries with fewer hits and older access time
      const score = entry.timestamp + entry.hits * 10000;
      if (score < oldestTime || (score === oldestTime && entry.hits < lowestHits)) {
        oldestTime = score;
        lowestHits = entry.hits;
        oldestPath = path;
      }
    }

    if (oldestPath) {
      const entry = this.cache.get(oldestPath);
      if (entry) {
        this.totalCacheSize -= entry.size;
      }
      this.cache.delete(oldestPath);
      this.stats.evictions++;
      this.emit('cache:evict', { path: oldestPath });
    }
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    let cleaned = 0;
    for (const [path, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(path);
        this.totalCacheSize -= entry.size;
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.stats.evictions += cleaned;
      this.stats.totalEntries = this.cache.size;
      this.stats.totalCacheSize = this.totalCacheSize;
    }
  }

  /**
   * Hash content
   */
  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Update hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Get statistics
   */
  getStats(): FileCacheStats {
    return { ...this.stats };
  }

  /**
   * Format statistics
   */
  formatStats(): string {
    const sizeMB = (this.totalCacheSize / (1024 * 1024)).toFixed(2);
    const servedMB = (this.stats.bytesServed / (1024 * 1024)).toFixed(2);
    const readMB = (this.stats.bytesRead / (1024 * 1024)).toFixed(2);

    return [
      'File Content Cache Statistics',
      `  Entries: ${this.stats.totalEntries}`,
      `  Hit Rate: ${(this.stats.hitRate * 100).toFixed(1)}%`,
      `  Cache Size: ${sizeMB}MB`,
      `  Bytes Served: ${servedMB}MB`,
      `  Bytes Read: ${readMB}MB`,
      `  Evictions: ${this.stats.evictions}`,
      `  Invalidations: ${this.stats.invalidations}`,
    ].join('\n');
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.totalCacheSize = 0;
    this.stats = {
      totalEntries: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      bytesServed: 0,
      bytesRead: 0,
      totalCacheSize: 0,
      evictions: 0,
      invalidations: 0,
    };
    this.emit('cache:clear');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: FileContentCache | null = null;

export function getFileContentCache(config?: Partial<FileCacheConfig>): FileContentCache {
  if (!instance) {
    instance = new FileContentCache(config);
  }
  return instance;
}

export function resetFileContentCache(): void {
  if (instance) {
    instance.dispose();
  }
  instance = null;
}
