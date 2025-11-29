/**
 * Tests for Checkpoint Manager
 */

import { CheckpointManager, createCheckpointManager } from '../src/undo/checkpoint-manager';

// Mock dependencies
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  pathExists: jest.fn().mockResolvedValue(false),
  readJSON: jest.fn().mockResolvedValue({ checkpoints: [], currentIndex: -1 }),
  writeJSON: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue('file content'),
  copy: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 100, mode: 0o644 }),
  readdir: jest.fn().mockResolvedValue([]),
}));

jest.mock('child_process', () => ({
  execSync: jest.fn().mockReturnValue('main\n'),
  spawn: jest.fn(),
}));

jest.mock('diff-match-patch', () => ({
  diff_match_patch: jest.fn().mockImplementation(() => ({
    diff_main: jest.fn().mockReturnValue([]),
    diff_cleanupSemantic: jest.fn(),
    patch_make: jest.fn().mockReturnValue([]),
    patch_toText: jest.fn().mockReturnValue(''),
  })),
}));

describe('CheckpointManager', () => {
  let manager: CheckpointManager;

  beforeEach(() => {
    manager = createCheckpointManager('/test/project', {
      autoCheckpoint: false,
      maxCheckpoints: 10,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Constructor', () => {
    it('should create with working directory', () => {
      expect(manager).toBeDefined();
    });

    it('should accept custom config', () => {
      const m = createCheckpointManager('/test', {
        maxCheckpoints: 5,
        autoCheckpoint: false,
      });
      expect(m).toBeDefined();
      m.dispose();
    });
  });

  describe('createCheckpoint', () => {
    it('should create a checkpoint', async () => {
      const checkpoint = await manager.createCheckpoint({
        name: 'Test Checkpoint',
        operation: 'test',
      });

      expect(checkpoint).toBeDefined();
      expect(checkpoint.name).toBe('Test Checkpoint');
      expect(checkpoint.id).toBeDefined();
    });

    it('should set metadata', async () => {
      const checkpoint = await manager.createCheckpoint({
        name: 'Test',
        operation: 'edit',
        tool: 'Edit',
      });

      expect(checkpoint.metadata.operation).toBe('edit');
      expect(checkpoint.metadata.tool).toBe('Edit');
    });

    it('should support tags', async () => {
      const checkpoint = await manager.createCheckpoint({
        name: 'Tagged',
        operation: 'test',
        tags: ['feature', 'important'],
      });

      expect(checkpoint.tags).toContain('feature');
      expect(checkpoint.tags).toContain('important');
    });
  });

  describe('getCheckpoints', () => {
    it('should return all checkpoints', async () => {
      await manager.createCheckpoint({ name: 'CP1', operation: 'test' });
      await manager.createCheckpoint({ name: 'CP2', operation: 'test' });

      const checkpoints = manager.getCheckpoints();
      expect(checkpoints.length).toBe(2);
    });
  });

  describe('getCurrentCheckpoint', () => {
    it('should return null when no checkpoints', () => {
      expect(manager.getCurrentCheckpoint()).toBeNull();
    });

    it('should return current checkpoint', async () => {
      await manager.createCheckpoint({ name: 'Test', operation: 'test' });

      const current = manager.getCurrentCheckpoint();
      expect(current).not.toBeNull();
      expect(current?.name).toBe('Test');
    });
  });

  describe('canUndo', () => {
    it('should return false with no checkpoints', () => {
      expect(manager.canUndo()).toBe(false);
    });

    it('should return false with one checkpoint', async () => {
      await manager.createCheckpoint({ name: 'First', operation: 'test' });
      expect(manager.canUndo()).toBe(false);
    });

    it('should return true with multiple checkpoints', async () => {
      await manager.createCheckpoint({ name: 'First', operation: 'test' });
      await manager.createCheckpoint({ name: 'Second', operation: 'test' });
      expect(manager.canUndo()).toBe(true);
    });
  });

  describe('canRedo', () => {
    it('should return false initially', () => {
      expect(manager.canRedo()).toBe(false);
    });
  });

  describe('searchCheckpoints', () => {
    it('should search by name', async () => {
      await manager.createCheckpoint({ name: 'Feature A', operation: 'test' });
      await manager.createCheckpoint({ name: 'Bug Fix', operation: 'test' });

      const results = manager.searchCheckpoints('Feature');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Feature A');
    });

    it('should search by tag', async () => {
      await manager.createCheckpoint({
        name: 'Test',
        operation: 'test',
        tags: ['important'],
      });

      const results = manager.searchCheckpoints('important');
      expect(results.length).toBe(1);
    });
  });

  describe('tagCheckpoint', () => {
    it('should add tag to checkpoint', async () => {
      const cp = await manager.createCheckpoint({
        name: 'Test',
        operation: 'test',
      });

      await manager.tagCheckpoint(cp.id, 'milestone');

      const checkpoint = manager.getCheckpoint(cp.id);
      expect(checkpoint?.tags).toContain('milestone');
    });

    it('should not duplicate tags', async () => {
      const cp = await manager.createCheckpoint({
        name: 'Test',
        operation: 'test',
        tags: ['existing'],
      });

      await manager.tagCheckpoint(cp.id, 'existing');

      const checkpoint = manager.getCheckpoint(cp.id);
      expect(checkpoint?.tags.filter(t => t === 'existing').length).toBe(1);
    });
  });

  describe('renameCheckpoint', () => {
    it('should rename checkpoint', async () => {
      const cp = await manager.createCheckpoint({
        name: 'Old Name',
        operation: 'test',
      });

      await manager.renameCheckpoint(cp.id, 'New Name');

      const checkpoint = manager.getCheckpoint(cp.id);
      expect(checkpoint?.name).toBe('New Name');
    });
  });

  describe('deleteCheckpoint', () => {
    it('should delete checkpoint', async () => {
      const cp = await manager.createCheckpoint({
        name: 'To Delete',
        operation: 'test',
      });

      await manager.deleteCheckpoint(cp.id);

      expect(manager.getCheckpoint(cp.id)).toBeUndefined();
    });
  });

  describe('shouldAutoCheckpoint', () => {
    it('should return true for dangerous operations', () => {
      expect(manager.shouldAutoCheckpoint('delete file')).toBe(true);
      expect(manager.shouldAutoCheckpoint('remove function')).toBe(true);
      expect(manager.shouldAutoCheckpoint('refactor code')).toBe(true);
    });

    it('should return false for safe operations', () => {
      expect(manager.shouldAutoCheckpoint('read file')).toBe(false);
      expect(manager.shouldAutoCheckpoint('list files')).toBe(false);
    });
  });

  describe('formatStatus', () => {
    it('should render status', async () => {
      await manager.createCheckpoint({ name: 'Test', operation: 'test' });

      const status = manager.formatStatus();

      expect(status).toContain('CHECKPOINT MANAGER');
      expect(status).toContain('Total Checkpoints');
      expect(status).toContain('Test');
    });
  });

  describe('events', () => {
    it('should emit checkpoint:created event', async () => {
      const handler = jest.fn();
      manager.on('checkpoint:created', handler);

      await manager.createCheckpoint({ name: 'Test', operation: 'test' });

      expect(handler).toHaveBeenCalled();
    });

    it('should emit checkpoint:deleted event', async () => {
      const handler = jest.fn();
      manager.on('checkpoint:deleted', handler);

      const cp = await manager.createCheckpoint({ name: 'Test', operation: 'test' });
      await manager.deleteCheckpoint(cp.id);

      expect(handler).toHaveBeenCalled();
    });
  });
});
