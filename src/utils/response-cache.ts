import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface CacheEntry {
  query: string;
  response: string;
  model: string;
  contextHash: string;
  timestamp: number;
  ttl: number; // Time to live in seconds
  hits: number;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  cacheSize: string;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

/**
 * Local response cache for identical queries
 * Saves tokens and provides instant responses for repeated questions
 */
export class ResponseCache {
  private cacheDir: string;
  private cacheFile: string;
  private cache: Map<string, CacheEntry> = new Map();
  private stats = { hits: 0, misses: 0 };
  private maxEntries: number;
  private defaultTTL: number; // seconds
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private saveDebounceMs: number = 1000; // Debounce saves by 1 second
  private isLoaded: boolean = false;
  private loadPromise: Promise<void> | null = null;

  constructor(options: { maxEntries?: number; defaultTTL?: number } = {}) {
    this.maxEntries = options.maxEntries || 1000;
    this.defaultTTL = options.defaultTTL || 86400; // 24 hours default
    this.cacheDir = path.join(os.homedir(), '.grok', 'cache');
    this.cacheFile = path.join(this.cacheDir, 'response-cache.json');
    // Start loading asynchronously
    this.loadPromise = this.loadCache();
  }

  private async loadCache(): Promise<void> {
    try {
      // Use sync for directory creation during init (only once)
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }

      try {
        const content = await fs.readFile(this.cacheFile, 'utf-8');
        const data = JSON.parse(content);

        // Convert to Map and filter expired entries
        const now = Date.now();
        for (const [key, entry] of Object.entries(data.entries || {})) {
          const cacheEntry = entry as CacheEntry;
          if (now - cacheEntry.timestamp < cacheEntry.ttl * 1000) {
            this.cache.set(key, cacheEntry);
          }
        }

        this.stats = data.stats || { hits: 0, misses: 0 };
      } catch {
        // File doesn't exist or is invalid - start fresh
      }
    } catch (_error) {
      // Start with empty cache on error
      this.cache.clear();
    } finally {
      this.isLoaded = true;
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
      this.saveCache();
    }, this.saveDebounceMs);
  }

  private async saveCache(): Promise<void> {
    try {
      const data = {
        entries: Object.fromEntries(this.cache),
        stats: this.stats,
        savedAt: Date.now(),
      };
      // Use compact JSON without pretty-printing for better performance
      await fs.writeFile(this.cacheFile, JSON.stringify(data));
    } catch (_error) {
      // Silently fail on save errors
    }
  }

  /**
   * Generate a cache key from query and context
   */
  private generateKey(query: string, contextHash: string, model: string): string {
    const data = `${query}:${contextHash}:${model}`;
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  /**
   * Generate a hash of the current context (files in context)
   */
  generateContextHash(files: { path: string; content: string; mtime?: number }[]): string {
    const data = files
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(f => `${f.path}:${f.mtime || crypto.createHash('md5').update(f.content).digest('hex')}`)
      .join('|');
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  /**
   * Get cached response if available and valid
   */
  get(query: string, contextHash: string, model: string): string | null {
    const key = this.generateKey(query, contextHash, model);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl * 1000) {
      this.cache.delete(key);
      this.stats.misses++;
      this.scheduleSave();
      return null;
    }

    // Check if context changed
    if (entry.contextHash !== contextHash) {
      this.stats.misses++;
      return null;
    }

    // Cache hit!
    entry.hits++;
    this.stats.hits++;
    this.scheduleSave();
    return entry.response;
  }

  /**
   * Store a response in the cache
   */
  set(
    query: string,
    response: string,
    contextHash: string,
    model: string,
    ttl?: number
  ): void {
    // Don't cache very short responses or error messages
    if (response.length < 50 || response.toLowerCase().includes('error:')) {
      return;
    }

    const key = this.generateKey(query, contextHash, model);

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    const entry: CacheEntry = {
      query,
      response,
      model,
      contextHash,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
      hits: 0,
    };

    this.cache.set(key, entry);
    this.scheduleSave();
  }

  /**
   * Evict oldest entries to make room
   */
  private evictOldest(): void {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    // Remove 10% of entries
    const toRemove = Math.max(1, Math.floor(this.maxEntries * 0.1));
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
    this.scheduleSave();
  }

  /**
   * Invalidate cache entries related to a specific file
   */
  invalidateForFile(filePath: string): number {
    let invalidated = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.query.includes(filePath)) {
        this.cache.delete(key);
        invalidated++;
      }
    }
    if (invalidated > 0) {
      this.scheduleSave();
    }
    return invalidated;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;
    let totalSize = 0;

    for (const entry of this.cache.values()) {
      totalSize += entry.query.length + entry.response.length;
      if (!oldestTimestamp || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
      if (!newestTimestamp || entry.timestamp > newestTimestamp) {
        newestTimestamp = entry.timestamp;
      }
    }

    return {
      totalEntries: this.cache.size,
      totalHits: this.stats.hits,
      totalMisses: this.stats.misses,
      cacheSize: this.formatBytes(totalSize),
      oldestEntry: oldestTimestamp ? new Date(oldestTimestamp) : null,
      newestEntry: newestTimestamp ? new Date(newestTimestamp) : null,
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Format cache status for display
   */
  formatStatus(): string {
    const stats = this.getStats();
    const hitRate = stats.totalHits + stats.totalMisses > 0
      ? ((stats.totalHits / (stats.totalHits + stats.totalMisses)) * 100).toFixed(1)
      : '0';

    return `📦 Response Cache
─────────────────────────────
Entries: ${stats.totalEntries}
Size: ${stats.cacheSize}
Hit Rate: ${hitRate}% (${stats.totalHits} hits, ${stats.totalMisses} misses)
${stats.oldestEntry ? `Oldest: ${stats.oldestEntry.toLocaleDateString()}` : ''}
${stats.newestEntry ? `Newest: ${stats.newestEntry.toLocaleDateString()}` : ''}`;
  }

  /**
   * Dispose and flush pending saves
   */
  async dispose(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    // Final save
    await this.saveCache();
  }
}

// Singleton instance
let responseCacheInstance: ResponseCache | null = null;

export function getResponseCache(): ResponseCache {
  if (!responseCacheInstance) {
    responseCacheInstance = new ResponseCache();
  }
  return responseCacheInstance;
}

export function resetResponseCache(): void {
  if (responseCacheInstance) {
    responseCacheInstance.dispose();
  }
  responseCacheInstance = null;
}
