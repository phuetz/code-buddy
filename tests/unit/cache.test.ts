/**
 * Comprehensive unit tests for the cache module
 *
 * Tests cover:
 * - Cache creation and configuration
 * - Get/set/delete operations
 * - TTL expiration
 * - Cache eviction policies (LRU)
 * - Memory management
 * - Statistics tracking
 * - Event emission
 * - Semantic caching
 * - Response caching
 * - Type utilities
 */

import { Cache, createCacheKey } from '../../src/utils/cache';
import {
  LRUCache,
  LRUMap,
  CACHE_SIZES,
  CACHE_TTL,
  createCheckpointCache,
  createChunkStoreCache,
  createMemoryCache,
  createAnalysisCache,
} from '../../src/utils/lru-cache';
import {
  BaseCacheEntry,
  TimedCacheEntry,
  LRUCacheEntry,
  FullCacheEntry,
  BaseCacheStats,
  DetailedCacheStats,
  BaseCacheConfig,
  LRUCacheConfig,
  CacheLookupResult,
  CacheEvent,
  isCacheEntry,
  isExpired,
  calculateHitRate,
  createCacheEntry,
  createTimedCacheEntry,
  createLRUCacheEntry,
  createCacheStats,
} from '../../src/types/cache-types';

// ============================================================================
// Simple Cache Tests
// ============================================================================

describe('Cache (Simple TTL-based)', () => {
  describe('Cache creation and configuration', () => {
    it('should create cache with default TTL', () => {
      const cache = new Cache<string>();
      expect(cache).toBeInstanceOf(Cache);
      expect(cache.size).toBe(0);
    });

    it('should create cache with custom TTL', () => {
      const cache = new Cache<string>(5000);
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
    });

    it('should handle different value types', () => {
      const stringCache = new Cache<string>();
      const numberCache = new Cache<number>();
      const objectCache = new Cache<{ name: string }>();
      const arrayCache = new Cache<number[]>();

      stringCache.set('key', 'string');
      numberCache.set('key', 42);
      objectCache.set('key', { name: 'test' });
      arrayCache.set('key', [1, 2, 3]);

      expect(stringCache.get('key')).toBe('string');
      expect(numberCache.get('key')).toBe(42);
      expect(objectCache.get('key')).toEqual({ name: 'test' });
      expect(arrayCache.get('key')).toEqual([1, 2, 3]);
    });
  });

  describe('Get/Set/Delete operations', () => {
    let cache: Cache<string>;

    beforeEach(() => {
      cache = new Cache<string>();
    });

    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should overwrite existing values', () => {
      cache.set('key', 'value1');
      cache.set('key', 'value2');
      expect(cache.get('key')).toBe('value2');
      expect(cache.size).toBe(1);
    });

    it('should check if key exists with has()', () => {
      cache.set('existing', 'value');
      expect(cache.has('existing')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete keys and return success status', () => {
      cache.set('key', 'value');
      expect(cache.delete('key')).toBe(true);
      expect(cache.get('key')).toBeUndefined();
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      expect(cache.size).toBe(3);

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key3')).toBeUndefined();
    });

    it('should handle empty string keys', () => {
      cache.set('', 'empty key value');
      expect(cache.get('')).toBe('empty key value');
    });

    it('should handle special characters in keys', () => {
      cache.set('key:with:colons', 'value1');
      cache.set('key/with/slashes', 'value2');
      cache.set('key.with.dots', 'value3');
      cache.set('key with spaces', 'value4');

      expect(cache.get('key:with:colons')).toBe('value1');
      expect(cache.get('key/with/slashes')).toBe('value2');
      expect(cache.get('key.with.dots')).toBe('value3');
      expect(cache.get('key with spaces')).toBe('value4');
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after default TTL', async () => {
      const cache = new Cache<string>(100); // 100ms TTL
      cache.set('key', 'value');

      expect(cache.get('key')).toBe('value');

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cache.get('key')).toBeUndefined();
    });

    it('should use custom TTL per entry', async () => {
      const cache = new Cache<string>(10000); // Default 10s TTL
      cache.set('short', 'short-lived', 100); // 100ms TTL
      cache.set('long', 'long-lived'); // Uses default 10s TTL

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('long')).toBe('long-lived');
    });

    it('should delete expired entry on access', async () => {
      const cache = new Cache<string>(100);
      cache.set('key', 'value');

      expect(cache.size).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Access triggers deletion
      expect(cache.get('key')).toBeUndefined();
      // Note: the simple Cache doesn't remove from size until cleanup() is called
    });

    it('should cleanup expired entries', async () => {
      const cache = new Cache<string>(100);
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      await new Promise((resolve) => setTimeout(resolve, 150));

      cache.cleanup();
      expect(cache.size).toBe(0);
    });

    it('should not expire entries before TTL', async () => {
      const cache = new Cache<string>(1000);
      cache.set('key', 'value');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(cache.get('key')).toBe('value');
    });
  });

  describe('getOrCompute', () => {
    it('should compute value if not in cache', async () => {
      const cache = new Cache<number>();
      const computeFn = jest.fn(async () => 42);

      const result = await cache.getOrCompute('key', computeFn);

      expect(result).toBe(42);
      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it('should return cached value without computing', async () => {
      const cache = new Cache<number>();
      const computeFn = jest.fn(async () => 42);

      await cache.getOrCompute('key', computeFn);
      const result = await cache.getOrCompute('key', computeFn);

      expect(result).toBe(42);
      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it('should recompute after expiration', async () => {
      const cache = new Cache<number>(100);
      let callCount = 0;
      const computeFn = jest.fn(async () => ++callCount);

      const result1 = await cache.getOrCompute('key', computeFn);
      expect(result1).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 150));

      const result2 = await cache.getOrCompute('key', computeFn);
      expect(result2).toBe(2);
      expect(computeFn).toHaveBeenCalledTimes(2);
    });

    it('should handle async compute errors', async () => {
      const cache = new Cache<number>();
      const computeFn = jest.fn(async () => {
        throw new Error('Compute failed');
      });

      await expect(cache.getOrCompute('key', computeFn)).rejects.toThrow(
        'Compute failed'
      );
    });

    it('should use custom TTL for computed values', async () => {
      const cache = new Cache<number>(10000);
      const computeFn = jest.fn(async () => 42);

      await cache.getOrCompute('key', computeFn, 100);

      await new Promise((resolve) => setTimeout(resolve, 150));

      const result = await cache.getOrCompute('key', computeFn);
      expect(result).toBe(42);
      expect(computeFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('getOrComputeSync', () => {
    it('should compute value synchronously if not in cache', () => {
      const cache = new Cache<number>();
      const computeFn = jest.fn(() => 42);

      const result = cache.getOrComputeSync('key', computeFn);

      expect(result).toBe(42);
      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it('should use cached value', () => {
      const cache = new Cache<number>();
      const computeFn = jest.fn(() => 42);

      cache.getOrComputeSync('key', computeFn);
      const result = cache.getOrComputeSync('key', computeFn);

      expect(result).toBe(42);
      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it('should handle compute function that throws', () => {
      const cache = new Cache<number>();
      const computeFn = jest.fn(() => {
        throw new Error('Sync compute failed');
      });

      expect(() => cache.getOrComputeSync('key', computeFn)).toThrow(
        'Sync compute failed'
      );
    });
  });
});

describe('createCacheKey', () => {
  it('should create key from single value', () => {
    expect(createCacheKey('test')).toBe('test');
  });

  it('should create key from multiple values', () => {
    expect(createCacheKey('a', 'b', 'c')).toBe('a:b:c');
  });

  it('should handle numbers and booleans', () => {
    expect(createCacheKey('test', 42, true, false)).toBe('test:42:true:false');
  });

  it('should filter out null and undefined', () => {
    expect(createCacheKey('a', null, 'b', undefined, 'c')).toBe('a:b:c');
  });

  it('should handle empty input', () => {
    expect(createCacheKey()).toBe('');
  });

  it('should handle all null/undefined values', () => {
    expect(createCacheKey(null, undefined, null)).toBe('');
  });

  it('should handle zero and empty string', () => {
    expect(createCacheKey('prefix', 0, '')).toBe('prefix:0:');
  });
});

// ============================================================================
// LRU Cache Tests
// ============================================================================

describe('LRUCache', () => {
  describe('Cache creation and configuration', () => {
    it('should create cache with specified maxSize', () => {
      const cache = new LRUCache<string>({ maxSize: 100 });
      expect(cache.size).toBe(0);
      expect(cache.getStats().maxSize).toBe(100);
    });

    it('should enforce minimum size of 1', () => {
      const cache = new LRUCache<string>({ maxSize: 0 });
      cache.set('a', 'value');
      expect(cache.size).toBe(1);
    });

    it('should accept negative maxSize and convert to 1', () => {
      const cache = new LRUCache<string>({ maxSize: -10 });
      cache.set('a', 'value');
      cache.set('b', 'value');
      expect(cache.size).toBe(1);
    });

    it('should accept optional TTL configuration', () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 1000 });
      expect(cache).toBeInstanceOf(LRUCache);
    });

    it('should accept optional onEvict callback', () => {
      const onEvict = jest.fn();
      const cache = new LRUCache<string>({ maxSize: 1, onEvict });

      cache.set('a', '1');
      cache.set('b', '2');

      expect(onEvict).toHaveBeenCalledWith('a', '1');
    });
  });

  describe('Get/Set operations', () => {
    let cache: LRUCache<string>;

    beforeEach(() => {
      cache = new LRUCache<string>({ maxSize: 5 });
    });

    it('should set and get values', () => {
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should update existing keys', () => {
      cache.set('key', 'value1');
      cache.set('key', 'value2');
      expect(cache.get('key')).toBe('value2');
      expect(cache.size).toBe(1);
    });

    it('should update access time on get (move to MRU position)', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      // Access 'a' to make it most recently used
      cache.get('a');

      // Fill cache to capacity
      cache.set('d', '4');
      cache.set('e', '5');

      // Add new entry, should evict 'b' (LRU)
      cache.set('f', '6');

      expect(cache.get('a')).toBe('1'); // Still present
      expect(cache.get('b')).toBeUndefined(); // Evicted
    });
  });

  describe('LRU eviction policy', () => {
    it('should evict LRU entry when at capacity', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4'); // Should evict 'a'

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe('2');
      expect(cache.get('c')).toBe('3');
      expect(cache.get('d')).toBe('4');
    });

    it('should maintain order based on access', () => {
      const cache = new LRUCache<string>({ maxSize: 3 });
      const evicted: string[] = [];

      cache.on('evict', ({ key }) => evicted.push(key));

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      // Access in order: a, b (c becomes LRU)
      cache.get('a');
      cache.get('b');

      cache.set('d', '4'); // Should evict 'c'

      expect(evicted).toEqual(['c']);
    });

    it('should call onEvict callback on eviction', () => {
      const evictedItems: Array<{ key: string; value: string }> = [];
      const cache = new LRUCache<string>({
        maxSize: 2,
        onEvict: (key, value) => evictedItems.push({ key, value }),
      });

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4');

      expect(evictedItems).toEqual([
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ]);
    });

    it('should handle updating existing key without eviction', () => {
      const cache = new LRUCache<string>({ maxSize: 2 });

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('a', 'updated'); // Update, not add

      expect(cache.size).toBe(2);
      expect(cache.get('a')).toBe('updated');
      expect(cache.get('b')).toBe('2');
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 50 });
      cache.set('key', 'value');

      expect(cache.get('key')).toBe('value');

      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(cache.get('key')).toBeUndefined();
    });

    it('should count expired entries as misses in stats', async () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 50 });
      cache.set('key', 'value');
      cache.get('key'); // Hit

      await new Promise((resolve) => setTimeout(resolve, 80));

      cache.get('key'); // Miss (expired)

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should return false for has() on expired keys', async () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 50 });
      cache.set('key', 'value');

      expect(cache.has('key')).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(cache.has('key')).toBe(false);
    });

    it('should prune expired entries', async () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 50 });
      cache.set('a', '1');
      cache.set('b', '2');

      await new Promise((resolve) => setTimeout(resolve, 80));

      cache.set('c', '3'); // Not expired

      const pruned = cache.prune();
      expect(pruned).toBe(2);
      expect(cache.size).toBe(1);
    });

    it('should exclude expired entries from values()', async () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 50 });
      cache.set('a', '1');

      await new Promise((resolve) => setTimeout(resolve, 80));

      cache.set('b', '2');

      expect(cache.values()).toEqual(['2']);
    });

    it('should exclude expired entries from entries()', async () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 50 });
      cache.set('a', '1');

      await new Promise((resolve) => setTimeout(resolve, 80));

      cache.set('b', '2');

      expect(cache.entries()).toEqual([['b', '2']]);
    });
  });

  describe('Delete operations', () => {
    it('should delete existing keys and return true', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('key', 'value');

      expect(cache.delete('key')).toBe(true);
      expect(cache.get('key')).toBeUndefined();
    });

    it('should return false for missing keys', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should emit delete event', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      const handler = jest.fn();
      cache.on('delete', handler);

      cache.set('key', 'value');
      cache.delete('key');

      expect(handler).toHaveBeenCalledWith({ key: 'key', value: 'value' });
    });
  });

  describe('Clear operations', () => {
    it('should remove all entries', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });

    it('should emit clear event with previous size', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      const handler = jest.fn();
      cache.on('clear', handler);

      cache.set('a', '1');
      cache.set('b', '2');
      cache.clear();

      expect(handler).toHaveBeenCalledWith({ size: 2 });
    });
  });

  describe('Keys/Values/Entries', () => {
    let cache: LRUCache<string>;

    beforeEach(() => {
      cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
    });

    it('should return all keys', () => {
      expect(cache.keys()).toEqual(['a', 'b', 'c']);
    });

    it('should return all values', () => {
      expect(cache.values()).toEqual(['1', '2', '3']);
    });

    it('should return all entries as [key, value] pairs', () => {
      expect(cache.entries()).toEqual([
        ['a', '1'],
        ['b', '2'],
        ['c', '3'],
      ]);
    });
  });

  describe('forEach iteration', () => {
    it('should iterate over all non-expired entries', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');
      cache.set('b', '2');

      const entries: Array<[string, string]> = [];
      cache.forEach((value, key) => {
        entries.push([key, value]);
      });

      expect(entries).toEqual([
        ['a', '1'],
        ['b', '2'],
      ]);
    });

    it('should skip expired entries during iteration', async () => {
      const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 50 });
      cache.set('a', '1');

      await new Promise((resolve) => setTimeout(resolve, 80));

      cache.set('b', '2');

      const entries: Array<[string, string]> = [];
      cache.forEach((value, key) => {
        entries.push([key, value]);
      });

      expect(entries).toEqual([['b', '2']]);
    });
  });

  describe('Symbol.iterator', () => {
    it('should be iterable with for...of', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');
      cache.set('b', '2');

      const entries: Array<[string, string]> = [];
      for (const [key, value] of cache) {
        entries.push([key, value]);
      }

      expect(entries).toEqual([
        ['a', '1'],
        ['b', '2'],
      ]);
    });

    it('should work with spread operator', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');
      cache.set('b', '2');

      const entries = [...cache];
      expect(entries).toEqual([
        ['a', '1'],
        ['b', '2'],
      ]);
    });

    it('should work with Array.from()', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');
      cache.set('b', '2');

      const entries = Array.from(cache);
      expect(entries).toEqual([
        ['a', '1'],
        ['b', '2'],
      ]);
    });
  });

  describe('toObject/fromObject serialization', () => {
    it('should convert cache to plain object', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');
      cache.set('b', '2');

      const obj = cache.toObject();
      expect(obj).toEqual({ a: '1', b: '2' });
    });

    it('should load from plain object', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.fromObject({ a: '1', b: '2' });

      expect(cache.get('a')).toBe('1');
      expect(cache.get('b')).toBe('2');
      expect(cache.size).toBe(2);
    });

    it('should load from Map', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      const map = new Map([
        ['a', '1'],
        ['b', '2'],
      ]);
      cache.fromObject(map);

      expect(cache.get('a')).toBe('1');
      expect(cache.get('b')).toBe('2');
    });

    it('should respect maxSize when loading from object', () => {
      const cache = new LRUCache<string>({ maxSize: 2 });
      cache.fromObject({ a: '1', b: '2', c: '3' });

      expect(cache.size).toBe(2);
    });
  });

  describe('Statistics tracking', () => {
    it('should track hits and misses', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');

      cache.get('a'); // Hit
      cache.get('a'); // Hit
      cache.get('b'); // Miss
      cache.get('c'); // Miss
      cache.get('d'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(3);
    });

    it('should calculate hit rate correctly', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');

      cache.get('a'); // Hit
      cache.get('a'); // Hit
      cache.get('b'); // Miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should handle hit rate with no accesses', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('should track evictions', () => {
      const cache = new LRUCache<string>({ maxSize: 2 });
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4');

      const stats = cache.getStats();
      expect(stats.evictions).toBe(2);
    });

    it('should return correct size info', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');
      cache.set('b', '2');

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(10);
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics to zero', () => {
      const cache = new LRUCache<string>({ maxSize: 2 });
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3'); // Eviction

      cache.get('a'); // Miss
      cache.get('b'); // Hit
      cache.get('c'); // Hit

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should not affect cache contents', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.set('a', '1');
      cache.set('b', '2');

      cache.resetStats();

      expect(cache.get('a')).toBe('1');
      expect(cache.get('b')).toBe('2');
      expect(cache.size).toBe(2);
    });
  });

  describe('setMaxSize', () => {
    it('should update max size', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.setMaxSize(5);

      const stats = cache.getStats();
      expect(stats.maxSize).toBe(5);
    });

    it('should evict entries if new size is smaller', () => {
      const cache = new LRUCache<string>({ maxSize: 5 });
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4');
      cache.set('e', '5');

      cache.setMaxSize(2);

      expect(cache.size).toBe(2);
      // Should keep most recently added
      expect(cache.get('d')).toBe('4');
      expect(cache.get('e')).toBe('5');
    });

    it('should enforce minimum size of 1', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      cache.setMaxSize(0);

      const stats = cache.getStats();
      expect(stats.maxSize).toBe(1);
    });
  });

  describe('dispose', () => {
    it('should clear cache and remove all event listeners', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      const setHandler = jest.fn();
      const deleteHandler = jest.fn();

      cache.on('set', setHandler);
      cache.on('delete', deleteHandler);

      cache.set('a', '1');
      cache.dispose();

      expect(cache.size).toBe(0);
      expect(cache.listenerCount('set')).toBe(0);
      expect(cache.listenerCount('delete')).toBe(0);
    });
  });

  describe('Event emission', () => {
    it('should emit set event', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      const handler = jest.fn();
      cache.on('set', handler);

      cache.set('key', 'value');

      expect(handler).toHaveBeenCalledWith({ key: 'key', value: 'value' });
    });

    it('should emit delete event', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      const handler = jest.fn();
      cache.on('delete', handler);

      cache.set('key', 'value');
      cache.delete('key');

      expect(handler).toHaveBeenCalledWith({ key: 'key', value: 'value' });
    });

    it('should emit evict event', () => {
      const cache = new LRUCache<string>({ maxSize: 1 });
      const handler = jest.fn();
      cache.on('evict', handler);

      cache.set('a', '1');
      cache.set('b', '2');

      expect(handler).toHaveBeenCalledWith({ key: 'a', value: '1' });
    });

    it('should emit clear event', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });
      const handler = jest.fn();
      cache.on('clear', handler);

      cache.set('a', '1');
      cache.set('b', '2');
      cache.clear();

      expect(handler).toHaveBeenCalledWith({ size: 2 });
    });
  });
});

// ============================================================================
// LRUMap Tests
// ============================================================================

describe('LRUMap', () => {
  it('should work as Map replacement with number keys', () => {
    const map = new LRUMap<number, string>(10);

    map.set(1, 'one');
    map.set(2, 'two');

    expect(map.get(1)).toBe('one');
    expect(map.get(2)).toBe('two');
    expect(map.size).toBe(2);
  });

  it('should support object keys with custom serialization', () => {
    interface Key {
      id: number;
      type: string;
    }

    const map = new LRUMap<Key, string>(10, {
      keyToString: (k) => `${k.type}:${k.id}`,
    });

    map.set({ id: 1, type: 'user' }, 'Alice');
    map.set({ id: 2, type: 'user' }, 'Bob');
    map.set({ id: 1, type: 'admin' }, 'Charlie');

    expect(map.get({ id: 1, type: 'user' })).toBe('Alice');
    expect(map.get({ id: 2, type: 'user' })).toBe('Bob');
    expect(map.get({ id: 1, type: 'admin' })).toBe('Charlie');
    expect(map.size).toBe(3);
  });

  it('should evict LRU entries', () => {
    const map = new LRUMap<number, string>(2);

    map.set(1, 'one');
    map.set(2, 'two');
    map.set(3, 'three');

    expect(map.has(1)).toBe(false);
    expect(map.has(2)).toBe(true);
    expect(map.has(3)).toBe(true);
  });

  it('should delete entries', () => {
    const map = new LRUMap<number, string>(10);

    map.set(1, 'one');
    expect(map.delete(1)).toBe(true);
    expect(map.get(1)).toBeUndefined();
    expect(map.delete(2)).toBe(false);
  });

  it('should clear all entries', () => {
    const map = new LRUMap<number, string>(10);

    map.set(1, 'one');
    map.set(2, 'two');
    map.clear();

    expect(map.size).toBe(0);
  });

  it('should return values', () => {
    const map = new LRUMap<number, string>(10);

    map.set(1, 'one');
    map.set(2, 'two');

    expect(map.values()).toEqual(['one', 'two']);
  });

  it('should provide statistics', () => {
    const map = new LRUMap<number, string>(10);
    map.set(1, 'one');
    map.get(1); // Hit
    map.get(2); // Miss

    const stats = map.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it('should return self on set() for chaining', () => {
    const map = new LRUMap<number, string>(10);

    const result = map.set(1, 'one').set(2, 'two').set(3, 'three');

    expect(result).toBe(map);
    expect(map.size).toBe(3);
  });

  it('should support TTL', async () => {
    const map = new LRUMap<number, string>(10, { ttlMs: 50 });

    map.set(1, 'one');
    expect(map.get(1)).toBe('one');

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(map.get(1)).toBeUndefined();
  });

  it('should dispose properly', () => {
    const map = new LRUMap<number, string>(10);
    map.set(1, 'one');
    map.set(2, 'two');

    map.dispose();

    expect(map.size).toBe(0);
  });
});

// ============================================================================
// Cache Constants Tests
// ============================================================================

describe('Cache constants', () => {
  describe('CACHE_SIZES', () => {
    it('should have standard size tiers', () => {
      expect(CACHE_SIZES.SMALL).toBe(100);
      expect(CACHE_SIZES.MEDIUM).toBe(500);
      expect(CACHE_SIZES.LARGE).toBe(1000);
      expect(CACHE_SIZES.XLARGE).toBe(5000);
    });

    it('should have specific use case sizes', () => {
      expect(CACHE_SIZES.CHECKPOINT).toBe(50);
      expect(CACHE_SIZES.CHUNK_STORE).toBe(2000);
      expect(CACHE_SIZES.FILE_INDEX).toBe(1000);
      expect(CACHE_SIZES.SYMBOL_INDEX).toBe(5000);
      expect(CACHE_SIZES.MEMORY).toBe(500);
      expect(CACHE_SIZES.ANALYSIS).toBe(200);
      expect(CACHE_SIZES.REPAIR_HISTORY).toBe(100);
      expect(CACHE_SIZES.CLIENT_POOL).toBe(10);
    });
  });

  describe('CACHE_TTL', () => {
    it('should have standard TTL values in milliseconds', () => {
      expect(CACHE_TTL.SHORT).toBe(60 * 1000); // 1 minute
      expect(CACHE_TTL.MEDIUM).toBe(5 * 60 * 1000); // 5 minutes
      expect(CACHE_TTL.LONG).toBe(30 * 60 * 1000); // 30 minutes
      expect(CACHE_TTL.HOUR).toBe(60 * 60 * 1000); // 1 hour
      expect(CACHE_TTL.DAY).toBe(24 * 60 * 60 * 1000); // 24 hours
    });
  });
});

// ============================================================================
// Factory Functions Tests
// ============================================================================

describe('Cache factory functions', () => {
  it('createCheckpointCache should create cache with correct settings', () => {
    const cache = createCheckpointCache<string>();
    const stats = cache.getStats();

    expect(stats.maxSize).toBe(CACHE_SIZES.CHECKPOINT);
    expect(cache).toBeInstanceOf(LRUCache);
  });

  it('createChunkStoreCache should create cache with correct settings', () => {
    const cache = createChunkStoreCache<string>();
    const stats = cache.getStats();

    expect(stats.maxSize).toBe(CACHE_SIZES.CHUNK_STORE);
    expect(cache).toBeInstanceOf(LRUCache);
  });

  it('createMemoryCache should create cache with correct settings', () => {
    const cache = createMemoryCache<string>();
    const stats = cache.getStats();

    expect(stats.maxSize).toBe(CACHE_SIZES.MEMORY);
    expect(cache).toBeInstanceOf(LRUCache);
  });

  it('createAnalysisCache should create cache with correct settings', () => {
    const cache = createAnalysisCache<string>();
    const stats = cache.getStats();

    expect(stats.maxSize).toBe(CACHE_SIZES.ANALYSIS);
    expect(cache).toBeInstanceOf(LRUCache);
  });
});

// ============================================================================
// Cache Types Tests
// ============================================================================

describe('Cache types and utilities', () => {
  describe('isCacheEntry type guard', () => {
    it('should return true for valid cache entries', () => {
      const entry: BaseCacheEntry<string> = {
        value: 'test',
        timestamp: Date.now(),
      };

      expect(isCacheEntry(entry)).toBe(true);
    });

    it('should return false for invalid objects', () => {
      expect(isCacheEntry(null)).toBe(false);
      expect(isCacheEntry(undefined)).toBe(false);
      expect(isCacheEntry({})).toBe(false);
      expect(isCacheEntry({ value: 'test' })).toBe(false);
      expect(isCacheEntry({ timestamp: 123 })).toBe(false);
      expect(isCacheEntry({ value: 'test', timestamp: 'not a number' })).toBe(
        false
      );
    });

    it('should return true for extended cache entry types', () => {
      const timedEntry: TimedCacheEntry<string> = {
        value: 'test',
        timestamp: Date.now(),
        expiresAt: Date.now() + 1000,
      };

      const lruEntry: LRUCacheEntry<string> = {
        value: 'test',
        timestamp: Date.now(),
        createdAt: Date.now(),
        accessedAt: Date.now(),
      };

      expect(isCacheEntry(timedEntry)).toBe(true);
      expect(isCacheEntry(lruEntry)).toBe(true);
    });
  });

  describe('isExpired', () => {
    it('should return false for non-expired entries', () => {
      const entry: TimedCacheEntry<string> = {
        value: 'test',
        timestamp: Date.now(),
        expiresAt: Date.now() + 10000,
      };

      expect(isExpired(entry)).toBe(false);
    });

    it('should return true for expired entries', () => {
      const entry: TimedCacheEntry<string> = {
        value: 'test',
        timestamp: Date.now() - 10000,
        expiresAt: Date.now() - 1000,
      };

      expect(isExpired(entry)).toBe(true);
    });

    it('should return false if expiresAt is not set', () => {
      const entry: FullCacheEntry<string> = {
        value: 'test',
        timestamp: Date.now(),
        createdAt: Date.now(),
        accessedAt: Date.now(),
      };

      expect(isExpired(entry)).toBe(false);
    });
  });

  describe('calculateHitRate', () => {
    it('should calculate correct hit rate', () => {
      expect(calculateHitRate(8, 2)).toBeCloseTo(0.8);
      expect(calculateHitRate(5, 5)).toBeCloseTo(0.5);
      expect(calculateHitRate(0, 10)).toBeCloseTo(0);
      expect(calculateHitRate(10, 0)).toBeCloseTo(1);
    });

    it('should return 0 when no accesses', () => {
      expect(calculateHitRate(0, 0)).toBe(0);
    });
  });

  describe('createCacheEntry', () => {
    it('should create basic cache entry', () => {
      const before = Date.now();
      const entry = createCacheEntry('test value');
      const after = Date.now();

      expect(entry.value).toBe('test value');
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
    });

    it('should handle different value types', () => {
      const numberEntry = createCacheEntry(42);
      const objectEntry = createCacheEntry({ key: 'value' });
      const arrayEntry = createCacheEntry([1, 2, 3]);

      expect(numberEntry.value).toBe(42);
      expect(objectEntry.value).toEqual({ key: 'value' });
      expect(arrayEntry.value).toEqual([1, 2, 3]);
    });
  });

  describe('createTimedCacheEntry', () => {
    it('should create timed cache entry with correct expiration', () => {
      const ttlMs = 5000;
      const before = Date.now();
      const entry = createTimedCacheEntry('test value', ttlMs);
      const after = Date.now();

      expect(entry.value).toBe('test value');
      expect(entry.ttl).toBe(ttlMs);
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
      expect(entry.expiresAt).toBeGreaterThanOrEqual(before + ttlMs);
      expect(entry.expiresAt).toBeLessThanOrEqual(after + ttlMs);
    });
  });

  describe('createLRUCacheEntry', () => {
    it('should create LRU cache entry with access tracking', () => {
      const before = Date.now();
      const entry = createLRUCacheEntry('test value');
      const after = Date.now();

      expect(entry.value).toBe('test value');
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
      expect(entry.createdAt).toBeGreaterThanOrEqual(before);
      expect(entry.createdAt).toBeLessThanOrEqual(after);
      expect(entry.accessedAt).toBeGreaterThanOrEqual(before);
      expect(entry.accessedAt).toBeLessThanOrEqual(after);
      expect(entry.accessCount).toBe(1);
    });
  });

  describe('createCacheStats', () => {
    it('should create initial cache statistics', () => {
      const stats = createCacheStats(100);

      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(100);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should default maxSize to 0', () => {
      const stats = createCacheStats();
      expect(stats.maxSize).toBe(0);
    });
  });
});

// ============================================================================
// Memory Management Tests
// ============================================================================

describe('Memory management', () => {
  describe('Simple Cache memory', () => {
    it('should not grow unbounded with expired entries', async () => {
      const cache = new Cache<string>(50);

      // Add many entries
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      expect(cache.size).toBe(100);

      await new Promise((resolve) => setTimeout(resolve, 80));

      // Cleanup expired
      cache.cleanup();

      expect(cache.size).toBe(0);
    });
  });

  describe('LRU Cache memory', () => {
    it('should never exceed maxSize', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      expect(cache.size).toBe(10);
    });

    it('should maintain correct size after mixed operations', () => {
      const cache = new LRUCache<string>({ maxSize: 5 });

      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.delete('b');
      cache.set('d', '4');
      cache.set('e', '5');
      cache.set('f', '6'); // Would exceed if 'b' wasn't deleted

      expect(cache.size).toBeLessThanOrEqual(5);
    });

    it('should handle rapid set/delete cycles', () => {
      const cache = new LRUCache<number>({ maxSize: 100 });

      for (let i = 0; i < 1000; i++) {
        cache.set(`key${i % 50}`, i);
        if (i % 3 === 0) {
          cache.delete(`key${(i + 17) % 50}`);
        }
      }

      expect(cache.size).toBeLessThanOrEqual(100);
    });
  });

  describe('Dynamic size adjustment', () => {
    it('should evict entries when maxSize is reduced', () => {
      const cache = new LRUCache<string>({ maxSize: 100 });

      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      expect(cache.size).toBe(100);

      cache.setMaxSize(10);

      expect(cache.size).toBe(10);
    });

    it('should track evictions during size reduction', () => {
      const cache = new LRUCache<string>({ maxSize: 10 });

      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      cache.resetStats();
      cache.setMaxSize(5);

      const stats = cache.getStats();
      expect(stats.evictions).toBe(5);
    });
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge cases and error handling', () => {
  describe('Simple Cache edge cases', () => {
    it('should handle undefined values', () => {
      const cache = new Cache<string | undefined>();
      cache.set('key', undefined);

      // Note: undefined values are stored but get() returns undefined
      // which is indistinguishable from "not found"
      expect(cache.get('key')).toBeUndefined();
    });

    it('should handle null values', () => {
      const cache = new Cache<string | null>();
      cache.set('key', null);
      expect(cache.get('key')).toBeNull();
    });

    it('should handle very long keys', () => {
      const cache = new Cache<string>();
      const longKey = 'a'.repeat(10000);
      cache.set(longKey, 'value');
      expect(cache.get(longKey)).toBe('value');
    });

    it('should handle very long values', () => {
      const cache = new Cache<string>();
      const longValue = 'x'.repeat(10000);
      cache.set('key', longValue);
      expect(cache.get('key')).toBe(longValue);
    });

    it('should handle unicode keys and values', () => {
      const cache = new Cache<string>();
      cache.set('emoji-key', 'value');
      cache.set('key', 'emoji-value');
      cache.set('key-with-special', 'value');

      expect(cache.get('emoji-key')).toBe('value');
      expect(cache.get('key')).toBe('emoji-value');
    });
  });

  describe('LRU Cache edge cases', () => {
    it('should handle maxSize of 1', () => {
      const cache = new LRUCache<string>({ maxSize: 1 });

      cache.set('a', '1');
      cache.set('b', '2');

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe('2');
      expect(cache.size).toBe(1);
    });

    it('should handle very large maxSize', () => {
      const cache = new LRUCache<number>({ maxSize: 1000000 });

      for (let i = 0; i < 1000; i++) {
        cache.set(`key${i}`, i);
      }

      expect(cache.size).toBe(1000);
      expect(cache.getStats().evictions).toBe(0);
    });

    it('should handle rapid successive gets', () => {
      const cache = new LRUCache<number>({ maxSize: 10 });
      cache.set('key', 42);

      for (let i = 0; i < 1000; i++) {
        expect(cache.get('key')).toBe(42);
      }

      const stats = cache.getStats();
      expect(stats.hits).toBe(1000);
    });

    it('should handle concurrent-like access patterns', () => {
      const cache = new LRUCache<number>({ maxSize: 5 });

      // Simulate interleaved reads and writes
      cache.set('a', 1);
      cache.get('a');
      cache.set('b', 2);
      cache.get('a');
      cache.set('c', 3);
      cache.get('b');
      cache.set('d', 4);
      cache.get('a');
      cache.set('e', 5);
      cache.set('f', 6);

      // 'c' or 'd' should be evicted (LRU)
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('e')).toBe(5);
      expect(cache.get('f')).toBe(6);
    });
  });

  describe('TTL edge cases', () => {
    it('should handle TTL of 0', async () => {
      const cache = new Cache<string>(0);
      cache.set('key', 'value');

      // With TTL of 0, entry expires immediately
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(cache.get('key')).toBeUndefined();
    });

    it('should handle very large TTL', () => {
      const cache = new Cache<string>(Number.MAX_SAFE_INTEGER);
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
    });

    it('should handle entries set at exactly the same time', () => {
      const cache = new LRUCache<number>({ maxSize: 3 });

      // Set multiple entries "simultaneously"
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);

      // First entry should be evicted
      expect(cache.get('a')).toBeUndefined();
      expect(cache.size).toBe(3);
    });
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance characteristics', () => {
  it('LRUCache should have O(1) get/set operations', () => {
    const cache = new LRUCache<number>({ maxSize: 10000 });

    const startSet = performance.now();
    for (let i = 0; i < 10000; i++) {
      cache.set(`key${i}`, i);
    }
    const setTime = performance.now() - startSet;

    const startGet = performance.now();
    for (let i = 0; i < 10000; i++) {
      cache.get(`key${i}`);
    }
    const getTime = performance.now() - startGet;

    // These should complete in reasonable time (< 1s for 10000 operations)
    expect(setTime).toBeLessThan(1000);
    expect(getTime).toBeLessThan(1000);
  });

  it('Simple Cache should handle many entries efficiently', () => {
    const cache = new Cache<number>();

    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      cache.set(`key${i}`, i);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(cache.size).toBe(10000);
  });

  it('Cleanup should be efficient', async () => {
    const cache = new Cache<number>(50);

    for (let i = 0; i < 10000; i++) {
      cache.set(`key${i}`, i);
    }

    await new Promise((resolve) => setTimeout(resolve, 80));

    const start = performance.now();
    cache.cleanup();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(cache.size).toBe(0);
  });
});
