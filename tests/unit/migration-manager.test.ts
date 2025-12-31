/**
 * Comprehensive Unit Tests for Migration Manager
 *
 * Tests cover:
 * 1. Initialization and configuration
 * 2. Migration registration
 * 3. Forward migrations
 * 4. Rollback operations
 * 5. Migration history
 * 6. Version management
 * 7. Error handling
 * 8. Event emission
 */

import { EventEmitter } from 'events';

// Mock fs-extra before importing the module
const mockEnsureDir = jest.fn().mockResolvedValue(undefined);
const mockPathExists = jest.fn().mockResolvedValue(false);
const mockReadJson = jest.fn().mockResolvedValue({ history: [] });
const mockWriteJson = jest.fn().mockResolvedValue(undefined);

jest.mock('fs-extra', () => ({
  ensureDir: mockEnsureDir,
  pathExists: mockPathExists,
  readJson: mockReadJson,
  writeJson: mockWriteJson,
}));

// Helper function to parse version
const parseVersion = (v: string): { major: number; minor: number; patch: number } => {
  const [major, minor, patch] = v.split('.').map(Number);
  return { major, minor, patch };
};

// Helper function to compare versions
const compareVersions = (a: string, b: string): number => {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
};

// Mock semver
jest.mock('semver', () => ({
  valid: jest.fn((v: string): string | null => {
    const regex = /^\d+\.\d+\.\d+$/;
    return regex.test(v) ? v : null;
  }),
  compare: jest.fn((a: string, b: string): number => compareVersions(a, b)),
  eq: jest.fn((a: string, b: string): boolean => a === b),
  lt: jest.fn((a: string, b: string): boolean => compareVersions(a, b) < 0),
  gt: jest.fn((a: string, b: string): boolean => compareVersions(a, b) > 0),
  lte: jest.fn((a: string, b: string): boolean => compareVersions(a, b) <= 0),
  gte: jest.fn((a: string, b: string): boolean => compareVersions(a, b) >= 0),
}));

import {
  MigrationManager,
  getMigrationManager,
  resetMigrationManager,
  Migration,
  MigrationContext,
} from '../../src/versioning/migration-manager';

describe('MigrationManager', () => {
  let manager: MigrationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMigrationManager();

    mockPathExists.mockResolvedValue(false);
    mockReadJson.mockResolvedValue({ history: [] });

    manager = new MigrationManager({
      dataDir: '/test/data',
      configDir: '/test/config',
      dryRun: false,
      verbose: false,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Constructor and Initialization', () => {
    it('should create manager with default config', () => {
      const defaultManager = new MigrationManager();
      expect(defaultManager).toBeDefined();
      expect(defaultManager).toBeInstanceOf(MigrationManager);
      expect(defaultManager).toBeInstanceOf(EventEmitter);
      defaultManager.dispose();
    });

    it('should create manager with custom config', () => {
      expect(manager).toBeDefined();
      expect(manager.isInitialized()).toBe(false);
    });

    it('should initialize correctly', async () => {
      await manager.initialize();

      expect(manager.isInitialized()).toBe(true);
      expect(mockEnsureDir).toHaveBeenCalledWith('/test/data');
      expect(mockEnsureDir).toHaveBeenCalledWith('/test/config');
    });

    it('should emit initialized event', async () => {
      const handler = jest.fn();
      manager.on('initialized', handler);

      await manager.initialize();

      expect(handler).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      await manager.initialize();
      const callCount = mockEnsureDir.mock.calls.length;

      await manager.initialize();

      expect(mockEnsureDir).toHaveBeenCalledTimes(callCount);
    });

    it('should load existing history on initialization', async () => {
      const existingHistory = [
        {
          version: '1.0.0',
          name: 'initial',
          appliedAt: new Date().toISOString(),
          status: 'success',
          duration: 100,
        },
      ];

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ history: existingHistory });

      await manager.initialize();

      const history = manager.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].version).toBe('1.0.0');
    });

    it('should handle corrupted history gracefully', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockRejectedValue(new Error('JSON parse error'));

      await manager.initialize();

      expect(manager.getHistory()).toEqual([]);
    });
  });

  describe('Migration Registration', () => {
    const createMigration = (version: string, name: string): Migration => ({
      version,
      name,
      up: jest.fn().mockResolvedValue(undefined),
      down: jest.fn().mockResolvedValue(undefined),
    });

    it('should register a valid migration', () => {
      const migration = createMigration('1.0.0', 'initial');

      manager.registerMigration(migration);

      expect(manager.getMigrations()).toHaveLength(1);
      expect(manager.getMigrations()[0]).toBe(migration);
    });

    it('should emit migration:registered event', () => {
      const handler = jest.fn();
      manager.on('migration:registered', handler);

      const migration = createMigration('1.0.0', 'test');
      manager.registerMigration(migration);

      expect(handler).toHaveBeenCalledWith(migration);
    });

    it('should throw for invalid version format', () => {
      const migration = createMigration('invalid', 'test');

      expect(() => manager.registerMigration(migration)).toThrow(
        'Invalid version format'
      );
    });

    it('should throw for duplicate version', () => {
      const migration1 = createMigration('1.0.0', 'first');
      const migration2 = createMigration('1.0.0', 'second');

      manager.registerMigration(migration1);

      expect(() => manager.registerMigration(migration2)).toThrow(
        'Migration already registered'
      );
    });

    it('should register multiple migrations', () => {
      const migrations = [
        createMigration('1.0.0', 'first'),
        createMigration('1.1.0', 'second'),
        createMigration('2.0.0', 'third'),
      ];

      manager.registerMigrations(migrations);

      expect(manager.getMigrations()).toHaveLength(3);
    });

    it('should return migrations sorted by version', () => {
      manager.registerMigration(createMigration('2.0.0', 'third'));
      manager.registerMigration(createMigration('1.0.0', 'first'));
      manager.registerMigration(createMigration('1.5.0', 'second'));

      const migrations = manager.getMigrations();

      expect(migrations[0].version).toBe('1.0.0');
      expect(migrations[1].version).toBe('1.5.0');
      expect(migrations[2].version).toBe('2.0.0');
    });
  });

  describe('Version Management', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should return 0.0.0 when no migrations applied', () => {
      expect(manager.getCurrentVersion()).toBe('0.0.0');
    });

    it('should return latest applied version', async () => {
      const existingHistory = [
        { version: '1.0.0', name: 'first', appliedAt: new Date(), status: 'success' as const, duration: 100 },
        { version: '1.1.0', name: 'second', appliedAt: new Date(), status: 'success' as const, duration: 100 },
      ];

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ history: existingHistory });

      const newManager = new MigrationManager({ dataDir: '/test/data', configDir: '/test/config' });
      await newManager.initialize();

      expect(newManager.getCurrentVersion()).toBe('1.1.0');
      newManager.dispose();
    });

    it('should return latest available version', () => {
      manager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: jest.fn(),
        down: jest.fn(),
      });
      manager.registerMigration({
        version: '2.0.0',
        name: 'second',
        up: jest.fn(),
        down: jest.fn(),
      });

      expect(manager.getLatestVersion()).toBe('2.0.0');
    });

    it('should return 0.0.0 when no migrations registered', () => {
      expect(manager.getLatestVersion()).toBe('0.0.0');
    });

    it('should identify pending migrations', () => {
      manager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: jest.fn(),
        down: jest.fn(),
      });
      manager.registerMigration({
        version: '2.0.0',
        name: 'second',
        up: jest.fn(),
        down: jest.fn(),
      });

      const pending = manager.getPendingMigrations();

      expect(pending).toHaveLength(2);
      expect(manager.hasPendingMigrations()).toBe(true);
    });

    it('should return applied migrations', async () => {
      const existingHistory = [
        { version: '1.0.0', name: 'first', appliedAt: new Date(), status: 'success' as const, duration: 100 },
      ];

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ history: existingHistory });

      const newManager = new MigrationManager({ dataDir: '/test/data', configDir: '/test/config' });
      await newManager.initialize();

      expect(newManager.getAppliedMigrations()).toHaveLength(1);
      newManager.dispose();
    });

    it('should return correct migration status', () => {
      manager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: jest.fn(),
        down: jest.fn(),
      });

      const status = manager.getStatus();

      expect(status.currentVersion).toBe('0.0.0');
      expect(status.latestVersion).toBe('1.0.0');
      expect(status.pendingCount).toBe(1);
      expect(status.appliedCount).toBe(0);
      expect(status.hasPending).toBe(true);
    });
  });

  describe('Forward Migrations', () => {
    const mockUp = jest.fn().mockResolvedValue(undefined);
    const mockDown = jest.fn().mockResolvedValue(undefined);

    beforeEach(async () => {
      await manager.initialize();
      mockUp.mockClear();
      mockDown.mockClear();
    });

    it('should apply pending migrations', async () => {
      manager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: mockUp,
        down: mockDown,
      });

      const result = await manager.migrate();

      expect(result.success).toBe(true);
      expect(result.migrationsApplied).toBe(1);
      expect(result.currentVersion).toBe('1.0.0');
      expect(mockUp).toHaveBeenCalled();
    });

    it('should apply multiple migrations in order', async () => {
      const callOrder: string[] = [];

      manager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: jest.fn().mockImplementation(() => callOrder.push('1.0.0')),
        down: mockDown,
      });
      manager.registerMigration({
        version: '2.0.0',
        name: 'second',
        up: jest.fn().mockImplementation(() => callOrder.push('2.0.0')),
        down: mockDown,
      });

      await manager.migrate();

      expect(callOrder).toEqual(['1.0.0', '2.0.0']);
    });

    it('should emit migration events', async () => {
      const startHandler = jest.fn();
      const completeHandler = jest.fn();

      manager.on('migrate:start', startHandler);
      manager.on('migrate:complete', completeHandler);

      manager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: mockUp,
        down: mockDown,
      });

      await manager.migrate();

      expect(startHandler).toHaveBeenCalledWith({ count: 1 });
      expect(completeHandler).toHaveBeenCalled();
    });

    it('should emit individual migration events', async () => {
      const migrationStart = jest.fn();
      const migrationComplete = jest.fn();

      manager.on('migration:start', migrationStart);
      manager.on('migration:complete', migrationComplete);

      manager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: mockUp,
        down: mockDown,
      });

      await manager.migrate();

      expect(migrationStart).toHaveBeenCalled();
      expect(migrationComplete).toHaveBeenCalled();
    });

    it('should save history after each migration', async () => {
      manager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: mockUp,
        down: mockDown,
      });

      await manager.migrate();

      expect(mockWriteJson).toHaveBeenCalled();
    });

    it('should pass correct context to migration', async () => {
      let capturedContext: MigrationContext | null = null;

      manager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: jest.fn().mockImplementation((ctx) => {
          capturedContext = ctx;
        }),
        down: mockDown,
      });

      await manager.migrate();

      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.dataDir).toBe('/test/data');
      expect(capturedContext!.configDir).toBe('/test/config');
      expect(capturedContext!.dryRun).toBe(false);
    });

    it('should return success when no pending migrations', async () => {
      const result = await manager.migrate();

      expect(result.success).toBe(true);
      expect(result.migrationsApplied).toBe(0);
    });

    it('should handle migration failure', async () => {
      const errorHandler = jest.fn();
      manager.on('migration:error', errorHandler);

      manager.registerMigration({
        version: '1.0.0',
        name: 'failing',
        up: jest.fn().mockRejectedValue(new Error('Migration failed')),
        down: mockDown,
      });

      const result = await manager.migrate();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Migration 1.0.0 failed: Migration failed');
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should stop on first failure', async () => {
      const secondUp = jest.fn();

      manager.registerMigration({
        version: '1.0.0',
        name: 'failing',
        up: jest.fn().mockRejectedValue(new Error('Failed')),
        down: mockDown,
      });
      manager.registerMigration({
        version: '2.0.0',
        name: 'never-run',
        up: secondUp,
        down: mockDown,
      });

      await manager.migrate();

      expect(secondUp).not.toHaveBeenCalled();
    });

    it('should initialize if not initialized', async () => {
      const uninitManager = new MigrationManager({ dataDir: '/test/data', configDir: '/test/config' });

      uninitManager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: mockUp,
        down: mockDown,
      });

      await uninitManager.migrate();

      expect(uninitManager.isInitialized()).toBe(true);
      uninitManager.dispose();
    });

    it('should track duration in result', async () => {
      manager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: mockUp,
        down: mockDown,
      });

      const result = await manager.migrate();

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Migrate To Specific Version', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should migrate to specific version', async () => {
      const up1 = jest.fn();
      const up2 = jest.fn();

      manager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: up1,
        down: jest.fn(),
      });
      manager.registerMigration({
        version: '2.0.0',
        name: 'second',
        up: up2,
        down: jest.fn(),
      });

      await manager.migrateTo('1.0.0');

      expect(up1).toHaveBeenCalled();
      expect(up2).not.toHaveBeenCalled();
    });

    it('should return error for invalid version', async () => {
      const result = await manager.migrateTo('invalid');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Invalid target version: invalid');
    });

    it('should return success when already at target version', async () => {
      // Simulate already at version 1.0.0
      const existingHistory = [
        { version: '1.0.0', name: 'first', appliedAt: new Date(), status: 'success' as const, duration: 100 },
      ];

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ history: existingHistory });

      const newManager = new MigrationManager({ dataDir: '/test/data', configDir: '/test/config' });
      await newManager.initialize();

      newManager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: jest.fn(),
        down: jest.fn(),
      });

      const result = await newManager.migrateTo('1.0.0');

      expect(result.success).toBe(true);
      expect(result.migrationsApplied).toBe(0);
      newManager.dispose();
    });
  });

  describe('Rollback Operations', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should rollback last migration', async () => {
      const down = jest.fn();

      // Simulate applied migration
      const existingHistory = [
        { version: '1.0.0', name: 'first', appliedAt: new Date(), status: 'success' as const, duration: 100 },
      ];

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ history: existingHistory });

      const newManager = new MigrationManager({ dataDir: '/test/data', configDir: '/test/config' });
      await newManager.initialize();

      newManager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: jest.fn(),
        down,
      });

      const result = await newManager.rollback();

      expect(result.success).toBe(true);
      expect(result.migrationsApplied).toBe(1);
      expect(down).toHaveBeenCalled();
      newManager.dispose();
    });

    it('should emit rollback events', async () => {
      const startHandler = jest.fn();
      const completeHandler = jest.fn();

      const existingHistory = [
        { version: '1.0.0', name: 'first', appliedAt: new Date(), status: 'success' as const, duration: 100 },
      ];

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ history: existingHistory });

      const newManager = new MigrationManager({ dataDir: '/test/data', configDir: '/test/config' });
      await newManager.initialize();

      newManager.on('rollback:start', startHandler);
      newManager.on('rollback:complete', completeHandler);

      newManager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: jest.fn(),
        down: jest.fn(),
      });

      await newManager.rollback();

      expect(startHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
      newManager.dispose();
    });

    it('should return success when no migrations to rollback', async () => {
      const result = await manager.rollback();

      expect(result.success).toBe(true);
      expect(result.migrationsApplied).toBe(0);
    });

    it('should return error when migration not found', async () => {
      const existingHistory = [
        { version: '1.0.0', name: 'first', appliedAt: new Date(), status: 'success' as const, duration: 100 },
      ];

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ history: existingHistory });

      const newManager = new MigrationManager({ dataDir: '/test/data', configDir: '/test/config' });
      await newManager.initialize();

      // Don't register the migration
      const result = await newManager.rollback();

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Migration not found');
      newManager.dispose();
    });

    it('should handle rollback failure', async () => {
      const errorHandler = jest.fn();

      const existingHistory = [
        { version: '1.0.0', name: 'first', appliedAt: new Date(), status: 'success' as const, duration: 100 },
      ];

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ history: existingHistory });

      const newManager = new MigrationManager({ dataDir: '/test/data', configDir: '/test/config' });
      await newManager.initialize();

      newManager.on('rollback:error', errorHandler);

      newManager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: jest.fn(),
        down: jest.fn().mockRejectedValue(new Error('Rollback failed')),
      });

      const result = await newManager.rollback();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Rollback failed: Rollback failed');
      expect(errorHandler).toHaveBeenCalled();
      newManager.dispose();
    });

    it('should rollback to specific version', async () => {
      const down1 = jest.fn();
      const down2 = jest.fn();

      const existingHistory = [
        { version: '1.0.0', name: 'first', appliedAt: new Date(), status: 'success' as const, duration: 100 },
        { version: '2.0.0', name: 'second', appliedAt: new Date(), status: 'success' as const, duration: 100 },
      ];

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ history: existingHistory });

      const newManager = new MigrationManager({ dataDir: '/test/data', configDir: '/test/config' });
      await newManager.initialize();

      newManager.registerMigration({
        version: '1.0.0',
        name: 'first',
        up: jest.fn(),
        down: down1,
      });
      newManager.registerMigration({
        version: '2.0.0',
        name: 'second',
        up: jest.fn(),
        down: down2,
      });

      await newManager.rollbackTo('1.0.0');

      expect(down2).toHaveBeenCalled();
      expect(down1).not.toHaveBeenCalled();
      newManager.dispose();
    });
  });

  describe('Migration History', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should return copy of history', () => {
      const history1 = manager.getHistory();
      const history2 = manager.getHistory();

      expect(history1).not.toBe(history2);
    });

    it('should clear history', async () => {
      const handler = jest.fn();
      manager.on('history:cleared', handler);

      await manager.clearHistory();

      expect(manager.getHistory()).toEqual([]);
      expect(handler).toHaveBeenCalled();
    });

    it('should record successful migrations in history', async () => {
      manager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: jest.fn(),
        down: jest.fn(),
      });

      await manager.migrate();

      const history = manager.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].version).toBe('1.0.0');
      expect(history[0].status).toBe('success');
    });

    it('should record failed migrations in history', async () => {
      manager.registerMigration({
        version: '1.0.0',
        name: 'failing',
        up: jest.fn().mockRejectedValue(new Error('Failed')),
        down: jest.fn(),
      });

      await manager.migrate();

      const history = manager.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].status).toBe('failed');
      expect(history[0].error).toBe('Failed');
    });

    it('should track migration duration in history', async () => {
      manager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: jest.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 10))),
        down: jest.fn(),
      });

      await manager.migrate();

      const history = manager.getHistory();
      expect(history[0].duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Dry Run Mode', () => {
    it('should not save history in dry run mode', async () => {
      const dryRunManager = new MigrationManager({
        dataDir: '/test/data',
        configDir: '/test/config',
        dryRun: true,
      });
      await dryRunManager.initialize();

      dryRunManager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: jest.fn(),
        down: jest.fn(),
      });

      await dryRunManager.migrate();

      // writeJson should not be called for saving history in dry run
      const historySaveCalls = mockWriteJson.mock.calls.filter(
        (call) => call[0].includes('migration-history')
      );
      expect(historySaveCalls.length).toBe(0);

      dryRunManager.dispose();
    });
  });

  describe('Verbose Logging', () => {
    it('should emit log events', async () => {
      const logHandler = jest.fn();
      manager.on('log', logHandler);

      manager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: jest.fn(),
        down: jest.fn(),
      });

      await manager.migrate();

      expect(logHandler).toHaveBeenCalled();
      expect(logHandler.mock.calls.some((call) => call[0].level === 'info')).toBe(true);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getMigrationManager', () => {
      const instance1 = getMigrationManager();
      const instance2 = getMigrationManager();

      expect(instance1).toBe(instance2);
      resetMigrationManager();
    });

    it('should reset singleton', () => {
      const instance1 = getMigrationManager();
      resetMigrationManager();
      const instance2 = getMigrationManager();

      expect(instance1).not.toBe(instance2);
      resetMigrationManager();
    });
  });

  describe('Dispose', () => {
    it('should clean up resources on dispose', async () => {
      manager.registerMigration({
        version: '1.0.0',
        name: 'test',
        up: jest.fn(),
        down: jest.fn(),
      });

      manager.dispose();

      expect(manager.getMigrations()).toHaveLength(0);
      expect(manager.getHistory()).toHaveLength(0);
      expect(manager.isInitialized()).toBe(false);
    });

    it('should remove all event listeners on dispose', () => {
      const handler = jest.fn();
      manager.on('migration:registered', handler);

      manager.dispose();

      expect(manager.listenerCount('migration:registered')).toBe(0);
    });
  });
});
