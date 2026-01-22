/**
 * Shared singleton pattern utilities
 *
 * This module provides standardized singleton patterns that are used
 * throughout the codebase. It reduces boilerplate and ensures
 * consistent singleton management.
 */

/**
 * Type for a factory function that creates an instance
 */
export type Factory<T, TArgs extends unknown[] = []> = (...args: TArgs) => T;

/**
 * Type for a class constructor
 */
export type Constructor<T, TArgs extends unknown[] = []> = new (...args: TArgs) => T;

/**
 * Storage for singleton instances
 */
const singletonStorage = new Map<string | symbol, unknown>();

/**
 * Create a singleton getter function
 *
 * @param key - Unique key for this singleton
 * @param factory - Factory function to create the instance
 * @returns A function that returns the singleton instance
 *
 * @example
 * ```typescript
 * class MyService {
 *   constructor(config: Config) { ... }
 * }
 *
 * export const getMyService = createSingleton(
 *   'myService',
 *   (config?: Config) => new MyService(config ?? defaultConfig)
 * );
 *
 * // Usage:
 * const service = getMyService();
 * const serviceWithConfig = getMyService(customConfig); // Only used on first call
 * ```
 */
export function createSingleton<T, TArgs extends unknown[] = []>(
  key: string | symbol,
  factory: Factory<T, TArgs>
): (...args: TArgs) => T {
  return (...args: TArgs): T => {
    if (!singletonStorage.has(key)) {
      singletonStorage.set(key, factory(...args));
    }
    return singletonStorage.get(key) as T;
  };
}

/**
 * Create a singleton getter with reset capability
 *
 * @param key - Unique key for this singleton
 * @param factory - Factory function to create the instance
 * @returns Object with get and reset functions
 *
 * @example
 * ```typescript
 * const { get: getCache, reset: resetCache } = createResettableSingleton(
 *   'cache',
 *   () => new Cache()
 * );
 *
 * // Usage:
 * const cache = getCache();
 * resetCache(); // Clears the instance, next get() creates new one
 * ```
 */
export function createResettableSingleton<T, TArgs extends unknown[] = []>(
  key: string | symbol,
  factory: Factory<T, TArgs>
): {
  get: (...args: TArgs) => T;
  reset: () => void;
} {
  return {
    get: (...args: TArgs): T => {
      if (!singletonStorage.has(key)) {
        singletonStorage.set(key, factory(...args));
      }
      return singletonStorage.get(key) as T;
    },
    reset: (): void => {
      singletonStorage.delete(key);
    },
  };
}

/**
 * Create a lazy singleton that's only created when first accessed
 *
 * @param factory - Factory function to create the instance
 * @returns Object with value getter and reset function
 *
 * @example
 * ```typescript
 * const heavyService = createLazySingleton(() => new HeavyService());
 *
 * // Service not created yet
 * // ...
 * const service = heavyService.value; // Created now
 * ```
 */
export function createLazySingleton<T>(factory: () => T): {
  readonly value: T;
  reset: () => void;
} {
  let instance: T | undefined;
  let created = false;

  return {
    get value(): T {
      if (!created) {
        instance = factory();
        created = true;
      }
      return instance as T;
    },
    reset(): void {
      instance = undefined;
      created = false;
    },
  };
}

// Note: Decorator-based @Singleton pattern removed due to TypeScript strict mode
// constraints. Use moduleSingleton() or createSingleton() instead for type-safe
// singleton patterns.

/**
 * Clear all singleton instances (useful for testing)
 */
export function clearAllSingletons(): void {
  singletonStorage.clear();
}

/**
 * Check if a singleton exists
 *
 * @param key - Singleton key to check
 * @returns true if singleton instance exists
 */
export function hasSingleton(key: string | symbol): boolean {
  return singletonStorage.has(key);
}

/**
 * Get a singleton instance without creating it
 *
 * @param key - Singleton key
 * @returns The instance or undefined if not created
 */
export function peekSingleton<T>(key: string | symbol): T | undefined {
  return singletonStorage.get(key) as T | undefined;
}

// Note: SingletonMixin removed due to TypeScript strict mode constraints with
// class extension. Use moduleSingleton() or createSingleton() instead.

/**
 * Create a module-level singleton pattern (most common use case)
 *
 * This is the simplest pattern for creating a singleton at module level.
 *
 * @param factory - Factory function to create the instance
 * @returns Singleton manager object
 *
 * @example
 * ```typescript
 * // In myService.ts
 * class MyService {
 *   constructor(private config: Config) {}
 * }
 *
 * const { getInstance, resetInstance } = moduleSingleton(
 *   () => new MyService(loadConfig())
 * );
 *
 * export { getInstance as getMyService, resetInstance as resetMyService };
 * ```
 */
export function moduleSingleton<T>(factory: () => T): {
  getInstance: () => T;
  resetInstance: () => void;
  hasInstance: () => boolean;
} {
  let instance: T | null = null;

  return {
    getInstance(): T {
      if (instance === null) {
        instance = factory();
      }
      return instance;
    },
    resetInstance(): void {
      instance = null;
    },
    hasInstance(): boolean {
      return instance !== null;
    },
  };
}
