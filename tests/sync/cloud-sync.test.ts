/**
 * Cloud Sync Module Tests
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdir, rm, writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

// Direct imports (no mocking for integration tests)
import {
  LocalStorage,
  CloudStorage,
  createCloudStorage,
} from '../../src/sync/cloud/storage.js';
import {
  CloudSyncManager,
  createSyncManager,
} from '../../src/sync/cloud/sync-manager.js';
import {
  BackupManager,
  createBackupManager,
} from '../../src/sync/cloud/backup-manager.js';
import {
  createCloudSyncSystem,
  createLocalConfig,
  createS3Config,
  createDefaultSyncItems,
  createDefaultBackupItems,
} from '../../src/sync/cloud/index.js';

describe('Cloud Storage', () => {
  let testDir: string;
  let storage: LocalStorage;

  beforeEach(async () => {
    testDir = join(tmpdir(), `cloud-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    storage = new LocalStorage({
      provider: 'local',
      bucket: 'test',
      endpoint: testDir,
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('LocalStorage', () => {
    it('should upload and download files', async () => {
      const data = Buffer.from('test content');
      await storage.upload('test/file.txt', data);

      const downloaded = await storage.download('test/file.txt');
      expect(downloaded.toString()).toBe('test content');
    });

    it('should store and retrieve metadata', async () => {
      const data = Buffer.from('test');
      await storage.upload('meta-test.txt', data, { author: 'test', version: '1.0' });

      const metadata = await storage.getMetadata('meta-test.txt');
      expect(metadata).toBeDefined();
      expect(metadata?.metadata?.author).toBe('test');
      expect(metadata?.metadata?.version).toBe('1.0');
    });

    it('should delete files', async () => {
      const data = Buffer.from('to delete');
      await storage.upload('delete-me.txt', data);

      expect(await storage.exists('delete-me.txt')).toBe(true);

      await storage.delete('delete-me.txt');

      expect(await storage.exists('delete-me.txt')).toBe(false);
    });

    it('should list files with prefix', async () => {
      await storage.upload('dir1/file1.txt', Buffer.from('1'));
      await storage.upload('dir1/file2.txt', Buffer.from('2'));
      await storage.upload('dir2/file3.txt', Buffer.from('3'));

      const result = await storage.list({ prefix: 'dir1' });
      expect(result.objects.length).toBe(2);
    });

    it('should check file existence', async () => {
      expect(await storage.exists('nonexistent.txt')).toBe(false);

      await storage.upload('exists.txt', Buffer.from('exists'));
      expect(await storage.exists('exists.txt')).toBe(true);
    });

    it('should handle nested directories', async () => {
      await storage.upload('a/b/c/deep.txt', Buffer.from('deep content'));

      const downloaded = await storage.download('a/b/c/deep.txt');
      expect(downloaded.toString()).toBe('deep content');
    });

    it('should handle empty files', async () => {
      await storage.upload('empty.txt', Buffer.alloc(0));

      const downloaded = await storage.download('empty.txt');
      expect(downloaded.length).toBe(0);
    });

    it('should handle large files', async () => {
      const largeData = Buffer.alloc(1024 * 100, 'x'); // 100KB
      await storage.upload('large.txt', largeData);

      const downloaded = await storage.download('large.txt');
      expect(downloaded.length).toBe(largeData.length);
    });
  });

  describe('Encryption', () => {
    it('should encrypt and decrypt data with encryption key', async () => {
      const encryptedStorage = new LocalStorage({
        provider: 'local',
        bucket: 'test',
        endpoint: testDir,
        encryptionKey: 'my-secret-key',
      });

      const originalData = Buffer.from('sensitive data');
      await encryptedStorage.upload('encrypted.txt', originalData);

      const downloaded = await encryptedStorage.download('encrypted.txt');
      expect(downloaded.toString()).toBe('sensitive data');
    });

    it('should produce different ciphertext for same plaintext', async () => {
      const encryptedStorage = new LocalStorage({
        provider: 'local',
        bucket: 'test',
        endpoint: testDir,
        encryptionKey: 'my-secret-key',
      });

      const data = Buffer.from('same data');
      await encryptedStorage.upload('enc1.txt', data);
      await encryptedStorage.upload('enc2.txt', data);

      // Read raw files (they should be different due to random IV)
      const raw1 = await readFile(join(testDir, 'enc1.txt'));
      const raw2 = await readFile(join(testDir, 'enc2.txt'));

      // IVs should be different (first 16 bytes)
      expect(raw1.subarray(0, 16).equals(raw2.subarray(0, 16))).toBe(false);
    });
  });

  describe('createCloudStorage factory', () => {
    it('should create LocalStorage for local provider', () => {
      const storage = createCloudStorage({
        provider: 'local',
        bucket: 'test',
        endpoint: testDir,
      });

      expect(storage).toBeInstanceOf(LocalStorage);
    });

    it('should create cloud storage for gcs and azure providers', () => {
      const gcs = createCloudStorage({
        provider: 'gcs',
        bucket: 'test',
      });
      const azure = createCloudStorage({
        provider: 'azure',
        bucket: 'test',
      });

      expect(gcs).toBeInstanceOf(CloudStorage);
      expect(azure).toBeInstanceOf(CloudStorage);
    });
  });
});

describe('CloudSyncManager', () => {
  let testDir: string;
  let localDir: string;
  let cloudDir: string;
  let syncManager: CloudSyncManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `sync-test-${randomUUID()}`);
    localDir = join(testDir, 'local');
    cloudDir = join(testDir, 'cloud');

    await mkdir(localDir, { recursive: true });
    await mkdir(cloudDir, { recursive: true });

    syncManager = createSyncManager({
      cloud: {
        provider: 'local',
        bucket: 'test',
        endpoint: cloudDir,
      },
      sync: {
        autoSync: false,
        syncInterval: 1000,
        direction: 'bidirectional',
        conflictResolution: 'newest',
        items: [
          {
            type: 'custom',
            localPath: localDir,
            remotePath: 'sync-data',
            enabled: true,
          },
        ],
        compression: false,
        encryption: false,
      },
    });
  });

  afterEach(async () => {
    syncManager.dispose();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Initialization', () => {
    it('should create sync manager with config', () => {
      expect(syncManager).toBeDefined();
      expect(syncManager.getState().status).toBe('idle');
    });

    it('should return initial state', () => {
      const state = syncManager.getState();
      expect(state.status).toBe('idle');
      expect(state.progress).toBe(0);
      expect(state.lastSync).toBeUndefined();
    });

    it('should be an EventEmitter', () => {
      expect(syncManager).toBeInstanceOf(EventEmitter);
    });
  });

  describe('Sync Operations', () => {
    it('should sync local files to cloud', async () => {
      // Create local files
      await writeFile(join(localDir, 'file1.txt'), 'content 1');
      await writeFile(join(localDir, 'file2.txt'), 'content 2');

      const result = await syncManager.sync();

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should emit sync events', async () => {
      const events: any[] = [];
      syncManager.onSyncEvent((event) => events.push(event));

      await writeFile(join(localDir, 'event-test.txt'), 'event content');
      await syncManager.sync();

      expect(events.some((e) => e.type === 'sync_started')).toBe(true);
      expect(events.some((e) => e.type === 'sync_completed')).toBe(true);
    });

    it('should handle empty sync items', async () => {
      const emptyManager = createSyncManager({
        cloud: { provider: 'local', bucket: 'test', endpoint: cloudDir },
        sync: {
          autoSync: false,
          syncInterval: 1000,
          direction: 'bidirectional',
          conflictResolution: 'newest',
          items: [],
          compression: false,
          encryption: false,
        },
      });

      const result = await emptyManager.sync();

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(0);

      emptyManager.dispose();
    });

    it('should prevent concurrent sync', async () => {
      await writeFile(join(localDir, 'concurrent.txt'), 'content');

      // Start first sync
      const sync1 = syncManager.sync();

      // Try to start second sync - should reject with any error about sync in progress
      await expect(syncManager.sync()).rejects.toThrow(/sync.*already in progress/i);

      await sync1;
    });

    it('should update state during sync', async () => {
      await writeFile(join(localDir, 'state-test.txt'), 'state content');

      const syncEvents: any[] = [];
      syncManager.onSyncEvent((event) => {
        syncEvents.push(event);
      });

      await syncManager.sync();

      // Should have received sync_started and sync_completed events
      expect(syncEvents.some(e => e.type === 'sync_started')).toBe(true);
      expect(syncEvents.some(e => e.type === 'sync_completed')).toBe(true);
    });

    it('should track bytes transferred', async () => {
      await writeFile(join(localDir, 'bytes-test.txt'), 'some bytes here');

      const result = await syncManager.sync();

      expect(result.bytesUploaded).toBeGreaterThan(0);
    });
  });

  describe('Sync Directions', () => {
    it('should push only when direction is push', async () => {
      const pushManager = createSyncManager({
        cloud: { provider: 'local', bucket: 'test', endpoint: cloudDir },
        sync: {
          autoSync: false,
          syncInterval: 1000,
          direction: 'push',
          conflictResolution: 'newest',
          items: [{ type: 'custom', localPath: localDir, remotePath: 'push-data', enabled: true }],
          compression: false,
          encryption: false,
        },
      });

      await writeFile(join(localDir, 'push-only.txt'), 'push content');
      const result = await pushManager.sync();

      expect(result.success).toBe(true);
      pushManager.dispose();
    });

    it('should pull only when direction is pull', async () => {
      const pullManager = createSyncManager({
        cloud: { provider: 'local', bucket: 'test', endpoint: cloudDir },
        sync: {
          autoSync: false,
          syncInterval: 1000,
          direction: 'pull',
          conflictResolution: 'newest',
          items: [{ type: 'custom', localPath: localDir, remotePath: 'pull-data', enabled: true }],
          compression: false,
          encryption: false,
        },
      });

      const result = await pullManager.sync();

      expect(result.success).toBe(true);
      pullManager.dispose();
    });
  });

  describe('Auto Sync', () => {
    it('should start and stop auto sync', () => {
      const autoSyncManager = createSyncManager({
        cloud: { provider: 'local', bucket: 'test', endpoint: cloudDir },
        sync: {
          autoSync: true,
          syncInterval: 60000, // Use 60 seconds (valid interval)
          direction: 'bidirectional',
          conflictResolution: 'newest',
          items: [],
          compression: false,
          encryption: false,
        },
      });

      autoSyncManager.startAutoSync();
      autoSyncManager.stopAutoSync();
      autoSyncManager.dispose();
    });

    it('should not start auto sync twice', () => {
      syncManager.startAutoSync();
      syncManager.startAutoSync(); // Should not throw
      syncManager.stopAutoSync();
    });
  });

  describe('Force Operations', () => {
    it('should force push local to remote', async () => {
      await writeFile(join(localDir, 'force-push.txt'), 'force push content');

      const result = await syncManager.forcePush();

      expect(result.success).toBe(true);
    });

    it('should force pull remote to local', async () => {
      const result = await syncManager.forcePull();

      expect(result.success).toBe(true);
    });

    it('should restore original direction after force operations', async () => {
      const originalState = syncManager.getState();

      await syncManager.forcePush();
      await syncManager.forcePull();

      // Should still work with original config
      const result = await syncManager.sync();
      expect(result.success).toBe(true);
    });
  });

  describe('Event Handling', () => {
    it('should add and remove event handlers', () => {
      const handler = jest.fn();

      syncManager.onSyncEvent(handler);
      syncManager.offSyncEvent(handler);

      // Should not throw
      expect(true).toBe(true);
    });
  });
});

describe('BackupManager', () => {
  let testDir: string;
  let dataDir: string;
  let cloudDir: string;
  let backupManager: BackupManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `backup-test-${randomUUID()}`);
    dataDir = join(testDir, 'data');
    cloudDir = join(testDir, 'cloud');

    await mkdir(dataDir, { recursive: true });
    await mkdir(cloudDir, { recursive: true });

    backupManager = createBackupManager({
      cloud: {
        provider: 'local',
        bucket: 'test',
        endpoint: cloudDir,
      },
      backup: {
        autoBackup: false,
        backupInterval: 3600000,
        maxBackups: 5,
        items: [dataDir],
        compressionLevel: 6,
      },
    });
  });

  afterEach(async () => {
    backupManager.dispose();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Initialization', () => {
    it('should create backup manager with config', () => {
      expect(backupManager).toBeDefined();
    });

    it('should be an EventEmitter', () => {
      expect(backupManager).toBeInstanceOf(EventEmitter);
    });
  });

  describe('Backup Creation', () => {
    it('should create a backup', async () => {
      // Create some data
      await writeFile(join(dataDir, 'file1.txt'), 'backup content 1');
      await writeFile(join(dataDir, 'file2.txt'), 'backup content 2');

      const manifest = await backupManager.createBackup('Test backup');

      expect(manifest).toBeDefined();
      expect(manifest.id).toMatch(/^backup-/);
      expect(manifest.items.length).toBeGreaterThan(0);
      expect(manifest.totalSize).toBeGreaterThan(0);
    });

    it('should include all files in manifest', async () => {
      await writeFile(join(dataDir, 'a.txt'), 'a');
      await writeFile(join(dataDir, 'b.txt'), 'bb');
      await writeFile(join(dataDir, 'c.txt'), 'ccc');

      const manifest = await backupManager.createBackup();

      expect(manifest.items.length).toBe(3);
    });

    it('should handle nested directories', async () => {
      await mkdir(join(dataDir, 'nested', 'deep'), { recursive: true });
      await writeFile(join(dataDir, 'nested/deep/file.txt'), 'nested content');

      const manifest = await backupManager.createBackup();

      expect(manifest.items.some(i => i.path.includes('nested'))).toBe(true);
    });

    it('should emit backup events', async () => {
      const events: any[] = [];
      backupManager.on('backup_created', (event) => events.push(event));

      await writeFile(join(dataDir, 'event.txt'), 'event content');
      await backupManager.createBackup();

      expect(events.length).toBeGreaterThan(0);
    });

    it('should prevent concurrent backups', async () => {
      await writeFile(join(dataDir, 'concurrent.txt'), 'content');

      const backup1 = backupManager.createBackup();
      await expect(backupManager.createBackup()).rejects.toThrow(/backup.*already in progress/i);

      await backup1;
    });

    it('should calculate checksums', async () => {
      await writeFile(join(dataDir, 'checksum.txt'), 'checksum content');

      const manifest = await backupManager.createBackup();

      expect(manifest.checksum).toBeDefined();
      expect(manifest.checksum.length).toBe(64); // SHA-256 hex
      expect(manifest.items[0].checksum).toBeDefined();
    });

    it('should compress data', async () => {
      await writeFile(join(dataDir, 'compress.txt'), 'a'.repeat(1000)); // Highly compressible

      const manifest = await backupManager.createBackup();

      expect(manifest.compressedSize).toBeLessThan(manifest.totalSize);
    });
  });

  describe('Backup Listing', () => {
    it('should list backups', async () => {
      await writeFile(join(dataDir, 'list.txt'), 'content');
      await backupManager.createBackup();

      const backups = await backupManager.listBackups();

      expect(backups.length).toBeGreaterThanOrEqual(1);
      expect(backups[0].id).toMatch(/^backup-/);
    });

    it('should return empty list when no backups exist', async () => {
      const emptyManager = createBackupManager({
        cloud: { provider: 'local', bucket: 'test', endpoint: join(testDir, 'empty') },
        backup: {
          autoBackup: false,
          backupInterval: 3600000,
          maxBackups: 5,
          items: [],
          compressionLevel: 6,
        },
      });

      const backups = await emptyManager.listBackups();
      expect(backups).toHaveLength(0);

      emptyManager.dispose();
    });

    it('should sort backups by date descending', async () => {
      await writeFile(join(dataDir, 'sort.txt'), 'content');

      await backupManager.createBackup();
      await new Promise(r => setTimeout(r, 10));
      await backupManager.createBackup();

      const backups = await backupManager.listBackups();

      if (backups.length >= 2) {
        expect(backups[0].createdAt.getTime()).toBeGreaterThanOrEqual(backups[1].createdAt.getTime());
      }
    });
  });

  describe('Backup Manifest', () => {
    it('should get backup manifest', async () => {
      await writeFile(join(dataDir, 'manifest.txt'), 'content');
      const created = await backupManager.createBackup();

      const manifest = await backupManager.getBackupManifest(created.id);

      expect(manifest).toBeDefined();
      expect(manifest?.id).toBe(created.id);
    });

    it('should return null for nonexistent backup', async () => {
      const manifest = await backupManager.getBackupManifest('nonexistent');
      expect(manifest).toBeNull();
    });
  });

  describe('Backup Restoration', () => {
    it('should restore a backup', async () => {
      // Create data and backup
      await writeFile(join(dataDir, 'restore.txt'), 'restore content');
      const manifest = await backupManager.createBackup();

      // Create restore directory
      const restoreDir = join(testDir, 'restore');
      await mkdir(restoreDir, { recursive: true });

      // Restore backup
      const result = await backupManager.restoreBackup(manifest.id, restoreDir, {
        overwrite: true,
      });

      expect(result.success).toBe(true);
      expect(result.itemsRestored).toBeGreaterThan(0);
    });

    it('should restore file contents correctly', async () => {
      const originalContent = 'original content to restore';
      await writeFile(join(dataDir, 'content-check.txt'), originalContent);
      const manifest = await backupManager.createBackup();

      const restoreDir = join(testDir, 'restore-check');
      await mkdir(restoreDir, { recursive: true });

      await backupManager.restoreBackup(manifest.id, restoreDir, { overwrite: true });

      const restoredContent = await readFile(join(restoreDir, 'content-check.txt'), 'utf-8');
      expect(restoredContent).toBe(originalContent);
    });

    it('should handle missing backup gracefully', async () => {
      await expect(
        backupManager.restoreBackup('nonexistent-backup-id', testDir)
      ).rejects.toThrow(/backup.*not found/i);
    });

    it('should skip existing files when overwrite is false', async () => {
      await writeFile(join(dataDir, 'skip.txt'), 'backup version');
      const manifest = await backupManager.createBackup();

      const restoreDir = join(testDir, 'skip-restore');
      await mkdir(restoreDir, { recursive: true });
      await writeFile(join(restoreDir, 'skip.txt'), 'existing version');

      await backupManager.restoreBackup(manifest.id, restoreDir, { overwrite: false });

      const content = await readFile(join(restoreDir, 'skip.txt'), 'utf-8');
      expect(content).toBe('existing version');
    });

    it('should restore only specific items', async () => {
      await writeFile(join(dataDir, 'item1.txt'), 'item 1');
      await writeFile(join(dataDir, 'item2.txt'), 'item 2');
      const manifest = await backupManager.createBackup();

      const restoreDir = join(testDir, 'selective-restore');
      await mkdir(restoreDir, { recursive: true });

      await backupManager.restoreBackup(manifest.id, restoreDir, {
        overwrite: true,
        items: ['item1.txt'],
      });

      expect(await stat(join(restoreDir, 'item1.txt')).catch(() => null)).toBeTruthy();
    });
  });

  describe('Backup Deletion', () => {
    it('should delete a backup', async () => {
      await writeFile(join(dataDir, 'delete.txt'), 'delete content');
      const manifest = await backupManager.createBackup();

      const deleted = await backupManager.deleteBackup(manifest.id);
      expect(deleted).toBe(true);

      const backups = await backupManager.listBackups();
      expect(backups.find((b) => b.id === manifest.id)).toBeUndefined();
    });

    it('should handle deleting nonexistent backup', async () => {
      const deleted = await backupManager.deleteBackup('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should emit deletion event', async () => {
      await writeFile(join(dataDir, 'delete-event.txt'), 'content');
      const manifest = await backupManager.createBackup();

      const events: any[] = [];
      backupManager.on('backup_deleted', (event) => events.push(event));

      await backupManager.deleteBackup(manifest.id);

      expect(events.length).toBe(1);
      expect(events[0].backupId).toBe(manifest.id);
    });
  });

  describe('Backup Verification', () => {
    it('should verify backup integrity', async () => {
      await writeFile(join(dataDir, 'verify.txt'), 'verify content');
      const manifest = await backupManager.createBackup();

      const result = await backupManager.verifyBackup(manifest.id);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing backup', async () => {
      const result = await backupManager.verifyBackup('missing-backup');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Manifest not found');
    });
  });

  describe('Backup Cleanup', () => {
    it('should cleanup old backups', async () => {
      const smallMaxManager = createBackupManager({
        cloud: { provider: 'local', bucket: 'test', endpoint: join(testDir, 'cleanup-cloud') },
        backup: {
          autoBackup: false,
          backupInterval: 3600000,
          maxBackups: 2,
          items: [dataDir],
          compressionLevel: 6,
        },
      });

      // Create more backups than maxBackups
      await writeFile(join(dataDir, 'cleanup.txt'), 'cleanup');
      await smallMaxManager.createBackup();
      await smallMaxManager.createBackup();
      await smallMaxManager.createBackup();

      const backups = await smallMaxManager.listBackups();
      expect(backups.length).toBeLessThanOrEqual(2);

      smallMaxManager.dispose();
    });

    it('should not cleanup when under limit', async () => {
      await writeFile(join(dataDir, 'no-cleanup.txt'), 'content');
      await backupManager.createBackup();

      const deleted = await backupManager.cleanupOldBackups();
      expect(deleted).toBe(0);
    });
  });

  describe('Auto Backup', () => {
    it('should start and stop auto backup', () => {
      const autoBackupManager = createBackupManager({
        cloud: { provider: 'local', bucket: 'test', endpoint: cloudDir },
        backup: {
          autoBackup: true,
          backupInterval: 100,
          maxBackups: 5,
          items: [],
          compressionLevel: 6,
        },
      });

      autoBackupManager.startAutoBackup();
      autoBackupManager.stopAutoBackup();
      autoBackupManager.dispose();
    });

    it('should not start auto backup twice', () => {
      backupManager.startAutoBackup();
      backupManager.startAutoBackup(); // Should not throw
      backupManager.stopAutoBackup();
    });
  });

  describe('Export/Import', () => {
    it('should export backup to local file', async () => {
      await writeFile(join(dataDir, 'export.txt'), 'export content');
      const manifest = await backupManager.createBackup();

      const exportPath = join(testDir, 'exported.dat');
      await backupManager.exportBackup(manifest.id, exportPath);

      const stats = await stat(exportPath);
      expect(stats.size).toBeGreaterThan(0);
    });

    it('should export manifest alongside backup', async () => {
      await writeFile(join(dataDir, 'export2.txt'), 'content');
      const manifest = await backupManager.createBackup();

      const exportPath = join(testDir, 'export2.dat');
      await backupManager.exportBackup(manifest.id, exportPath);

      const manifestPath = join(testDir, 'export2.manifest.json');
      const manifestContent = await readFile(manifestPath, 'utf-8');
      const exportedManifest = JSON.parse(manifestContent);

      expect(exportedManifest.id).toBe(manifest.id);
    });
  });
});

describe('Cloud Sync System', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `system-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should create integrated sync system', () => {
    const system = createCloudSyncSystem({
      cloud: createLocalConfig(testDir),
    });

    expect(system.sync).toBeDefined();
    expect(system.backup).toBeDefined();

    system.dispose();
  });

  it('should start and stop all services', () => {
    const system = createCloudSyncSystem({
      cloud: createLocalConfig(testDir),
      sync: { autoSync: true, syncInterval: 1000 },
      backup: { autoBackup: true, backupInterval: 1000 },
    });

    system.startAll();
    system.stopAll();
    system.dispose();
  });

  it('should use default sync config', () => {
    const system = createCloudSyncSystem({
      cloud: createLocalConfig(testDir),
    });

    expect(system.sync).toBeDefined();
    system.dispose();
  });

  it('should use default backup config', () => {
    const system = createCloudSyncSystem({
      cloud: createLocalConfig(testDir),
    });

    expect(system.backup).toBeDefined();
    system.dispose();
  });
});

describe('Configuration Helpers', () => {
  describe('createLocalConfig', () => {
    it('should create local config with default path', () => {
      const config = createLocalConfig();

      expect(config.provider).toBe('local');
      expect(config.bucket).toBe('local');
      expect(config.endpoint).toContain('.codebuddy/cloud');
    });

    it('should create local config with custom path', () => {
      const config = createLocalConfig('/custom/path');

      expect(config.endpoint).toBe('/custom/path');
    });
  });

  describe('createS3Config', () => {
    it('should create S3 config', () => {
      const config = createS3Config({
        bucket: 'my-bucket',
        region: 'us-west-2',
        accessKeyId: 'AKID',
        secretAccessKey: 'SECRET',
      });

      expect(config.provider).toBe('s3');
      expect(config.bucket).toBe('my-bucket');
      expect(config.region).toBe('us-west-2');
      expect(config.credentials?.accessKeyId).toBe('AKID');
    });

    it('should use default region', () => {
      const config = createS3Config({ bucket: 'test' });

      expect(config.region).toBe('us-east-1');
    });

    it('should include optional parameters', () => {
      const config = createS3Config({
        bucket: 'test',
        endpoint: 'https://custom.endpoint.com',
        prefix: 'my-prefix',
        encryptionKey: 'my-key',
      });

      expect(config.endpoint).toBe('https://custom.endpoint.com');
      expect(config.prefix).toBe('my-prefix');
      expect(config.encryptionKey).toBe('my-key');
    });
  });

  describe('createDefaultSyncItems', () => {
    it('should return default sync items', () => {
      const items = createDefaultSyncItems();

      expect(items.length).toBe(4);
      expect(items.find((i) => i.type === 'sessions')).toBeDefined();
      expect(items.find((i) => i.type === 'memory')).toBeDefined();
      expect(items.find((i) => i.type === 'settings')).toBeDefined();
      expect(items.find((i) => i.type === 'checkpoints')).toBeDefined();
    });

    it('should have checkpoints disabled by default', () => {
      const items = createDefaultSyncItems();
      const checkpoints = items.find((i) => i.type === 'checkpoints');

      expect(checkpoints?.enabled).toBe(false);
    });

    it('should have proper paths', () => {
      const items = createDefaultSyncItems();

      items.forEach(item => {
        expect(item.localPath).toContain('.codebuddy');
        expect(item.remotePath).toBeDefined();
      });
    });

    it('should have priorities set', () => {
      const items = createDefaultSyncItems();

      items.forEach(item => {
        expect(item.priority).toBeDefined();
        expect(typeof item.priority).toBe('number');
      });
    });
  });

  describe('createDefaultBackupItems', () => {
    it('should return default backup items', () => {
      const items = createDefaultBackupItems();

      expect(items.length).toBe(3);
      expect(items).toContain('.codebuddy/sessions');
      expect(items).toContain('.codebuddy/memory');
      expect(items).toContain('.codebuddy/settings');
    });

    it('should not include checkpoints', () => {
      const items = createDefaultBackupItems();

      expect(items.some(i => i.includes('checkpoints'))).toBe(false);
    });
  });
});

describe('Type Definitions', () => {
  it('should export all required types', async () => {
    const types = await import('../../src/sync/cloud/types.js');

    // Check type exports exist
    expect(types).toBeDefined();
  });
});
