/**
 * Config Hot-Reload Module
 *
 * Provides automatic configuration reloading when files change.
 * Supports subsystem-specific reloaders and rollback on failure.
 */

import * as path from 'path';
import * as os from 'os';

// Types
export type {
  SubsystemId,
  ConfigChange,
  ConfigSnapshot,
  SubsystemReloader,
  ReloadResult,
  WatcherConfig,
  HotReloadEvents,
} from './types.js';

export {
  DEFAULT_WATCHER_CONFIG,
  HotReloadEmitter,
  SUBSYSTEM_PRIORITY,
  SUBSYSTEM_DEPENDENCIES,
} from './types.js';

// Diff utilities
export {
  hashConfig,
  createSnapshot,
  snapshotsEqual,
  diffConfigs,
  groupChangesBySubsystem,
  getAffectedSubsystems,
  getSubsystemForPath,
  mergeChanges,
  createPatch,
  createRollbackPatch,
} from './diff.js';

// Watcher
export {
  ConfigWatcher,
  getConfigWatcher,
  resetConfigWatcher,
} from './watcher.js';

// Reloader
export {
  registerReloader,
  unregisterReloader,
  reloadSubsystems,
  sortByPriority,
  getReloadOrder,
  hasAllReloaders,
  getMissingReloaders,
  createNoOpReloader,
  createSimpleReloader,
} from './reloader.js';

// ============================================================================
// Hot-Reload Manager
// ============================================================================

import type { SubsystemId, ConfigChange, ReloadResult, WatcherConfig } from './types.js';
import { HotReloadEmitter } from './types.js';
import { diffConfigs, getAffectedSubsystems } from './diff.js';
import { ConfigWatcher } from './watcher.js';
import { reloadSubsystems } from './reloader.js';

/**
 * Hot-reload manager configuration
 */
export interface HotReloadManagerConfig {
  /** Watcher configuration */
  watcher?: Partial<WatcherConfig>;
  /** Whether to auto-start watching */
  autoStart?: boolean;
  /** Whether to rollback on failure */
  rollbackOnFailure?: boolean;
  /** Whether to stop reloading on first error */
  stopOnFirstError?: boolean;
  /** Whether to reload in parallel */
  parallelReload?: boolean;
}

/**
 * Default hot-reload manager configuration
 */
export const DEFAULT_HOT_RELOAD_CONFIG: HotReloadManagerConfig = {
  autoStart: false,
  rollbackOnFailure: true,
  stopOnFirstError: false,
  parallelReload: false,
};

/**
 * Hot-reload manager
 *
 * Coordinates file watching, change detection, and subsystem reloading.
 */
export class HotReloadManager extends HotReloadEmitter {
  private config: HotReloadManagerConfig;
  private watcher: ConfigWatcher;
  private running = false;

  constructor(config: Partial<HotReloadManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_HOT_RELOAD_CONFIG, ...config };

    // Default paths to watch
    const defaultPaths = [
      path.join(os.homedir(), '.codebuddy', 'user-settings.json'),
      path.join(process.cwd(), '.codebuddy', 'settings.json'),
    ];

    this.watcher = new ConfigWatcher({
      paths: defaultPaths,
      ...this.config.watcher,
    });

    this.setupWatcherListeners();

    if (this.config.autoStart) {
      this.start().catch(err => this.emit('config:error', err as Error));
    }
  }

  /**
   * Setup listeners for watcher events
   */
  private setupWatcherListeners(): void {
    this.watcher.on('change', async (filePath, newSnapshot) => {
      const oldSnapshot = this.watcher.getSnapshot(filePath);

      if (!oldSnapshot) {
        // First load, no comparison needed
        return;
      }

      // Diff the configs
      const changes = diffConfigs(oldSnapshot, newSnapshot);

      if (changes.length === 0) {
        return;
      }

      this.emit('config:changed', changes);

      // Determine affected subsystems
      const subsystems = getAffectedSubsystems(changes);
      this.emit('config:reloading', subsystems);

      // Reload subsystems
      try {
        const results = await reloadSubsystems(changes, {
          rollbackOnFailure: this.config.rollbackOnFailure,
          stopOnFirstError: this.config.stopOnFirstError,
          parallel: this.config.parallelReload,
        });

        this.emit('config:reloaded', results);

        // Check for failures
        const failures = results.filter(r => !r.success);
        for (const failure of failures) {
          this.emit('config:error', new Error(failure.error || 'Reload failed'), failure.subsystem);
        }
      } catch (error) {
        this.emit('config:error', error as Error);
      }
    });

    this.watcher.on('error', (error) => {
      this.emit('config:error', error);
    });

    this.watcher.on('ready', () => {
      this.emit('watcher:started', this.watcher.getWatchedPaths());
    });
  }

  /**
   * Start watching for config changes
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    await this.watcher.start();
  }

  /**
   * Stop watching for config changes
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.watcher.stop();
    this.emit('watcher:stopped');
  }

  /**
   * Add a path to watch
   */
  async addPath(watchPath: string): Promise<void> {
    await this.watcher.addPath(watchPath);
  }

  /**
   * Remove a path from watching
   */
  removePath(watchPath: string): void {
    this.watcher.removePath(watchPath);
  }

  /**
   * Force reload all configs
   */
  async forceReload(): Promise<ReloadResult[]> {
    const changes: ConfigChange[] = [];
    const paths = this.watcher.getWatchedPaths();

    for (const watchPath of paths) {
      const snapshot = await this.watcher.reload(watchPath);
      if (snapshot) {
        // Create synthetic changes for all keys
        for (const [key, value] of Object.entries(snapshot.data)) {
          changes.push({
            subsystem: 'model', // Will be determined by getSubsystemForPath
            path: key,
            oldValue: undefined,
            newValue: value,
            timestamp: Date.now(),
          });
        }
      }
    }

    if (changes.length === 0) {
      return [];
    }

    return await reloadSubsystems(changes, {
      rollbackOnFailure: this.config.rollbackOnFailure,
      stopOnFirstError: this.config.stopOnFirstError,
      parallel: this.config.parallelReload,
    });
  }

  /**
   * Check if manager is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get watched paths
   */
  getWatchedPaths(): string[] {
    return this.watcher.getWatchedPaths();
  }
}

// Singleton instance
let managerInstance: HotReloadManager | null = null;

/**
 * Get the singleton hot-reload manager
 */
export function getHotReloadManager(config?: Partial<HotReloadManagerConfig>): HotReloadManager {
  if (!managerInstance) {
    managerInstance = new HotReloadManager(config);
  }
  return managerInstance;
}

/**
 * Reset the singleton hot-reload manager
 */
export function resetHotReloadManager(): void {
  if (managerInstance) {
    managerInstance.stop();
    managerInstance = null;
  }
}

/**
 * Convenience function to start hot-reload with default paths
 */
export async function startHotReload(config?: Partial<HotReloadManagerConfig>): Promise<HotReloadManager> {
  const manager = getHotReloadManager(config);
  await manager.start();
  return manager;
}

/**
 * Convenience function to stop hot-reload
 */
export function stopHotReload(): void {
  if (managerInstance) {
    managerInstance.stop();
  }
}
