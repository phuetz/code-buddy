/**
 * Config File Watcher
 *
 * Watches configuration files for changes and emits events
 * when modifications are detected.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import type { WatcherConfig, ConfigSnapshot } from './types.js';
import { DEFAULT_WATCHER_CONFIG } from './types.js';
import { createSnapshot, hashConfig } from './diff.js';

/**
 * Debounce function for file path changes
 */
function debounceFilePath(
  fn: (path: string) => void,
  delay: number
): { call: (path: string) => void; cancel: () => void } {
  let timeoutId: NodeJS.Timeout | null = null;

  return {
    call: (filePath: string) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        fn(filePath);
        timeoutId = null;
      }, delay);
    },
    cancel: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}

/**
 * Check if a path matches any ignore pattern
 */
function matchesIgnorePattern(filePath: string, patterns: string[]): boolean {
  const fileName = path.basename(filePath);

  for (const pattern of patterns) {
    // Simple glob matching
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      if (fileName.endsWith(ext)) return true;
    } else if (pattern.endsWith('/**')) {
      const dir = pattern.slice(0, -3);
      if (filePath.includes(dir)) return true;
    } else if (pattern === fileName) {
      return true;
    }
  }

  return false;
}

/**
 * Config file watcher events
 */
export interface WatcherEvents {
  'change': (filePath: string, snapshot: ConfigSnapshot) => void;
  'error': (error: Error) => void;
  'ready': () => void;
}

/**
 * Config file watcher
 */
export class ConfigWatcher extends EventEmitter {
  private config: WatcherConfig;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private snapshots: Map<string, ConfigSnapshot> = new Map();
  private debouncedHandlers: Map<string, { call: (filePath: string) => void; cancel: () => void }> = new Map();
  private running = false;

  constructor(config: Partial<WatcherConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WATCHER_CONFIG, ...config };
  }

  /**
   * Start watching files
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    for (const watchPath of this.config.paths) {
      await this.watchPath(watchPath);
    }

    this.emit('ready');
  }

  /**
   * Stop watching files
   */
  stop(): void {
    this.running = false;

    // Cancel all debounced handlers
    for (const handler of this.debouncedHandlers.values()) {
      handler.cancel();
    }
    this.debouncedHandlers.clear();

    // Close all watchers
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    // Clear snapshots
    this.snapshots.clear();
  }

  /**
   * Add a path to watch
   */
  async addPath(watchPath: string): Promise<void> {
    if (!this.config.paths.includes(watchPath)) {
      this.config.paths.push(watchPath);
    }

    if (this.running) {
      await this.watchPath(watchPath);
    }
  }

  /**
   * Remove a path from watching
   */
  removePath(watchPath: string): void {
    const index = this.config.paths.indexOf(watchPath);
    if (index >= 0) {
      this.config.paths.splice(index, 1);
    }

    const watcher = this.watchers.get(watchPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(watchPath);
    }

    const handler = this.debouncedHandlers.get(watchPath);
    if (handler) {
      handler.cancel();
      this.debouncedHandlers.delete(watchPath);
    }

    this.snapshots.delete(watchPath);
  }

  /**
   * Get current snapshot for a path
   */
  getSnapshot(filePath: string): ConfigSnapshot | undefined {
    return this.snapshots.get(filePath);
  }

  /**
   * Force reload a file
   */
  async reload(filePath: string): Promise<ConfigSnapshot | null> {
    return await this.loadAndSnapshot(filePath);
  }

  /**
   * Watch a specific path
   */
  private async watchPath(watchPath: string): Promise<void> {
    try {
      const resolvedPath = path.resolve(watchPath);

      // Check if path exists
      if (!fs.existsSync(resolvedPath)) {
        // Watch parent directory for file creation
        const parentDir = path.dirname(resolvedPath);
        if (fs.existsSync(parentDir)) {
          this.watchDirectory(parentDir, resolvedPath);
        }
        return;
      }

      const stat = fs.statSync(resolvedPath);

      if (stat.isDirectory()) {
        this.watchDirectory(resolvedPath);
      } else {
        await this.watchFile(resolvedPath);
      }
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  /**
   * Watch a directory
   */
  private watchDirectory(dirPath: string, targetFile?: string): void {
    if (this.watchers.has(dirPath)) {
      return;
    }

    try {
      const watcher = fs.watch(
        dirPath,
        { recursive: this.config.recursive },
        (eventType, filename) => {
          if (!filename) return;

          const fullPath = path.join(dirPath, filename);

          // If watching for a specific file, check if it matches
          if (targetFile && fullPath !== targetFile) {
            return;
          }

          // Check ignore patterns
          if (matchesIgnorePattern(fullPath, this.config.ignorePatterns)) {
            return;
          }

          // Only process JSON files
          if (!filename.endsWith('.json')) {
            return;
          }

          this.handleChange(fullPath);
        }
      );

      this.watchers.set(dirPath, watcher);
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  /**
   * Watch a specific file
   */
  private async watchFile(filePath: string): Promise<void> {
    if (this.watchers.has(filePath)) {
      return;
    }

    // Load initial snapshot
    await this.loadAndSnapshot(filePath);

    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          this.handleChange(filePath);
        }
      });

      this.watchers.set(filePath, watcher);
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  /**
   * Handle a file change event
   */
  private handleChange(filePath: string): void {
    // Get or create debounced handler for this file
    let handler = this.debouncedHandlers.get(filePath);
    if (!handler) {
      handler = debounceFilePath(
        (p: string) => this.processChange(p),
        this.config.debounceMs
      );
      this.debouncedHandlers.set(filePath, handler);
    }

    handler.call(filePath);
  }

  /**
   * Process a file change after debouncing
   */
  private async processChange(filePath: string): Promise<void> {
    const oldSnapshot = this.snapshots.get(filePath);
    const newSnapshot = await this.loadAndSnapshot(filePath);

    if (!newSnapshot) {
      return;
    }

    // Check if content actually changed
    if (oldSnapshot && oldSnapshot.hash === newSnapshot.hash) {
      return;
    }

    this.emit('change', filePath, newSnapshot);
  }

  /**
   * Load a file and create a snapshot
   */
  private async loadAndSnapshot(filePath: string): Promise<ConfigSnapshot | null> {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as Record<string, unknown>;
      const snapshot = createSnapshot(data);

      this.snapshots.set(filePath, snapshot);
      return snapshot;
    } catch (error) {
      this.emit('error', error as Error);
      return null;
    }
  }

  /**
   * Get watched paths
   */
  getWatchedPaths(): string[] {
    return [...this.config.paths];
  }

  /**
   * Check if watcher is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

// Singleton instance
let watcherInstance: ConfigWatcher | null = null;

/**
 * Get the singleton config watcher
 */
export function getConfigWatcher(config?: Partial<WatcherConfig>): ConfigWatcher {
  if (!watcherInstance) {
    watcherInstance = new ConfigWatcher(config);
  }
  return watcherInstance;
}

/**
 * Reset the singleton watcher
 */
export function resetConfigWatcher(): void {
  if (watcherInstance) {
    watcherInstance.stop();
    watcherInstance = null;
  }
}
