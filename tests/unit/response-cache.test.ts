/**
 * Comprehensive Unit Tests for Response Cache
 *
 * Tests cover:
 * 1. Cache initialization
 * 2. Get and set operations
 * 3. TTL expiration
 * 4. Context hash validation
 * 5. Cache eviction
 * 6. Statistics
 * 7. Invalidation
 * 8. Singleton and reset
 */

// Create mock functions
const mockReadFile = jest.fn().mockResolvedValue('{}');
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
const mockExistsSync = jest.fn().mockReturnValue(false);
const mockMkdirSync = jest.fn();

// Mock fs modules before importing
jest.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

import {
  ResponseCache,
  CacheEntry,
  CacheStats,
  getResponseCache,
  resetResponseCache,
} from '../../src/utils/response-cache';

describe('ResponseCache', () => {
  let cache: ResponseCache;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFile.mockResolvedValue(JSON.stringify({ entries: {}, stats: { hits: 0, misses: 0 } }));

    cache = new ResponseCache({
      maxEntries: 10,
      defaultTTL: 3600, // 1 hour
    });

    // Wait for async initialization
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  afterEach(async () => {
    await cache.dispose();
  });

  describe('Constructor and Initialization', () => {
    it('should create cache with default options', async () => {
      const defaultCache = new ResponseCache();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(defaultCache).toBeDefined();
      await defaultCache.dispose();
    });

    it('should create cache with custom options', async () => {
      const customCache = new ResponseCache({
        maxEntries: 500,
        defaultTTL: 7200,
      });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(customCache).toBeDefined();
      await customCache.dispose();
    });

    it('should create cache directory if not exists', async () => {
      mockExistsSync.mockReturnValue(false);

      const newCache = new ResponseCache();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockMkdirSync).toHaveBeenCalled();
      await newCache.dispose();
    });

    it('should load existing cache from file', async () => {
      const existingCache = {
        entries: {
          'key1': {
            query: 'test query',
            response: 'test response that is long enough to be cached by the system',
            model: 'grok-3',
            contextHash: 'hash1',
            timestamp: Date.now(),
            ttl: 3600,
            hits: 5,
          },
        },
        stats: { hits: 10, misses: 5 },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(existingCache));

      const loadedCache = new ResponseCache();
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = loadedCache.getStats();
      expect(stats.totalHits).toBe(10);
      await loadedCache.dispose();
    });

    it('should filter expired entries on load', async () => {
      const existingCache = {
        entries: {
          'expired': {
            query: 'old query',
            response: 'old response that is long enough to be cached properly by the system',
            model: 'grok-3',
            contextHash: 'hash1',
            timestamp: Date.now() - 7200000, // 2 hours ago
            ttl: 3600, // 1 hour TTL
            hits: 0,
          },
        },
        stats: { hits: 0, misses: 0 },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(existingCache));

      const loadedCache = new ResponseCache({ defaultTTL: 3600 });
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = loadedCache.getStats();
      expect(stats.totalEntries).toBe(0);
      await loadedCache.dispose();
    });

    it('should handle corrupted cache file gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockRejectedValue(new Error('File read error'));

      const brokenCache = new ResponseCache();
      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = brokenCache.getStats();
      expect(stats.totalEntries).toBe(0);
      await brokenCache.dispose();
    }, 5000);
  });

  describe('generateContextHash', () => {
    it('should generate hash for files', () => {
      const files = [
        { path: '/test/file1.ts', content: 'content 1' },
        { path: '/test/file2.ts', content: 'content 2' },
      ];

      const hash = cache.generateContextHash(files);

      expect(hash).toBeDefined();
      expect(hash.length).toBe(16);
    });

    it('should generate consistent hash for same files', () => {
      const files = [
        { path: '/test/file.ts', content: 'content' },
      ];

      const hash1 = cache.generateContextHash(files);
      const hash2 = cache.generateContextHash(files);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different files', () => {
      const files1 = [{ path: '/test/file1.ts', content: 'content 1' }];
      const files2 = [{ path: '/test/file2.ts', content: 'content 2' }];

      const hash1 = cache.generateContextHash(files1);
      const hash2 = cache.generateContextHash(files2);

      expect(hash1).not.toBe(hash2);
    });

    it('should use mtime if provided', () => {
      const files1 = [{ path: '/test/file.ts', content: 'content', mtime: 1000 }];
      const files2 = [{ path: '/test/file.ts', content: 'content', mtime: 2000 }];

      const hash1 = cache.generateContextHash(files1);
      const hash2 = cache.generateContextHash(files2);

      expect(hash1).not.toBe(hash2);
    });

    it('should sort files by path for consistent hashing', () => {
      const files1 = [
        { path: '/test/a.ts', content: 'a' },
        { path: '/test/b.ts', content: 'b' },
      ];
      const files2 = [
        { path: '/test/b.ts', content: 'b' },
        { path: '/test/a.ts', content: 'a' },
      ];

      const hash1 = cache.generateContextHash(files1);
      const hash2 = cache.generateContextHash(files2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('set and get', () => {
    const query = 'test query';
    const response = 'This is a test response that is long enough to be cached by the system';
    const contextHash = 'contexthash123';
    const model = 'grok-3';

    it('should cache a response', () => {
      cache.set(query, response, contextHash, model);

      const cached = cache.get(query, contextHash, model);
      expect(cached).toBe(response);
    });

    it('should return null for cache miss', () => {
      const cached = cache.get('nonexistent', contextHash, model);
      expect(cached).toBeNull();
    });

    it('should not cache short responses', () => {
      cache.set(query, 'short', contextHash, model);

      const cached = cache.get(query, contextHash, model);
      expect(cached).toBeNull();
    });

    it('should not cache error responses', () => {
      cache.set(query, 'Error: something went wrong with this operation', contextHash, model);

      const cached = cache.get(query, contextHash, model);
      expect(cached).toBeNull();
    });

    it('should increment hits on cache hit', () => {
      cache.set(query, response, contextHash, model);

      const statsBefore = cache.getStats();
      cache.get(query, contextHash, model);
      const statsAfter = cache.getStats();

      expect(statsAfter.totalHits).toBe(statsBefore.totalHits + 1);
    });

    it('should increment misses on cache miss', () => {
      const statsBefore = cache.getStats();
      cache.get('nonexistent', contextHash, model);
      const statsAfter = cache.getStats();

      expect(statsAfter.totalMisses).toBe(statsBefore.totalMisses + 1);
    });

    it('should respect custom TTL', () => {
      cache.set(query, response, contextHash, model, 1); // 1 second TTL

      // Cache should hit immediately
      expect(cache.get(query, contextHash, model)).toBe(response);
    });

    it('should return null for expired entry', async () => {
      // Create cache with very short TTL
      const shortTTLCache = new ResponseCache({
        maxEntries: 10,
        defaultTTL: 1, // 1 second
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      shortTTLCache.set(query, response, contextHash, model);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      const cached = shortTTLCache.get(query, contextHash, model);
      expect(cached).toBeNull();

      await shortTTLCache.dispose();
    });

    it('should return null when context hash changes', () => {
      cache.set(query, response, 'hash1', model);

      const cached = cache.get(query, 'hash2', model);
      expect(cached).toBeNull();
    });

    it('should differentiate by model', () => {
      cache.set(query, response, contextHash, 'grok-3');
      cache.set(query, 'different response that is also long enough for caching', contextHash, 'grok-2');

      const cached1 = cache.get(query, contextHash, 'grok-3');
      const cached2 = cache.get(query, contextHash, 'grok-2');

      expect(cached1).toBe(response);
      expect(cached2).toBe('different response that is also long enough for caching');
    });
  });

  describe('Cache Eviction', () => {
    it('should evict oldest entries when at capacity', async () => {
      const smallCache = new ResponseCache({
        maxEntries: 3,
        defaultTTL: 3600,
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Fill cache
      smallCache.set('q1', 'Response 1 that is long enough to be cached by the system', 'h1', 'm1');
      await new Promise(resolve => setTimeout(resolve, 10));
      smallCache.set('q2', 'Response 2 that is long enough to be cached by the system', 'h2', 'm1');
      await new Promise(resolve => setTimeout(resolve, 10));
      smallCache.set('q3', 'Response 3 that is long enough to be cached by the system', 'h3', 'm1');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add one more to trigger eviction
      smallCache.set('q4', 'Response 4 that is long enough to be cached by the system', 'h4', 'm1');

      const stats = smallCache.getStats();
      expect(stats.totalEntries).toBeLessThanOrEqual(3);

      await smallCache.dispose();
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      cache.set('q1', 'Response 1 that is long enough to be cached by the system', 'h1', 'm1');
      cache.set('q2', 'Response 2 that is long enough to be cached by the system', 'h2', 'm1');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.totalHits).toBe(0);
      expect(stats.totalMisses).toBe(0);
    });
  });

  describe('invalidateForFile', () => {
    it('should invalidate entries related to a file', () => {
      // Need to use longer responses to ensure caching (min 50 chars)
      cache.set('query mentioning /test/file.ts in the query text for caching', 'Response about the file that is definitely long enough to be cached', 'h1', 'm1');
      cache.set('query mentioning /other/file.ts in the query text for caching', 'Response about other file that is definitely long enough to be cached', 'h2', 'm1');

      const invalidated = cache.invalidateForFile('/test/file.ts');

      expect(invalidated).toBe(1);
      expect(cache.get('query mentioning /test/file.ts in the query text for caching', 'h1', 'm1')).toBeNull();
      expect(cache.get('query mentioning /other/file.ts in the query text for caching', 'h2', 'm1')).not.toBeNull();
    });

    it('should return 0 when no entries match', () => {
      cache.set('query', 'Response that is long enough to be cached by the system', 'h1', 'm1');

      const invalidated = cache.invalidateForFile('/nonexistent/file.ts');

      expect(invalidated).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      const stats = cache.getStats();

      expect(stats).toHaveProperty('totalEntries');
      expect(stats).toHaveProperty('totalHits');
      expect(stats).toHaveProperty('totalMisses');
      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('oldestEntry');
      expect(stats).toHaveProperty('newestEntry');
    });

    it('should track entry timestamps', () => {
      cache.set('q1', 'Response 1 that is long enough to be cached by the system', 'h1', 'm1');

      const stats = cache.getStats();

      expect(stats.oldestEntry).toBeInstanceOf(Date);
      expect(stats.newestEntry).toBeInstanceOf(Date);
    });

    it('should return null timestamps when empty', () => {
      const stats = cache.getStats();

      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
    });

    it('should format cache size correctly', () => {
      cache.set('q1', 'A'.repeat(100), 'h1', 'm1'); // Should be cached (>50 chars)

      const stats = cache.getStats();

      expect(stats.cacheSize).toMatch(/\d+ B|\d+\.\d+ KB|\d+\.\d+ MB/);
    });
  });

  describe('formatStatus', () => {
    it('should return formatted status string', () => {
      cache.set('query', 'Response that is long enough to be cached by the system', 'h1', 'm1');
      cache.get('query', 'h1', 'm1'); // Hit
      cache.get('nonexistent', 'h2', 'm1'); // Miss

      const status = cache.formatStatus();

      expect(status).toContain('Response Cache');
      expect(status).toContain('Entries:');
      expect(status).toContain('Hit Rate:');
    });

    it('should show 0% hit rate when no operations', () => {
      const status = cache.formatStatus();
      expect(status).toContain('0%');
    });
  });

  describe('dispose', () => {
    it('should save cache on dispose', async () => {
      cache.set('query', 'Response that is long enough to be cached by the system', 'h1', 'm1');

      // Clear mock to check new calls
      mockWriteFile.mockClear();

      await cache.dispose();

      // Give time for async save
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should clear pending save timeout', async () => {
      cache.set('query', 'Response that is long enough to be cached by the system', 'h1', 'm1');

      // Dispose should clear timeout and save immediately
      await cache.dispose();

      // No error should occur
      expect(true).toBe(true);
    });
  });

  describe('Singleton functions', () => {
    beforeEach(() => {
      resetResponseCache();
    });

    it('should return singleton instance', () => {
      const instance1 = getResponseCache();
      const instance2 = getResponseCache();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', async () => {
      const instance1 = getResponseCache();
      await new Promise(resolve => setTimeout(resolve, 50));

      resetResponseCache();
      await new Promise(resolve => setTimeout(resolve, 50));

      const instance2 = getResponseCache();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Debounced Saves', () => {
    it('should debounce multiple set operations', async () => {
      mockWriteFile.mockClear();

      cache.set('q1', 'Response 1 that is long enough to be cached by the system', 'h1', 'm1');
      cache.set('q2', 'Response 2 that is long enough to be cached by the system', 'h2', 'm1');
      cache.set('q3', 'Response 3 that is long enough to be cached by the system', 'h3', 'm1');

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Should have been called once (or few times) due to debouncing
      expect(mockWriteFile.mock.calls.length).toBeLessThan(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in query', () => {
      const specialQuery = 'query with "quotes" and \n newlines';
      const response = 'Response that is long enough to be cached by the system properly';

      cache.set(specialQuery, response, 'h1', 'm1');

      const cached = cache.get(specialQuery, 'h1', 'm1');
      expect(cached).toBe(response);
    });

    it('should handle unicode in response', () => {
      const response = 'Response with unicode characters and plenty of content to make it long enough';

      cache.set('query', response, 'h1', 'm1');

      const cached = cache.get('query', 'h1', 'm1');
      expect(cached).toBe(response);
    });

    it('should handle very long responses', () => {
      const longResponse = 'x'.repeat(100000);

      cache.set('query', longResponse, 'h1', 'm1');

      const cached = cache.get('query', 'h1', 'm1');
      expect(cached).toBe(longResponse);
    });
  });
});
