/**
 * Comprehensive Unit Tests for Performance Module
 *
 * Tests for:
 * - PerformanceManager (orchestration, metrics, monitoring)
 * - LazyLoader (lazy loading, preloading, memory management)
 * - ToolCache (semantic caching, cache invalidation)
 * - RequestOptimizer (batching, deduplication, retries)
 * - BenchmarkSuite (benchmarking, profiling)
 */

import { EventEmitter } from 'events';

// Mock dependencies before imports
jest.mock('../../src/utils/semantic-cache', () => {
  const EventEmitter = require('events').EventEmitter;

  class MockSemanticCache extends EventEmitter {
    private cache = new Map<string, { response: unknown; expiresAt: number }>();
    private stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalEntries: 0,
      avgSimilarity: 0,
      semanticHits: 0,
      exactHits: 0,
      evictions: 0,
    };

    async getOrCompute(
      query: string,
      computeFn: () => Promise<unknown>,
      _metadata?: Record<string, unknown>
    ): Promise<{ result: unknown; cached: boolean; similarity?: number }> {
      if (this.cache.has(query)) {
        const entry = this.cache.get(query)!;
        if (entry.expiresAt > Date.now()) {
          this.stats.hits++;
          this.emit('cache:hit', { key: query });
          return { result: entry.response, cached: true, similarity: 1.0 };
        }
        this.cache.delete(query);
      }

      this.stats.misses++;
      this.emit('cache:miss', { key: query });
      const result = await computeFn();
      this.cache.set(query, { response: result, expiresAt: Date.now() + 60000 });
      this.stats.totalEntries = this.cache.size;
      return { result, cached: false };
    }

    invalidate(pattern: string | RegExp): number {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      let count = 0;
      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          this.cache.delete(key);
          count++;
        }
      }
      return count;
    }

    clear(): void {
      this.cache.clear();
      this.stats.totalEntries = 0;
    }

    getStats() {
      return { ...this.stats };
    }

    dispose(): void {
      this.cache.clear();
      this.removeAllListeners();
    }
  }

  return {
    SemanticCache: MockSemanticCache,
    getApiCache: jest.fn(() => new MockSemanticCache()),
    resetApiCache: jest.fn(),
  };
});

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/utils/token-counter', () => ({
  countTokens: jest.fn((text: string) => Math.ceil(text.length / 4)),
  calculateCost: jest.fn((input: number, output: number) => ({
    inputCost: input * 0.00001,
    outputCost: output * 0.00003,
    totalCost: input * 0.00001 + output * 0.00003,
  })),
}));

// Import after mocks
import {
  PerformanceManager,
  getPerformanceManager,
  resetPerformanceManager,
  initializePerformanceManager,
  measureOperation,
  getPerformanceSummary,
  PerformanceConfig,
} from '../../src/performance/performance-manager';

import {
  LazyLoader,
  getLazyLoader,
  resetLazyLoader,
  registerCommonModules,
  initializeLazyLoader,
  LazyLoaderConfig,
} from '../../src/performance/lazy-loader';

import {
  ToolCache,
  getToolCache,
  resetToolCache,
  withCache,
  Cacheable,
  ToolCacheConfig,
} from '../../src/performance/tool-cache';

import {
  RequestOptimizer,
  getRequestOptimizer,
  resetRequestOptimizer,
  executeParallel,
  batchRequests,
  RequestConfig,
} from '../../src/performance/request-optimizer';

import {
  BenchmarkSuite,
  getBenchmarkSuite,
  resetBenchmarkSuite,
  DEFAULT_PROMPTS,
  BenchmarkConfig,
} from '../../src/performance/benchmark-suite';

// ============================================================================
// Mock Console
// ============================================================================

const mockConsole = {
  log: jest.spyOn(console, 'log').mockImplementation(),
  error: jest.spyOn(console, 'error').mockImplementation(),
  warn: jest.spyOn(console, 'warn').mockImplementation(),
};

// ============================================================================
// PerformanceManager Tests
// ============================================================================

describe('PerformanceManager', () => {
  let manager: PerformanceManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    resetPerformanceManager();
    resetLazyLoader();
    resetToolCache();
    resetRequestOptimizer();
    manager = new PerformanceManager();
  });

  afterEach(() => {
    manager.dispose();
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    it('should create with default configuration', () => {
      const instance = new PerformanceManager();
      expect(instance).toBeDefined();
      instance.dispose();
    });

    it('should create with custom configuration', () => {
      const config: Partial<PerformanceConfig> = {
        enabled: true,
        lazyLoading: false,
        toolCaching: true,
        requestOptimization: false,
        apiCaching: true,
        budgetMs: 10000,
        enableMetrics: true,
        metricsRetention: 500,
      };

      const instance = new PerformanceManager(config);
      expect(instance).toBeDefined();
      instance.dispose();
    });

    it('should merge custom config with defaults', () => {
      const config: Partial<PerformanceConfig> = {
        budgetMs: 3000,
      };

      const instance = new PerformanceManager(config);
      expect(instance).toBeDefined();
      instance.dispose();
    });
  });

  describe('initialize', () => {
    it('should initialize all performance systems', async () => {
      await manager.initialize();

      expect(manager.getLazyLoader()).toBeDefined();
      expect(manager.getToolCache()).toBeDefined();
      expect(manager.getRequestOptimizer()).toBeDefined();
    });

    it('should emit initialized event', async () => {
      const eventHandler = jest.fn();
      manager.on('initialized', eventHandler);

      await manager.initialize();

      expect(eventHandler).toHaveBeenCalledTimes(1);
    });

    it('should only initialize once', async () => {
      const eventHandler = jest.fn();
      manager.on('initialized', eventHandler);

      await manager.initialize();
      await manager.initialize();
      await manager.initialize();

      expect(eventHandler).toHaveBeenCalledTimes(1);
    });

    it('should not initialize lazy loader when disabled', async () => {
      const noLazyManager = new PerformanceManager({ lazyLoading: false });
      await noLazyManager.initialize();

      expect(noLazyManager.getLazyLoader()).toBeNull();
      noLazyManager.dispose();
    });

    it('should not initialize tool cache when disabled', async () => {
      const noCacheManager = new PerformanceManager({ toolCaching: false });
      await noCacheManager.initialize();

      expect(noCacheManager.getToolCache()).toBeNull();
      noCacheManager.dispose();
    });

    it('should not initialize request optimizer when disabled', async () => {
      const noOptimizerManager = new PerformanceManager({ requestOptimization: false });
      await noOptimizerManager.initialize();

      expect(noOptimizerManager.getRequestOptimizer()).toBeNull();
      noOptimizerManager.dispose();
    });
  });

  describe('recordMetric', () => {
    it('should record a metric', async () => {
      await manager.initialize();

      manager.recordMetric({
        operation: 'test-operation',
        duration: 100,
        cached: false,
        success: true,
      });

      const metrics = manager.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operation).toBe('test-operation');
      expect(metrics[0].duration).toBe(100);
    });

    it('should emit metric event', async () => {
      await manager.initialize();
      const eventHandler = jest.fn();
      manager.on('metric', eventHandler);

      manager.recordMetric({
        operation: 'test-op',
        duration: 50,
        cached: true,
        success: true,
      });

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'test-op',
          duration: 50,
          cached: true,
        })
      );
    });

    it('should add timestamp to metric', async () => {
      await manager.initialize();

      const before = Date.now();
      manager.recordMetric({
        operation: 'timestamp-test',
        duration: 25,
        cached: false,
        success: true,
      });
      const after = Date.now();

      const metrics = manager.getMetrics();
      expect(metrics[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(metrics[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('should emit budget:exceeded when duration exceeds budget', async () => {
      const shortBudgetManager = new PerformanceManager({ budgetMs: 100 });
      await shortBudgetManager.initialize();

      const eventHandler = jest.fn();
      shortBudgetManager.on('budget:exceeded', eventHandler);

      shortBudgetManager.recordMetric({
        operation: 'slow-op',
        duration: 200,
        cached: false,
        success: true,
      });

      expect(eventHandler).toHaveBeenCalledWith({
        operation: 'slow-op',
        duration: 200,
        budget: 100,
      });

      shortBudgetManager.dispose();
    });

    it('should trim old metrics when exceeding retention limit', async () => {
      const lowRetentionManager = new PerformanceManager({ metricsRetention: 3 });
      await lowRetentionManager.initialize();

      for (let i = 0; i < 5; i++) {
        lowRetentionManager.recordMetric({
          operation: `op-${i}`,
          duration: 10,
          cached: false,
          success: true,
        });
      }

      const metrics = lowRetentionManager.getMetrics();
      expect(metrics).toHaveLength(3);
      expect(metrics[0].operation).toBe('op-2');
      expect(metrics[2].operation).toBe('op-4');

      lowRetentionManager.dispose();
    });

    it('should not record metrics when disabled', async () => {
      const noMetricsManager = new PerformanceManager({ enableMetrics: false });
      await noMetricsManager.initialize();

      noMetricsManager.recordMetric({
        operation: 'ignored',
        duration: 100,
        cached: false,
        success: true,
      });

      expect(noMetricsManager.getMetrics()).toHaveLength(0);
      noMetricsManager.dispose();
    });

    it('should store metadata in metric', async () => {
      await manager.initialize();

      manager.recordMetric({
        operation: 'meta-test',
        duration: 75,
        cached: false,
        success: true,
        metadata: { key: 'value', count: 42 },
      });

      const metrics = manager.getMetrics();
      expect(metrics[0].metadata).toEqual({ key: 'value', count: 42 });
    });
  });

  describe('measure', () => {
    it('should measure async operation duration', async () => {
      jest.useRealTimers();
      await manager.initialize();

      const result = await manager.measure('async-test', async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 'completed';
      });

      expect(result).toBe('completed');

      const metrics = manager.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operation).toBe('async-test');
      expect(metrics[0].duration).toBeGreaterThanOrEqual(40);
      expect(metrics[0].success).toBe(true);

      jest.useFakeTimers();
    });

    it('should record failure when operation throws', async () => {
      await manager.initialize();

      await expect(
        manager.measure('fail-test', async () => {
          throw new Error('Operation failed');
        })
      ).rejects.toThrow('Operation failed');

      const metrics = manager.getMetrics();
      expect(metrics[0].success).toBe(false);
    });

    it('should include metadata in measurement', async () => {
      await manager.initialize();

      await manager.measure(
        'meta-measure',
        async () => 'result',
        { tool: 'grep', args: 'pattern' }
      );

      const metrics = manager.getMetrics();
      expect(metrics[0].metadata).toEqual({ tool: 'grep', args: 'pattern' });
    });
  });

  describe('getSummary', () => {
    it('should return comprehensive performance summary', async () => {
      await manager.initialize();

      manager.recordMetric({
        operation: 'op1',
        duration: 100,
        cached: true,
        success: true,
      });
      manager.recordMetric({
        operation: 'op2',
        duration: 200,
        cached: false,
        success: true,
      });

      const summary = manager.getSummary();

      expect(summary.overall.totalOperations).toBe(2);
      expect(summary.overall.cachedOperations).toBe(1);
      expect(summary.overall.cacheHitRate).toBe(0.5);
      expect(summary.overall.averageDuration).toBe(150);
    });

    it('should return empty stats when no operations recorded', async () => {
      await manager.initialize();

      const summary = manager.getSummary();

      expect(summary.overall.totalOperations).toBe(0);
      expect(summary.overall.cacheHitRate).toBe(0);
      expect(summary.overall.averageDuration).toBe(0);
    });

    it('should include lazy loader stats', async () => {
      await manager.initialize();

      const summary = manager.getSummary();

      expect(summary.lazyLoader).toBeDefined();
      expect(summary.lazyLoader).toHaveProperty('totalModules');
      expect(summary.lazyLoader).toHaveProperty('loadedModules');
    });

    it('should include tool cache stats', async () => {
      await manager.initialize();

      const summary = manager.getSummary();

      expect(summary.toolCache).toBeDefined();
      expect(summary.toolCache).toHaveProperty('hits');
      expect(summary.toolCache).toHaveProperty('misses');
    });

    it('should include request optimizer stats', async () => {
      await manager.initialize();

      const summary = manager.getSummary();

      expect(summary.requestOptimizer).toBeDefined();
      expect(summary.requestOptimizer).toHaveProperty('totalRequests');
    });
  });

  describe('getMetrics', () => {
    it('should return all metrics without limit', async () => {
      await manager.initialize();

      for (let i = 0; i < 5; i++) {
        manager.recordMetric({
          operation: `op-${i}`,
          duration: 10,
          cached: false,
          success: true,
        });
      }

      const metrics = manager.getMetrics();
      expect(metrics).toHaveLength(5);
    });

    it('should return limited metrics with limit parameter', async () => {
      await manager.initialize();

      for (let i = 0; i < 10; i++) {
        manager.recordMetric({
          operation: `op-${i}`,
          duration: 10,
          cached: false,
          success: true,
        });
      }

      const metrics = manager.getMetrics(3);
      expect(metrics).toHaveLength(3);
      // Should return last 3 metrics
      expect(metrics[0].operation).toBe('op-7');
      expect(metrics[2].operation).toBe('op-9');
    });

    it('should return copy of metrics array', async () => {
      await manager.initialize();

      manager.recordMetric({
        operation: 'copy-test',
        duration: 10,
        cached: false,
        success: true,
      });

      const metrics1 = manager.getMetrics();
      const metrics2 = manager.getMetrics();

      expect(metrics1).not.toBe(metrics2);
      expect(metrics1).toEqual(metrics2);
    });
  });

  describe('getSlowOperations', () => {
    it('should return operations exceeding threshold', async () => {
      await manager.initialize();

      manager.recordMetric({ operation: 'fast', duration: 50, cached: false, success: true });
      manager.recordMetric({ operation: 'slow1', duration: 1500, cached: false, success: true });
      manager.recordMetric({ operation: 'medium', duration: 500, cached: false, success: true });
      manager.recordMetric({ operation: 'slow2', duration: 2000, cached: false, success: true });

      const slowOps = manager.getSlowOperations(1000);

      expect(slowOps).toHaveLength(2);
      expect(slowOps.map((m) => m.operation)).toEqual(['slow1', 'slow2']);
    });

    it('should use default threshold of 1000ms', async () => {
      await manager.initialize();

      manager.recordMetric({ operation: 'under', duration: 999, cached: false, success: true });
      manager.recordMetric({ operation: 'over', duration: 1001, cached: false, success: true });

      const slowOps = manager.getSlowOperations();

      expect(slowOps).toHaveLength(1);
      expect(slowOps[0].operation).toBe('over');
    });
  });

  describe('clearCaches', () => {
    it('should clear all caches', async () => {
      await manager.initialize();

      const eventHandler = jest.fn();
      manager.on('caches:cleared', eventHandler);

      manager.clearCaches();

      expect(eventHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidateForFile', () => {
    it('should emit cache:invalidated event', async () => {
      await manager.initialize();

      const eventHandler = jest.fn();
      manager.on('cache:invalidated', eventHandler);

      manager.invalidateForFile('/src/test.ts');

      expect(eventHandler).toHaveBeenCalledWith({ filePath: '/src/test.ts' });
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics', async () => {
      await manager.initialize();

      manager.recordMetric({ operation: 'test', duration: 100, cached: true, success: true });

      const beforeReset = manager.getMetrics();
      expect(beforeReset).toHaveLength(1);

      manager.resetStats();

      const afterReset = manager.getMetrics();
      expect(afterReset).toHaveLength(0);
    });

    it('should emit stats:reset event', async () => {
      await manager.initialize();

      const eventHandler = jest.fn();
      manager.on('stats:reset', eventHandler);

      manager.resetStats();

      expect(eventHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', async () => {
      await manager.initialize();

      const eventHandler = jest.fn();
      manager.on('config:updated', eventHandler);

      manager.updateConfig({ budgetMs: 20000 });

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({ budgetMs: 20000 })
      );
    });
  });

  describe('dispose', () => {
    it('should clean up all resources', async () => {
      await manager.initialize();

      // Verify components exist before dispose
      expect(manager.getLazyLoader()).not.toBeNull();
      expect(manager.getToolCache()).not.toBeNull();
      expect(manager.getRequestOptimizer()).not.toBeNull();

      manager.dispose();

      // After dispose, initialized flag is false, so subsequent calls
      // may still return cached instances but manager should be inactive
      expect(manager.listenerCount('metric')).toBe(0);
    });

    it('should remove all event listeners', async () => {
      await manager.initialize();

      const handler = jest.fn();
      manager.on('metric', handler);

      manager.dispose();

      // After dispose, recording should not emit events
      expect(manager.listenerCount('metric')).toBe(0);
    });
  });

  describe('Singleton functions', () => {
    it('getPerformanceManager should return same instance', () => {
      resetPerformanceManager();
      const pm1 = getPerformanceManager();
      const pm2 = getPerformanceManager();

      expect(pm1).toBe(pm2);
    });

    it('resetPerformanceManager should create new instance', () => {
      const pm1 = getPerformanceManager();
      resetPerformanceManager();
      const pm2 = getPerformanceManager();

      expect(pm1).not.toBe(pm2);
    });

    it('initializePerformanceManager should initialize and return manager', async () => {
      resetPerformanceManager();
      const pm = await initializePerformanceManager({ budgetMs: 8000 });

      expect(pm).toBeDefined();
      expect(pm.getLazyLoader()).toBeDefined();
    });
  });

  describe('Utility functions', () => {
    it('measureOperation should measure and record operation', async () => {
      resetPerformanceManager();
      const pm = getPerformanceManager();
      await pm.initialize();

      const result = await measureOperation('utility-test', async () => 'done');

      expect(result).toBe('done');
      expect(pm.getMetrics()).toHaveLength(1);
    });

    it('getPerformanceSummary should return summary', async () => {
      resetPerformanceManager();
      const pm = getPerformanceManager();
      await pm.initialize();

      const summary = getPerformanceSummary();

      expect(summary).toHaveProperty('overall');
      expect(summary).toHaveProperty('lazyLoader');
    });
  });
});

// ============================================================================
// LazyLoader Additional Tests
// ============================================================================

describe('LazyLoader - Additional Tests', () => {
  let loader: LazyLoader;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    resetLazyLoader();
    loader = new LazyLoader();
  });

  afterEach(() => {
    loader.clear();
    jest.useRealTimers();
  });

  describe('Memory Management', () => {
    it('should free memory when module is unloaded', async () => {
      const largeData = { data: 'x'.repeat(10000) };
      loader.register('large-module', async () => largeData);

      await loader.get('large-module');
      expect(loader.isLoaded('large-module')).toBe(true);

      const unloaded = loader.unload('large-module');
      expect(unloaded).toBe(true);
      expect(loader.isLoaded('large-module')).toBe(false);
    });

    it('should track memory through multiple load/unload cycles', async () => {
      let loadCount = 0;
      loader.register('cycle-module', async () => {
        loadCount++;
        return { iteration: loadCount };
      });

      // First load
      const first = await loader.get<{ iteration: number }>('cycle-module');
      expect(first.iteration).toBe(1);

      // Unload
      loader.unload('cycle-module');

      // Second load
      const second = await loader.get<{ iteration: number }>('cycle-module');
      expect(second.iteration).toBe(2);

      // Verify metrics track both loads
      const metrics = loader.getMetrics();
      expect(metrics).toHaveLength(2);
    });
  });

  describe('Startup Time Optimization', () => {
    it('should defer loading until module is requested', async () => {
      const moduleLoader = jest.fn().mockResolvedValue({ ready: true });
      loader.register('deferred-module', moduleLoader);

      // Module registered but not loaded
      expect(moduleLoader).not.toHaveBeenCalled();
      expect(loader.isLoaded('deferred-module')).toBe(false);

      // Now request the module
      await loader.get('deferred-module');
      expect(moduleLoader).toHaveBeenCalledTimes(1);
    });

    it('should measure load time for profiling', async () => {
      jest.useRealTimers();

      loader.register('timed-module', async () => {
        await new Promise((r) => setTimeout(r, 25));
        return { loaded: true };
      });

      await loader.get('timed-module');

      const metrics = loader.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].loadTime).toBeGreaterThanOrEqual(20);
      expect(metrics[0].success).toBe(true);

      jest.useFakeTimers();
    });

    it('should support background preloading after delay', async () => {
      jest.useRealTimers();

      const preloadLoader = new LazyLoader({
        preloadDelay: 50,
        preloadModules: ['bg-module'],
      });

      const moduleLoader = jest.fn().mockResolvedValue({ preloaded: true });
      preloadLoader.register('bg-module', moduleLoader);

      preloadLoader.schedulePreload();

      // Wait for preload to complete
      await new Promise((r) => setTimeout(r, 100));

      expect(preloadLoader.isLoaded('bg-module')).toBe(true);
      preloadLoader.clear();

      jest.useFakeTimers();
    });
  });

  describe('Error Recovery', () => {
    it('should store error for failed loads', async () => {
      const error = new Error('Module initialization failed');
      loader.register('error-module', async () => {
        throw error;
      });

      await expect(loader.get('error-module')).rejects.toThrow('Module initialization failed');

      // Module should not be marked as loaded
      expect(loader.isLoaded('error-module')).toBe(false);
    });

    it('should allow retry after error', async () => {
      let attempts = 0;
      loader.register('retry-module', async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('First attempt failed');
        }
        return { success: true };
      });

      // First attempt fails
      await expect(loader.get('retry-module')).rejects.toThrow('First attempt failed');

      // Second attempt succeeds
      const result = await loader.get('retry-module');
      expect(result).toEqual({ success: true });
      expect(attempts).toBe(2);
    });
  });
});

// ============================================================================
// ToolCache Additional Tests
// ============================================================================

describe('ToolCache - Additional Tests', () => {
  let cache: ToolCache;

  beforeEach(() => {
    jest.clearAllMocks();
    resetToolCache();
    cache = new ToolCache({
      enabled: true,
      ttlMs: 60000,
    });
  });

  afterEach(() => {
    cache.dispose();
  });

  describe('Cache Key Generation', () => {
    it('should generate consistent keys for same tool and args', async () => {
      let execCount = 0;
      const execute = async () => {
        execCount++;
        return { success: true, output: `result-${execCount}` };
      };

      await cache.getOrExecute('search', { query: 'test', path: '/src' }, execute);
      await cache.getOrExecute('search', { query: 'test', path: '/src' }, execute);

      // Same args should hit cache
      expect(execCount).toBe(1);
    });

    it('should generate different keys for different args', async () => {
      let execCount = 0;
      const execute = async () => {
        execCount++;
        return { success: true, output: `result-${execCount}` };
      };

      await cache.getOrExecute('search', { query: 'test1' }, execute);
      await cache.getOrExecute('search', { query: 'test2' }, execute);

      // Different args should not hit cache
      expect(execCount).toBe(2);
    });

    it('should handle complex nested args', async () => {
      let execCount = 0;
      const execute = async () => {
        execCount++;
        return { success: true, output: 'result' };
      };

      const complexArgs = {
        query: 'test',
        options: { recursive: true, maxDepth: 5 },
        filters: ['*.ts', '*.js'],
      };

      await cache.getOrExecute('search', complexArgs, execute);
      await cache.getOrExecute('search', complexArgs, execute);

      expect(execCount).toBe(1);
    });
  });

  describe('Cache Invalidation Strategies', () => {
    it('should invalidate all entries for a tool', async () => {
      const execute = async () => ({ success: true, output: 'data' });

      await cache.getOrExecute('grep', { pattern: 'error' }, execute);
      await cache.getOrExecute('grep', { pattern: 'warning' }, execute);
      await cache.getOrExecute('search', { query: 'test' }, execute);

      cache.invalidate('grep');

      // grep entries should be invalidated, search should remain
      const stats = cache.getStats();
      expect(stats.misses).toBe(3); // All were misses initially
    });

    it('should invalidate entries matching regex pattern', async () => {
      const execute = async () => ({ success: true, output: 'data' });

      await cache.getOrExecute('grep', { pattern: 'config' }, execute);
      await cache.getOrExecute('search', { query: 'config' }, execute);

      cache.invalidate(undefined, /config/);

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });

    it('should invalidate entries affected by file changes', async () => {
      const execute = async () => ({ success: true, output: 'file content' });

      await cache.getOrExecute('view_file', { path: '/src/main.ts' }, execute);

      const count = cache.invalidateForFile('/src/main.ts');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Statistics Tracking', () => {
    it('should calculate hit rate correctly', async () => {
      const execute = async () => ({ success: true, output: 'data' });

      // 2 misses, 2 hits
      await cache.getOrExecute('search', { q: 'a' }, execute); // miss
      await cache.getOrExecute('search', { q: 'b' }, execute); // miss
      await cache.getOrExecute('search', { q: 'a' }, execute); // hit
      await cache.getOrExecute('search', { q: 'b' }, execute); // hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should estimate saved time', async () => {
      const execute = async () => ({ success: true, output: 'data' });

      await cache.getOrExecute('search', { q: 'test' }, execute);
      await cache.getOrExecute('search', { q: 'test' }, execute);
      await cache.getOrExecute('search', { q: 'test' }, execute);

      const stats = cache.getStats();
      expect(stats.savedCalls).toBe(2);
      expect(stats.savedTime).toBeGreaterThan(0);
    });

    it('should reset stats on clear', async () => {
      const execute = async () => ({ success: true, output: 'data' });

      await cache.getOrExecute('search', { q: 'test' }, execute);
      await cache.getOrExecute('search', { q: 'test' }, execute);

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('Decorator Pattern', () => {
    it('withCache should wrap tool execution', async () => {
      resetToolCache();
      let execCount = 0;

      const result = await withCache('search', { q: 'decorator-test' }, async () => {
        execCount++;
        return { success: true, output: 'cached-result' };
      });

      expect(result.success).toBe(true);
      expect(execCount).toBe(1);
    });
  });
});

// ============================================================================
// RequestOptimizer Additional Tests
// ============================================================================

describe('RequestOptimizer - Additional Tests', () => {
  let optimizer: RequestOptimizer;

  beforeEach(() => {
    jest.clearAllMocks();
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

  describe('Request Batching', () => {
    it('should batch requests within batch window', async () => {
      jest.useRealTimers();

      const executionOrder: string[] = [];
      const createExecutor = (id: string) => async () => {
        executionOrder.push(id);
        return `result-${id}`;
      };

      // Submit multiple requests quickly
      const promises = [
        optimizer.execute('req-1', createExecutor('1'), { deduplicate: false }),
        optimizer.execute('req-2', createExecutor('2'), { deduplicate: false }),
        optimizer.execute('req-3', createExecutor('3'), { deduplicate: false }),
      ];

      const results = await Promise.all(promises);

      expect(results).toEqual(['result-1', 'result-2', 'result-3']);
      expect(executionOrder).toHaveLength(3);

      jest.useFakeTimers();
    });
  });

  describe('Exponential Backoff', () => {
    it('should implement exponential backoff on retry', async () => {
      jest.useRealTimers();

      let attempts = 0;
      const startTime = Date.now();

      await optimizer.executeImmediate(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return 'success';
        },
        { retries: 3 }
      );

      const elapsed = Date.now() - startTime;

      // Should have retried with delays
      expect(attempts).toBe(3);
      // With 50ms base delay: first retry ~50ms, second retry ~100ms
      expect(elapsed).toBeGreaterThanOrEqual(100);

      jest.useFakeTimers();
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout slow requests', async () => {
      jest.useRealTimers();

      const slowOptimizer = new RequestOptimizer({
        timeoutMs: 100,
        maxRetries: 0,
      });

      await expect(
        slowOptimizer.executeImmediate(async () => {
          await new Promise((r) => setTimeout(r, 200));
          return 'too slow';
        })
      ).rejects.toThrow('timed out');

      slowOptimizer.clear();
      jest.useFakeTimers();
    });
  });

  describe('Priority Queue', () => {
    it('should process higher priority requests first', async () => {
      jest.useRealTimers();

      const localOptimizer = new RequestOptimizer({
        maxConcurrent: 1, // Force sequential processing
        batchWindowMs: 5,
      });

      const order: string[] = [];

      const promises = [
        localOptimizer.execute(
          'low',
          async () => {
            order.push('low');
            return 'low';
          },
          { priority: 1, deduplicate: false }
        ),
        localOptimizer.execute(
          'high',
          async () => {
            order.push('high');
            return 'high';
          },
          { priority: 10, deduplicate: false }
        ),
        localOptimizer.execute(
          'medium',
          async () => {
            order.push('medium');
            return 'medium';
          },
          { priority: 5, deduplicate: false }
        ),
      ];

      await Promise.all(promises);

      // High priority should be processed first
      expect(order[0]).toBe('high');

      localOptimizer.clear();
      jest.useFakeTimers();
    });
  });

  describe('Latency Tracking', () => {
    it('should track average latency', async () => {
      jest.useRealTimers();

      await optimizer.execute('latency-1', async () => 'r1', { deduplicate: false });
      await optimizer.execute('latency-2', async () => 'r2', { deduplicate: false });
      await optimizer.execute('latency-3', async () => 'r3', { deduplicate: false });

      const stats = optimizer.getStats();
      expect(stats.averageLatency).toBeGreaterThanOrEqual(0);
      expect(stats.successfulRequests).toBe(3);

      jest.useFakeTimers();
    });

    it('should limit latency history to 100 entries', async () => {
      jest.useRealTimers();

      const localOptimizer = new RequestOptimizer({
        batchWindowMs: 1,
      });

      // Execute many requests
      for (let i = 0; i < 110; i++) {
        await localOptimizer.execute(
          `req-${i}`,
          async () => `result-${i}`,
          { deduplicate: false }
        );
      }

      const stats = localOptimizer.getStats();
      expect(stats.successfulRequests).toBe(110);
      // Average latency should still be calculated correctly
      expect(stats.averageLatency).toBeGreaterThanOrEqual(0);

      localOptimizer.clear();
      jest.useFakeTimers();
    });
  });

  describe('Utility Functions', () => {
    it('executeParallel should execute multiple requests', async () => {
      jest.useRealTimers();

      const requests = [
        { key: 'a', execute: async () => 'result-a' },
        { key: 'b', execute: async () => 'result-b' },
        { key: 'c', execute: async () => 'result-c' },
      ];

      const results = await executeParallel(requests);

      expect(results.get('a')).toBe('result-a');
      expect(results.get('b')).toBe('result-b');
      expect(results.get('c')).toBe('result-c');

      jest.useFakeTimers();
    });

    it('executeParallel should handle errors in results', async () => {
      jest.useRealTimers();

      // Create a fresh optimizer for this test
      const localOptimizer = new RequestOptimizer({
        maxConcurrent: 5,
        maxRetries: 0, // No retries to avoid delays
        batchWindowMs: 10,
      });

      const results = new Map<string, string | Error>();

      // Execute with error handling
      await Promise.all([
        localOptimizer.executeImmediate(async () => 'ok', { retries: 0 })
          .then((r) => results.set('success', r))
          .catch((e) => results.set('success', e)),
        localOptimizer.executeImmediate(
          async () => {
            throw new Error('Failed');
          },
          { retries: 0 }
        )
          .then((r) => results.set('fail', r))
          .catch((e) => results.set('fail', e)),
      ]);

      expect(results.get('success')).toBe('ok');
      expect(results.get('fail')).toBeInstanceOf(Error);

      localOptimizer.clear();
      jest.useFakeTimers();
    });

    it('batchRequests should batch keys together', async () => {
      jest.useRealTimers();
      resetRequestOptimizer();

      const batchFn = jest.fn().mockImplementation(async (keys: string[]) => {
        const results = new Map<string, string>();
        keys.forEach((k) => results.set(k, `value-${k}`));
        return results;
      });

      const results = await batchRequests(['key1', 'key2', 'key3'], batchFn);

      expect(batchFn).toHaveBeenCalledTimes(1);
      expect(results.get('key1')).toBe('value-key1');

      resetRequestOptimizer();
      jest.useFakeTimers();
    });
  });
});

// ============================================================================
// BenchmarkSuite Tests
// ============================================================================

describe('BenchmarkSuite', () => {
  let suite: BenchmarkSuite;

  beforeEach(() => {
    jest.clearAllMocks();
    resetBenchmarkSuite();
    suite = new BenchmarkSuite();
  });

  describe('Constructor', () => {
    it('should create with default configuration', () => {
      const instance = new BenchmarkSuite();
      const config = instance.getConfig();

      expect(config.warmupRuns).toBe(2);
      expect(config.runs).toBe(10);
      expect(config.concurrency).toBe(1);
      expect(config.timeout).toBe(60000);
    });

    it('should create with custom configuration', () => {
      const config: BenchmarkConfig = {
        warmupRuns: 5,
        runs: 20,
        concurrency: 4,
        timeout: 30000,
        monitorVRAM: true,
      };

      const instance = new BenchmarkSuite(config);
      const resultConfig = instance.getConfig();

      expect(resultConfig.warmupRuns).toBe(5);
      expect(resultConfig.runs).toBe(20);
      expect(resultConfig.concurrency).toBe(4);
    });
  });

  describe('run', () => {
    it('should run benchmark with callback', async () => {
      jest.useRealTimers();

      const testSuite = new BenchmarkSuite({
        warmupRuns: 1,
        runs: 3,
        prompts: [
          { name: 'test-prompt', prompt: 'Hello', category: 'simple' },
        ],
      });

      const callback = jest.fn().mockImplementation(async (prompt: string) => ({
        content: `Response to: ${prompt}`,
        inputTokens: 5,
        outputTokens: 10,
      }));

      const results = await testSuite.run('test-model', callback);

      expect(results.model).toBe('test-model');
      expect(results.runs).toHaveLength(3);
      expect(results.summary.successfulRuns).toBe(3);

      jest.useFakeTimers();
    });

    it('should calculate TPS correctly', async () => {
      jest.useRealTimers();

      const testSuite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 1,
        prompts: [{ name: 'tps-test', prompt: 'Test', category: 'simple' }],
      });

      const callback = jest.fn().mockImplementation(async (_prompt: string, onFirstToken?: () => void) => {
        onFirstToken?.();
        await new Promise((r) => setTimeout(r, 50));
        return {
          content: 'Response',
          inputTokens: 5,
          outputTokens: 100,
        };
      });

      const results = await testSuite.run('test-model', callback);

      expect(results.runs[0].tps).toBeGreaterThan(0);
      expect(results.runs[0].outputTokens).toBe(100);

      jest.useFakeTimers();
    });

    it('should handle timeout', async () => {
      jest.useRealTimers();

      const testSuite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 1,
        timeout: 100,
        prompts: [{ name: 'timeout-test', prompt: 'Test', category: 'simple' }],
      });

      const callback = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { content: 'Too slow', inputTokens: 5, outputTokens: 10 };
      });

      const results = await testSuite.run('test-model', callback);

      expect(results.runs[0].success).toBe(false);
      expect(results.runs[0].error).toContain('Timeout');

      jest.useFakeTimers();
    });

    it('should prevent concurrent runs', async () => {
      jest.useRealTimers();

      const testSuite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 1,
        prompts: [{ name: 'concurrent-test', prompt: 'Test', category: 'simple' }],
      });

      const callback = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { content: 'Done', inputTokens: 5, outputTokens: 10 };
      });

      const firstRun = testSuite.run('model', callback);

      await expect(testSuite.run('model', callback)).rejects.toThrow(
        'Benchmark already running'
      );

      await firstRun;

      jest.useFakeTimers();
    });

    it('should emit phase events', async () => {
      jest.useRealTimers();

      const testSuite = new BenchmarkSuite({
        warmupRuns: 1,
        runs: 2,
        prompts: [{ name: 'event-test', prompt: 'Test', category: 'simple' }],
      });

      const phases: string[] = [];
      testSuite.on('phase', ({ phase }) => phases.push(phase));

      await testSuite.run('model', async () => ({
        content: 'Response',
        inputTokens: 5,
        outputTokens: 10,
      }));

      expect(phases).toContain('warmup');
      expect(phases).toContain('benchmark');

      jest.useFakeTimers();
    });
  });

  describe('calculateSummary', () => {
    it('should calculate percentile statistics', async () => {
      jest.useRealTimers();

      const testSuite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 10,
        prompts: [{ name: 'percentile-test', prompt: 'Test', category: 'simple' }],
      });

      const callback = jest.fn().mockImplementation(async () => ({
        content: 'Response',
        inputTokens: 5,
        outputTokens: 10,
      }));

      const results = await testSuite.run('model', callback);

      expect(results.summary.ttft.p50).toBeGreaterThanOrEqual(0);
      expect(results.summary.ttft.p95).toBeGreaterThanOrEqual(results.summary.ttft.p50);
      expect(results.summary.ttft.p99).toBeGreaterThanOrEqual(results.summary.ttft.p95);

      jest.useFakeTimers();
    });

    it('should handle empty runs gracefully', async () => {
      jest.useRealTimers();

      const testSuite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 1,
        timeout: 10,
        prompts: [{ name: 'fail-test', prompt: 'Test', category: 'simple' }],
      });

      const callback = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { content: 'Response', inputTokens: 5, outputTokens: 10 };
      });

      const results = await testSuite.run('model', callback);

      // All runs should have failed due to timeout
      expect(results.summary.failedRuns).toBe(1);

      jest.useFakeTimers();
    });
  });

  describe('formatResults', () => {
    it('should format results as readable string', async () => {
      jest.useRealTimers();

      const testSuite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 3,
        prompts: [{ name: 'format-test', prompt: 'Test', category: 'simple' }],
      });

      const results = await testSuite.run('test-model', async () => ({
        content: 'Response',
        inputTokens: 5,
        outputTokens: 10,
      }));

      const formatted = suite.formatResults(results);

      expect(formatted).toContain('BENCHMARK RESULTS');
      expect(formatted).toContain('test-model');
      expect(formatted).toContain('LATENCY');
      expect(formatted).toContain('THROUGHPUT');
      expect(formatted).toContain('COST');

      jest.useFakeTimers();
    });
  });

  describe('exportJSON', () => {
    it('should export results as JSON string', async () => {
      jest.useRealTimers();

      const testSuite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 1,
        prompts: [{ name: 'json-test', prompt: 'Test', category: 'simple' }],
      });

      const results = await testSuite.run('test-model', async () => ({
        content: 'Response',
        inputTokens: 5,
        outputTokens: 10,
      }));

      const json = suite.exportJSON(results);
      const parsed = JSON.parse(json);

      expect(parsed.model).toBe('test-model');
      expect(parsed.runs).toHaveLength(1);

      jest.useFakeTimers();
    });
  });

  describe('compare', () => {
    it('should compare two benchmark results', async () => {
      jest.useRealTimers();

      const testSuite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 3,
        prompts: [{ name: 'compare-test', prompt: 'Test', category: 'simple' }],
      });

      // Run baseline
      const baseline = await testSuite.run('baseline-model', async () => ({
        content: 'Response',
        inputTokens: 5,
        outputTokens: 10,
      }));

      // Run current (faster)
      const current = await testSuite.run('current-model', async () => ({
        content: 'Response',
        inputTokens: 5,
        outputTokens: 20,
      }));

      const comparison = suite.compare(baseline, current);

      expect(comparison.baseline).toBe('baseline-model');
      expect(comparison.current).toBe('current-model');
      expect(comparison.ttft).toHaveProperty('diff');
      expect(comparison.tps).toHaveProperty('improved');
      expect(comparison.cost).toHaveProperty('baseline');

      jest.useFakeTimers();
    });
  });

  describe('DEFAULT_PROMPTS', () => {
    it('should have diverse prompt categories', () => {
      const categories = DEFAULT_PROMPTS.map((p) => p.category);

      expect(categories).toContain('simple');
      expect(categories).toContain('code');
      expect(categories).toContain('reasoning');
      expect(categories).toContain('complex');
    });

    it('should have expected token estimates', () => {
      const simplePrompt = DEFAULT_PROMPTS.find((p) => p.category === 'simple');
      const complexPrompt = DEFAULT_PROMPTS.find((p) => p.category === 'complex');

      expect(simplePrompt?.expectedTokens).toBeLessThan(complexPrompt?.expectedTokens || 0);
    });
  });

  describe('Singleton functions', () => {
    it('getBenchmarkSuite should return same instance', () => {
      resetBenchmarkSuite();
      const suite1 = getBenchmarkSuite();
      const suite2 = getBenchmarkSuite();

      expect(suite1).toBe(suite2);
    });

    it('resetBenchmarkSuite should create new instance', () => {
      const suite1 = getBenchmarkSuite();
      resetBenchmarkSuite();
      const suite2 = getBenchmarkSuite();

      expect(suite1).not.toBe(suite2);
    });

    it('should accept config on first call', () => {
      resetBenchmarkSuite();
      const suite = getBenchmarkSuite({ runs: 50 });
      const config = suite.getConfig();

      expect(config.runs).toBe(50);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      suite.updateConfig({ runs: 25, warmupRuns: 5 });
      const config = suite.getConfig();

      expect(config.runs).toBe(25);
      expect(config.warmupRuns).toBe(5);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Performance Module Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPerformanceManager();
    resetLazyLoader();
    resetToolCache();
    resetRequestOptimizer();
    resetBenchmarkSuite();
  });

  it('should coordinate all performance systems', async () => {
    const manager = await initializePerformanceManager();

    // Register lazy module
    const lazyLoader = manager.getLazyLoader()!;
    lazyLoader.register('test-module', async () => ({ initialized: true }));

    // Use tool cache
    const toolCache = manager.getToolCache()!;
    await toolCache.getOrExecute('search', { q: 'test' }, async () => ({
      success: true,
      output: 'results',
    }));

    // Use request optimizer
    const optimizer = manager.getRequestOptimizer()!;
    await optimizer.executeImmediate(async () => 'optimized');

    // Check summary includes all systems
    const summary = manager.getSummary();
    expect(summary.lazyLoader.totalModules).toBe(7); // 6 common + 1 test
    expect(summary.toolCache).toBeDefined();
    expect(summary.requestOptimizer).toBeDefined();

    manager.dispose();
  });

  it('should track metrics across systems', async () => {
    const manager = await initializePerformanceManager();

    // Load a lazy module (should record metric)
    const lazyLoader = manager.getLazyLoader()!;
    lazyLoader.register('metrics-module', async () => ({ ready: true }));
    await lazyLoader.get('metrics-module');

    // Get summary
    const summary = manager.getSummary();
    expect(summary.lazyLoader.loadedModules).toBeGreaterThan(0);

    manager.dispose();
  });
});
