/**
 * Graceful Shutdown Manager
 *
 * Provides clean application shutdown with:
 * - Session state preservation
 * - Pending operation completion (waits for in-progress operations)
 * - Connection cleanup (MCP, Database)
 * - Log flushing
 * - Configurable timeout (default 30s) before force exit
 *
 * Intercepts signals: SIGINT (Ctrl+C), SIGTERM (kill), SIGHUP (terminal closed)
 */

import { logger, getLogger } from './logger.js';
import { DisposableManager, registerDisposable, type Disposable } from './disposable.js';

export interface ShutdownOptions {
  /** Maximum time to wait for shutdown in milliseconds (default: 30000) */
  timeoutMs: number;
  /** Whether to force exit after timeout (default: true) */
  forceExitOnTimeout: boolean;
  /** Custom exit code (default: 0 for graceful, 1 for timeout) */
  exitCode?: number;
  /** Show progress during shutdown (default: true) */
  showProgress: boolean;
}

export interface ShutdownHandler {
  /** Name for logging purposes */
  name: string;
  /** Priority (higher = runs first, default: 0) */
  priority: number;
  /** The shutdown handler function */
  handler: () => void | Promise<void>;
}

const DEFAULT_OPTIONS: ShutdownOptions = {
  timeoutMs: 30000, // 30 seconds max before force exit
  forceExitOnTimeout: true,
  showProgress: true,
};

/**
 * Graceful Shutdown Manager
 *
 * Coordinates clean shutdown of all application components
 */
export class GracefulShutdownManager implements Disposable {
  private static instance: GracefulShutdownManager | null = null;
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private options: ShutdownOptions;
  private signalsRegistered = false;
  private pendingOperations: Map<string, { description: string; startTime: number }> = new Map();
  private completedHandlers: Set<string> = new Set();

  private constructor(options: Partial<ShutdownOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get singleton instance
   */
  static getInstance(options?: Partial<ShutdownOptions>): GracefulShutdownManager {
    if (!GracefulShutdownManager.instance) {
      GracefulShutdownManager.instance = new GracefulShutdownManager(options);
      // Register self as disposable for cleanup
      registerDisposable(GracefulShutdownManager.instance);
    }
    return GracefulShutdownManager.instance;
  }

  /**
   * Register process signal handlers
   */
  registerSignalHandlers(): void {
    if (this.signalsRegistered) {
      return;
    }

    // SIGINT: Ctrl+C
    process.on('SIGINT', () => this.handleSignal('SIGINT'));

    // SIGTERM: Kill command
    process.on('SIGTERM', () => this.handleSignal('SIGTERM'));

    // SIGHUP: Terminal closed
    process.on('SIGHUP', () => this.handleSignal('SIGHUP'));

    this.signalsRegistered = true;
    logger.debug('Signal handlers registered for graceful shutdown');
  }

  /**
   * Handle incoming signal
   */
  private async handleSignal(signal: string): Promise<void> {
    logger.info(`Received ${signal}, initiating graceful shutdown...`);

    // Show user-friendly message
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    try {
      await this.shutdown({ exitCode: 0 });
    } catch (error) {
      logger.error('Error during shutdown', error instanceof Error ? error : new Error(String(error)));
      process.exit(1);
    }
  }

  /**
   * Register a shutdown handler
   */
  registerHandler(handler: ShutdownHandler): void {
    this.handlers.push(handler);
    // Sort by priority (higher first)
    this.handlers.sort((a, b) => b.priority - a.priority);
    logger.debug(`Registered shutdown handler: ${handler.name} (priority: ${handler.priority})`);
  }

  /**
   * Unregister a shutdown handler by name
   */
  unregisterHandler(name: string): boolean {
    const index = this.handlers.findIndex(h => h.name === name);
    if (index !== -1) {
      this.handlers.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Track a pending operation (blocks shutdown until complete)
   * Returns a function to mark the operation as complete
   */
  trackOperation(id: string, description: string): () => void {
    this.pendingOperations.set(id, {
      description,
      startTime: Date.now(),
    });
    logger.debug(`Tracking operation: ${id} - ${description}`);

    return () => {
      this.pendingOperations.delete(id);
      logger.debug(`Operation completed: ${id}`);
    };
  }

  /**
   * Check if there are pending operations
   */
  hasPendingOperations(): boolean {
    return this.pendingOperations.size > 0;
  }

  /**
   * Get list of pending operations
   */
  getPendingOperations(): Array<{ id: string; description: string; duration: number }> {
    const now = Date.now();
    return Array.from(this.pendingOperations.entries()).map(([id, op]) => ({
      id,
      description: op.description,
      duration: now - op.startTime,
    }));
  }

  /**
   * Execute shutdown with timeout
   */
  async shutdown(overrideOptions?: Partial<ShutdownOptions>): Promise<void> {
    // Prevent multiple concurrent shutdowns
    if (this.isShuttingDown) {
      logger.debug('Shutdown already in progress, waiting...');
      return this.shutdownPromise!;
    }

    this.isShuttingDown = true;
    const options = { ...this.options, ...overrideOptions };

    this.shutdownPromise = this.executeShutdown(options);
    return this.shutdownPromise;
  }

  /**
   * Execute the actual shutdown sequence
   */
  private async executeShutdown(options: ShutdownOptions): Promise<void> {
    const startTime = Date.now();
    this.completedHandlers.clear();

    logger.info('Starting graceful shutdown sequence...', {
      handlerCount: this.handlers.length,
      pendingOperations: this.pendingOperations.size,
      timeoutMs: options.timeoutMs,
    });

    // Wait for pending operations first (with partial timeout)
    const operationTimeout = Math.min(options.timeoutMs / 3, 10000); // Max 10s for operations
    if (this.pendingOperations.size > 0) {
      if (options.showProgress) {
        logger.info(`Waiting for ${this.pendingOperations.size} pending operation(s)...`);
        this.getPendingOperations().forEach(op => {
          logger.info(`  - ${op.description} (${Math.round(op.duration / 1000)}s)`);
        });
      }

      await this.waitForPendingOperations(operationTimeout);
    }

    // Create timeout promise for handlers
    const remainingTime = options.timeoutMs - (Date.now() - startTime);
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), Math.max(remainingTime, 1000));
    });

    // Create shutdown work promise
    const shutdownWork = this.runShutdownHandlers(options.showProgress);

    // Race between shutdown and timeout
    const result = await Promise.race([
      shutdownWork.then(() => 'completed' as const),
      timeoutPromise,
    ]);

    const elapsed = Date.now() - startTime;

    if (result === 'timeout') {
      const pendingOps = this.getPendingOperations();
      const pendingHandlers = this.handlers.filter(h => !this.completedHandlers.has(h.name));

      logger.warn(`Shutdown timed out after ${options.timeoutMs}ms`, {
        completedHandlers: this.completedHandlers.size,
        totalHandlers: this.handlers.length,
        pendingOperations: pendingOps.length,
      });

      logger.warn(`Shutdown timed out after ${options.timeoutMs / 1000}s. Forcing exit...`);

      if (pendingOps.length > 0) {
        logger.warn('Pending operations that were interrupted:');
        pendingOps.forEach(op => logger.warn(`  - ${op.description}`));
      }

      if (pendingHandlers.length > 0) {
        logger.warn('Handlers that did not complete:');
        pendingHandlers.forEach(h => logger.warn(`  - ${h.name}`));
      }

      if (options.forceExitOnTimeout) {
        process.exit(options.exitCode ?? 1);
      }
    } else {
      logger.info(`Graceful shutdown completed in ${elapsed}ms`);

      if (options.showProgress) {
        logger.info(`Shutdown completed in ${elapsed}ms.`);
      }

      // Flush logs before exit
      await this.flushLogs();

      process.exit(options.exitCode ?? 0);
    }
  }

  /**
   * Wait for pending operations to complete
   */
  private async waitForPendingOperations(timeoutMs: number): Promise<void> {
    const startTime = Date.now();

    while (this.pendingOperations.size > 0) {
      if (Date.now() - startTime > timeoutMs) {
        logger.warn('Timeout waiting for pending operations', {
          remaining: this.pendingOperations.size,
        });
        break;
      }

      // Wait a bit and check again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Run all shutdown handlers in priority order
   */
  private async runShutdownHandlers(showProgress: boolean = false): Promise<void> {
    // First, run custom handlers
    for (const handler of this.handlers) {
      try {
        if (showProgress) {
          process.stdout.write(`  [shutdown] ${handler.name}...`);
        }
        logger.debug(`Running shutdown handler: ${handler.name}`);

        const result = handler.handler();
        if (result instanceof Promise) {
          await result;
        }

        this.completedHandlers.add(handler.name);

        if (showProgress) {
          process.stdout.write(' done\n');
        }
        logger.debug(`Completed shutdown handler: ${handler.name}`);
      } catch (error) {
        this.completedHandlers.add(handler.name); // Mark as completed even on error
        if (showProgress) {
          process.stdout.write(' failed\n');
        }
        logger.error(`Error in shutdown handler ${handler.name}:`, error instanceof Error ? error : new Error(String(error)));
        // Continue with other handlers even if one fails
      }
    }

    // Then, dispose all registered disposables
    try {
      if (showProgress) {
        process.stdout.write('  [shutdown] disposing resources...');
      }
      logger.debug('Disposing all registered resources...');
      await DisposableManager.getInstance().disposeAll();
      if (showProgress) {
        process.stdout.write(' done\n');
      }
      logger.debug('All resources disposed');
    } catch (error) {
      if (showProgress) {
        process.stdout.write(' failed\n');
      }
      logger.error('Error disposing resources:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Flush all pending logs
   */
  private async flushLogs(): Promise<void> {
    try {
      const loggerInstance = getLogger();
      loggerInstance.close();
    } catch {
      // Ignore errors during log flushing
    }
  }

  /**
   * Check if shutdown is in progress
   */
  isInShutdown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Implement Disposable interface
   */
  dispose(): void {
    // Cleanup if needed
    this.handlers = [];
    GracefulShutdownManager.instance = null;
  }

  /**
   * Reset the singleton (for testing)
   */
  static reset(): void {
    if (GracefulShutdownManager.instance) {
      GracefulShutdownManager.instance.handlers = [];
      GracefulShutdownManager.instance.isShuttingDown = false;
      GracefulShutdownManager.instance.shutdownPromise = null;
    }
    GracefulShutdownManager.instance = null;
  }
}

/**
 * Get the global shutdown manager instance
 */
export function getShutdownManager(options?: Partial<ShutdownOptions>): GracefulShutdownManager {
  return GracefulShutdownManager.getInstance(options);
}

/**
 * Register a shutdown handler with the global manager
 */
export function onShutdown(
  name: string,
  handler: () => void | Promise<void>,
  priority: number = 0
): void {
  getShutdownManager().registerHandler({ name, handler, priority });
}

/**
 * Initiate graceful shutdown
 */
export async function initiateShutdown(options?: Partial<ShutdownOptions>): Promise<void> {
  return getShutdownManager().shutdown(options);
}

/**
 * Track a pending operation that should complete before shutdown
 * Returns a function to mark the operation as complete
 *
 * @example
 * const done = trackOperation('file-save', 'Saving file...');
 * try {
 *   await saveFile();
 * } finally {
 *   done();
 * }
 */
export function trackOperation(id: string, description: string): () => void {
  return getShutdownManager().trackOperation(id, description);
}

/**
 * Check if shutdown is in progress
 */
export function isShuttingDown(): boolean {
  return getShutdownManager().isInShutdown();
}

/**
 * Register default handlers for common resources
 */
export function registerDefaultShutdownHandlers(): void {
  const manager = getShutdownManager();

  // Session save handler (highest priority)
  manager.registerHandler({
    name: 'session-save',
    priority: 100,
    handler: async () => {
      try {
        // Dynamically import to avoid circular dependencies
        const { getSessionStore } = await import('../persistence/session-store.js');
        const sessionStore = getSessionStore();
        const currentSession = await sessionStore.getCurrentSession();

        if (currentSession) {
          await sessionStore.saveSession(currentSession);
          logger.info(`Session saved: ${currentSession.id}`);
        }
      } catch (error) {
        logger.warn('Failed to save session during shutdown', { error: String(error) });
      }
    },
  });

  // Crash handler terminal restore (high priority)
  manager.registerHandler({
    name: 'terminal-restore',
    priority: 90,
    handler: async () => {
      try {
        const { getCrashHandler } = await import('../errors/crash-handler.js');
        getCrashHandler().restoreTerminal();
      } catch {
        // Ignore errors
      }
    },
  });

  // MCP connection cleanup (medium priority)
  manager.registerHandler({
    name: 'mcp-cleanup',
    priority: 50,
    handler: async () => {
      try {
        const { getMCPClient } = await import('../mcp/mcp-client.js');
        const client = getMCPClient();
        if (client) {
          await client.dispose();
          logger.debug('MCP connections closed');
        }
      } catch {
        // MCP client may not be initialized
      }
    },
  });

  // Database cleanup (medium priority)
  manager.registerHandler({
    name: 'database-cleanup',
    priority: 40,
    handler: async () => {
      try {
        const { getDatabaseManager } = await import('../database/database-manager.js');
        const db = getDatabaseManager();
        if (db) {
          db.close();
          logger.debug('Database connections closed');
        }
      } catch {
        // Database may not be initialized
      }
    },
  });

  // Log flush (lowest priority - should be last)
  manager.registerHandler({
    name: 'log-flush',
    priority: -100,
    handler: () => {
      const loggerInstance = getLogger();
      loggerInstance.close();
    },
  });

  logger.debug('Default shutdown handlers registered');
}

/**
 * Initialize graceful shutdown system
 * Call this early in application startup
 */
export function initializeGracefulShutdown(options?: Partial<ShutdownOptions>): GracefulShutdownManager {
  const manager = getShutdownManager(options);
  manager.registerSignalHandlers();
  registerDefaultShutdownHandlers();
  return manager;
}
