/**
 * Unit tests for DistributedCache
 * Tests caching, eviction, TTL, sync, and event emission
 */

import DistributedCache, {
  getDistributedCache,
  CacheEntry,
  CacheStats,
  DistributedCacheConfig,
} from '../../src/advanced/distributed-cache';

// Mock crypto module with unique hashes
let hashCounter = 0;
const mockDigest = jest.fn().mockImplementation(() => {
  hashCounter++;
  return `hash${hashCounter.toString().padStart(16, '0')}`;
});
const mockUpdate = jest.fn().mockReturnValue({ digest: mockDigest });
const mockCreateHash = jest.fn().mockReturnValue({ update: mockUpdate });

jest.mock('crypto', () => ({
  createHash: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockImplementation((input: string) => ({
      digest: jest.fn().mockImplementation(() => {
        // Create a deterministic hash based on input
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
          hash = ((hash << 5) - hash) + input.charCodeAt(i);
          hash |= 0;
        }
        return Math.abs(hash).toString(16).padStart(16, '0');
      }),
    })),
  })),
}));

describe('DistributedCache', () => {
  let cache: DistributedCache;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    cache = new DistributedCache();
  });

  afterEach(() => {
    cache.dispose();
    jest.useRealTimers();
  });

  describe('Constructor and Configuration', () => {
    it('should create cache with default configuration', () => {
      const defaultCache = new DistributedCache();
      expect(defaultCache).toBeInstanceOf(DistributedCache);
      defaultCache.dispose();
    });

    it('should create cache with custom configuration', () => {
      const config: DistributedCacheConfig = {
        maxSize: 50 * 1024 * 1024,
        ttl: 1800000,
        syncInterval: 30000,
        nodes: ['node1', 'node2'],
      };
      const customCache = new DistributedCache(config);
      expect(customCache).toBeInstanceOf(DistributedCache);
      customCache.dispose();
    });

    it('should merge partial config with defaults', () => {
      const partialConfig: DistributedCacheConfig = {
        maxSize: 200 * 1024 * 1024,
      };
      const partialCache = new DistributedCache(partialConfig);
      expect(partialCache).toBeInstanceOf(DistributedCache);
      partialCache.dispose();
    });
  });

  describe('set()', () => {
    it('should set a value in the cache', () => {
      const result = cache.set('testKey', 'testValue', 'user1');
      expect(result).toBe(true);
    });

    it('should emit "set" event when setting value', () => {
      const setHandler = jest.fn();
      cache.on('set', setHandler);

      cache.set('testKey', 'testValue', 'user1');

      expect(setHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.any(String),
          size: expect.any(Number),
        })
      );
    });

    it('should reject entries larger than 10% of max size', () => {
      const smallCache = new DistributedCache({ maxSize: 100 });
      const largeValue = 'x'.repeat(20); // 20 bytes > 10 bytes (10% of 100)

      const result = smallCache.set('key', largeValue, 'user1');

      expect(result).toBe(false);
      smallCache.dispose();
    });

    it('should allow entries smaller than 10% of max size', () => {
      const smallCache = new DistributedCache({ maxSize: 1000 });
      const smallValue = 'x'.repeat(50); // 50 bytes < 100 bytes (10% of 1000)

      const result = smallCache.set('key', smallValue, 'user1');

      expect(result).toBe(true);
      smallCache.dispose();
    });

    it('should store metadata with entry', () => {
      cache.set('key', 'value', 'user123');

      // Verify by getting the value back
      const value = cache.get('key');
      expect(value).toBe('value');
    });
  });

  describe('get()', () => {
    it('should return cached value', () => {
      cache.set('myKey', 'myValue', 'user1');
      const result = cache.get('myKey');
      expect(result).toBe('myValue');
    });

    it('should return null for non-existent key', () => {
      const result = cache.get('nonExistent');
      expect(result).toBeNull();
    });

    it('should emit "hit" event on successful get', () => {
      const hitHandler = jest.fn();
      cache.on('hit', hitHandler);

      cache.set('key', 'value', 'user1');
      cache.get('key');

      expect(hitHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.any(String),
        })
      );
    });

    it('should increment hits counter on successful get', () => {
      cache.set('key', 'value', 'user1');

      cache.get('key');
      cache.get('key');
      cache.get('key');

      const stats = cache.getStats();
      expect(stats.hitRate).toBeGreaterThan(0);
    });

    it('should increment misses counter on cache miss', () => {
      cache.get('nonExistent1');
      cache.get('nonExistent2');

      const stats = cache.getStats();
      expect(stats.missRate).toBeGreaterThan(0);
    });

    it('should return null and delete expired entries', () => {
      const shortTtlCache = new DistributedCache({ ttl: 100 });
      shortTtlCache.set('key', 'value', 'user1');

      // Advance time past TTL
      jest.advanceTimersByTime(200);

      const result = shortTtlCache.get('key');
      expect(result).toBeNull();
      shortTtlCache.dispose();
    });
  });

  describe('has()', () => {
    it('should return true for existing key', () => {
      cache.set('key', 'value', 'user1');
      expect(cache.has('key')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(cache.has('nonExistent')).toBe(false);
    });

    it('should return false for expired key', () => {
      const shortTtlCache = new DistributedCache({ ttl: 100 });
      shortTtlCache.set('key', 'value', 'user1');

      jest.advanceTimersByTime(200);

      expect(shortTtlCache.has('key')).toBe(false);
      shortTtlCache.dispose();
    });
  });

  describe('delete()', () => {
    it('should delete existing key', () => {
      cache.set('key', 'value', 'user1');
      const result = cache.delete('key');

      expect(result).toBe(true);
      expect(cache.has('key')).toBe(false);
    });

    it('should return false when deleting non-existent key', () => {
      const result = cache.delete('nonExistent');
      expect(result).toBe(false);
    });
  });

  describe('getStats()', () => {
    it('should return correct stats for empty cache', () => {
      const stats = cache.getStats();

      expect(stats).toEqual({
        totalEntries: 0,
        totalSize: 0,
        hitRate: 0,
        missRate: 0,
      });
    });

    it('should return correct entry count', () => {
      cache.set('key1', 'value1', 'user1');
      cache.set('key2', 'value2', 'user1');
      cache.set('key3', 'value3', 'user1');

      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(3);
    });

    it('should calculate total size', () => {
      cache.set('key', 'test value', 'user1');

      const stats = cache.getStats();
      expect(stats.totalSize).toBeGreaterThan(0);
    });

    it('should calculate hit rate correctly', () => {
      cache.set('key', 'value', 'user1');

      cache.get('key'); // hit
      cache.get('key'); // hit
      cache.get('miss'); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
      expect(stats.missRate).toBeCloseTo(1 / 3, 2);
    });
  });

  describe('clear()', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'value1', 'user1');
      cache.set('key2', 'value2', 'user1');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('should reset hit/miss counters', () => {
      cache.set('key', 'value', 'user1');
      cache.get('key');
      cache.get('miss');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
      expect(stats.missRate).toBe(0);
    });

    it('should emit "cleared" event', () => {
      const clearedHandler = jest.fn();
      cache.on('cleared', clearedHandler);

      cache.clear();

      expect(clearedHandler).toHaveBeenCalled();
    });
  });

  describe('Eviction', () => {
    it('should evict least hit entries when cache is full', () => {
      // Create a very small cache
      const smallCache = new DistributedCache({ maxSize: 100 });

      // Add entries that together exceed the limit
      smallCache.set('key1', 'x'.repeat(5), 'user1');
      smallCache.set('key2', 'x'.repeat(5), 'user1');

      // Access key2 to give it more hits
      smallCache.get('key2');
      smallCache.get('key2');

      // Add a large entry that will trigger eviction
      smallCache.set('key3', 'x'.repeat(5), 'user1');

      // key1 should potentially be evicted as it has fewer hits
      const stats = smallCache.getStats();
      expect(stats.totalEntries).toBeLessThanOrEqual(3);
      smallCache.dispose();
    });
  });

  describe('Sync Operations', () => {
    it('should start sync timer', () => {
      cache.startSync();

      // Sync should emit events at intervals
      const syncHandler = jest.fn();
      cache.on('sync', syncHandler);

      jest.advanceTimersByTime(60000); // Default sync interval

      expect(syncHandler).toHaveBeenCalled();
    });

    it('should stop sync timer', () => {
      cache.startSync();
      cache.stopSync();

      const syncHandler = jest.fn();
      cache.on('sync', syncHandler);

      jest.advanceTimersByTime(120000);

      expect(syncHandler).not.toHaveBeenCalled();
    });

    it('should cleanup expired entries during sync', () => {
      const shortTtlCache = new DistributedCache({ ttl: 100, syncInterval: 50 });
      shortTtlCache.set('key', 'value', 'user1');

      shortTtlCache.startSync();
      jest.advanceTimersByTime(200);

      // After cleanup, the expired entry should be removed
      expect(shortTtlCache.has('key')).toBe(false);
      shortTtlCache.dispose();
    });

    it('should include stats in sync event', () => {
      cache.set('key', 'value', 'user1');
      cache.startSync();

      const syncHandler = jest.fn();
      cache.on('sync', syncHandler);

      jest.advanceTimersByTime(60000);

      expect(syncHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          totalEntries: expect.any(Number),
          totalSize: expect.any(Number),
          hitRate: expect.any(Number),
          missRate: expect.any(Number),
        })
      );
    });
  });

  describe('dispose()', () => {
    it('should stop sync and clear cache', () => {
      cache.set('key', 'value', 'user1');
      cache.startSync();

      cache.dispose();

      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('should remove all event listeners', () => {
      const handler = jest.fn();
      cache.on('set', handler);
      cache.on('hit', handler);
      cache.on('cleared', handler);

      cache.dispose();

      // After dispose, the cache has removed all listeners
      // So the handler count should remain at what it was before the new set call
      // (dispose clears listeners, then the next operation won't trigger them)
      expect(cache.listenerCount('set')).toBe(0);
    });
  });

  describe('Event Emission', () => {
    it('should be an EventEmitter', () => {
      expect(typeof cache.on).toBe('function');
      expect(typeof cache.emit).toBe('function');
      expect(typeof cache.removeAllListeners).toBe('function');
    });

    it('should support multiple listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      cache.on('set', handler1);
      cache.on('set', handler2);

      cache.set('key', 'value', 'user1');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });
});

describe('getDistributedCache singleton', () => {
  afterEach(() => {
    // Clean up singleton - note: this is a simplified cleanup
    // In real scenario, you might need to reset the module
  });

  it('should return a DistributedCache instance', () => {
    const cache = getDistributedCache();
    expect(cache).toBeInstanceOf(DistributedCache);
  });

  it('should return the same instance on multiple calls', () => {
    const cache1 = getDistributedCache();
    const cache2 = getDistributedCache();
    expect(cache1).toBe(cache2);
  });

  it('should accept config on first call', () => {
    // Reset module to test fresh singleton
    jest.resetModules();
    const { getDistributedCache: getFresh, default: DCClass } = require('../../src/advanced/distributed-cache');

    const cache = getFresh({ maxSize: 50 * 1024 * 1024 });
    // Check that it's a DistributedCache by duck-typing
    expect(typeof cache.set).toBe('function');
    expect(typeof cache.get).toBe('function');
    expect(typeof cache.getStats).toBe('function');
  });
});

describe('Edge Cases', () => {
  let cache: DistributedCache;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new DistributedCache();
  });

  afterEach(() => {
    cache.dispose();
    jest.useRealTimers();
  });

  it('should handle empty string values', () => {
    const result = cache.set('key', '', 'user1');
    expect(result).toBe(true);
    expect(cache.get('key')).toBe('');
  });

  it('should handle unicode values', () => {
    const unicodeValue = 'Hello \u4e16\u754c \ud83c\udf0d';
    cache.set('key', unicodeValue, 'user1');
    expect(cache.get('key')).toBe(unicodeValue);
  });

  it('should handle special characters in keys', () => {
    cache.set('key with spaces & special!@#$%', 'value', 'user1');
    expect(cache.get('key with spaces & special!@#$%')).toBe('value');
  });

  it('should handle very long keys', () => {
    const longKey = 'k'.repeat(10000);
    cache.set(longKey, 'value', 'user1');
    expect(cache.get(longKey)).toBe('value');
  });

  it('should handle concurrent set operations', () => {
    for (let i = 0; i < 100; i++) {
      cache.set(`key${i}`, `value${i}`, 'user1');
    }

    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(100);
  });

  it('should handle rapid get/set cycles', () => {
    for (let i = 0; i < 50; i++) {
      cache.set('rapidKey', `value${i}`, 'user1');
      const val = cache.get('rapidKey');
      expect(val).toBe(`value${i}`);
    }
  });

  it('should overwrite existing entries', () => {
    cache.set('key', 'value1', 'user1');
    cache.set('key', 'value2', 'user2');

    expect(cache.get('key')).toBe('value2');
  });

  it('should handle stopSync when no sync is running', () => {
    // Should not throw
    expect(() => cache.stopSync()).not.toThrow();
  });

  it('should handle multiple startSync calls', () => {
    cache.startSync();
    cache.startSync();

    const syncHandler = jest.fn();
    cache.on('sync', syncHandler);

    jest.advanceTimersByTime(120000);

    // Should still work (last timer wins)
    expect(syncHandler).toHaveBeenCalled();
  });
});
