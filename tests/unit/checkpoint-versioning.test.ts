/**
 * Comprehensive Unit Tests for Checkpoint Versioning
 *
 * Tests cover:
 * 1. Version creation
 * 2. Tag management
 * 3. Branch operations
 * 4. Version history
 * 5. Checkout operations
 * 6. Diff operations
 * 7. Persistence (save/load)
 * 8. Statistics and pruning
 */

import { EventEmitter } from 'events';

// Create mock functions for fs-extra
const mockEnsureDir = jest.fn().mockResolvedValue(undefined);
const mockPathExists = jest.fn().mockResolvedValue(false);
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
const mockWriteJson = jest.fn().mockResolvedValue(undefined);
const mockReadJson = jest.fn().mockResolvedValue({});
const mockUnlink = jest.fn().mockResolvedValue(undefined);

// Mock fs-extra before importing the module
jest.mock('fs-extra', () => ({
  __esModule: true,
  default: {
    ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
    pathExists: (...args: unknown[]) => mockPathExists(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    writeJson: (...args: unknown[]) => mockWriteJson(...args),
    readJson: (...args: unknown[]) => mockReadJson(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
  ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
  pathExists: (...args: unknown[]) => mockPathExists(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  writeJson: (...args: unknown[]) => mockWriteJson(...args),
  readJson: (...args: unknown[]) => mockReadJson(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

// Mock crypto
jest.mock('crypto', () => ({
  createHash: () => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('abcdef1234567890abcdef1234567890'),
  }),
}));

import {
  CheckpointVersioning,
  getCheckpointVersioning,
  resetCheckpointVersioning,
} from '../../src/checkpoints/checkpoint-versioning';
import type { Checkpoint } from '../../src/checkpoints/checkpoint-manager';

// Set a short test timeout
jest.setTimeout(10000);

describe('CheckpointVersioning', () => {
  let versioning: CheckpointVersioning;

  // Sample checkpoint for testing
  const createSampleCheckpoint = (id = 'cp_test_123', description = 'Test checkpoint'): Checkpoint => ({
    id,
    timestamp: new Date('2024-01-15T10:00:00Z'),
    description,
    files: [
      {
        path: '/test/file1.ts',
        content: 'const x = 1;',
        existed: true,
      },
      {
        path: '/test/file2.ts',
        content: 'const y = 2;',
        existed: true,
      },
    ],
    workingDirectory: '/test',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetCheckpointVersioning();

    // Reset mock implementations
    mockPathExists.mockResolvedValue(false);
    mockWriteJson.mockResolvedValue(undefined);
    mockReadJson.mockResolvedValue({});

    versioning = new CheckpointVersioning({
      storageDir: '.codebuddy/versions',
      defaultBranch: 'main',
      autoSave: false,
    });
  });

  afterEach(() => {
    if (versioning) {
      versioning.dispose();
    }
    resetCheckpointVersioning();
  });

  afterAll(() => {
    resetCheckpointVersioning();
  });

  describe('Constructor and Initialization', () => {
    it('should create versioning instance with default config', () => {
      const v = new CheckpointVersioning();
      expect(v).toBeDefined();
      expect(v).toBeInstanceOf(CheckpointVersioning);
      expect(v).toBeInstanceOf(EventEmitter);
      expect(v.getCurrentBranch()).toBe('main');
      v.dispose();
    });

    it('should create versioning instance with custom config', () => {
      const v = new CheckpointVersioning({
        storageDir: '.custom/versions',
        defaultBranch: 'develop',
        maxVersionsPerBranch: 50,
        autoSave: false,
      });
      expect(v.getCurrentBranch()).toBe('develop');
      v.dispose();
    });

    it('should initialize default branch', () => {
      const branches = versioning.getBranches();
      expect(branches.length).toBe(1);
      expect(branches[0].name).toBe('main');
      expect(branches[0].description).toBe('Default branch');
    });
  });

  describe('Version Creation', () => {
    it('should create a version from checkpoint', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      expect(version).toBeDefined();
      expect(version.id).toMatch(/^v_/);
      expect(version.checkpoint).toBe(checkpoint);
      expect(version.branchName).toBe('main');
      expect(version.parentId).toBeNull();
      expect(version.createdAt).toBeInstanceOf(Date);
    });

    it('should create version with name and description', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint, {
        name: 'v1.0.0',
        description: 'Initial release',
      });

      expect(version.name).toBe('v1.0.0');
      expect(version.description).toBe('Initial release');
    });

    it('should use checkpoint description when not provided', () => {
      const checkpoint = createSampleCheckpoint('cp_1', 'Checkpoint description');
      const version = versioning.createVersion(checkpoint);

      expect(version.description).toBe('Checkpoint description');
    });

    it('should create version with metadata', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint, {
        metadata: {
          sessionId: 'session-123',
          toolName: 'TextEditor',
          tags: ['feature', 'important'],
          custom: { priority: 'high' },
        },
      });

      expect(version.metadata.sessionId).toBe('session-123');
      expect(version.metadata.toolName).toBe('TextEditor');
      expect(version.metadata.tags).toContain('feature');
      expect(version.metadata.tags).toContain('important');
      expect(version.metadata.custom.priority).toBe('high');
    });

    it('should set parentId from previous version', () => {
      const cp1 = createSampleCheckpoint('cp_1');
      const cp2 = createSampleCheckpoint('cp_2');

      const v1 = versioning.createVersion(cp1);
      const v2 = versioning.createVersion(cp2);

      expect(v2.parentId).toBe(v1.id);
    });

    it('should update branch head after creating version', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      const branches = versioning.getBranches();
      const mainBranch = branches.find(b => b.name === 'main');
      expect(mainBranch?.headVersionId).toBe(version.id);
    });

    it('should emit version-created event', () => {
      const handler = jest.fn();
      versioning.on('version-created', handler);

      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      expect(handler).toHaveBeenCalledWith(version);
    });

    it('should throw error if branch not found', () => {
      // Force switch to non-existent branch (via internal manipulation for testing)
      (versioning as any).currentBranch = 'nonexistent';

      const checkpoint = createSampleCheckpoint();
      expect(() => versioning.createVersion(checkpoint)).toThrow('Branch not found: nonexistent');
    });
  });

  describe('Tag Management', () => {
    it('should create a tag for a version', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      versioning.createTag(version.id, 'release-1.0');

      const tags = versioning.getTags();
      expect(tags.get('release-1.0')).toBe(version.id);
    });

    it('should emit tag-created event', () => {
      const handler = jest.fn();
      versioning.on('tag-created', handler);

      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);
      versioning.createTag(version.id, 'test-tag');

      expect(handler).toHaveBeenCalledWith({
        tagName: 'test-tag',
        versionId: version.id,
      });
    });

    it('should throw error if version not found for tag', () => {
      expect(() => versioning.createTag('nonexistent', 'tag')).toThrow(
        'Version not found: nonexistent'
      );
    });

    it('should throw error if tag already exists', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      versioning.createTag(version.id, 'existing-tag');

      expect(() => versioning.createTag(version.id, 'existing-tag')).toThrow(
        'Tag already exists: existing-tag'
      );
    });

    it('should delete a tag', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);
      versioning.createTag(version.id, 'to-delete');

      const result = versioning.deleteTag('to-delete');

      expect(result).toBe(true);
      expect(versioning.getTags().has('to-delete')).toBe(false);
    });

    it('should return false when deleting non-existent tag', () => {
      const result = versioning.deleteTag('nonexistent');
      expect(result).toBe(false);
    });

    it('should get version by tag name', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);
      versioning.createTag(version.id, 'my-tag');

      const retrieved = versioning.getVersionByTag('my-tag');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(version.id);
    });

    it('should return undefined for non-existent tag', () => {
      const result = versioning.getVersionByTag('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('Branch Operations', () => {
    it('should create a new branch', () => {
      const branch = versioning.createBranch('feature', undefined, 'Feature branch');

      expect(branch).toBeDefined();
      expect(branch.name).toBe('feature');
      expect(branch.description).toBe('Feature branch');
      expect(branch.createdAt).toBeInstanceOf(Date);
    });

    it('should create branch from specific version', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      const branch = versioning.createBranch('feature', version.id);

      expect(branch.headVersionId).toBe(version.id);
    });

    it('should emit branch-created event', () => {
      const handler = jest.fn();
      versioning.on('branch-created', handler);

      const branch = versioning.createBranch('feature');

      expect(handler).toHaveBeenCalledWith(branch);
    });

    it('should throw error if branch already exists', () => {
      versioning.createBranch('feature');

      expect(() => versioning.createBranch('feature')).toThrow(
        'Branch already exists: feature'
      );
    });

    it('should switch to a different branch', () => {
      versioning.createBranch('feature');
      const branch = versioning.switchBranch('feature');

      expect(branch.name).toBe('feature');
      expect(versioning.getCurrentBranch()).toBe('feature');
    });

    it('should emit branch-switched event', () => {
      const handler = jest.fn();
      versioning.on('branch-switched', handler);

      versioning.createBranch('feature');
      const branch = versioning.switchBranch('feature');

      expect(handler).toHaveBeenCalledWith(branch);
    });

    it('should throw error when switching to non-existent branch', () => {
      expect(() => versioning.switchBranch('nonexistent')).toThrow(
        'Branch not found: nonexistent'
      );
    });

    it('should delete a branch', () => {
      versioning.createBranch('feature');
      const result = versioning.deleteBranch('feature');

      expect(result).toBe(true);
      expect(versioning.getBranches().find(b => b.name === 'feature')).toBeUndefined();
    });

    it('should throw error when deleting default branch', () => {
      expect(() => versioning.deleteBranch('main')).toThrow('Cannot delete default branch');
    });

    it('should throw error when deleting current branch', () => {
      versioning.createBranch('feature');
      versioning.switchBranch('feature');

      expect(() => versioning.deleteBranch('feature')).toThrow('Cannot delete current branch');
    });

    it('should return false when deleting non-existent branch', () => {
      const result = versioning.deleteBranch('nonexistent');
      expect(result).toBe(false);
    });

    it('should get all branches', () => {
      versioning.createBranch('feature1');
      versioning.createBranch('feature2');

      const branches = versioning.getBranches();

      expect(branches.length).toBe(3); // main + 2 features
      expect(branches.map(b => b.name)).toContain('main');
      expect(branches.map(b => b.name)).toContain('feature1');
      expect(branches.map(b => b.name)).toContain('feature2');
    });
  });

  describe('Version History', () => {
    it('should get current version', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      const current = versioning.getCurrentVersion();

      expect(current).toBeDefined();
      expect(current?.id).toBe(version.id);
    });

    it('should return undefined when no versions exist', () => {
      const current = versioning.getCurrentVersion();
      expect(current).toBeUndefined();
    });

    it('should get version history', () => {
      const cp1 = createSampleCheckpoint('cp_1');
      const cp2 = createSampleCheckpoint('cp_2');
      const cp3 = createSampleCheckpoint('cp_3');

      versioning.createVersion(cp1);
      versioning.createVersion(cp2);
      versioning.createVersion(cp3);

      const history = versioning.getVersionHistory();

      expect(history.length).toBe(3);
      // History is from newest to oldest
      expect(history[0].checkpoint.id).toBe('cp_3');
      expect(history[2].checkpoint.id).toBe('cp_1');
    });

    it('should limit version history', () => {
      for (let i = 0; i < 10; i++) {
        versioning.createVersion(createSampleCheckpoint(`cp_${i}`));
      }

      const history = versioning.getVersionHistory({ limit: 5 });

      expect(history.length).toBe(5);
    });

    it('should get version history for specific branch', () => {
      versioning.createVersion(createSampleCheckpoint('cp_main_1'));
      versioning.createVersion(createSampleCheckpoint('cp_main_2'));

      versioning.createBranch('feature');
      versioning.switchBranch('feature');
      versioning.createVersion(createSampleCheckpoint('cp_feature_1'));

      const mainHistory = versioning.getVersionHistory({ branch: 'main' });
      const featureHistory = versioning.getVersionHistory({ branch: 'feature' });

      expect(mainHistory.length).toBe(2);
      expect(featureHistory.length).toBe(1);
    });

    it('should get version by ID', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      const retrieved = versioning.getVersion(version.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(version.id);
    });

    it('should return undefined for non-existent version ID', () => {
      const result = versioning.getVersion('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('Checkout Operations', () => {
    it('should checkout a version', async () => {
      mockPathExists.mockResolvedValue(false);

      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      const result = await versioning.checkout(version.id);

      expect(result.success).toBe(true);
      expect(result.restored.length).toBe(2);
      expect(result.errors.length).toBe(0);
    });

    it('should return error for non-existent version', async () => {
      const result = await versioning.checkout('nonexistent');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Version not found: nonexistent');
    });

    it('should restore file content', async () => {
      mockPathExists.mockResolvedValue(false);

      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      await versioning.checkout(version.id);

      expect(mockEnsureDir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should delete file that did not exist at checkpoint', async () => {
      const checkpoint: Checkpoint = {
        id: 'cp_delete',
        timestamp: new Date(),
        description: 'Delete test',
        files: [
          { path: '/test/deleted.ts', content: '', existed: false },
        ],
        workingDirectory: '/test',
      };

      mockPathExists.mockResolvedValue(true);

      const version = versioning.createVersion(checkpoint);
      const result = await versioning.checkout(version.id);

      expect(mockUnlink).toHaveBeenCalled();
      expect(result.restored).toContain('Deleted: /test/deleted.ts');
    });

    it('should emit checkout event', async () => {
      const handler = jest.fn();
      versioning.on('checkout', handler);

      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      await versioning.checkout(version.id);

      expect(handler).toHaveBeenCalled();
    });

    it('should handle restore errors gracefully', async () => {
      mockWriteFile.mockRejectedValue(new Error('Write failed'));

      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      const result = await versioning.checkout(version.id);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Diff Operations', () => {
    it('should detect added files in diff', () => {
      const cp1: Checkpoint = {
        id: 'cp_1',
        timestamp: new Date(),
        description: 'Before',
        files: [],
        workingDirectory: '/test',
      };

      const cp2: Checkpoint = {
        id: 'cp_2',
        timestamp: new Date(),
        description: 'After',
        files: [{ path: '/test/new.ts', content: 'new content', existed: true }],
        workingDirectory: '/test',
      };

      const v1 = versioning.createVersion(cp1);
      const v2 = versioning.createVersion(cp2);

      const diff = versioning.diff(v1.id, v2.id);

      expect(diff.added).toContain('/test/new.ts');
      expect(diff.details.find(d => d.path === '/test/new.ts')?.type).toBe('added');
    });

    it('should detect deleted files in diff', () => {
      const cp1: Checkpoint = {
        id: 'cp_1',
        timestamp: new Date(),
        description: 'Before',
        files: [{ path: '/test/deleted.ts', content: 'old content', existed: true }],
        workingDirectory: '/test',
      };

      const cp2: Checkpoint = {
        id: 'cp_2',
        timestamp: new Date(),
        description: 'After',
        files: [],
        workingDirectory: '/test',
      };

      const v1 = versioning.createVersion(cp1);
      const v2 = versioning.createVersion(cp2);

      const diff = versioning.diff(v1.id, v2.id);

      expect(diff.deleted).toContain('/test/deleted.ts');
    });

    it('should detect modified files in diff', () => {
      const cp1: Checkpoint = {
        id: 'cp_1',
        timestamp: new Date(),
        description: 'Before',
        files: [{ path: '/test/modified.ts', content: 'old content', existed: true }],
        workingDirectory: '/test',
      };

      const cp2: Checkpoint = {
        id: 'cp_2',
        timestamp: new Date(),
        description: 'After',
        files: [{ path: '/test/modified.ts', content: 'new content', existed: true }],
        workingDirectory: '/test',
      };

      const v1 = versioning.createVersion(cp1);
      const v2 = versioning.createVersion(cp2);

      const diff = versioning.diff(v1.id, v2.id);

      expect(diff.modified).toContain('/test/modified.ts');
      expect(diff.details.find(d => d.path === '/test/modified.ts')?.hunks).toBeDefined();
    });

    it('should detect unchanged files in diff', () => {
      const file = { path: '/test/same.ts', content: 'same content', existed: true };

      const cp1: Checkpoint = {
        id: 'cp_1',
        timestamp: new Date(),
        description: 'Before',
        files: [file],
        workingDirectory: '/test',
      };

      const cp2: Checkpoint = {
        id: 'cp_2',
        timestamp: new Date(),
        description: 'After',
        files: [file],
        workingDirectory: '/test',
      };

      const v1 = versioning.createVersion(cp1);
      const v2 = versioning.createVersion(cp2);

      const diff = versioning.diff(v1.id, v2.id);

      expect(diff.unchanged).toContain('/test/same.ts');
    });

    it('should throw error when version not found for diff', () => {
      expect(() => versioning.diff('nonexistent1', 'nonexistent2')).toThrow(
        'One or both versions not found'
      );
    });

    it('should compute diff hunks correctly', () => {
      const cp1: Checkpoint = {
        id: 'cp_1',
        timestamp: new Date(),
        description: 'Before',
        files: [{ path: '/test/file.ts', content: 'line1\nline2\nline3', existed: true }],
        workingDirectory: '/test',
      };

      const cp2: Checkpoint = {
        id: 'cp_2',
        timestamp: new Date(),
        description: 'After',
        files: [{ path: '/test/file.ts', content: 'line1\nmodified\nline3', existed: true }],
        workingDirectory: '/test',
      };

      const v1 = versioning.createVersion(cp1);
      const v2 = versioning.createVersion(cp2);

      const diff = versioning.diff(v1.id, v2.id);
      const detail = diff.details.find(d => d.path === '/test/file.ts');

      expect(detail?.hunks).toBeDefined();
      expect(detail?.hunks?.length).toBeGreaterThan(0);
    });
  });

  describe('Common Ancestor', () => {
    it('should find common ancestor of two versions', () => {
      const cp1 = createSampleCheckpoint('cp_1');
      const cp2 = createSampleCheckpoint('cp_2');
      const cp3 = createSampleCheckpoint('cp_3');

      versioning.createVersion(cp1);
      versioning.createVersion(cp2);
      const v3 = versioning.createVersion(cp3);

      const ancestor = versioning.findCommonAncestor(v3.id, v3.id);

      expect(ancestor).toBeDefined();
      expect(ancestor?.id).toBe(v3.id);
    });

    it('should return undefined when no common ancestor', () => {
      // Create version on main
      versioning.createVersion(createSampleCheckpoint('cp_main'));

      // Create separate branch with its own root
      versioning.createBranch('isolated');
      versioning.switchBranch('isolated');

      // Manually set head to empty to simulate isolated branch
      const branch = (versioning as any).branches.get('isolated');
      branch.headVersionId = '';

      const v2 = versioning.createVersion(createSampleCheckpoint('cp_isolated'));

      const mainVersion = versioning.getVersionHistory({ branch: 'main' })[0];
      const ancestor = versioning.findCommonAncestor(mainVersion.id, v2.id);

      expect(ancestor).toBeUndefined();
    });
  });

  describe('Persistence (Save/Load)', () => {
    it('should save versioning state to disk', async () => {
      const checkpoint = createSampleCheckpoint();
      versioning.createVersion(checkpoint, { name: 'v1.0' });
      versioning.createBranch('feature');

      await versioning.save();

      expect(mockEnsureDir).toHaveBeenCalled();
      expect(mockWriteJson).toHaveBeenCalled();
    });

    it('should load versioning state from disk', async () => {
      const savedState = {
        versions: [
          ['v_abc123', {
            id: 'v_abc123',
            name: 'Loaded Version',
            description: 'Test',
            parentId: null,
            branchName: 'main',
            checkpoint: createSampleCheckpoint(),
            metadata: { tags: [], custom: {} },
            createdAt: '2024-01-15T10:00:00Z',
          }],
        ],
        branches: [
          ['main', { name: 'main', headVersionId: 'v_abc123', createdAt: '2024-01-15T10:00:00Z' }],
        ],
        tags: [['release', 'v_abc123']],
        currentBranch: 'main',
      };

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue(savedState);

      await versioning.load();

      const version = versioning.getVersion('v_abc123');
      expect(version).toBeDefined();
      expect(version?.name).toBe('Loaded Version');
    });

    it('should handle missing state file', async () => {
      mockPathExists.mockResolvedValue(false);

      await versioning.load();

      // Should not throw, versions should remain empty
      expect(versioning.getVersionHistory()).toEqual([]);
    });

    it('should emit load-error on corrupted data', async () => {
      const handler = jest.fn();
      versioning.on('load-error', handler);

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockRejectedValue(new Error('JSON parse error'));

      await versioning.load();

      expect(handler).toHaveBeenCalled();
    });

    it('should convert date strings to Date objects on load', async () => {
      const savedState = {
        versions: [
          ['v_abc123', {
            id: 'v_abc123',
            description: 'Test',
            parentId: null,
            branchName: 'main',
            checkpoint: {
              id: 'cp_test',
              timestamp: '2024-01-15T10:00:00Z',
              description: 'Test',
              files: [],
              workingDirectory: '/test',
            },
            metadata: { tags: [], custom: {} },
            createdAt: '2024-01-15T10:00:00Z',
          }],
        ],
        branches: [
          ['main', { name: 'main', headVersionId: 'v_abc123', createdAt: '2024-01-15T10:00:00Z' }],
        ],
        tags: [],
        currentBranch: 'main',
      };

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue(savedState);

      await versioning.load();

      const version = versioning.getVersion('v_abc123');
      expect(version?.createdAt).toBeInstanceOf(Date);
      expect(version?.checkpoint.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Statistics', () => {
    it('should get correct statistics', () => {
      versioning.createVersion(createSampleCheckpoint('cp_1'));
      versioning.createVersion(createSampleCheckpoint('cp_2'));
      versioning.createBranch('feature');
      versioning.switchBranch('feature');
      versioning.createVersion(createSampleCheckpoint('cp_3'));
      versioning.createTag(versioning.getCurrentVersion()!.id, 'release');

      const stats = versioning.getStats();

      expect(stats.totalVersions).toBe(3);
      expect(stats.totalBranches).toBe(2);
      expect(stats.totalTags).toBe(1);
      expect(stats.versionsPerBranch.main).toBe(2);
      expect(stats.versionsPerBranch.feature).toBe(1);
    });

    it('should return empty stats for new instance', () => {
      const stats = versioning.getStats();

      expect(stats.totalVersions).toBe(0);
      expect(stats.totalBranches).toBe(1); // default branch
      expect(stats.totalTags).toBe(0);
    });
  });

  describe('Pruning', () => {
    it('should prune old versions', () => {
      // Create many versions
      for (let i = 0; i < 10; i++) {
        versioning.createVersion(createSampleCheckpoint(`cp_${i}`));
      }

      const pruned = versioning.prune(5);

      expect(pruned).toBe(5);
      expect(versioning.getVersionHistory().length).toBe(5);
    });

    it('should not prune tagged versions', () => {
      const cp1 = createSampleCheckpoint('cp_1');
      const v1 = versioning.createVersion(cp1);
      versioning.createTag(v1.id, 'keep-this');

      for (let i = 2; i <= 5; i++) {
        versioning.createVersion(createSampleCheckpoint(`cp_${i}`));
      }

      versioning.prune(2);

      const taggedVersion = versioning.getVersion(v1.id);
      expect(taggedVersion).toBeDefined();
    });

    it('should update branch head if current head is pruned', () => {
      versioning.createVersion(createSampleCheckpoint('cp_1'));
      versioning.createVersion(createSampleCheckpoint('cp_2'));

      // This will prune cp_1
      versioning.prune(1);

      const branch = versioning.getBranches().find(b => b.name === 'main');
      expect(branch?.headVersionId).toBeDefined();
      expect(versioning.getVersion(branch!.headVersionId)).toBeDefined();
    });

    it('should return 0 when nothing to prune', () => {
      versioning.createVersion(createSampleCheckpoint('cp_1'));

      const pruned = versioning.prune(10);

      expect(pruned).toBe(0);
    });
  });

  describe('Format Version', () => {
    it('should format version for display', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint, {
        name: 'v1.0',
        metadata: { tags: ['feature', 'release'] },
      });

      const formatted = versioning.formatVersion(version);

      expect(formatted).toContain('v_');
      expect(formatted).toContain('(v1.0)');
      expect(formatted).toContain('[feature, release]');
    });

    it('should format version without name', () => {
      const checkpoint = createSampleCheckpoint();
      const version = versioning.createVersion(checkpoint);

      const formatted = versioning.formatVersion(version);

      expect(formatted).not.toContain('()');
      expect(formatted).toContain(version.description);
    });
  });

  describe('Dispose', () => {
    it('should clean up on dispose', () => {
      versioning.createVersion(createSampleCheckpoint());
      versioning.createBranch('feature');
      versioning.createTag(versioning.getCurrentVersion()!.id, 'tag');

      versioning.dispose();

      // Internal maps should be cleared
      expect((versioning as any).versions.size).toBe(0);
      expect((versioning as any).branches.size).toBe(0);
      expect((versioning as any).tags.size).toBe(0);
    });

    it('should remove all event listeners on dispose', () => {
      const handler = jest.fn();
      versioning.on('version-created', handler);

      versioning.dispose();

      expect(versioning.listenerCount('version-created')).toBe(0);
    });
  });

  describe('Singleton Functions', () => {
    it('should return same instance via getCheckpointVersioning', () => {
      resetCheckpointVersioning();

      const instance1 = getCheckpointVersioning({ autoSave: false });
      const instance2 = getCheckpointVersioning();

      expect(instance1).toBe(instance2);

      resetCheckpointVersioning();
    });

    it('should create new instance after reset', () => {
      resetCheckpointVersioning();

      const instance1 = getCheckpointVersioning({ autoSave: false });
      resetCheckpointVersioning();
      const instance2 = getCheckpointVersioning({ autoSave: false });

      expect(instance1).not.toBe(instance2);

      resetCheckpointVersioning();
    });

    it('should apply config to singleton', () => {
      resetCheckpointVersioning();

      const instance = getCheckpointVersioning({ defaultBranch: 'develop', autoSave: false });

      expect(instance.getCurrentBranch()).toBe('develop');

      resetCheckpointVersioning();
    });
  });
});
