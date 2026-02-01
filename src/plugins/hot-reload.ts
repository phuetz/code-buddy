/**
 * Plugin Hot Reload System
 *
 * Provides file watching and hot reloading capabilities for plugins.
 * Allows developers to see changes immediately without restarting.
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { PluginMetadata, PluginManifest } from './types.js';

/**
 * Hot reload configuration
 */
export interface HotReloadConfig {
  /** Enable hot reloading */
  enabled: boolean;
  /** Debounce delay in ms */
  debounceMs: number;
  /** File patterns to watch */
  watchPatterns: string[];
  /** File patterns to ignore */
  ignorePatterns: string[];
  /** Reload on manifest change */
  reloadOnManifestChange: boolean;
  /** Reload on source change */
  reloadOnSourceChange: boolean;
  /** Show notifications on reload */
  showNotifications: boolean;
}

/**
 * Default hot reload configuration
 */
export const DEFAULT_HOT_RELOAD_CONFIG: HotReloadConfig = {
  enabled: true,
  debounceMs: 300,
  watchPatterns: ['**/*.js', '**/*.ts', '**/*.json'],
  ignorePatterns: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
  reloadOnManifestChange: true,
  reloadOnSourceChange: true,
  showNotifications: true,
};

/**
 * Reload event data
 */
export interface ReloadEvent {
  pluginId: string;
  pluginPath: string;
  changedFile: string;
  changeType: 'add' | 'change' | 'unlink';
  timestamp: Date;
}

/**
 * Watched plugin entry
 */
interface WatchedPlugin {
  id: string;
  path: string;
  watcher: fs.FSWatcher;
  manifest: PluginManifest;
  lastReload: Date;
  pendingReload: NodeJS.Timeout | null;
}

/**
 * Plugin Hot Reloader
 *
 * Watches plugin directories for changes and triggers reloads.
 */
export class PluginHotReloader extends EventEmitter {
  private config: HotReloadConfig;
  private watchedPlugins: Map<string, WatchedPlugin> = new Map();
  private reloadCallback: ((pluginId: string) => Promise<void>) | null = null;

  constructor(config: Partial<HotReloadConfig> = {}) {
    super();
    this.config = { ...DEFAULT_HOT_RELOAD_CONFIG, ...config };
  }

  /**
   * Set the reload callback function
   */
  onReload(callback: (pluginId: string) => Promise<void>): void {
    this.reloadCallback = callback;
  }

  /**
   * Start watching a plugin directory
   */
  watch(pluginId: string, pluginPath: string, manifest: PluginManifest): void {
    if (!this.config.enabled) return;

    // Stop existing watcher if any
    this.unwatch(pluginId);

    try {
      const watcher = fs.watch(
        pluginPath,
        { recursive: true },
        (eventType, filename) => {
          if (filename) {
            this.handleFileChange(pluginId, pluginPath, filename, eventType);
          }
        }
      );

      watcher.on('error', (error) => {
        this.emit('error', { pluginId, error });
      });

      this.watchedPlugins.set(pluginId, {
        id: pluginId,
        path: pluginPath,
        watcher,
        manifest,
        lastReload: new Date(),
        pendingReload: null,
      });

      this.emit('watching', { pluginId, pluginPath });
    } catch (error) {
      this.emit('error', { pluginId, error });
    }
  }

  /**
   * Stop watching a plugin
   */
  unwatch(pluginId: string): void {
    const watched = this.watchedPlugins.get(pluginId);
    if (watched) {
      if (watched.pendingReload) {
        clearTimeout(watched.pendingReload);
      }
      watched.watcher.close();
      this.watchedPlugins.delete(pluginId);
      this.emit('unwatched', { pluginId });
    }
  }

  /**
   * Stop watching all plugins
   */
  unwatchAll(): void {
    for (const pluginId of this.watchedPlugins.keys()) {
      this.unwatch(pluginId);
    }
  }

  /**
   * Handle file change event
   */
  private handleFileChange(
    pluginId: string,
    pluginPath: string,
    filename: string,
    eventType: string
  ): void {
    const watched = this.watchedPlugins.get(pluginId);
    if (!watched) return;

    // Check if file should be ignored
    if (this.shouldIgnore(filename)) return;

    // Check if file matches watch patterns
    if (!this.shouldWatch(filename)) return;

    const changedFile = path.join(pluginPath, filename);
    const changeType = eventType === 'rename'
      ? (fs.existsSync(changedFile) ? 'add' : 'unlink')
      : 'change';

    // Check reload conditions
    const isManifest = filename === 'manifest.json' || filename === 'package.json';
    if (isManifest && !this.config.reloadOnManifestChange) return;
    if (!isManifest && !this.config.reloadOnSourceChange) return;

    // Debounce reload
    if (watched.pendingReload) {
      clearTimeout(watched.pendingReload);
    }

    watched.pendingReload = setTimeout(() => {
      this.triggerReload(pluginId, changedFile, changeType);
    }, this.config.debounceMs);
  }

  /**
   * Trigger a plugin reload
   */
  private async triggerReload(
    pluginId: string,
    changedFile: string,
    changeType: 'add' | 'change' | 'unlink'
  ): Promise<void> {
    const watched = this.watchedPlugins.get(pluginId);
    if (!watched) return;

    watched.pendingReload = null;

    const event: ReloadEvent = {
      pluginId,
      pluginPath: watched.path,
      changedFile,
      changeType,
      timestamp: new Date(),
    };

    this.emit('reload-start', event);

    try {
      // Call the reload callback
      if (this.reloadCallback) {
        await this.reloadCallback(pluginId);
      }

      watched.lastReload = new Date();
      this.emit('reload-complete', event);

      if (this.config.showNotifications) {
        this.emit('notification', {
          type: 'success',
          message: `Plugin ${pluginId} reloaded`,
          file: changedFile,
        });
      }
    } catch (error) {
      this.emit('reload-error', { ...event, error });

      if (this.config.showNotifications) {
        this.emit('notification', {
          type: 'error',
          message: `Failed to reload plugin ${pluginId}`,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Check if a file should be ignored
   */
  private shouldIgnore(filename: string): boolean {
    for (const pattern of this.config.ignorePatterns) {
      if (this.matchPattern(filename, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a file matches watch patterns
   */
  private shouldWatch(filename: string): boolean {
    for (const pattern of this.config.watchPatterns) {
      if (this.matchPattern(filename, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob pattern matching
   */
  private matchPattern(filename: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/\./g, '\\.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filename) || regex.test(path.basename(filename));
  }

  /**
   * Get list of watched plugins
   */
  getWatchedPlugins(): string[] {
    return Array.from(this.watchedPlugins.keys());
  }

  /**
   * Check if a plugin is being watched
   */
  isWatching(pluginId: string): boolean {
    return this.watchedPlugins.has(pluginId);
  }

  /**
   * Get watch status for a plugin
   */
  getWatchStatus(pluginId: string): {
    watching: boolean;
    lastReload?: Date;
    path?: string;
  } {
    const watched = this.watchedPlugins.get(pluginId);
    if (!watched) {
      return { watching: false };
    }
    return {
      watching: true,
      lastReload: watched.lastReload,
      path: watched.path,
    };
  }

  /**
   * Force reload a plugin
   */
  async forceReload(pluginId: string): Promise<void> {
    const watched = this.watchedPlugins.get(pluginId);
    if (watched) {
      await this.triggerReload(pluginId, watched.path, 'change');
    } else if (this.reloadCallback) {
      await this.reloadCallback(pluginId);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HotReloadConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): HotReloadConfig {
    return { ...this.config };
  }

  /**
   * Shutdown the hot reloader
   */
  shutdown(): void {
    this.unwatchAll();
    this.removeAllListeners();
  }
}

// Singleton instance
let hotReloaderInstance: PluginHotReloader | null = null;

/**
 * Get hot reloader instance
 */
export function getPluginHotReloader(
  config?: Partial<HotReloadConfig>
): PluginHotReloader {
  if (!hotReloaderInstance) {
    hotReloaderInstance = new PluginHotReloader(config);
  }
  return hotReloaderInstance;
}

/**
 * Reset hot reloader
 */
export function resetPluginHotReloader(): void {
  if (hotReloaderInstance) {
    hotReloaderInstance.shutdown();
    hotReloaderInstance = null;
  }
}

export default PluginHotReloader;
