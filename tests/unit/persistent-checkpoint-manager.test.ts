/**
 * Comprehensive Unit Tests for Persistent Checkpoint Manager
 *
 * Tests cover:
 * 1. Initialization and directory setup
 * 2. Checkpoint creation
 * 3. Checkpoint restoration
 * 4. Index management
 * 5. Cache operations
 * 6. Statistics and formatting
 * 7. Cleanup and deletion
 */

import { EventEmitter } from 'events';

// Create mock functions for fs
const mockExistsSync = jest.fn().mockReturnValue(false);
const mockMkdirSync = jest.fn();
const mockReadFileSync = jest.fn().mockReturnValue('file content');
const mockWriteFileSync = jest.fn();
const mockUnlinkSync = jest.fn();
const mockStatSync = jest.fn().mockReturnValue({ isFile: () => true, size: 100 });
const mockReaddirSync = jest.fn().mockReturnValue([]);

// Mock fs before importing the module
jest.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

// Mock os
jest.mock('os', () => ({
  homedir: () => '/home/testuser',
}));

// Mock crypto
jest.mock('crypto', () => ({
  createHash: () => ({
    update: jest.fn().mockReturnThis(),
    digest: () => 'abcdef1234567890',
  }),
  randomBytes: () => ({
    toString: () => 'abcd1234',
  }),
}));

// Mock path with actual implementation
jest.mock('path', () => {
  const actualPath = jest.requireActual('path');
  return {
    ...actualPath,
    join: (...args: string[]) => args.join('/'),
    dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
    basename: (p: string) => p.split('/').pop() || '',
    resolve: (...args: string[]) => args.join('/'),
  };
});

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  PersistentCheckpointManager,
  getPersistentCheckpointManager,
  resetPersistentCheckpointManager,
  PersistentCheckpoint,
  CheckpointIndex,
} from '../../src/checkpoints/persistent-checkpoint-manager';

// Set a short test timeout
jest.setTimeout(10000);

describe('PersistentCheckpointManager', () => {
  let manager: PersistentCheckpointManager;

  // Sample index for testing
  const createSampleIndex = (): CheckpointIndex => ({
    projectHash: 'abcdef1234567890'.substring(0, 16),
    projectPath: '/test/project',
    checkpoints: [],
    lastUpdated: new Date(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetPersistentCheckpointManager();

    // Reset mock implementations
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('file content');
    mockStatSync.mockReturnValue({ isFile: () => true, size: 100 });
    mockReaddirSync.mockReturnValue([]);

    // Create manager with test options
    manager = new PersistentCheckpointManager({
      maxCheckpoints: 10,
      autoCheckpoint: true,
      historyDir: '/home/testuser/.codebuddy/history',
    });
  });

  afterEach(() => {
    if (manager) {
      manager.dispose();
    }
    resetPersistentCheckpointManager();
  });

  afterAll(() => {
    resetPersistentCheckpointManager();
  });

  describe('Constructor and Initialization', () => {
    it('should create manager with default options', () => {
      const m = new PersistentCheckpointManager();
      expect(m).toBeDefined();
      expect(m).toBeInstanceOf(PersistentCheckpointManager);
      expect(m).toBeInstanceOf(EventEmitter);
      m.dispose();
    });

    it('should create manager with custom options', () => {
      const m = new PersistentCheckpointManager({
        maxCheckpoints: 50,
        autoCheckpoint: false,
        historyDir: '/custom/history',
      });
      expect(m).toBeDefined();
      expect(m.isAutoCheckpointEnabled()).toBe(false);
      m.dispose();
    });

    it('should create history directory if it does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const m = new PersistentCheckpointManager();

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      m.dispose();
    });

    it('should create index file if it does not exist', () => {
      mockExistsSync
        .mockReturnValueOnce(false)  // history dir doesn't exist
        .mockReturnValueOnce(false); // index file doesn't exist

      const m = new PersistentCheckpointManager();

      expect(mockWriteFileSync).toHaveBeenCalled();
      m.dispose();
    });

    it('should handle directory operations correctly when directory exists', () => {
      mockExistsSync.mockReturnValue(true);

      const m = new PersistentCheckpointManager();

      // Directory may still be created, but it should work without error
      expect(m).toBeDefined();
      m.dispose();
    });

    it('should handle directory creation errors gracefully', () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not throw
      const m = new PersistentCheckpointManager();
      expect(m).toBeDefined();
      m.dispose();
    });
  });

  describe('Checkpoint Creation', () => {
    beforeEach(() => {
      // Setup for checkpoint creation
      const indexData = JSON.stringify(createSampleIndex());
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return indexData;
        }
        return 'file content';
      });
    });

    it('should create a checkpoint with description', () => {
      const checkpoint = manager.createCheckpoint('Test checkpoint');

      expect(checkpoint).toBeDefined();
      expect(checkpoint.id).toMatch(/^cp_/);
      expect(checkpoint.description).toBe('Test checkpoint');
      expect(checkpoint.timestamp).toBeInstanceOf(Date);
      expect(checkpoint.files).toEqual([]);
    });

    it('should create checkpoint with files', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isFile: () => true, size: 100 });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(createSampleIndex());
        }
        return 'file content';
      });

      const checkpoint = manager.createCheckpoint('With files', ['/test/file1.ts', '/test/file2.ts']);

      expect(checkpoint.files.length).toBe(2);
      expect(checkpoint.files[0].existed).toBe(true);
      expect(checkpoint.files[0].content).toBe('file content');
    });

    it('should mark non-existent files correctly', () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('index.json') || path.includes('history')) {
          return true;
        }
        return false; // File doesn't exist
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(createSampleIndex());
        }
        return 'file content';
      });

      const checkpoint = manager.createCheckpoint('Non-existent file', ['/test/missing.ts']);

      expect(checkpoint.files.length).toBe(1);
      expect(checkpoint.files[0].existed).toBe(false);
      expect(checkpoint.files[0].content).toBe('');
    });

    it('should save checkpoint to disk', () => {
      const checkpoint = manager.createCheckpoint('Save test');

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining(checkpoint.id),
        expect.any(String)
      );
    });

    it('should update index after creating checkpoint', () => {
      const initialIndex = createSampleIndex();
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(initialIndex);
        }
        return 'file content';
      });

      const checkpoint = manager.createCheckpoint('Index test');

      // Index should be updated with new checkpoint ID
      const writeCall = mockWriteFileSync.mock.calls.find(
        (call) => call[0].includes('index.json')
      );
      expect(writeCall).toBeDefined();
      const savedIndex = JSON.parse(writeCall![1]);
      expect(savedIndex.checkpoints).toContain(checkpoint.id);
    });

    it('should emit checkpoint-created event', () => {
      const handler = jest.fn();
      manager.on('checkpoint-created', handler);

      const checkpoint = manager.createCheckpoint('Event test');

      expect(handler).toHaveBeenCalledWith(checkpoint);
    });

    it('should trim old checkpoints when exceeding max', () => {
      const index: CheckpointIndex = {
        ...createSampleIndex(),
        checkpoints: Array.from({ length: 10 }, (_, i) => `cp_${i}`),
      };

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(index);
        }
        return 'file content';
      });

      manager.createCheckpoint('Trim test');

      // Should have deleted the oldest checkpoint
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('should cache created checkpoint', () => {
      const checkpoint = manager.createCheckpoint('Cache test');

      // Getting the same checkpoint should return cached version
      const cached = manager.getCheckpoint(checkpoint.id);

      expect(cached).toBe(checkpoint);
    });

    it('should skip directories when snapshotting files', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isFile: () => false, isDirectory: () => true, size: 0 });

      const checkpoint = manager.createCheckpoint('Dir test', ['/test/directory']);

      expect(checkpoint.files.length).toBe(0);
    });

    it('should handle file read errors', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isFile: () => true, size: 100 });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(createSampleIndex());
        }
        throw new Error('Read error');
      });

      const checkpoint = manager.createCheckpoint('Error test', ['/test/error.ts']);

      // Should skip files that can't be read
      expect(checkpoint.files.length).toBe(0);
    });
  });

  describe('Checkpoint Before Edit/Create', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(createSampleIndex());
        }
        return 'existing content';
      });
      mockStatSync.mockReturnValue({ isFile: () => true, size: 100 });
    });

    it('should create checkpoint before editing a file', () => {
      const checkpoint = manager.checkpointBeforeEdit('/test/file.ts');

      expect(checkpoint.description).toBe('Before editing: file.ts');
      expect(checkpoint.files.length).toBe(1);
    });

    it('should create checkpoint before editing with custom description', () => {
      const checkpoint = manager.checkpointBeforeEdit('/test/file.ts', 'Custom edit description');

      expect(checkpoint.description).toBe('Custom edit description');
    });

    it('should create checkpoint before creating a file', () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('index.json') || path.includes('history')) {
          return true;
        }
        return false; // File doesn't exist yet
      });

      const checkpoint = manager.checkpointBeforeCreate('/test/new-file.ts');

      expect(checkpoint.description).toBe('Before creating: new-file.ts');
      expect(checkpoint.files[0].existed).toBe(false);
    });

    it('should create checkpoint before creating with custom description', () => {
      const checkpoint = manager.checkpointBeforeCreate('/test/new-file.ts', 'Custom create description');

      expect(checkpoint.description).toBe('Custom create description');
    });
  });

  describe('Checkpoint Restoration', () => {
    let savedCheckpoint: PersistentCheckpoint;

    beforeEach(() => {
      savedCheckpoint = {
        id: 'cp_test_restore',
        timestamp: new Date(),
        description: 'Restore test',
        files: [
          {
            path: '/test/project/file1.ts',
            content: 'restored content',
            existed: true,
            hash: 'abc123',
          },
          {
            path: '/test/project/file2.ts',
            content: '',
            existed: false,
            hash: '',
          },
        ],
        workingDirectory: '/test/project',
        projectHash: 'abcdef12345678',
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify({
            ...createSampleIndex(),
            checkpoints: ['cp_test_restore'],
          });
        }
        if (path.includes('cp_test_restore')) {
          return JSON.stringify(savedCheckpoint);
        }
        return 'file content';
      });
    });

    it('should restore a checkpoint by ID', () => {
      const result = manager.restore('cp_test_restore');

      expect(result.restored.length).toBeGreaterThan(0);
      expect(result.checkpoint).toBeDefined();
    });

    it('should restore file content', () => {
      manager.restore('cp_test_restore');

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/test/project/file1.ts',
        'restored content'
      );
    });

    it('should delete file that did not exist', () => {
      mockExistsSync.mockImplementation(() => {
        return true; // All files exist now
      });

      manager.restore('cp_test_restore');

      expect(mockUnlinkSync).toHaveBeenCalledWith('/test/project/file2.ts');
    });

    it('should create directories if needed', () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('index.json') || path.includes('cp_test_restore')) {
          return true;
        }
        return false; // Parent directory doesn't exist
      });

      manager.restore('cp_test_restore');

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
    });

    it('should return error for non-existent checkpoint', () => {
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(createSampleIndex());
        }
        return 'content';
      });
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('nonexistent')) {
          return false;
        }
        return true;
      });

      const result = manager.restore('nonexistent');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Checkpoint not found: nonexistent');
    });

    it('should emit restore event', () => {
      const handler = jest.fn();
      manager.on('restore', handler);

      manager.restore('cp_test_restore');

      expect(handler).toHaveBeenCalled();
    });

    it('should handle restore errors gracefully', () => {
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      const result = manager.restore('cp_test_restore');

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should restore to last checkpoint', () => {
      // Setup mock to return proper data for restoreLast
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify({
            ...createSampleIndex(),
            checkpoints: ['cp_test_restore'],
          });
        }
        if (path.includes('cp_test_restore')) {
          return JSON.stringify(savedCheckpoint);
        }
        return 'file content';
      });

      const result = manager.restoreLast();

      expect(result.checkpoint?.id).toBe('cp_test_restore');
    });

    it('should return error when no checkpoints for restoreLast', () => {
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(createSampleIndex()); // Empty checkpoints
        }
        return 'content';
      });

      const result = manager.restoreLast();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('No checkpoints available');
    });
  });

  describe('Checkpoint Retrieval', () => {
    const checkpointIds = ['cp_1', 'cp_2', 'cp_3'];

    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify({
            ...createSampleIndex(),
            checkpoints: checkpointIds,
          });
        }
        const id = checkpointIds.find(id => path.includes(id));
        if (id) {
          return JSON.stringify({
            id,
            timestamp: new Date(),
            description: `Checkpoint ${id}`,
            files: [],
            workingDirectory: '/test',
            projectHash: 'abc123',
          });
        }
        return 'content';
      });
    });

    it('should get all checkpoints', () => {
      const checkpoints = manager.getCheckpoints();

      expect(checkpoints.length).toBe(3);
    });

    it('should get checkpoint by ID', () => {
      const checkpoint = manager.getCheckpoint('cp_2');

      expect(checkpoint).toBeDefined();
      expect(checkpoint?.id).toBe('cp_2');
    });

    it('should return null for non-existent checkpoint', () => {
      const checkpoint = manager.getCheckpoint('nonexistent');

      expect(checkpoint).toBeNull();
    });

    it('should get recent checkpoints', () => {
      const recent = manager.getRecentCheckpoints(2);

      expect(recent.length).toBe(2);
      expect(recent[0].id).toBe('cp_2');
      expect(recent[1].id).toBe('cp_3');
    });

    it('should cache loaded checkpoints', () => {
      // First load
      manager.getCheckpoint('cp_1');

      // Clear read mock to verify cache is used
      mockReadFileSync.mockClear();

      // Second load should use cache
      manager.getCheckpoint('cp_1');

      // Should not have read the checkpoint file again
      const checkpointReads = mockReadFileSync.mock.calls.filter(
        call => call[0].includes('cp_1.json')
      );
      expect(checkpointReads.length).toBe(0);
    });

    it('should convert timestamp string to Date object', () => {
      const checkpoint = manager.getCheckpoint('cp_1');

      expect(checkpoint?.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Checkpoint Deletion', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify({
            ...createSampleIndex(),
            checkpoints: ['cp_1', 'cp_2', 'cp_3'],
          });
        }
        return JSON.stringify({
          id: 'cp_1',
          timestamp: new Date(),
          description: 'Test',
          files: [],
          workingDirectory: '/test',
          projectHash: 'abc',
        });
      });
    });

    it('should delete a specific checkpoint', () => {
      const result = manager.deleteCheckpoint('cp_2');

      expect(result).toBe(true);
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('should update index after deletion', () => {
      manager.deleteCheckpoint('cp_2');

      const writeCall = mockWriteFileSync.mock.calls.find(
        call => call[0].includes('index.json')
      );
      expect(writeCall).toBeDefined();
      const savedIndex = JSON.parse(writeCall![1]);
      expect(savedIndex.checkpoints).not.toContain('cp_2');
    });

    it('should return false for non-existent checkpoint', () => {
      const result = manager.deleteCheckpoint('nonexistent');

      expect(result).toBe(false);
    });

    it('should remove from cache when deleted', () => {
      // Load checkpoint to cache it
      manager.getCheckpoint('cp_1');

      // Delete it
      manager.deleteCheckpoint('cp_1');

      // Verify it's removed from cache
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify({
            ...createSampleIndex(),
            checkpoints: ['cp_2', 'cp_3'],
          });
        }
        if (path.includes('cp_1')) {
          throw new Error('File not found');
        }
        return 'content';
      });
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('cp_1')) {
          return false;
        }
        return true;
      });

      const result = manager.getCheckpoint('cp_1');
      expect(result).toBeNull();
    });

    it('should clear all checkpoints', () => {
      manager.clearCheckpoints();

      expect(mockUnlinkSync).toHaveBeenCalledTimes(3);
    });

    it('should emit checkpoints-cleared event', () => {
      const handler = jest.fn();
      manager.on('checkpoints-cleared', handler);

      manager.clearCheckpoints();

      expect(handler).toHaveBeenCalled();
    });

    it('should update index when clearing all', () => {
      manager.clearCheckpoints();

      const writeCall = mockWriteFileSync.mock.calls.find(
        call => call[0].includes('index.json')
      );
      expect(writeCall).toBeDefined();
      const savedIndex = JSON.parse(writeCall![1]);
      expect(savedIndex.checkpoints).toEqual([]);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['cp_1.json', 'cp_2.json', 'index.json']);
      mockStatSync.mockReturnValue({ isFile: () => true, size: 1024 });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify({
            ...createSampleIndex(),
            checkpoints: ['cp_1', 'cp_2'],
          });
        }
        return JSON.stringify({
          id: path.includes('cp_1') ? 'cp_1' : 'cp_2',
          timestamp: new Date('2024-01-15T10:00:00Z'),
          description: 'Test',
          files: [{ path: '/test/file.ts', content: 'content', existed: true, hash: 'abc' }],
          workingDirectory: '/test',
          projectHash: 'abc',
        });
      });
    });

    it('should get checkpoint statistics', () => {
      const stats = manager.getStats();

      expect(stats.count).toBe(2);
      expect(stats.totalFiles).toBe(2);
      expect(stats.storageSize).toBeGreaterThan(0);
      expect(stats.storagePath).toBeDefined();
    });

    it('should include oldest and newest timestamps', () => {
      const stats = manager.getStats();

      expect(stats.oldestTimestamp).toBeDefined();
      expect(stats.newestTimestamp).toBeDefined();
    });

    it('should handle empty checkpoints', () => {
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(createSampleIndex());
        }
        return 'content';
      });

      const stats = manager.getStats();

      expect(stats.count).toBe(0);
      expect(stats.totalFiles).toBe(0);
    });

    it('should handle storage size calculation errors', () => {
      mockReaddirSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      const stats = manager.getStats();

      expect(stats.storageSize).toBe(0);
    });
  });

  describe('Formatting', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify({
            ...createSampleIndex(),
            checkpoints: ['cp_1', 'cp_2'],
          });
        }
        const id = path.includes('cp_1') ? 'cp_1' : 'cp_2';
        return JSON.stringify({
          id,
          timestamp: new Date('2024-01-15T10:00:00Z'),
          description: `Checkpoint ${id}`,
          files: [{ path: '/test/file.ts', content: 'content', existed: true, hash: 'abc' }],
          workingDirectory: '/test',
          projectHash: 'abc',
        });
      });
    });

    it('should format single checkpoint for display', () => {
      const checkpoint = manager.getCheckpoint('cp_1')!;
      const formatted = manager.formatCheckpoint(checkpoint);

      expect(formatted).toContain('[cp_1');
      expect(formatted).toContain('Checkpoint cp_1');
      expect(formatted).toContain('1 file');
    });

    it('should pluralize files correctly', () => {
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify({
            ...createSampleIndex(),
            checkpoints: ['cp_multi'],
          });
        }
        return JSON.stringify({
          id: 'cp_multi',
          timestamp: new Date(),
          description: 'Multi files',
          files: [
            { path: '/test/file1.ts', content: '', existed: true, hash: '' },
            { path: '/test/file2.ts', content: '', existed: true, hash: '' },
          ],
          workingDirectory: '/test',
          projectHash: 'abc',
        });
      });

      const checkpoint = manager.getCheckpoint('cp_multi')!;
      const formatted = manager.formatCheckpoint(checkpoint);

      expect(formatted).toContain('2 files');
    });

    it('should format checkpoint list', () => {
      const formatted = manager.formatCheckpointList();

      expect(formatted).toContain('Checkpoints (persistent)');
      expect(formatted).toContain('1.');
      expect(formatted).toContain('2.');
      expect(formatted).toContain('/restore');
    });

    it('should show message when no checkpoints', () => {
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(createSampleIndex());
        }
        return 'content';
      });

      const formatted = manager.formatCheckpointList();

      expect(formatted).toBe('No checkpoints available.');
    });
  });

  describe('Auto Checkpoint Settings', () => {
    it('should check if auto checkpoint is enabled', () => {
      const enabled = manager.isAutoCheckpointEnabled();

      expect(enabled).toBe(true);
    });

    it('should enable auto checkpoint', () => {
      manager.setAutoCheckpoint(true);

      expect(manager.isAutoCheckpointEnabled()).toBe(true);
    });

    it('should disable auto checkpoint', () => {
      manager.setAutoCheckpoint(false);

      expect(manager.isAutoCheckpointEnabled()).toBe(false);
    });
  });

  describe('History Directory', () => {
    it('should return history directory path', () => {
      const historyDir = manager.getHistoryDir();

      expect(historyDir).toBeDefined();
      expect(typeof historyDir).toBe('string');
    });
  });

  describe('Dispose', () => {
    it('should clean up on dispose', () => {
      manager.dispose();

      expect(manager.listenerCount('checkpoint-created')).toBe(0);
    });

    it('should remove all event listeners', () => {
      const handler = jest.fn();
      manager.on('checkpoint-created', handler);
      manager.on('restore', handler);

      manager.dispose();

      expect(manager.listenerCount('checkpoint-created')).toBe(0);
      expect(manager.listenerCount('restore')).toBe(0);
    });
  });

  describe('Singleton Functions', () => {
    it('should return same instance via getPersistentCheckpointManager', () => {
      resetPersistentCheckpointManager();

      const instance1 = getPersistentCheckpointManager();
      const instance2 = getPersistentCheckpointManager();

      expect(instance1).toBe(instance2);

      resetPersistentCheckpointManager();
    });

    it('should create new instance after reset', () => {
      resetPersistentCheckpointManager();

      const instance1 = getPersistentCheckpointManager();
      resetPersistentCheckpointManager();
      const instance2 = getPersistentCheckpointManager();

      expect(instance1).not.toBe(instance2);

      resetPersistentCheckpointManager();
    });

    it('should apply options to singleton', () => {
      resetPersistentCheckpointManager();

      const instance = getPersistentCheckpointManager({ autoCheckpoint: false });

      expect(instance.isAutoCheckpointEnabled()).toBe(false);

      resetPersistentCheckpointManager();
    });
  });

  describe('Index Management', () => {
    it('should load index from disk', () => {
      const savedIndex: CheckpointIndex = {
        projectHash: 'abc123',
        projectPath: '/test/project',
        checkpoints: ['cp_1', 'cp_2'],
        lastUpdated: new Date(),
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(savedIndex);
        }
        return 'content';
      });

      manager.getCheckpoints();

      // getCheckpoints loads checkpoints based on index
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('index.json'),
        'utf-8'
      );
    });

    it('should handle corrupted index gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return 'invalid json';
        }
        return 'content';
      });

      // Should not throw, should return empty
      const checkpoints = manager.getCheckpoints();

      expect(checkpoints).toEqual([]);
    });

    it('should update lastUpdated when saving index', () => {
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(createSampleIndex());
        }
        return 'content';
      });

      manager.createCheckpoint('Update test');

      const writeCall = mockWriteFileSync.mock.calls.find(
        call => call[0].includes('index.json')
      );
      expect(writeCall).toBeDefined();
      const savedIndex = JSON.parse(writeCall![1]);
      expect(savedIndex.lastUpdated).toBeDefined();
    });
  });

  describe('Project Hash Generation', () => {
    it('should generate consistent hash for same project path', () => {
      resetPersistentCheckpointManager();

      const manager1 = new PersistentCheckpointManager();
      const manager2 = new PersistentCheckpointManager();

      // Both should use same project hash since they're in same directory
      expect(manager1.getHistoryDir()).toBe(manager2.getHistoryDir());

      manager1.dispose();
      manager2.dispose();
    });
  });

  describe('File Snapshot Hashing', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isFile: () => true, size: 100 });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('index.json')) {
          return JSON.stringify(createSampleIndex());
        }
        return 'file content to hash';
      });
    });

    it('should generate hash for file content', () => {
      const checkpoint = manager.createCheckpoint('Hash test', ['/test/file.ts']);

      expect(checkpoint.files[0].hash).toBeDefined();
      expect(checkpoint.files[0].hash.length).toBe(16);
    });

    it('should generate empty hash for non-existent file', () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('index.json') || path.includes('history')) {
          return true;
        }
        return false;
      });

      const checkpoint = manager.createCheckpoint('Empty hash test', ['/test/missing.ts']);

      expect(checkpoint.files[0].hash).toBe('');
    });
  });
});
