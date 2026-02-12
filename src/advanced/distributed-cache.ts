/**
 * Distributed Caching for Teams (Item 104)
 * Shared response cache across team members
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface CacheEntry {
  key: string;
  value: string;
  metadata: {
    createdBy: string;
    createdAt: Date;
    expiresAt: Date;
    hits: number;
    size: number;
  };
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  missRate: number;
}

export interface DistributedCacheConfig {
  maxSize?: number;
  ttl?: number;
  syncInterval?: number;
  nodes?: string[];
}

export class DistributedCache extends EventEmitter {
  private cache: Map<string, CacheEntry> = new Map();
  private config: Required<DistributedCacheConfig>;
  private hits = 0;
  private misses = 0;
  private syncTimer: NodeJS.Timeout | null = null;

  constructor(config: DistributedCacheConfig = {}) {
    super();
    this.config = {
      maxSize: 100 * 1024 * 1024, // 100MB
      ttl: 3600000, // 1 hour
      syncInterval: 60000, // 1 minute
      nodes: [],
      ...config,
    };
  }

  private generateKey(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
  }

  set(key: string, value: string, userId: string): boolean {
    const hashedKey = this.generateKey(key);
    const size = Buffer.byteLength(value, 'utf8');
    
    // Check size limit
    if (size > this.config.maxSize / 10) {
      return false; // Single entry too large
    }

    // Evict if needed
    this.evictIfNeeded(size);

    // Re-check after eviction - reject if still won't fit
    if (this.getTotalSize() + size > this.config.maxSize) {
      return false;
    }

    const entry: CacheEntry = {
      key: hashedKey,
      value,
      metadata: {
        createdBy: userId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.config.ttl),
        hits: 0,
        size,
      },
    };

    this.cache.set(hashedKey, entry);
    this.emit('set', { key: hashedKey, size });
    return true;
  }

  get(key: string): string | null {
    const hashedKey = this.generateKey(key);
    const entry = this.cache.get(hashedKey);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (new Date() > entry.metadata.expiresAt) {
      this.cache.delete(hashedKey);
      this.misses++;
      return null;
    }

    entry.metadata.hits++;
    this.hits++;
    this.emit('hit', { key: hashedKey });
    return entry.value;
  }

  has(key: string): boolean {
    const hashedKey = this.generateKey(key);
    const entry = this.cache.get(hashedKey);
    return entry !== undefined && new Date() <= entry.metadata.expiresAt;
  }

  delete(key: string): boolean {
    const hashedKey = this.generateKey(key);
    return this.cache.delete(hashedKey);
  }

  private evictIfNeeded(newSize: number): void {
    let totalSize = this.getTotalSize();
    
    while (totalSize + newSize > this.config.maxSize && this.cache.size > 0) {
      // Evict least recently hit entries
      let oldestEntry: [string, CacheEntry] | null = null;
      
      for (const entry of this.cache.entries()) {
        if (!oldestEntry || entry[1].metadata.hits < oldestEntry[1].metadata.hits) {
          oldestEntry = entry;
        }
      }
      
      if (oldestEntry) {
        this.cache.delete(oldestEntry[0]);
        totalSize -= oldestEntry[1].metadata.size;
      } else {
        break; // No entry to evict
      }
    }
  }

  private getTotalSize(): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      total += entry.metadata.size;
    }
    return total;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      totalEntries: this.cache.size,
      totalSize: this.getTotalSize(),
      hitRate: total > 0 ? this.hits / total : 0,
      missRate: total > 0 ? this.misses / total : 0,
    };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.emit('cleared');
  }

  startSync(): void {
    this.syncTimer = setInterval(() => {
      this.cleanup();
      this.emit('sync', this.getStats());
    }, this.config.syncInterval);
  }

  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private cleanup(): void {
    const now = new Date();
    for (const [key, entry] of this.cache) {
      if (now > entry.metadata.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  dispose(): void {
    this.stopSync();
    this.clear();
    this.removeAllListeners();
  }
}

let instance: DistributedCache | null = null;

export function getDistributedCache(config?: DistributedCacheConfig): DistributedCache {
  if (!instance) instance = new DistributedCache(config);
  return instance;
}

export default DistributedCache;
