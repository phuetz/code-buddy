/**
 * Cloud Sync Manager
 *
 * Manages synchronization of local data with cloud storage.
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { createGzip, createGunzip } from 'zlib';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';
import type {
  SyncConfig,
  SyncState,
  SyncResult,
  SyncConflict,
  SyncError,
  SyncItem,
  SyncDirection,
  ConflictResolution,
  SyncEvent,
  SyncEventHandler,
  VersionInfo,
} from './types.js';
import { CloudStorage, createCloudStorage, type ListOptions } from './storage.js';
import type { CloudConfig } from './types.js';

const gzip = promisify(require('zlib').gzip);
const gunzip = promisify(require('zlib').gunzip);

// ============================================================================
// Sync Manager
// ============================================================================

export interface SyncManagerConfig {
  cloud: CloudConfig;
  sync: SyncConfig;
}

interface LocalFileInfo {
  path: string;
  relativePath: string;
  size: number;
  modifiedAt: Date;
  checksum: string;
}

interface RemoteFileInfo {
  key: string;
  size: number;
  modifiedAt: Date;
  checksum?: string;
  version?: string;
}

interface SyncDelta {
  toUpload: LocalFileInfo[];
  toDownload: RemoteFileInfo[];
  conflicts: SyncConflict[];
  toDelete: { local: string[]; remote: string[] };
}

export class CloudSyncManager extends EventEmitter {
  private storage: CloudStorage;
  private config: SyncManagerConfig;
  private state: SyncState;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;
  private versionCache: Map<string, VersionInfo[]> = new Map();

  constructor(config: SyncManagerConfig) {
    super();
    this.config = config;
    this.storage = createCloudStorage(config.cloud);
    this.state = {
      status: 'idle',
      lastSync: undefined,
      lastError: undefined,
      currentItems: [],
      progress: 0,
      bytesTransferred: 0,
      totalBytes: 0,
    };
  }

  /**
   * Get current sync state
   */
  getState(): SyncState {
    return { ...this.state };
  }

  /**
   * Start automatic sync
   */
  startAutoSync(): void {
    if (this.syncTimer) return;
    if (!this.config.sync.autoSync) return;

    this.syncTimer = setInterval(async () => {
      try {
        await this.sync();
      } catch (error) {
        this.emitEvent({
          type: 'sync_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.sync.syncInterval);

    // Initial sync
    this.sync().catch((err) => {
      logger.debug('Initial sync failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }

  /**
   * Stop automatic sync
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Perform sync operation
   */
  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;
    const startTime = Date.now();

    this.updateState({
      status: 'syncing',
      currentItems: [],
      progress: 0,
      bytesTransferred: 0,
    });

    this.emitEvent({ type: 'sync_started', direction: this.config.sync.direction });

    const result: SyncResult = {
      success: true,
      itemsSynced: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
      conflicts: [],
      errors: [],
      duration: 0,
      timestamp: new Date(),
    };

    try {
      // Get enabled sync items
      const enabledItems = this.config.sync.items.filter((item) => item.enabled);

      for (const item of enabledItems) {
        try {
          const itemResult = await this.syncItem(item);
          result.itemsSynced += itemResult.itemsSynced;
          result.bytesUploaded += itemResult.bytesUploaded;
          result.bytesDownloaded += itemResult.bytesDownloaded;
          result.conflicts.push(...itemResult.conflicts);
          result.errors.push(...itemResult.errors);
        } catch (error) {
          result.errors.push({
            path: item.localPath,
            code: 'SYNC_ITEM_ERROR',
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          });
        }
      }

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      this.updateState({
        status: result.conflicts.length > 0 ? 'resolving_conflicts' : 'idle',
        lastSync: new Date(),
        lastError: result.success ? undefined : result.errors[0]?.message,
        progress: 100,
      });

      this.emitEvent({ type: 'sync_completed', result });
    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;

      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({
        path: '',
        code: 'SYNC_ERROR',
        message: errorMessage,
        retryable: true,
      });

      this.updateState({
        status: 'error',
        lastError: errorMessage,
      });

      this.emitEvent({ type: 'sync_failed', error: errorMessage });
    } finally {
      this.isSyncing = false;
    }

    return result;
  }

  /**
   * Sync a single item
   */
  private async syncItem(item: SyncItem): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      itemsSynced: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
      conflicts: [],
      errors: [],
      duration: 0,
      timestamp: new Date(),
    };

    this.updateState({ currentItems: [item.localPath] });

    // Calculate delta
    const delta = await this.calculateDelta(item);

    // Handle based on sync direction
    switch (this.config.sync.direction) {
      case 'push':
        await this.uploadFiles(delta.toUpload, item.remotePath, result);
        break;

      case 'pull':
        await this.downloadFiles(delta.toDownload, item.localPath, result);
        break;

      case 'bidirectional':
        // Handle conflicts first
        for (const conflict of delta.conflicts) {
          const resolved = await this.resolveConflict(conflict);
          if (resolved) {
            result.conflicts.push(conflict);
          }
        }

        // Then sync changes
        await this.uploadFiles(delta.toUpload, item.remotePath, result);
        await this.downloadFiles(delta.toDownload, item.localPath, result);
        break;
    }

    // Update last sync time
    item.lastSync = new Date();

    return result;
  }

  /**
   * Calculate sync delta between local and remote
   */
  private async calculateDelta(item: SyncItem): Promise<SyncDelta> {
    const delta: SyncDelta = {
      toUpload: [],
      toDownload: [],
      conflicts: [],
      toDelete: { local: [], remote: [] },
    };

    // Get local files
    const localFiles = await this.scanLocalFiles(item.localPath);

    // Get remote files
    const remoteFiles = await this.scanRemoteFiles(item.remotePath);

    // Build maps for comparison
    const localMap = new Map(localFiles.map((f) => [f.relativePath, f]));
    const remoteMap = new Map(remoteFiles.map((f) => [f.key, f]));

    // Compare files
    for (const [path, localFile] of localMap) {
      const remoteFile = remoteMap.get(path);

      if (!remoteFile) {
        // New local file
        delta.toUpload.push(localFile);
      } else if (localFile.checksum !== remoteFile.checksum) {
        // File differs
        if (localFile.modifiedAt > remoteFile.modifiedAt) {
          delta.toUpload.push(localFile);
        } else if (localFile.modifiedAt < remoteFile.modifiedAt) {
          delta.toDownload.push(remoteFile);
        } else {
          // Same modification time but different content - conflict
          delta.conflicts.push({
            path,
            local: {
              version: localFile.checksum,
              modifiedAt: localFile.modifiedAt,
              size: localFile.size,
            },
            remote: {
              version: remoteFile.checksum || '',
              modifiedAt: remoteFile.modifiedAt,
              size: remoteFile.size,
            },
          });
        }
      }
    }

    // Find new remote files
    for (const [path, remoteFile] of remoteMap) {
      if (!localMap.has(path)) {
        delta.toDownload.push(remoteFile);
      }
    }

    return delta;
  }

  /**
   * Scan local files
   */
  private async scanLocalFiles(basePath: string): Promise<LocalFileInfo[]> {
    const files: LocalFileInfo[] = [];

    try {
      await this.scanDirectory(basePath, basePath, files);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
      if (code !== 'ENOENT') throw error;
    }

    return files;
  }

  /**
   * Recursively scan directory
   */
  private async scanDirectory(
    dir: string,
    basePath: string,
    files: LocalFileInfo[]
  ): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(basePath, fullPath);

      // Check exclusion patterns
      if (this.isExcluded(relativePath)) continue;

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, basePath, files);
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        const content = await readFile(fullPath);
        const checksum = this.calculateChecksum(content);

        files.push({
          path: fullPath,
          relativePath,
          size: stats.size,
          modifiedAt: stats.mtime,
          checksum,
        });
      }
    }
  }

  /**
   * Scan remote files
   */
  private async scanRemoteFiles(remotePath: string): Promise<RemoteFileInfo[]> {
    const files: RemoteFileInfo[] = [];

    try {
      const result = await this.storage.list({ prefix: remotePath });

      for (const obj of result.objects) {
        // Get checksum from metadata if available
        const metadata = await this.storage.getMetadata(obj.key);

        files.push({
          key: obj.key.replace(new RegExp(`^${remotePath}/?`), ''),
          size: obj.size,
          modifiedAt: obj.lastModified,
          checksum: metadata?.metadata?.checksum,
          version: metadata?.metadata?.version,
        });
      }
    } catch (error) {
      // Remote path may not exist yet
    }

    return files;
  }

  /**
   * Upload files to cloud storage
   */
  private async uploadFiles(
    files: LocalFileInfo[],
    remotePath: string,
    result: SyncResult
  ): Promise<void> {
    for (const file of files) {
      try {
        this.updateState({ currentItems: [file.path] });

        let content = await readFile(file.path);

        // Compress if enabled
        if (this.config.sync.compression) {
          content = await gzip(content);
        }

        const remoteKey = join(remotePath, file.relativePath);
        await this.storage.upload(remoteKey, content, {
          checksum: file.checksum,
          originalSize: String(file.size),
          compressed: String(this.config.sync.compression),
          modifiedAt: file.modifiedAt.toISOString(),
        });

        result.bytesUploaded += content.length;
        result.itemsSynced++;

        this.emitEvent({
          type: 'item_uploaded',
          path: file.relativePath,
          size: content.length,
        });

        this.updateProgress(result);
      } catch (error) {
        result.errors.push({
          path: file.path,
          code: 'UPLOAD_ERROR',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        });
      }
    }
  }

  /**
   * Download files from cloud storage
   */
  private async downloadFiles(
    files: RemoteFileInfo[],
    localPath: string,
    result: SyncResult
  ): Promise<void> {
    for (const file of files) {
      try {
        const localFilePath = join(localPath, file.key);
        this.updateState({ currentItems: [localFilePath] });

        let content = await this.storage.download(
          join(this.config.sync.items[0]?.remotePath || '', file.key)
        );

        // Decompress if needed
        const metadata = await this.storage.getMetadata(
          join(this.config.sync.items[0]?.remotePath || '', file.key)
        );
        if (metadata?.metadata?.compressed === 'true') {
          content = await gunzip(content);
        }

        // Ensure directory exists
        await mkdir(dirname(localFilePath), { recursive: true });

        // Write file
        await writeFile(localFilePath, content);

        result.bytesDownloaded += content.length;
        result.itemsSynced++;

        this.emitEvent({
          type: 'item_downloaded',
          path: file.key,
          size: content.length,
        });

        this.updateProgress(result);
      } catch (error) {
        result.errors.push({
          path: file.key,
          code: 'DOWNLOAD_ERROR',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        });
      }
    }
  }

  /**
   * Resolve a sync conflict
   */
  private async resolveConflict(conflict: SyncConflict): Promise<boolean> {
    this.emitEvent({ type: 'conflict_detected', conflict });

    switch (this.config.sync.conflictResolution) {
      case 'local':
        conflict.resolution = 'local';
        break;

      case 'remote':
        conflict.resolution = 'remote';
        break;

      case 'newest':
        conflict.resolution =
          conflict.local.modifiedAt > conflict.remote.modifiedAt ? 'local' : 'remote';
        break;

      case 'manual':
        // Leave unresolved for manual handling
        return false;
    }

    this.emitEvent({ type: 'conflict_resolved', conflict });
    return true;
  }

  /**
   * Manually resolve a conflict
   */
  async resolveConflictManually(
    conflict: SyncConflict,
    resolution: 'local' | 'remote' | 'merged',
    mergedData?: Buffer
  ): Promise<void> {
    conflict.resolution = resolution;
    conflict.resolvedData = mergedData;

    this.emitEvent({ type: 'conflict_resolved', conflict });
  }

  /**
   * Get version history for a file
   */
  async getVersionHistory(path: string): Promise<VersionInfo[]> {
    const cached = this.versionCache.get(path);
    if (cached) return cached;

    const versions: VersionInfo[] = [];
    const versionKey = `${path}/.versions`;

    try {
      const result = await this.storage.list({ prefix: versionKey });

      for (const obj of result.objects) {
        const metadata = await this.storage.getMetadata(obj.key);
        if (metadata) {
          versions.push({
            id: obj.key.split('/').pop() || '',
            path,
            timestamp: obj.lastModified,
            size: obj.size,
            checksum: metadata.metadata?.checksum || '',
            author: metadata.metadata?.author,
            parent: metadata.metadata?.parent,
          });
        }
      }

      // Sort by timestamp descending
      versions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      this.versionCache.set(path, versions);
    } catch (error) {
      // No version history
    }

    return versions;
  }

  /**
   * Restore a specific version
   */
  async restoreVersion(path: string, versionId: string): Promise<void> {
    const versionKey = `${path}/.versions/${versionId}`;
    const content = await this.storage.download(versionKey);

    // Find local path for this remote path
    const item = this.config.sync.items.find((i) =>
      path.startsWith(i.remotePath)
    );

    if (!item) {
      throw new Error(`No sync item found for path: ${path}`);
    }

    const localPath = join(
      item.localPath,
      path.replace(new RegExp(`^${item.remotePath}/?`), '')
    );

    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, content);
  }

  /**
   * Check if path matches exclusion patterns
   */
  private isExcluded(path: string): boolean {
    const patterns = this.config.sync.excludePatterns || [];

    for (const pattern of patterns) {
      // Simple glob matching
      const regex = new RegExp(
        '^' +
          pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.') +
          '$'
      );

      if (regex.test(path)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate file checksum
   */
  private calculateChecksum(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Update sync state
   */
  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
  }

  /**
   * Update progress
   */
  private updateProgress(result: SyncResult): void {
    const total = this.state.totalBytes || 1;
    const transferred = result.bytesUploaded + result.bytesDownloaded;
    const progress = Math.min(100, Math.round((transferred / total) * 100));

    this.updateState({
      progress,
      bytesTransferred: transferred,
    });

    this.emitEvent({ type: 'sync_progress', progress });
  }

  /**
   * Emit sync event
   */
  private emitEvent(event: SyncEvent): void {
    this.emit('sync-event', event);
    this.emit(event.type, event);
  }

  /**
   * Add event handler
   */
  onSyncEvent(handler: SyncEventHandler): void {
    this.on('sync-event', handler);
  }

  /**
   * Remove event handler
   */
  offSyncEvent(handler: SyncEventHandler): void {
    this.off('sync-event', handler);
  }

  /**
   * Force push local state to remote
   */
  async forcePush(): Promise<SyncResult> {
    const originalDirection = this.config.sync.direction;
    this.config.sync.direction = 'push';

    try {
      return await this.sync();
    } finally {
      this.config.sync.direction = originalDirection;
    }
  }

  /**
   * Force pull remote state to local
   */
  async forcePull(): Promise<SyncResult> {
    const originalDirection = this.config.sync.direction;
    this.config.sync.direction = 'pull';

    try {
      return await this.sync();
    } finally {
      this.config.sync.direction = originalDirection;
    }
  }

  /**
   * Dispose of the sync manager
   */
  dispose(): void {
    this.stopAutoSync();
    this.versionCache.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createSyncManager(config: SyncManagerConfig): CloudSyncManager {
  return new CloudSyncManager(config);
}
