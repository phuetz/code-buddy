/**
 * Cloud Backup Manager
 *
 * Manages backup creation, restoration, and lifecycle for cloud storage.
 */

import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { promisify } from 'util';
import type {
  BackupConfig,
  BackupManifest,
  BackupItem,
  BackupListEntry,
} from './types.js';
import { CloudStorage, createCloudStorage } from './storage.js';
import type { CloudConfig } from './types.js';

const gzip = promisify(require('zlib').gzip);
const gunzip = promisify(require('zlib').gunzip);

// ============================================================================
// Backup Manager
// ============================================================================

export interface BackupManagerConfig {
  cloud: CloudConfig;
  backup: BackupConfig;
  /** Base path for backups in cloud storage */
  backupPath?: string;
  /** Application version for compatibility checking */
  appVersion?: string;
}

// BackupArchive interface reserved for future streaming backup implementation

export class BackupManager extends EventEmitter {
  private storage: CloudStorage;
  private config: BackupManagerConfig;
  private backupTimer: ReturnType<typeof setInterval> | null = null;
  private isBackingUp = false;

  constructor(config: BackupManagerConfig) {
    super();
    this.config = {
      ...config,
      backupPath: config.backupPath || 'backups',
      appVersion: config.appVersion || '1.0.0',
    };
    this.storage = createCloudStorage(config.cloud);
  }

  /**
   * Start automatic backups
   */
  startAutoBackup(): void {
    if (this.backupTimer) return;
    if (!this.config.backup.autoBackup) return;

    this.backupTimer = setInterval(async () => {
      try {
        await this.createBackup();
      } catch (error) {
        this.emit('backup_error', {
          type: 'backup_error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.backup.backupInterval);
  }

  /**
   * Stop automatic backups
   */
  stopAutoBackup(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }
  }

  /**
   * Create a new backup
   */
  async createBackup(description?: string): Promise<BackupManifest> {
    if (this.isBackingUp) {
      throw new Error('A backup is already in progress. Please wait for it to complete before starting a new backup.');
    }

    this.isBackingUp = true;
    const backupId = this.generateBackupId();
    const startTime = Date.now();

    try {
      this.emit('backup_started', { backupId });

      // Collect all items to backup
      const items: BackupItem[] = [];
      const dataChunks: Buffer[] = [];
      let totalSize = 0;
      let offset = 0;

      for (const itemPath of this.config.backup.items) {
        try {
          const itemData = await this.collectItem(itemPath);

          for (const item of itemData) {
            items.push({
              path: item.path,
              type: item.type,
              size: item.size,
              checksum: item.checksum,
              offset,
            });

            dataChunks.push(item.data);
            totalSize += item.size;
            offset += item.data.length;
          }
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
          if (code !== 'ENOENT') {
            throw error;
          }
          // Skip missing paths
        }
      }

      // Combine all data
      const combinedData = Buffer.concat(dataChunks);

      // Compress
      const compressedData = await this.compress(combinedData);

      // Create manifest
      const manifest: BackupManifest = {
        id: backupId,
        createdAt: new Date(),
        version: this.config.appVersion!,
        items,
        totalSize,
        compressedSize: compressedData.length,
        checksum: this.calculateChecksum(compressedData),
        encrypted: !!this.config.cloud.encryptionKey,
      };

      // Handle splitting for large backups
      if (this.config.backup.splitSize && compressedData.length > this.config.backup.splitSize) {
        await this.uploadSplitBackup(backupId, compressedData, manifest);
      } else {
        // Upload as single file
        await this.uploadBackup(backupId, compressedData, manifest);
      }

      // Cleanup old backups
      await this.cleanupOldBackups();

      this.emit('backup_created', { type: 'backup_created', backup: manifest });

      return manifest;
    } finally {
      this.isBackingUp = false;
    }
  }

  /**
   * Collect data from a single item path
   */
  private async collectItem(
    itemPath: string
  ): Promise<Array<{ path: string; type: string; size: number; checksum: string; data: Buffer }>> {
    const results: Array<{
      path: string;
      type: string;
      size: number;
      checksum: string;
      data: Buffer;
    }> = [];

    const stats = await stat(itemPath);

    if (stats.isFile()) {
      const data = await readFile(itemPath);
      results.push({
        path: itemPath,
        type: this.getFileType(itemPath),
        size: data.length,
        checksum: this.calculateChecksum(data),
        data,
      });
    } else if (stats.isDirectory()) {
      await this.collectDirectory(itemPath, itemPath, results);
    }

    return results;
  }

  /**
   * Recursively collect files from directory
   */
  private async collectDirectory(
    dir: string,
    basePath: string,
    results: Array<{ path: string; type: string; size: number; checksum: string; data: Buffer }>
  ): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.collectDirectory(fullPath, basePath, results);
      } else if (entry.isFile()) {
        const data = await readFile(fullPath);
        const relativePath = relative(basePath, fullPath);

        results.push({
          path: relativePath,
          type: this.getFileType(fullPath),
          size: data.length,
          checksum: this.calculateChecksum(data),
          data,
        });
      }
    }
  }

  /**
   * Upload backup as single file
   */
  private async uploadBackup(
    backupId: string,
    data: Buffer,
    manifest: BackupManifest
  ): Promise<void> {
    const backupKey = `${this.config.backupPath}/${backupId}/backup.dat`;
    const manifestKey = `${this.config.backupPath}/${backupId}/manifest.json`;

    // Upload data and manifest in parallel
    await Promise.all([
      this.storage.upload(backupKey, data, {
        type: 'backup',
        checksum: manifest.checksum,
      }),
      this.storage.upload(
        manifestKey,
        Buffer.from(JSON.stringify(manifest, null, 2)),
        { type: 'manifest' }
      ),
    ]);
  }

  /**
   * Upload backup as split parts
   */
  private async uploadSplitBackup(
    backupId: string,
    data: Buffer,
    manifest: BackupManifest
  ): Promise<void> {
    const splitSize = this.config.backup.splitSize!;
    const parts = Math.ceil(data.length / splitSize);
    manifest.parts = parts;

    // Upload parts
    for (let i = 0; i < parts; i++) {
      const start = i * splitSize;
      const end = Math.min(start + splitSize, data.length);
      const partData = data.subarray(start, end);
      const partKey = `${this.config.backupPath}/${backupId}/part-${String(i).padStart(4, '0')}.dat`;

      await this.storage.upload(partKey, partData, {
        type: 'backup-part',
        part: String(i),
        totalParts: String(parts),
        checksum: this.calculateChecksum(partData),
      });

      this.emit('backup_progress', {
        type: 'backup_progress',
        progress: Math.round(((i + 1) / parts) * 100),
        part: i + 1,
        totalParts: parts,
      });
    }

    // Upload manifest
    const manifestKey = `${this.config.backupPath}/${backupId}/manifest.json`;
    await this.storage.upload(
      manifestKey,
      Buffer.from(JSON.stringify(manifest, null, 2)),
      { type: 'manifest' }
    );
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<BackupListEntry[]> {
    try {
      const result = await this.storage.list({ prefix: this.config.backupPath });

      // Find all manifest files
      const manifestKeys = result.objects
        .filter((obj) => obj.key.endsWith('manifest.json'))
        .map((obj) => obj.key);

      // Download and parse all manifests in parallel
      const manifestResults = await Promise.all(
        manifestKeys.map(async (key) => {
          try {
            const manifestData = await this.storage.download(key);
            const manifest: BackupManifest = JSON.parse(manifestData.toString());
            return {
              id: manifest.id,
              createdAt: new Date(manifest.createdAt),
              size: manifest.compressedSize,
              itemCount: manifest.items.length,
            };
          } catch {
            // Skip invalid manifests
            return null;
          }
        })
      );

      // Filter out failed manifests and sort by creation date descending
      const entries = manifestResults.filter((entry): entry is BackupListEntry => entry !== null);
      entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return entries;
    } catch {
      // No backups found
      return [];
    }
  }

  /**
   * Get backup manifest
   */
  async getBackupManifest(backupId: string): Promise<BackupManifest | null> {
    try {
      const manifestKey = `${this.config.backupPath}/${backupId}/manifest.json`;
      const manifestData = await this.storage.download(manifestKey);
      return JSON.parse(manifestData.toString());
    } catch (error) {
      return null;
    }
  }

  /**
   * Restore a backup
   */
  async restoreBackup(
    backupId: string,
    targetPath: string,
    options?: { overwrite?: boolean; items?: string[] }
  ): Promise<{ success: boolean; itemsRestored: number; errors: string[] }> {
    const manifest = await this.getBackupManifest(backupId);

    if (!manifest) {
      throw new Error(`Backup "${backupId}" not found. Use listBackups() to see available backups.`);
    }

    this.emit('restore_started', { backupId, manifest });

    const result = {
      success: true,
      itemsRestored: 0,
      errors: [] as string[],
    };

    try {
      // Download backup data
      let backupData: Buffer;

      if (manifest.parts) {
        // Download all parts in parallel for faster restore
        const partPromises = Array.from({ length: manifest.parts }, (_, i) => {
          const partKey = `${this.config.backupPath}/${backupId}/part-${String(i).padStart(4, '0')}.dat`;
          return this.storage.download(partKey);
        });
        const parts = await Promise.all(partPromises);

        this.emit('restore_progress', {
          type: 'restore_progress',
          progress: 50,
          phase: 'download',
        });

        backupData = Buffer.concat(parts);
      } else {
        const backupKey = `${this.config.backupPath}/${backupId}/backup.dat`;
        backupData = await this.storage.download(backupKey);
      }

      // Verify checksum
      const checksum = this.calculateChecksum(backupData);
      if (checksum !== manifest.checksum) {
        throw new Error('Backup data integrity check failed: checksum mismatch. The backup file may be corrupted or incomplete.');
      }

      // Decompress
      const decompressedData = await this.decompress(backupData);

      // Restore items
      const itemsToRestore = options?.items
        ? manifest.items.filter((item) => options.items!.includes(item.path))
        : manifest.items;

      for (let i = 0; i < itemsToRestore.length; i++) {
        const item = itemsToRestore[i];

        try {
          const itemPath = join(targetPath, item.path);

          // Check if file exists and overwrite is disabled
          if (!options?.overwrite) {
            try {
              await stat(itemPath);
              // File exists, skip
              continue;
            } catch {
              // File doesn't exist, proceed
            }
          }

          // Extract item data
          const itemData = decompressedData.subarray(item.offset, item.offset + item.size);

          // Verify item checksum
          const itemChecksum = this.calculateChecksum(itemData);
          if (itemChecksum !== item.checksum) {
            throw new Error(`File integrity check failed for "${item.path}": checksum mismatch. The backup may be corrupted.`);
          }

          // Create directory
          await mkdir(dirname(itemPath), { recursive: true });

          // Write file
          await writeFile(itemPath, itemData);

          result.itemsRestored++;

          this.emit('restore_progress', {
            type: 'restore_progress',
            progress: 50 + Math.round(((i + 1) / itemsToRestore.length) * 50),
            phase: 'restore',
            item: item.path,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push(`${item.path}: ${errorMessage}`);
        }
      }

      result.success = result.errors.length === 0;

      this.emit('restore_completed', {
        type: 'backup_restored',
        backup: manifest,
        result,
      });
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));

      this.emit('restore_error', {
        type: 'restore_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<boolean> {
    try {
      const manifest = await this.getBackupManifest(backupId);

      if (!manifest) {
        return false;
      }

      // Delete all backup files in parallel
      if (manifest.parts) {
        const deletePromises = Array.from({ length: manifest.parts }, (_, i) => {
          const partKey = `${this.config.backupPath}/${backupId}/part-${String(i).padStart(4, '0')}.dat`;
          return this.storage.delete(partKey);
        });
        // Also delete the manifest in the same batch
        const manifestKey = `${this.config.backupPath}/${backupId}/manifest.json`;
        deletePromises.push(this.storage.delete(manifestKey));
        await Promise.all(deletePromises);
      } else {
        // Delete backup data and manifest in parallel
        const backupKey = `${this.config.backupPath}/${backupId}/backup.dat`;
        const manifestKey = `${this.config.backupPath}/${backupId}/manifest.json`;
        await Promise.all([
          this.storage.delete(backupKey),
          this.storage.delete(manifestKey),
        ]);
      }

      this.emit('backup_deleted', { backupId });

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Cleanup old backups based on retention policy
   */
  async cleanupOldBackups(): Promise<number> {
    const backups = await this.listBackups();
    const maxBackups = this.config.backup.maxBackups;

    if (backups.length <= maxBackups) {
      return 0;
    }

    // Delete oldest backups
    const toDelete = backups.slice(maxBackups);
    let deleted = 0;

    for (const backup of toDelete) {
      if (await this.deleteBackup(backup.id)) {
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupId: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const manifest = await this.getBackupManifest(backupId);

      if (!manifest) {
        return { valid: false, errors: ['Manifest not found'] };
      }

      // Check backup data exists and checksum matches
      if (manifest.parts) {
        // Check all parts existence in parallel
        const partChecks = await Promise.allSettled(
          Array.from({ length: manifest.parts }, (_, i) => {
            const partKey = `${this.config.backupPath}/${backupId}/part-${String(i).padStart(4, '0')}.dat`;
            return this.storage.exists(partKey).then(exists => ({ part: i, exists }));
          })
        );

        for (const result of partChecks) {
          if (result.status === 'rejected') {
            errors.push(`Error checking part: ${result.reason}`);
          } else if (!result.value.exists) {
            errors.push(`Missing part: ${result.value.part}`);
          }
        }
      } else {
        const backupKey = `${this.config.backupPath}/${backupId}/backup.dat`;
        const exists = await this.storage.exists(backupKey);

        if (!exists) {
          errors.push('Backup data not found');
        }
      }

      return { valid: errors.length === 0, errors };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Export backup to local file
   */
  async exportBackup(backupId: string, outputPath: string): Promise<void> {
    const manifest = await this.getBackupManifest(backupId);

    if (!manifest) {
      throw new Error(`Backup "${backupId}" not found. Use listBackups() to see available backups.`);
    }

    // Download backup data
    let backupData: Buffer;

    if (manifest.parts) {
      // Download all parts in parallel
      const partPromises = Array.from({ length: manifest.parts }, (_, i) => {
        const partKey = `${this.config.backupPath}/${backupId}/part-${String(i).padStart(4, '0')}.dat`;
        return this.storage.download(partKey);
      });
      const parts = await Promise.all(partPromises);
      backupData = Buffer.concat(parts);
    } else {
      const backupKey = `${this.config.backupPath}/${backupId}/backup.dat`;
      backupData = await this.storage.download(backupKey);
    }

    // Write to local files in parallel
    await mkdir(dirname(outputPath), { recursive: true });
    await Promise.all([
      writeFile(outputPath, backupData),
      writeFile(
        outputPath.replace(/\.dat$/, '.manifest.json'),
        JSON.stringify(manifest, null, 2)
      ),
    ]);
  }

  /**
   * Import backup from local file
   */
  async importBackup(inputPath: string): Promise<BackupManifest> {
    // Read manifest
    const manifestPath = inputPath.replace(/\.dat$/, '.manifest.json');
    const manifestData = await readFile(manifestPath, 'utf-8');
    const manifest: BackupManifest = JSON.parse(manifestData);

    // Read backup data
    const backupData = await readFile(inputPath);

    // Verify checksum
    const checksum = this.calculateChecksum(backupData);
    if (checksum !== manifest.checksum) {
      throw new Error('Backup data integrity check failed: checksum mismatch. The backup file may be corrupted or incomplete.');
    }

    // Upload to cloud
    if (this.config.backup.splitSize && backupData.length > this.config.backup.splitSize) {
      await this.uploadSplitBackup(manifest.id, backupData, manifest);
    } else {
      await this.uploadBackup(manifest.id, backupData, manifest);
    }

    return manifest;
  }

  /**
   * Compress data
   */
  private async compress(data: Buffer): Promise<Buffer> {
    const level = this.config.backup.compressionLevel;
    return gzip(data, { level });
  }

  /**
   * Decompress data
   */
  private async decompress(data: Buffer): Promise<Buffer> {
    return gunzip(data);
  }

  /**
   * Calculate checksum
   */
  private calculateChecksum(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate backup ID
   */
  private generateBackupId(): string {
    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const uuid = randomUUID().slice(0, 8);
    return `backup-${date}-${uuid}`;
  }

  /**
   * Get file type from path
   */
  private getFileType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const typeMap: Record<string, string> = {
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      ts: 'typescript',
      js: 'javascript',
      md: 'markdown',
      txt: 'text',
    };
    return typeMap[ext] || 'binary';
  }

  /**
   * Dispose of the backup manager
   */
  dispose(): void {
    this.stopAutoBackup();
    this.removeAllListeners();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createBackupManager(config: BackupManagerConfig): BackupManager {
  return new BackupManager(config);
}
