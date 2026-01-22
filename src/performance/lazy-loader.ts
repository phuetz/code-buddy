/**
 * Lazy Loader
 *
 * Implements lazy loading for heavy modules to reduce startup time.
 * Modules are loaded on-demand and cached for subsequent uses.
 *
 * Key features:
 * - On-demand loading with automatic caching
 * - Priority-based preloading after startup
 * - Parallel module loading support
 * - Load time metrics and optimization hints
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface LazyModule<T = unknown> {
  name: string;
  loader: () => Promise<T>;
  instance?: T;
  loaded: boolean;
  loading: boolean;
  loadTime?: number;
  error?: Error;
  /** Priority for preloading (higher = load first) */
  priority?: number;
  /** Dependencies that must be loaded first */
  dependencies?: string[];
}

export interface LazyLoaderConfig {
  /** Preload modules after initial startup (ms delay) */
  preloadDelay: number;
  /** Modules to preload automatically */
  preloadModules: string[];
  /** Enable performance logging */
  enableMetrics: boolean;
  /** Maximum parallel loads during preload */
  maxParallelLoads: number;
  /** Enable idle-time preloading */
  idlePreload: boolean;
}

export interface LoadMetrics {
  moduleName: string;
  loadTime: number;
  timestamp: number;
  success: boolean;
}

/** Module loading priority levels */
export const LoadPriority = {
  CRITICAL: 100,    // Load immediately after startup
  HIGH: 75,         // Load soon after critical
  NORMAL: 50,       // Default priority
  LOW: 25,          // Load when idle
  DEFERRED: 0,      // Only load on demand
} as const;

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: LazyLoaderConfig = {
  preloadDelay: 100, // Reduced: start preloading after 100ms
  preloadModules: [],
  enableMetrics: true,
  maxParallelLoads: 3, // Load up to 3 modules in parallel
  idlePreload: true,   // Use idle time for preloading
};

// ============================================================================
// Lazy Loader Class
// ============================================================================

export class LazyLoader extends EventEmitter {
  private modules: Map<string, LazyModule> = new Map();
  private config: LazyLoaderConfig;
  private metrics: LoadMetrics[] = [];
  private preloadTimeout: ReturnType<typeof setTimeout> | null = null;
  private idleCallback: ReturnType<typeof setTimeout> | null = null;
  private loadingQueue: string[] = [];
  private activeLoads = 0;

  constructor(config: Partial<LazyLoaderConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a module for lazy loading
   */
  register<T>(name: string, loader: () => Promise<T>, options?: { priority?: number; dependencies?: string[] }): void {
    this.modules.set(name, {
      name,
      loader,
      loaded: false,
      loading: false,
      priority: options?.priority ?? LoadPriority.NORMAL,
      dependencies: options?.dependencies,
    });
    this.emit('module:registered', { name });
  }

  /**
   * Get a lazily loaded module
   */
  async get<T>(name: string): Promise<T> {
    const module = this.modules.get(name);

    if (!module) {
      throw new Error(`Module not registered: ${name}`);
    }

    // Already loaded
    if (module.loaded && module.instance !== undefined) {
      return module.instance as T;
    }

    // Currently loading - wait for it
    if (module.loading) {
      return new Promise((resolve, reject) => {
        const checkLoaded = () => {
          if (module.loaded && module.instance !== undefined) {
            resolve(module.instance as T);
          } else if (module.error) {
            reject(module.error);
          } else {
            setTimeout(checkLoaded, 50);
          }
        };
        checkLoaded();
      });
    }

    // Load the module
    return this.loadModule<T>(module);
  }

  /**
   * Check if a module is loaded
   */
  isLoaded(name: string): boolean {
    const module = this.modules.get(name);
    return module?.loaded ?? false;
  }

  /**
   * Preload specified modules with parallel loading support
   */
  async preload(moduleNames?: string[]): Promise<void> {
    const names = moduleNames || this.config.preloadModules;
    if (names.length === 0) return;

    // Sort by priority (highest first)
    const sortedNames = [...names].sort((a, b) => {
      const modA = this.modules.get(a);
      const modB = this.modules.get(b);
      return (modB?.priority ?? 0) - (modA?.priority ?? 0);
    });

    // Load in batches respecting max parallel loads
    const batchSize = this.config.maxParallelLoads;
    for (let i = 0; i < sortedNames.length; i += batchSize) {
      const batch = sortedNames.slice(i, i + batchSize);
      const promises = batch.map(async (name) => {
        try {
          // Load dependencies first
          const module = this.modules.get(name);
          if (module?.dependencies) {
            for (const dep of module.dependencies) {
              await this.get(dep);
            }
          }
          await this.get(name);
        } catch (error) {
          // Log but don't fail preload
          this.emit('preload:error', { name, error });
        }
      });
      await Promise.all(promises);
    }

    this.emit('preload:complete', { modules: sortedNames });
  }

  /**
   * Schedule preloading after startup
   */
  schedulePreload(): void {
    if (this.config.preloadModules.length === 0) return;

    this.preloadTimeout = setTimeout(() => {
      this.preload().catch((err) => {
        this.emit('preload:error', { error: err.message || String(err) });
      });
    }, this.config.preloadDelay);
  }

  /**
   * Schedule idle-time preloading for lower priority modules
   */
  scheduleIdlePreload(moduleNames: string[]): void {
    if (!this.config.idlePreload || moduleNames.length === 0) return;

    // Use setImmediate/setTimeout to defer to idle time
    const loadNext = () => {
      const name = moduleNames.shift();
      if (!name) return;

      const module = this.modules.get(name);
      if (module && !module.loaded && !module.loading) {
        this.get(name).catch(() => {
          // Ignore errors during idle preload
        }).finally(() => {
          if (moduleNames.length > 0) {
            this.idleCallback = setTimeout(loadNext, 50);
          }
        });
      } else if (moduleNames.length > 0) {
        this.idleCallback = setTimeout(loadNext, 10);
      }
    };

    this.idleCallback = setTimeout(loadNext, this.config.preloadDelay + 500);
  }

  /**
   * Unload a module to free memory
   */
  unload(name: string): boolean {
    const module = this.modules.get(name);
    if (!module || !module.loaded) return false;

    module.instance = undefined;
    module.loaded = false;
    module.loadTime = undefined;

    this.emit('module:unloaded', { name });
    return true;
  }

  /**
   * Get loading metrics
   */
  getMetrics(): LoadMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    totalModules: number;
    loadedModules: number;
    totalLoadTime: number;
    averageLoadTime: number;
  } {
    const loaded = [...this.modules.values()].filter(m => m.loaded);
    const totalLoadTime = this.metrics.reduce((sum, m) => sum + m.loadTime, 0);

    return {
      totalModules: this.modules.size,
      loadedModules: loaded.length,
      totalLoadTime,
      averageLoadTime: this.metrics.length > 0 ? totalLoadTime / this.metrics.length : 0,
    };
  }

  /**
   * Clear all modules
   */
  clear(): void {
    if (this.preloadTimeout) {
      clearTimeout(this.preloadTimeout);
    }
    if (this.idleCallback) {
      clearTimeout(this.idleCallback);
    }
    this.modules.clear();
    this.metrics = [];
    this.loadingQueue = [];
    this.activeLoads = 0;
  }

  /**
   * Get loading hints based on metrics
   */
  getOptimizationHints(): string[] {
    const hints: string[] = [];
    const slowModules = this.metrics
      .filter(m => m.success && m.loadTime > 100)
      .sort((a, b) => b.loadTime - a.loadTime);

    if (slowModules.length > 0) {
      hints.push(`Slow modules detected: ${slowModules.slice(0, 3).map(m => `${m.moduleName} (${m.loadTime}ms)`).join(', ')}`);
    }

    const failedModules = this.metrics.filter(m => !m.success);
    if (failedModules.length > 0) {
      hints.push(`Failed to load: ${failedModules.map(m => m.moduleName).join(', ')}`);
    }

    return hints;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async loadModule<T>(module: LazyModule): Promise<T> {
    module.loading = true;
    const startTime = Date.now();

    try {
      const instance = await module.loader();
      const loadTime = Date.now() - startTime;

      module.instance = instance;
      module.loaded = true;
      module.loadTime = loadTime;
      module.loading = false;

      if (this.config.enableMetrics) {
        this.metrics.push({
          moduleName: module.name,
          loadTime,
          timestamp: Date.now(),
          success: true,
        });
      }

      this.emit('module:loaded', { name: module.name, loadTime });
      return instance as T;
    } catch (error) {
      module.loading = false;
      module.error = error as Error;

      if (this.config.enableMetrics) {
        this.metrics.push({
          moduleName: module.name,
          loadTime: Date.now() - startTime,
          timestamp: Date.now(),
          success: false,
        });
      }

      this.emit('module:error', { name: module.name, error });
      throw error;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let loaderInstance: LazyLoader | null = null;

export function getLazyLoader(config?: Partial<LazyLoaderConfig>): LazyLoader {
  if (!loaderInstance) {
    loaderInstance = new LazyLoader(config);
  }
  return loaderInstance;
}

export function resetLazyLoader(): void {
  if (loaderInstance) {
    loaderInstance.clear();
  }
  loaderInstance = null;
}

// ============================================================================
// Pre-configured Module Loaders
// ============================================================================

/**
 * Register common heavy modules for lazy loading
 */
export function registerCommonModules(loader: LazyLoader): void {
  // PDF processing - low priority, only needed when user processes PDFs
  loader.register('pdf-parse', async () => {
    const module = await import('pdf-parse');
    return module.default || module;
  }, { priority: LoadPriority.DEFERRED });

  // Excel processing - low priority
  loader.register('xlsx', async () => {
    const module = await import('xlsx');
    return module.default || module;
  }, { priority: LoadPriority.DEFERRED });

  // Archive handling - low priority
  loader.register('jszip', async () => {
    const module = await import('jszip');
    return module.default || module;
  }, { priority: LoadPriority.DEFERRED });

  loader.register('tar', async () => {
    const module = await import('tar');
    return module;
  }, { priority: LoadPriority.DEFERRED });

  // SQL engines - deferred until needed
  loader.register('better-sqlite3', async () => {
    const module = await import('better-sqlite3');
    return module.default || module;
  }, { priority: LoadPriority.DEFERRED });

  loader.register('alasql', async () => {
    const module = await import('alasql');
    return module.default || module;
  }, { priority: LoadPriority.DEFERRED });

  // React/Ink - high priority for UI mode
  loader.register('react', async () => {
    const module = await import('react');
    return module;
  }, { priority: LoadPriority.HIGH });

  loader.register('ink', async () => {
    const module = await import('ink');
    return module;
  }, { priority: LoadPriority.HIGH, dependencies: ['react'] });

  // Chalk - normal priority for logging
  loader.register('chalk', async () => {
    const module = await import('chalk');
    return module.default || module;
  }, { priority: LoadPriority.NORMAL });

  // Marked for markdown rendering
  loader.register('marked', async () => {
    const module = await import('marked');
    return module;
  }, { priority: LoadPriority.LOW });

  loader.register('marked-terminal', async () => {
    const module = await import('marked-terminal');
    return module;
  }, { priority: LoadPriority.LOW, dependencies: ['marked'] });

  // OpenAI SDK - critical for API calls
  loader.register('openai', async () => {
    const module = await import('openai');
    return module;
  }, { priority: LoadPriority.CRITICAL });

  // fs-extra - normal priority
  loader.register('fs-extra', async () => {
    const module = await import('fs-extra');
    return module;
  }, { priority: LoadPriority.NORMAL });

  // tiktoken for token counting - high priority
  loader.register('tiktoken', async () => {
    const module = await import('tiktoken');
    return module;
  }, { priority: LoadPriority.HIGH });
}

/**
 * Initialize lazy loader with common modules
 */
export function initializeLazyLoader(config?: Partial<LazyLoaderConfig>): LazyLoader {
  const loader = getLazyLoader(config);
  registerCommonModules(loader);
  loader.schedulePreload();
  return loader;
}

/**
 * Initialize lazy loader for CLI startup
 * Optimized for minimal startup time with intelligent preloading
 */
export function initializeCLILazyLoader(): LazyLoader {
  const loader = getLazyLoader({
    preloadDelay: 50,           // Start preloading quickly
    maxParallelLoads: 2,        // Conservative parallel loading
    idlePreload: true,
    enableMetrics: process.env.DEBUG === 'true',
    preloadModules: ['openai', 'tiktoken'], // Critical modules first
  });

  registerCommonModules(loader);

  // Schedule critical modules immediately
  loader.schedulePreload();

  // Schedule lower priority modules for idle time
  loader.scheduleIdlePreload([
    'chalk',
    'fs-extra',
    'marked',
    'marked-terminal',
  ]);

  return loader;
}

/**
 * Quick startup helper - defers module loading until after initial render
 * Returns a function to call after the UI is ready
 */
export function createDeferredLoader(): () => void {
  return () => {
    // This runs after the main action starts
    setImmediate(() => {
      initializeCLILazyLoader();
    });
  };
}
