/**
 * Persistent Queue Implementation
 *
 * Extends the priority queue with file-based persistence.
 * Survives process restarts and provides recovery capabilities.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PriorityQueue, PriorityItem, PriorityQueueOptions, PriorityLevel } from './priority-queue.js';
import { logger } from '../utils/logger.js';

export interface PersistentQueueOptions extends PriorityQueueOptions {
  /** Directory to store queue data */
  storageDir?: string;
  /** Filename for queue persistence */
  filename?: string;
  /** Whether to auto-save on every operation */
  autoSave?: boolean;
  /** Save interval in ms (if not auto-saving every operation) */
  saveInterval?: number;
  /** Whether to compress stored data */
  compress?: boolean;
}

export interface SerializedQueue<T> {
  version: number;
  createdAt: string;
  lastSavedAt: string;
  items: SerializedQueueItem<T>[];
  stats: {
    processed: number;
    failed: number;
  };
}

export interface SerializedQueueItem<T> {
  id: string;
  data: T;
  enqueuedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  priority: PriorityLevel;
  priorityValue: number;
  metadata?: Record<string, unknown>;
}

const DEFAULT_PERSISTENT_OPTIONS: PersistentQueueOptions = {
  maxSize: 1000,
  maxRetries: 3,
  retryDelay: 1000,
  autoProcess: false,
  concurrency: 1,
  defaultPriority: 'normal',
  fairScheduling: false,
  maxWaitTime: 60000,
  storageDir: path.join(os.homedir(), '.codebuddy', 'queues'),
  filename: 'queue.json',
  autoSave: true,
  saveInterval: 5000,
  compress: false,
};

const QUEUE_VERSION = 1;

/**
 * Persistent Priority Queue
 */
export class PersistentQueue<T = unknown> extends PriorityQueue<T> {
  protected persistOptions: Required<PersistentQueueOptions>;
  protected storageFilePath: string;
  protected saveTimer?: NodeJS.Timeout;
  protected dirty: boolean = false;
  protected initialized: boolean = false;

  constructor(options: PersistentQueueOptions = {}) {
    super(options);

    this.persistOptions = {
      ...DEFAULT_PERSISTENT_OPTIONS,
      ...options,
    } as Required<PersistentQueueOptions>;

    this.storageFilePath = path.join(
      this.persistOptions.storageDir,
      this.persistOptions.filename
    );

    this.ensureStorageDir();
    this.load();
    this.startAutoSave();
    this.initialized = true;
  }

  /**
   * Ensure storage directory exists
   */
  protected ensureStorageDir(): void {
    if (!fs.existsSync(this.persistOptions.storageDir)) {
      fs.mkdirSync(this.persistOptions.storageDir, { recursive: true });
    }
  }

  /**
   * Load queue from disk
   */
  load(): boolean {
    try {
      if (!fs.existsSync(this.storageFilePath)) {
        return false;
      }

      const content = fs.readFileSync(this.storageFilePath, 'utf-8');
      const data: SerializedQueue<T> = JSON.parse(content);

      if (data.version !== QUEUE_VERSION) {
        // Handle migration in future if needed
        logger.warn(`Queue version mismatch: expected ${QUEUE_VERSION}, got ${data.version}`);
      }

      // Restore items
      this.items = data.items.map(item => ({
        id: item.id,
        data: item.data,
        enqueuedAt: new Date(item.enqueuedAt),
        attempts: item.attempts,
        lastAttemptAt: item.lastAttemptAt ? new Date(item.lastAttemptAt) : undefined,
        priority: item.priority,
        priorityValue: item.priorityValue,
        metadata: item.metadata,
      }));

      // Restore stats
      this.processedCount = data.stats.processed;
      this.failedCount = data.stats.failed;

      this.emit('loaded', { itemCount: this.items.length });
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('load-error', err);
      return false;
    }
  }

  /**
   * Save queue to disk
   */
  save(): boolean {
    try {
      const data: SerializedQueue<T> = {
        version: QUEUE_VERSION,
        createdAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
        items: this.items.map(item => ({
          id: item.id,
          data: item.data,
          enqueuedAt: item.enqueuedAt.toISOString(),
          attempts: item.attempts,
          lastAttemptAt: item.lastAttemptAt?.toISOString(),
          priority: item.priority,
          priorityValue: item.priorityValue,
          metadata: item.metadata,
        })),
        stats: {
          processed: this.processedCount,
          failed: this.failedCount,
        },
      };

      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(this.storageFilePath, content);

      this.dirty = false;
      this.emit('saved', { itemCount: this.items.length });
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('save-error', err);
      return false;
    }
  }

  /**
   * Start auto-save timer
   */
  protected startAutoSave(): void {
    if (this.persistOptions.saveInterval > 0 && !this.persistOptions.autoSave) {
      this.saveTimer = setInterval(() => {
        if (this.dirty) {
          this.save();
        }
      }, this.persistOptions.saveInterval);
    }
  }

  /**
   * Stop auto-save timer
   */
  protected stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = undefined;
    }
  }

  /**
   * Mark queue as dirty (needs saving)
   */
  protected markDirty(): void {
    this.dirty = true;

    if (this.persistOptions.autoSave && this.initialized) {
      this.save();
    }
  }

  /**
   * Override enqueue to persist
   */
  override enqueuePriority(
    data: T,
    priority?: PriorityLevel,
    metadata?: Record<string, unknown>
  ): PriorityItem<T> | null {
    const item = super.enqueuePriority(data, priority, metadata);

    if (item) {
      this.markDirty();
    }

    return item;
  }

  /**
   * Override dequeue to persist
   */
  override dequeue(): PriorityItem<T> | undefined {
    const item = super.dequeue() as PriorityItem<T> | undefined;

    if (item) {
      this.markDirty();
    }

    return item;
  }

  /**
   * Override removeById to persist
   */
  override removeById(id: string): boolean {
    const removed = super.removeById(id);

    if (removed) {
      this.markDirty();
    }

    return removed;
  }

  /**
   * Override clear to persist
   */
  override clear(): number {
    const count = super.clear();

    if (count > 0) {
      this.markDirty();
    }

    return count;
  }

  /**
   * Override updatePriority to persist
   */
  override updatePriority(id: string, priority: PriorityLevel): boolean {
    const updated = super.updatePriority(id, priority);

    if (updated) {
      this.markDirty();
    }

    return updated;
  }

  /**
   * Delete persisted queue file
   */
  deleteStorage(): boolean {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        fs.unlinkSync(this.storageFilePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get storage file path
   */
  getStoragePath(): string {
    return this.storageFilePath;
  }

  /**
   * Check if storage file exists
   */
  hasStoredData(): boolean {
    return fs.existsSync(this.storageFilePath);
  }

  /**
   * Get storage file info
   */
  getStorageInfo(): {
    exists: boolean;
    path: string;
    size: number;
    lastModified: Date | null;
  } {
    const exists = fs.existsSync(this.storageFilePath);
    let size = 0;
    let lastModified: Date | null = null;

    if (exists) {
      const stats = fs.statSync(this.storageFilePath);
      size = stats.size;
      lastModified = stats.mtime;
    }

    return {
      exists,
      path: this.storageFilePath,
      size,
      lastModified,
    };
  }

  /**
   * Export queue to a specific file
   */
  exportTo(filePath: string): boolean {
    try {
      const data: SerializedQueue<T> = {
        version: QUEUE_VERSION,
        createdAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
        items: this.items.map(item => ({
          id: item.id,
          data: item.data,
          enqueuedAt: item.enqueuedAt.toISOString(),
          attempts: item.attempts,
          lastAttemptAt: item.lastAttemptAt?.toISOString(),
          priority: item.priority,
          priorityValue: item.priorityValue,
          metadata: item.metadata,
        })),
        stats: {
          processed: this.processedCount,
          failed: this.failedCount,
        },
      };

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Import queue from a file
   */
  importFrom(filePath: string, merge: boolean = false): boolean {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data: SerializedQueue<T> = JSON.parse(content);

      const newItems = data.items.map(item => ({
        id: item.id,
        data: item.data,
        enqueuedAt: new Date(item.enqueuedAt),
        attempts: item.attempts,
        lastAttemptAt: item.lastAttemptAt ? new Date(item.lastAttemptAt) : undefined,
        priority: item.priority,
        priorityValue: item.priorityValue,
        metadata: item.metadata,
      }));

      if (merge) {
        // Add new items, avoiding duplicates
        const existingIds = new Set(this.items.map(i => i.id));
        for (const item of newItems) {
          if (!existingIds.has(item.id) && this.items.length < this.options.maxSize) {
            this.insertByPriority(item);
          }
        }
      } else {
        // Replace all items
        this.items = newItems;
        this.processedCount = data.stats.processed;
        this.failedCount = data.stats.failed;
      }

      this.markDirty();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a backup of the current queue
   */
  backup(): string | null {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(
        this.persistOptions.storageDir,
        `${this.persistOptions.filename.replace('.json', '')}_backup_${timestamp}.json`
      );

      this.exportTo(backupPath);
      return backupPath;
    } catch {
      return null;
    }
  }

  /**
   * List available backups
   */
  listBackups(): string[] {
    try {
      const files = fs.readdirSync(this.persistOptions.storageDir);
      const basename = this.persistOptions.filename.replace('.json', '');
      return files
        .filter(f => f.startsWith(`${basename}_backup_`) && f.endsWith('.json'))
        .map(f => path.join(this.persistOptions.storageDir, f))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /**
   * Restore from a backup
   */
  restoreFromBackup(backupPath: string): boolean {
    return this.importFrom(backupPath, false);
  }

  /**
   * Dispose and cleanup
   */
  override dispose(): void {
    this.stopAutoSave();

    if (this.dirty) {
      this.save();
    }

    super.dispose();
  }

  /**
   * Format persistent queue status
   */
  override formatStatus(): string {
    const baseStatus = super.formatStatus();
    const storageInfo = this.getStorageInfo();

    const sizeStr = storageInfo.size > 1024
      ? `${(storageInfo.size / 1024).toFixed(1)}KB`
      : `${storageInfo.size}B`;

    const persistStatus = [
      '├────────────────────────────────────┤',
      '│         PERSISTENCE STATUS         │',
      '├────────────────────────────────────┤',
      `│ Storage:     ${(storageInfo.exists ? 'Active' : 'None').padStart(13)} │`,
      `│ Size:        ${sizeStr.padStart(13)} │`,
      `│ Dirty:       ${(this.dirty ? 'Yes' : 'No').padStart(13)} │`,
      '└────────────────────────────────────┘',
    ].join('\n');

    // Replace bottom line of base status
    return baseStatus.slice(0, -38) + persistStatus;
  }
}

/**
 * Create a persistent queue with custom settings
 */
export function createPersistentQueue<T>(
  options?: PersistentQueueOptions
): PersistentQueue<T> {
  return new PersistentQueue<T>(options);
}

export default PersistentQueue;
