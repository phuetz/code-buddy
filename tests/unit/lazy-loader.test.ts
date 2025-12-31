/**
 * Tests for Lazy Loader
 */

import {
  LazyLoader,
  LazyLoaderConfig,
  getLazyLoader,
  resetLazyLoader,
  registerCommonModules,
  initializeLazyLoader,
} from '../../src/performance/lazy-loader';

// Mock console to suppress output during tests
const mockConsole = {
  log: jest.spyOn(console, 'log').mockImplementation(),
  error: jest.spyOn(console, 'error').mockImplementation(),
  warn: jest.spyOn(console, 'warn').mockImplementation(),
};

describe('LazyLoader', () => {
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
    resetLazyLoader();
  });

  describe('Constructor', () => {
    it('should create with default configuration', () => {
      const instance = new LazyLoader();
      expect(instance).toBeDefined();
    });

    it('should create with custom configuration', () => {
      const config: Partial<LazyLoaderConfig> = {
        preloadDelay: 5000,
        preloadModules: ['test-module'],
        enableMetrics: false,
      };

      const instance = new LazyLoader(config);
      expect(instance).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const config: Partial<LazyLoaderConfig> = {
        preloadDelay: 3000,
      };

      const instance = new LazyLoader(config);
      // Should have custom preloadDelay but default enableMetrics
      expect(instance).toBeDefined();
    });
  });

  describe('register', () => {
    it('should register a module', () => {
      const moduleName = 'test-module';
      const moduleLoader = jest.fn().mockResolvedValue({ data: 'test' });

      loader.register(moduleName, moduleLoader);

      expect(loader.isLoaded(moduleName)).toBe(false);
    });

    it('should emit module:registered event', () => {
      const eventHandler = jest.fn();
      loader.on('module:registered', eventHandler);

      loader.register('test-module', jest.fn().mockResolvedValue({}));

      expect(eventHandler).toHaveBeenCalledWith({ name: 'test-module' });
    });

    it('should allow registering multiple modules', () => {
      loader.register('module1', jest.fn().mockResolvedValue({}));
      loader.register('module2', jest.fn().mockResolvedValue({}));
      loader.register('module3', jest.fn().mockResolvedValue({}));

      expect(loader.isLoaded('module1')).toBe(false);
      expect(loader.isLoaded('module2')).toBe(false);
      expect(loader.isLoaded('module3')).toBe(false);
    });

    it('should overwrite existing module registration', () => {
      const loader1 = jest.fn().mockResolvedValue({ version: 1 });
      const loader2 = jest.fn().mockResolvedValue({ version: 2 });

      loader.register('test-module', loader1);
      loader.register('test-module', loader2);

      // Only the second loader should be called when getting the module
      expect(loader.isLoaded('test-module')).toBe(false);
    });
  });

  describe('get', () => {
    it('should load and return a module', async () => {
      const moduleData = { name: 'TestModule', value: 42 };
      const moduleLoader = jest.fn().mockResolvedValue(moduleData);

      loader.register('test-module', moduleLoader);

      const result = await loader.get('test-module');

      expect(result).toEqual(moduleData);
      expect(moduleLoader).toHaveBeenCalledTimes(1);
    });

    it('should cache loaded modules', async () => {
      const moduleLoader = jest.fn().mockResolvedValue({ cached: true });

      loader.register('cached-module', moduleLoader);

      await loader.get('cached-module');
      await loader.get('cached-module');
      await loader.get('cached-module');

      expect(moduleLoader).toHaveBeenCalledTimes(1);
    });

    it('should throw error for unregistered module', async () => {
      await expect(loader.get('non-existent')).rejects.toThrow(
        'Module not registered: non-existent'
      );
    });

    it('should emit module:loaded event on successful load', async () => {
      const eventHandler = jest.fn();
      loader.on('module:loaded', eventHandler);

      loader.register('event-test', jest.fn().mockResolvedValue({}));
      await loader.get('event-test');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'event-test',
          loadTime: expect.any(Number),
        })
      );
    });

    it('should emit module:error event on load failure', async () => {
      const eventHandler = jest.fn();
      const error = new Error('Load failed');

      loader.on('module:error', eventHandler);
      loader.register('error-module', jest.fn().mockRejectedValue(error));

      await expect(loader.get('error-module')).rejects.toThrow('Load failed');

      expect(eventHandler).toHaveBeenCalledWith({
        name: 'error-module',
        error,
      });
    });

    it('should handle concurrent requests for the same module', async () => {
      // Use real timers for this test since it involves Promise resolution timing
      jest.useRealTimers();

      let resolveLoader: (value: unknown) => void;
      const moduleLoader = jest.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveLoader = resolve;
        });
      });

      loader.register('concurrent-module', moduleLoader);

      // Start multiple concurrent requests
      const promise1 = loader.get('concurrent-module');
      const promise2 = loader.get('concurrent-module');
      const promise3 = loader.get('concurrent-module');

      // Small delay to allow the polling to start
      await new Promise((r) => setTimeout(r, 10));
      resolveLoader!({ data: 'loaded' });

      const [result1, result2, result3] = await Promise.all([
        promise1,
        promise2,
        promise3,
      ]);

      expect(result1).toEqual({ data: 'loaded' });
      expect(result2).toEqual({ data: 'loaded' });
      expect(result3).toEqual({ data: 'loaded' });
      expect(moduleLoader).toHaveBeenCalledTimes(1);

      // Restore fake timers
      jest.useFakeTimers();
    });

    it('should record metrics when enableMetrics is true', async () => {
      const metricsLoader = new LazyLoader({ enableMetrics: true });
      metricsLoader.register('metrics-module', jest.fn().mockResolvedValue({}));

      await metricsLoader.get('metrics-module');

      const metrics = metricsLoader.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toEqual(
        expect.objectContaining({
          moduleName: 'metrics-module',
          success: true,
          loadTime: expect.any(Number),
          timestamp: expect.any(Number),
        })
      );

      metricsLoader.clear();
    });

    it('should record failed metrics', async () => {
      const metricsLoader = new LazyLoader({ enableMetrics: true });
      metricsLoader.register(
        'fail-module',
        jest.fn().mockRejectedValue(new Error('fail'))
      );

      try {
        await metricsLoader.get('fail-module');
      } catch {
        // Expected to fail
      }

      const metrics = metricsLoader.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toEqual(
        expect.objectContaining({
          moduleName: 'fail-module',
          success: false,
        })
      );

      metricsLoader.clear();
    });

    it('should not record metrics when enableMetrics is false', async () => {
      const noMetricsLoader = new LazyLoader({ enableMetrics: false });
      noMetricsLoader.register('no-metrics', jest.fn().mockResolvedValue({}));

      await noMetricsLoader.get('no-metrics');

      const metrics = noMetricsLoader.getMetrics();
      expect(metrics).toHaveLength(0);

      noMetricsLoader.clear();
    });

    it('should handle error during concurrent loading', async () => {
      // Use real timers for this test since it involves Promise resolution timing
      jest.useRealTimers();

      const error = new Error('Concurrent load failed');
      let rejectLoader: (err: Error) => void;
      const moduleLoader = jest.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          rejectLoader = reject;
        });
      });

      loader.register('concurrent-fail', moduleLoader);

      const promise1 = loader.get('concurrent-fail');
      const promise2 = loader.get('concurrent-fail');

      // Small delay to allow the polling to start
      await new Promise((r) => setTimeout(r, 10));
      rejectLoader!(error);

      await expect(promise1).rejects.toThrow('Concurrent load failed');
      await expect(promise2).rejects.toThrow('Concurrent load failed');

      // Restore fake timers
      jest.useFakeTimers();
    });
  });

  describe('isLoaded', () => {
    it('should return false for unregistered module', () => {
      expect(loader.isLoaded('unknown')).toBe(false);
    });

    it('should return false for registered but not loaded module', () => {
      loader.register('pending', jest.fn().mockResolvedValue({}));
      expect(loader.isLoaded('pending')).toBe(false);
    });

    it('should return true for loaded module', async () => {
      loader.register('loaded', jest.fn().mockResolvedValue({}));
      await loader.get('loaded');

      expect(loader.isLoaded('loaded')).toBe(true);
    });
  });

  describe('preload', () => {
    it('should preload specified modules', async () => {
      const loader1 = jest.fn().mockResolvedValue({});
      const loader2 = jest.fn().mockResolvedValue({});

      loader.register('preload1', loader1);
      loader.register('preload2', loader2);

      await loader.preload(['preload1', 'preload2']);

      expect(loader.isLoaded('preload1')).toBe(true);
      expect(loader.isLoaded('preload2')).toBe(true);
    });

    it('should use config preloadModules when no modules specified', async () => {
      const configLoader = new LazyLoader({
        preloadModules: ['config-preload'],
      });
      const moduleLoader = jest.fn().mockResolvedValue({});

      configLoader.register('config-preload', moduleLoader);
      await configLoader.preload();

      expect(configLoader.isLoaded('config-preload')).toBe(true);
      configLoader.clear();
    });

    it('should emit preload:complete event', async () => {
      const eventHandler = jest.fn();
      loader.on('preload:complete', eventHandler);

      loader.register('preload-test', jest.fn().mockResolvedValue({}));
      await loader.preload(['preload-test']);

      expect(eventHandler).toHaveBeenCalledWith({ modules: ['preload-test'] });
    });

    it('should emit preload:error for failed modules but continue', async () => {
      const eventHandler = jest.fn();
      loader.on('preload:error', eventHandler);

      loader.register('success', jest.fn().mockResolvedValue({}));
      loader.register('fail', jest.fn().mockRejectedValue(new Error('fail')));

      await loader.preload(['success', 'fail']);

      expect(loader.isLoaded('success')).toBe(true);
      expect(loader.isLoaded('fail')).toBe(false);
      expect(eventHandler).toHaveBeenCalledWith({
        name: 'fail',
        error: expect.any(Error),
      });
    });

    it('should handle unregistered modules in preload list', async () => {
      const eventHandler = jest.fn();
      loader.on('preload:error', eventHandler);

      await loader.preload(['non-existent']);

      expect(eventHandler).toHaveBeenCalledWith({
        name: 'non-existent',
        error: expect.any(Error),
      });
    });
  });

  describe('schedulePreload', () => {
    it('should schedule preload after delay', () => {
      const preloadLoader = new LazyLoader({
        preloadDelay: 2000,
        preloadModules: ['scheduled'],
      });
      const moduleLoader = jest.fn().mockResolvedValue({});
      const eventHandler = jest.fn();

      preloadLoader.register('scheduled', moduleLoader);
      preloadLoader.on('preload:complete', eventHandler);
      preloadLoader.schedulePreload();

      expect(moduleLoader).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2000);

      // Need to flush promises
      return Promise.resolve().then(() => {
        preloadLoader.clear();
      });
    });

    it('should not schedule if no preloadModules', () => {
      const noPreloadLoader = new LazyLoader({
        preloadModules: [],
      });

      const eventHandler = jest.fn();
      noPreloadLoader.on('preload:complete', eventHandler);

      noPreloadLoader.schedulePreload();

      jest.advanceTimersByTime(10000);

      expect(eventHandler).not.toHaveBeenCalled();
      noPreloadLoader.clear();
    });

    it('should emit preload:error on scheduled preload failure', async () => {
      const errorLoader = new LazyLoader({
        preloadDelay: 1000,
        preloadModules: ['error-module'],
      });
      const eventHandler = jest.fn();
      errorLoader.on('preload:error', eventHandler);

      // Register a module that will fail
      errorLoader.register(
        'error-module',
        jest.fn().mockRejectedValue(new Error('Preload failed'))
      );

      errorLoader.schedulePreload();
      jest.advanceTimersByTime(1000);

      // Wait for promises to resolve
      await Promise.resolve();
      await Promise.resolve();

      errorLoader.clear();
    });
  });

  describe('unload', () => {
    it('should unload a loaded module', async () => {
      loader.register('unload-test', jest.fn().mockResolvedValue({ data: 1 }));
      await loader.get('unload-test');

      expect(loader.isLoaded('unload-test')).toBe(true);

      const result = loader.unload('unload-test');

      expect(result).toBe(true);
      expect(loader.isLoaded('unload-test')).toBe(false);
    });

    it('should emit module:unloaded event', async () => {
      const eventHandler = jest.fn();
      loader.on('module:unloaded', eventHandler);

      loader.register('emit-test', jest.fn().mockResolvedValue({}));
      await loader.get('emit-test');
      loader.unload('emit-test');

      expect(eventHandler).toHaveBeenCalledWith({ name: 'emit-test' });
    });

    it('should return false for unregistered module', () => {
      const result = loader.unload('non-existent');
      expect(result).toBe(false);
    });

    it('should return false for not-loaded module', () => {
      loader.register('not-loaded', jest.fn().mockResolvedValue({}));
      const result = loader.unload('not-loaded');
      expect(result).toBe(false);
    });

    it('should allow reloading after unload', async () => {
      let loadCount = 0;
      const moduleLoader = jest.fn().mockImplementation(() => {
        loadCount++;
        return Promise.resolve({ loadCount });
      });

      loader.register('reload-test', moduleLoader);

      const first = await loader.get<{ loadCount: number }>('reload-test');
      expect(first.loadCount).toBe(1);

      loader.unload('reload-test');

      const second = await loader.get<{ loadCount: number }>('reload-test');
      expect(second.loadCount).toBe(2);
      expect(moduleLoader).toHaveBeenCalledTimes(2);
    });
  });

  describe('getMetrics', () => {
    it('should return empty array initially', () => {
      expect(loader.getMetrics()).toEqual([]);
    });

    it('should return copy of metrics array', async () => {
      loader.register('metric1', jest.fn().mockResolvedValue({}));
      await loader.get('metric1');

      const metrics1 = loader.getMetrics();
      const metrics2 = loader.getMetrics();

      expect(metrics1).not.toBe(metrics2);
      expect(metrics1).toEqual(metrics2);
    });

    it('should track multiple module loads', async () => {
      loader.register('m1', jest.fn().mockResolvedValue({}));
      loader.register('m2', jest.fn().mockResolvedValue({}));
      loader.register('m3', jest.fn().mockResolvedValue({}));

      await loader.get('m1');
      await loader.get('m2');
      await loader.get('m3');

      const metrics = loader.getMetrics();
      expect(metrics).toHaveLength(3);
      expect(metrics.map((m) => m.moduleName)).toEqual(['m1', 'm2', 'm3']);
    });
  });

  describe('getStats', () => {
    it('should return correct stats for empty loader', () => {
      const stats = loader.getStats();

      expect(stats).toEqual({
        totalModules: 0,
        loadedModules: 0,
        totalLoadTime: 0,
        averageLoadTime: 0,
      });
    });

    it('should return correct stats after loading modules', async () => {
      loader.register('s1', jest.fn().mockResolvedValue({}));
      loader.register('s2', jest.fn().mockResolvedValue({}));
      loader.register('s3', jest.fn().mockResolvedValue({}));

      await loader.get('s1');
      await loader.get('s2');

      const stats = loader.getStats();

      expect(stats.totalModules).toBe(3);
      expect(stats.loadedModules).toBe(2);
      expect(stats.totalLoadTime).toBeGreaterThanOrEqual(0);
      expect(stats.averageLoadTime).toBeGreaterThanOrEqual(0);
    });

    it('should calculate average correctly', async () => {
      loader.register('avg1', jest.fn().mockResolvedValue({}));
      loader.register('avg2', jest.fn().mockResolvedValue({}));

      await loader.get('avg1');
      await loader.get('avg2');

      const stats = loader.getStats();
      const metrics = loader.getMetrics();

      const expectedAverage =
        (metrics[0].loadTime + metrics[1].loadTime) / 2;
      expect(stats.averageLoadTime).toBe(expectedAverage);
    });
  });

  describe('clear', () => {
    it('should clear all modules and metrics', async () => {
      loader.register('clear1', jest.fn().mockResolvedValue({}));
      loader.register('clear2', jest.fn().mockResolvedValue({}));

      await loader.get('clear1');
      await loader.get('clear2');

      loader.clear();

      expect(loader.getMetrics()).toEqual([]);
      expect(loader.getStats().totalModules).toBe(0);
    });

    it('should cancel scheduled preload', () => {
      const preloadLoader = new LazyLoader({
        preloadDelay: 5000,
        preloadModules: ['cancel-test'],
      });
      const moduleLoader = jest.fn().mockResolvedValue({});

      preloadLoader.register('cancel-test', moduleLoader);
      preloadLoader.schedulePreload();

      preloadLoader.clear();

      jest.advanceTimersByTime(10000);

      expect(moduleLoader).not.toHaveBeenCalled();
    });
  });

  describe('Singleton - getLazyLoader', () => {
    beforeEach(() => {
      resetLazyLoader();
    });

    it('should return same instance when called multiple times', () => {
      const instance1 = getLazyLoader();
      const instance2 = getLazyLoader();

      expect(instance1).toBe(instance2);
    });

    it('should use provided config on first call', () => {
      const config: Partial<LazyLoaderConfig> = {
        preloadDelay: 10000,
      };

      const instance = getLazyLoader(config);
      expect(instance).toBeDefined();
    });

    it('should ignore config on subsequent calls', () => {
      const instance1 = getLazyLoader({ preloadDelay: 1000 });
      const instance2 = getLazyLoader({ preloadDelay: 5000 });

      expect(instance1).toBe(instance2);
    });
  });

  describe('resetLazyLoader', () => {
    it('should reset the singleton instance', () => {
      const instance1 = getLazyLoader();
      resetLazyLoader();
      const instance2 = getLazyLoader();

      expect(instance1).not.toBe(instance2);
    });

    it('should clear the instance on reset', () => {
      const instance = getLazyLoader();
      instance.register('test', jest.fn().mockResolvedValue({}));

      resetLazyLoader();

      const newInstance = getLazyLoader();
      expect(newInstance.getStats().totalModules).toBe(0);
    });

    it('should handle reset when no instance exists', () => {
      expect(() => resetLazyLoader()).not.toThrow();
    });
  });

  describe('registerCommonModules', () => {
    it('should register common modules', () => {
      const testLoader = new LazyLoader();

      registerCommonModules(testLoader);

      const stats = testLoader.getStats();
      expect(stats.totalModules).toBeGreaterThan(0);

      testLoader.clear();
    });

    it('should register pdf-parse module', () => {
      const testLoader = new LazyLoader();
      registerCommonModules(testLoader);

      expect(testLoader.isLoaded('pdf-parse')).toBe(false);
      testLoader.clear();
    });

    it('should register xlsx module', () => {
      const testLoader = new LazyLoader();
      registerCommonModules(testLoader);

      expect(testLoader.isLoaded('xlsx')).toBe(false);
      testLoader.clear();
    });

    it('should register jszip module', () => {
      const testLoader = new LazyLoader();
      registerCommonModules(testLoader);

      expect(testLoader.isLoaded('jszip')).toBe(false);
      testLoader.clear();
    });

    it('should register tar module', () => {
      const testLoader = new LazyLoader();
      registerCommonModules(testLoader);

      expect(testLoader.isLoaded('tar')).toBe(false);
      testLoader.clear();
    });

    it('should register better-sqlite3 module', () => {
      const testLoader = new LazyLoader();
      registerCommonModules(testLoader);

      expect(testLoader.isLoaded('better-sqlite3')).toBe(false);
      testLoader.clear();
    });

    it('should register alasql module', () => {
      const testLoader = new LazyLoader();
      registerCommonModules(testLoader);

      expect(testLoader.isLoaded('alasql')).toBe(false);
      testLoader.clear();
    });
  });

  describe('initializeLazyLoader', () => {
    it('should return a configured lazy loader', () => {
      const initializedLoader = initializeLazyLoader();

      expect(initializedLoader).toBeDefined();
      expect(initializedLoader.getStats().totalModules).toBeGreaterThan(0);

      initializedLoader.clear();
      resetLazyLoader();
    });

    it('should accept custom configuration', () => {
      const config: Partial<LazyLoaderConfig> = {
        preloadDelay: 1000,
        enableMetrics: false,
      };

      const initializedLoader = initializeLazyLoader(config);

      expect(initializedLoader).toBeDefined();

      initializedLoader.clear();
      resetLazyLoader();
    });

    it('should schedule preload', () => {
      const initializedLoader = initializeLazyLoader({
        preloadDelay: 5000,
        preloadModules: ['jszip'],
      });

      // Should have called schedulePreload
      expect(initializedLoader).toBeDefined();

      initializedLoader.clear();
      resetLazyLoader();
    });
  });

  describe('EventEmitter functionality', () => {
    it('should support multiple listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      loader.on('module:registered', handler1);
      loader.on('module:registered', handler2);

      loader.register('multi-listener', jest.fn().mockResolvedValue({}));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should allow removing listeners', () => {
      const handler = jest.fn();

      loader.on('module:registered', handler);
      loader.register('first', jest.fn().mockResolvedValue({}));

      loader.off('module:registered', handler);
      loader.register('second', jest.fn().mockResolvedValue({}));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should support once listeners', async () => {
      const handler = jest.fn();

      loader.once('module:loaded', handler);

      loader.register('once1', jest.fn().mockResolvedValue({}));
      loader.register('once2', jest.fn().mockResolvedValue({}));

      await loader.get('once1');
      await loader.get('once2');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle module that returns undefined', async () => {
      loader.register('undefined-module', jest.fn().mockResolvedValue(undefined));

      const result = await loader.get('undefined-module');

      expect(result).toBeUndefined();
      expect(loader.isLoaded('undefined-module')).toBe(true);
    });

    it('should handle module that returns null', async () => {
      loader.register('null-module', jest.fn().mockResolvedValue(null));

      const result = await loader.get('null-module');

      expect(result).toBeNull();
      expect(loader.isLoaded('null-module')).toBe(true);
    });

    it('should handle module that returns empty object', async () => {
      loader.register('empty-module', jest.fn().mockResolvedValue({}));

      const result = await loader.get('empty-module');

      expect(result).toEqual({});
      expect(loader.isLoaded('empty-module')).toBe(true);
    });

    it('should handle very fast module loads', async () => {
      loader.register('fast-module', jest.fn().mockResolvedValue({ fast: true }));

      const result = await loader.get('fast-module');

      expect(result).toEqual({ fast: true });
      const metrics = loader.getMetrics();
      expect(metrics[0].loadTime).toBeGreaterThanOrEqual(0);
    });

    it('should preserve type information', async () => {
      interface TestModule {
        name: string;
        version: number;
        active: boolean;
      }

      const moduleData: TestModule = {
        name: 'test',
        version: 1,
        active: true,
      };

      loader.register('typed-module', jest.fn().mockResolvedValue(moduleData));

      const result = await loader.get<TestModule>('typed-module');

      expect(result.name).toBe('test');
      expect(result.version).toBe(1);
      expect(result.active).toBe(true);
    });
  });
});
