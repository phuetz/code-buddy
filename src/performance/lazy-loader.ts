/**
 * Lazy Loader
 *
 * Implements lazy loading for heavy modules to reduce startup time.
 * Modules are loaded on-demand and cached for subsequent uses.
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
}

export interface LazyLoaderConfig {
  /** Preload modules after initial startup (ms delay) */
  preloadDelay: number;
  /** Modules to preload automatically */
  preloadModules: string[];
  /** Enable performance logging */
  enableMetrics: boolean;
}

export interface LoadMetrics {
  moduleName: string;
  loadTime: number;
  timestamp: number;
  success: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: LazyLoaderConfig = {
  preloadDelay: 2000, // Wait 2s after startup
  preloadModules: [],
  enableMetrics: true,
};

// ============================================================================
// Lazy Loader Class
// ============================================================================

export class LazyLoader extends EventEmitter {
  private modules: Map<string, LazyModule> = new Map();
  private config: LazyLoaderConfig;
  private metrics: LoadMetrics[] = [];
  private preloadTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<LazyLoaderConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a module for lazy loading
   */
  register<T>(name: string, loader: () => Promise<T>): void {
    this.modules.set(name, {
      name,
      loader,
      loaded: false,
      loading: false,
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
   * Preload specified modules
   */
  async preload(moduleNames?: string[]): Promise<void> {
    const names = moduleNames || this.config.preloadModules;

    const promises = names.map(async (name) => {
      try {
        await this.get(name);
      } catch (error) {
        // Log but don't fail preload
        this.emit('preload:error', { name, error });
      }
    });

    await Promise.all(promises);
    this.emit('preload:complete', { modules: names });
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
    this.modules.clear();
    this.metrics = [];
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
  // PDF processing
  loader.register('pdf-parse', async () => {
    // @ts-expect-error - Optional dependency
    const module = await import('pdf-parse');
    return module.default || module;
  });

  // Excel processing
  loader.register('xlsx', async () => {
    // @ts-expect-error - Optional dependency
    const module = await import('xlsx');
    return module.default || module;
  });

  // Archive handling
  loader.register('jszip', async () => {
    const module = await import('jszip');
    return module.default || module;
  });

  loader.register('tar', async () => {
    const module = await import('tar');
    return module;
  });

  // SQL engines
  loader.register('better-sqlite3', async () => {
    const module = await import('better-sqlite3');
    return module.default || module;
  });

  loader.register('alasql', async () => {
    const module = await import('alasql');
    return module.default || module;
  });
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
