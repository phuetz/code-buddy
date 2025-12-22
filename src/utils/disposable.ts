/**
 * Disposable interface and manager for proper resource cleanup
 *
 * This module provides a standardized way to manage lifecycle and cleanup
 * for singleton instances and other long-lived resources.
 */

import { logger } from './logger.js';

/**
 * Interface for objects that need cleanup
 */
export interface Disposable {
  /**
   * Clean up resources, close connections, remove listeners, etc.
   */
  dispose(): void | Promise<void>;
}

/**
 * Manager to track all disposable resources
 */
export class DisposableManager {
  private static instance: DisposableManager;
  private disposables: Set<Disposable> = new Set();
  private disposed: boolean = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): DisposableManager {
    if (!DisposableManager.instance) {
      DisposableManager.instance = new DisposableManager();
    }
    return DisposableManager.instance;
  }

  /**
   * Register a disposable resource
   */
  register(disposable: Disposable): void {
    if (this.disposed) {
      logger.warn('DisposableManager: Cannot register after disposal');
      return;
    }
    this.disposables.add(disposable);
  }

  /**
   * Unregister a disposable resource
   */
  unregister(disposable: Disposable): void {
    this.disposables.delete(disposable);
  }

  /**
   * Dispose all registered resources
   * Resources are disposed in reverse order of registration (LIFO)
   */
  async disposeAll(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    // Convert to array and reverse for LIFO disposal
    const disposables = Array.from(this.disposables).reverse();

    for (const disposable of disposables) {
      try {
        const result = disposable.dispose();
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        logger.error('Error disposing resource', { error });
      }
    }

    this.disposables.clear();
  }

  /**
   * Check if manager has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Get count of registered disposables
   */
  getCount(): number {
    return this.disposables.size;
  }

  /**
   * Reset the manager (primarily for testing)
   */
  reset(): void {
    this.disposables.clear();
    this.disposed = false;
  }
}

/**
 * Register a disposable resource with the global DisposableManager
 */
export function registerDisposable(disposable: Disposable): void {
  DisposableManager.getInstance().register(disposable);
}

/**
 * Unregister a disposable resource from the global DisposableManager
 */
export function unregisterDisposable(disposable: Disposable): void {
  DisposableManager.getInstance().unregister(disposable);
}

/**
 * Dispose all registered resources
 */
export async function disposeAll(): Promise<void> {
  await DisposableManager.getInstance().disposeAll();
}

/**
 * Get the global DisposableManager instance
 */
export function getDisposableManager(): DisposableManager {
  return DisposableManager.getInstance();
}
