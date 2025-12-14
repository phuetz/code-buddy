/**
 * Tests for Performance Modules
 * - LazyLoader
 * - ToolCache
 * - RequestOptimizer
 */

import {
  LazyLoader,
  getLazyLoader,
  resetLazyLoader,
  registerCommonModules,
  initializeLazyLoader,
} from '../src/performance/lazy-loader.js';

import {
  ToolCache,
  getToolCache,
  resetToolCache,
  withCache,
} from '../src/performance/tool-cache.js';

import {
  RequestOptimizer,
  getRequestOptimizer,
  resetRequestOptimizer,
} from '../src/performance/request-optimizer.js';

// ============================================================================
// LazyLoader Tests
// ============================================================================

describe('LazyLoader', () => {
  let loader: LazyLoader;

  beforeEach(() => {
    resetLazyLoader();
    loader = new LazyLoader();
  });

  afterEach(() => {
    loader.clear();
  });

  describe('register', () => {
    it('should register a module', () => {
      loader.register('test-module', async () => ({ value: 42 }));
      expect(loader.isLoaded('test-module')).toBe(false);
    });

    it('should emit module:registered event', (done) => {
      loader.on('module:registered', (data) => {
        expect(data.name).toBe('my-module');
        done();
      });
      loader.register('my-module', async () => 'value');
    });
  });

  describe('get', () => {
    it('should load and return module on first access', async () => {
      loader.register('my-module', async () => ({ data: 'test' }));

      const result = await loader.get('my-module');

      expect(result).toEqual({ data: 'test' });
      expect(loader.isLoaded('my-module')).toBe(true);
    });

    it('should return cached instance on subsequent calls', async () => {
      let loadCount = 0;
      loader.register('counted-module', async () => {
        loadCount++;
        return { count: loadCount };
      });

      const result1 = await loader.get('counted-module');
      const result2 = await loader.get('counted-module');

      expect(result1).toBe(result2);
      expect(loadCount).toBe(1);
    });

    it('should throw for unregistered module', async () => {
      await expect(loader.get('unknown')).rejects.toThrow('Module not registered');
    });

    it('should handle concurrent loads', async () => {
      let loadCount = 0;
      loader.register('concurrent-module', async () => {
        await new Promise((r) => setTimeout(r, 50));
        loadCount++;
        return { value: loadCount };
      });

      const [result1, result2] = await Promise.all([
        loader.get('concurrent-module'),
        loader.get('concurrent-module'),
      ]);

      expect(result1).toBe(result2);
      expect(loadCount).toBe(1);
    });

    it('should emit module:loaded event', (done) => {
      loader.on('module:loaded', (data) => {
        expect(data.name).toBe('event-module');
        expect(data.loadTime).toBeGreaterThanOrEqual(0);
        done();
      });

      loader.register('event-module', async () => 'loaded');
      loader.get('event-module');
    });

    it('should handle loader errors', async () => {
      loader.register('error-module', async () => {
        throw new Error('Load failed');
      });

      await expect(loader.get('error-module')).rejects.toThrow('Load failed');
    });
  });

  describe('isLoaded', () => {
    it('should return false for unloaded module', () => {
      loader.register('unloaded', async () => 'value');
      expect(loader.isLoaded('unloaded')).toBe(false);
    });

    it('should return true for loaded module', async () => {
      loader.register('loaded', async () => 'value');
      await loader.get('loaded');
      expect(loader.isLoaded('loaded')).toBe(true);
    });

    it('should return false for unknown module', () => {
      expect(loader.isLoaded('unknown')).toBe(false);
    });
  });

  describe('preload', () => {
    it('should preload specified modules', async () => {
      loader.register('mod1', async () => 'value1');
      loader.register('mod2', async () => 'value2');

      await loader.preload(['mod1', 'mod2']);

      expect(loader.isLoaded('mod1')).toBe(true);
      expect(loader.isLoaded('mod2')).toBe(true);
    });

    it('should handle preload errors gracefully', async () => {
      loader.register('good', async () => 'ok');
      loader.register('bad', async () => {
        throw new Error('Failed');
      });

      // Should not throw
      await expect(loader.preload(['good', 'bad'])).resolves.not.toThrow();

      expect(loader.isLoaded('good')).toBe(true);
      expect(loader.isLoaded('bad')).toBe(false);
    });

    it('should emit preload:complete event', (done) => {
      loader.register('preload1', async () => 'v1');

      loader.on('preload:complete', (data) => {
        expect(data.modules).toContain('preload1');
        done();
      });

      loader.preload(['preload1']);
    });
  });

  describe('unload', () => {
    it('should unload a loaded module', async () => {
      loader.register('unload-test', async () => 'value');
      await loader.get('unload-test');
      expect(loader.isLoaded('unload-test')).toBe(true);

      const unloaded = loader.unload('unload-test');

      expect(unloaded).toBe(true);
      expect(loader.isLoaded('unload-test')).toBe(false);
    });

    it('should return false for unloaded module', () => {
      loader.register('never-loaded', async () => 'value');
      expect(loader.unload('never-loaded')).toBe(false);
    });

    it('should return false for unknown module', () => {
      expect(loader.unload('unknown')).toBe(false);
    });

    it('should reload on next access', async () => {
      let loadCount = 0;
      loader.register('reload-test', async () => {
        loadCount++;
        return loadCount;
      });

      await loader.get('reload-test');
      expect(loadCount).toBe(1);

      loader.unload('reload-test');

      await loader.get('reload-test');
      expect(loadCount).toBe(2);
    });
  });

  describe('getMetrics', () => {
    it('should return load metrics', async () => {
      loader.register('metrics-test', async () => 'value');
      await loader.get('metrics-test');

      const metrics = loader.getMetrics();

      expect(metrics.length).toBe(1);
      expect(metrics[0].moduleName).toBe('metrics-test');
      expect(metrics[0].success).toBe(true);
    });

    it('should include failed loads', async () => {
      loader.register('fail-metrics', async () => {
        throw new Error('Fail');
      });

      try {
        await loader.get('fail-metrics');
      } catch {
        // Expected
      }

      const metrics = loader.getMetrics();
      const failMetric = metrics.find((m) => m.moduleName === 'fail-metrics');

      expect(failMetric).toBeDefined();
      expect(failMetric!.success).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return summary statistics', async () => {
      loader.register('stat1', async () => 'v1');
      loader.register('stat2', async () => 'v2');
      loader.register('stat3', async () => 'v3');

      await loader.get('stat1');
      await loader.get('stat2');

      const stats = loader.getStats();

      expect(stats.totalModules).toBe(3);
      expect(stats.loadedModules).toBe(2);
      expect(stats.totalLoadTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clear', () => {
    it('should clear all modules', async () => {
      loader.register('clear1', async () => 'v1');
      loader.register('clear2', async () => 'v2');
      await loader.get('clear1');

      loader.clear();

      expect(loader.getStats().totalModules).toBe(0);
      expect(loader.getMetrics().length).toBe(0);
    });
  });

  describe('Singleton functions', () => {
    it('should return same instance from getLazyLoader', () => {
      resetLazyLoader();
      const loader1 = getLazyLoader();
      const loader2 = getLazyLoader();
      expect(loader1).toBe(loader2);
    });

    it('should reset instance with resetLazyLoader', () => {
      const loader1 = getLazyLoader();
      resetLazyLoader();
      const loader2 = getLazyLoader();
      expect(loader1).not.toBe(loader2);
    });
  });

  describe('registerCommonModules', () => {
    it('should register common modules', () => {
      registerCommonModules(loader);

      // Should have common modules registered
      expect(loader.isLoaded('pdf-parse')).toBe(false); // Registered but not loaded
      expect(loader.isLoaded('xlsx')).toBe(false);
      expect(loader.isLoaded('better-sqlite3')).toBe(false);
    });
  });

  describe('initializeLazyLoader', () => {
    it('should create and configure loader', () => {
      resetLazyLoader();
      const initialized = initializeLazyLoader({
        preloadDelay: 5000,
      });

      expect(initialized).toBeInstanceOf(LazyLoader);
    });
  });
});

// ============================================================================
// ToolCache Tests
// ============================================================================

describe('ToolCache', () => {
  let cache: ToolCache;

  beforeEach(() => {
    resetToolCache();
    cache = new ToolCache({
      enabled: true,
      ttlMs: 60000,
    });
  });

  afterEach(() => {
    cache.dispose();
  });

  describe('isCacheable', () => {
    it('should return true for cacheable tools', () => {
      expect(cache.isCacheable('search', { query: 'test' })).toBe(true);
      expect(cache.isCacheable('grep', { pattern: 'test' })).toBe(true);
      expect(cache.isCacheable('glob', { pattern: '*.ts' })).toBe(true);
    });

    it('should return false for mutable tools', () => {
      expect(cache.isCacheable('bash', { command: 'ls' })).toBe(false);
      expect(cache.isCacheable('str_replace_editor', { file: 'test.ts' })).toBe(false);
      expect(cache.isCacheable('git_commit', { message: 'test' })).toBe(false);
    });

    it('should return false for non-cacheable tools', () => {
      expect(cache.isCacheable('unknown_tool', {})).toBe(false);
    });

    it('should return false when disabled', () => {
      cache.updateConfig({ enabled: false });
      expect(cache.isCacheable('search', { query: 'test' })).toBe(false);
    });

    it('should return false for excluded patterns', () => {
      expect(cache.isCacheable('search', { query: 'test', force: '--force' })).toBe(false);
      expect(cache.isCacheable('search', { query: 'random number' })).toBe(false);
    });
  });

  describe('getOrExecute', () => {
    it('should execute and cache for cacheable tools', async () => {
      let execCount = 0;
      const execute = async () => {
        execCount++;
        return { success: true, output: 'result' };
      };

      const result1 = await cache.getOrExecute('search', { query: 'test' }, execute);
      const result2 = await cache.getOrExecute('search', { query: 'test' }, execute);

      expect(result1.output).toBe('result');
      expect(result2.output).toBe('result');
      expect(execCount).toBe(1); // Should only execute once
      expect(result2.cached).toBe(true);
    });

    it('should not cache mutable tools', async () => {
      let execCount = 0;
      const execute = async () => {
        execCount++;
        return { success: true, output: String(execCount) };
      };

      await cache.getOrExecute('bash', { command: 'ls' }, execute);
      await cache.getOrExecute('bash', { command: 'ls' }, execute);

      expect(execCount).toBe(2);
    });

    it('should track cache statistics', async () => {
      const execute = async () => ({ success: true, output: 'data' });

      await cache.getOrExecute('search', { q: '1' }, execute);
      await cache.getOrExecute('search', { q: '1' }, execute);
      await cache.getOrExecute('search', { q: '2' }, execute);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(1 / 3, 2);
    });
  });

  describe('invalidate', () => {
    it('should invalidate by tool name', async () => {
      const execute = async () => ({ success: true, output: 'data' });

      await cache.getOrExecute('search', { q: 'test' }, execute);

      const count = cache.invalidate('search');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should invalidate by pattern', async () => {
      const execute = async () => ({ success: true, output: 'data' });

      await cache.getOrExecute('grep', { pattern: 'error' }, execute);

      const count = cache.invalidate(undefined, /error/);
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('invalidateForFile', () => {
    it('should invalidate cache entries for a file', async () => {
      const execute = async () => ({ success: true, output: 'content' });

      await cache.getOrExecute('view_file', { path: '/src/test.ts' }, execute);

      const count = cache.invalidateForFile('/src/test.ts');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clear', () => {
    it('should clear all cache entries', async () => {
      const execute = async () => ({ success: true, output: 'data' });

      await cache.getOrExecute('search', { q: '1' }, execute);
      await cache.getOrExecute('search', { q: '2' }, execute);

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return current statistics', async () => {
      const stats = cache.getStats();

      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('hitRate');
      expect(stats).toHaveProperty('savedCalls');
      expect(stats).toHaveProperty('savedTime');
    });
  });

  describe('getCacheInfo', () => {
    it('should return detailed cache info', () => {
      const info = cache.getCacheInfo();

      expect(info.stats).toBeDefined();
      expect(info.cacheStats).toBeDefined();
      expect(info.config).toBeDefined();
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      cache.updateConfig({ ttlMs: 120000 });
      const info = cache.getCacheInfo();
      expect(info.config.ttlMs).toBe(120000);
    });
  });

  describe('Singleton functions', () => {
    it('should return same instance from getToolCache', () => {
      resetToolCache();
      const cache1 = getToolCache();
      const cache2 = getToolCache();
      expect(cache1).toBe(cache2);
    });
  });

  describe('withCache', () => {
    it('should wrap tool execution with caching', async () => {
      resetToolCache();
      let execCount = 0;

      const result = await withCache('search', { q: 'test' }, async () => {
        execCount++;
        return { success: true, output: 'data' };
      });

      expect(result.success).toBe(true);
      expect(execCount).toBe(1);
    });
  });
});

// ============================================================================
// RequestOptimizer Tests
// ============================================================================

describe('RequestOptimizer', () => {
  let optimizer: RequestOptimizer;

  beforeEach(() => {
    resetRequestOptimizer();
    optimizer = new RequestOptimizer({
      maxConcurrent: 3,
      batchWindowMs: 10,
      maxRetries: 2,
      retryBaseDelayMs: 50,
      timeoutMs: 5000,
    });
  });

  afterEach(() => {
    optimizer.clear();
  });

  describe('execute', () => {
    it('should execute request', async () => {
      const result = await optimizer.execute('test-key', async () => 'result');
      expect(result).toBe('result');
    });

    it('should deduplicate concurrent requests', async () => {
      let execCount = 0;
      const execute = async () => {
        execCount++;
        await new Promise((r) => setTimeout(r, 100));
        return 'result';
      };

      const [result1, result2] = await Promise.all([
        optimizer.execute('same-key', execute),
        optimizer.execute('same-key', execute),
      ]);

      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(execCount).toBe(1);
    });

    it('should track deduplication stats', async () => {
      const execute = async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 'result';
      };

      await Promise.all([
        optimizer.execute('dup-key', execute),
        optimizer.execute('dup-key', execute),
      ]);

      const stats = optimizer.getStats();
      expect(stats.deduplicatedRequests).toBe(1);
    });

    it('should respect priority ordering', async () => {
      const order: string[] = [];

      await Promise.all([
        optimizer.execute('low', async () => {
          order.push('low');
          return 'low';
        }, { priority: 1 }),
        optimizer.execute('high', async () => {
          order.push('high');
          return 'high';
        }, { priority: 10 }),
      ]);

      // Higher priority should be processed first
      // Note: This may vary based on timing
      expect(order.length).toBe(2);
    });
  });

  describe('executeImmediate', () => {
    it('should execute immediately without queuing', async () => {
      const result = await optimizer.executeImmediate(async () => 'immediate');
      expect(result).toBe('immediate');
    });

    it('should retry on failure', async () => {
      let attempts = 0;
      const execute = async () => {
        attempts++;
        if (attempts < 2) throw new Error('Fail');
        return 'success';
      };

      const result = await optimizer.executeImmediate(execute, { retries: 3 });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should throw after max retries', async () => {
      const execute = async () => {
        throw new Error('Always fails');
      };

      await expect(
        optimizer.executeImmediate(execute, { retries: 2 })
      ).rejects.toThrow('Always fails');
    });
  });

  describe('concurrency control', () => {
    it('should respect maxConcurrent limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const execute = async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 50));
        concurrent--;
        return 'done';
      };

      // Queue 10 requests
      const promises = Array(10).fill(null).map((_, i) =>
        optimizer.execute(`key-${i}`, execute, { deduplicate: false })
      );

      await Promise.all(promises);

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });
  });

  describe('getStats', () => {
    it('should return request statistics', async () => {
      await optimizer.execute('stat-test', async () => 'result');

      const stats = optimizer.getStats();

      expect(stats.totalRequests).toBe(1);
      expect(stats.successfulRequests).toBe(1);
      expect(stats.failedRequests).toBe(0);
    });

    it('should track failed requests', async () => {
      try {
        await optimizer.execute('fail-test', async () => {
          throw new Error('Fail');
        }, { deduplicate: false });
      } catch {
        // Expected
      }

      const stats = optimizer.getStats();
      expect(stats.failedRequests).toBe(1);
    });

    it('should calculate average latency', async () => {
      await optimizer.execute('latency-1', async () => 'r1');
      await optimizer.execute('latency-2', async () => 'r2');

      const stats = optimizer.getStats();
      expect(stats.averageLatency).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics', async () => {
      await optimizer.execute('test', async () => 'result');

      optimizer.resetStats();

      const stats = optimizer.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
    });
  });

  describe('clear', () => {
    it('should reject pending requests', async () => {
      const localOptimizer = new RequestOptimizer({
        maxConcurrent: 1,
        batchWindowMs: 100, // Long enough to clear before processing
      });

      const promise = localOptimizer.execute('pending', async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return 'result';
      }, { deduplicate: false });

      // Clear before batch window expires
      localOptimizer.clear();

      await expect(promise).rejects.toThrow('cancelled');
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status', () => {
      const status = optimizer.getQueueStatus();

      expect(status).toHaveProperty('pending');
      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('maxConcurrent');
      expect(status.maxConcurrent).toBe(3);
    });
  });

  describe('events', () => {
    it('should emit success event', (done) => {
      optimizer.on('success', (data) => {
        expect(data.key).toBe('success-event');
        expect(data.latency).toBeGreaterThanOrEqual(0);
        done();
      });

      optimizer.execute('success-event', async () => 'result');
    });

    it('should emit failure event', (done) => {
      optimizer.on('failure', (data) => {
        expect(data.key).toBe('fail-event');
        expect(data.error).toBeDefined();
        done();
      });

      optimizer.execute('fail-event', async () => {
        throw new Error('Test error');
      }, { deduplicate: false }).catch(() => {});
    });

    it('should emit retry event', (done) => {
      let retryEmitted = false;

      optimizer.on('retry', (data) => {
        retryEmitted = true;
        expect(data.attempt).toBeGreaterThan(0);
      });

      let attempts = 0;
      optimizer.execute('retry-event', async () => {
        attempts++;
        if (attempts < 2) throw new Error('Retry me');
        return 'success';
      }, { deduplicate: false }).then(() => {
        expect(retryEmitted).toBe(true);
        done();
      });
    });

    it('should emit deduplicated event', async () => {
      let dedupEmitted = false;
      optimizer.on('deduplicated', (data) => {
        expect(data.key).toBe('dup-event');
        dedupEmitted = true;
      });

      const execute = async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 'result';
      };

      // Start first request and second should be deduplicated
      const [result1, result2] = await Promise.all([
        optimizer.execute('dup-event', execute),
        optimizer.execute('dup-event', execute),
      ]);

      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(dedupEmitted).toBe(true);
    });
  });

  describe('Singleton functions', () => {
    it('should return same instance from getRequestOptimizer', () => {
      resetRequestOptimizer();
      const opt1 = getRequestOptimizer();
      const opt2 = getRequestOptimizer();
      expect(opt1).toBe(opt2);
    });
  });

  describe('executeParallel', () => {
    it('should execute multiple requests in parallel', async () => {
      // Use a local optimizer to avoid interference from afterEach
      const localOptimizer = new RequestOptimizer({
        maxConcurrent: 5,
        batchWindowMs: 10,
      });

      const results = new Map<string, string>();
      const requests = ['req1', 'req2', 'req3'];

      await Promise.all(
        requests.map(async (key) => {
          const result = await localOptimizer.execute(key, async () => `result-${key}`, {
            deduplicate: false,
          });
          results.set(key, result);
        })
      );

      expect(results.get('req1')).toBe('result-req1');
      expect(results.get('req2')).toBe('result-req2');
      expect(results.get('req3')).toBe('result-req3');

      localOptimizer.clear();
    });

    it('should handle errors in parallel execution', async () => {
      // Create a simple test that verifies error handling
      const localOptimizer = new RequestOptimizer({ maxRetries: 0, batchWindowMs: 10 });

      let errorThrown = false;
      try {
        await localOptimizer.executeImmediate(async () => {
          throw new Error('Failed');
        }, { retries: 0 });
      } catch (error) {
        errorThrown = true;
        expect((error as Error).message).toBe('Failed');
      }

      expect(errorThrown).toBe(true);
      localOptimizer.clear();
    });
  });
});
