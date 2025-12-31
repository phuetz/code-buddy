/**
 * Comprehensive Unit Tests for Config Migrator
 *
 * Tests cover:
 * 1. Initialization and configuration
 * 2. Transform registration
 * 3. Configuration loading and saving
 * 4. Backup and restore
 * 5. Migration execution
 * 6. Change detection
 * 7. Utility methods (defaults, deprecated fields, renaming)
 * 8. Error handling and events
 */

import { EventEmitter } from 'events';

// Mock fs-extra before importing the module
const mockEnsureDir = jest.fn().mockResolvedValue(undefined);
const mockPathExists = jest.fn().mockResolvedValue(false);
const mockReadJson = jest.fn().mockResolvedValue({});
const mockWriteJson = jest.fn().mockResolvedValue(undefined);
const mockCopy = jest.fn().mockResolvedValue(undefined);
const mockReaddir = jest.fn().mockResolvedValue([]);

jest.mock('fs-extra', () => ({
  ensureDir: mockEnsureDir,
  pathExists: mockPathExists,
  readJson: mockReadJson,
  writeJson: mockWriteJson,
  copy: mockCopy,
  readdir: mockReaddir,
}));

// Helper function to parse version
const parseVersion = (v: string): { major: number; minor: number; patch: number } => {
  const [major, minor, patch] = v.split('.').map((p) => parseInt(p, 10) || 0);
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
  coerce: jest.fn((v: string): { version: string } | null => {
    const match = v.match(/(\d+)\.?(\d+)?\.?(\d+)?/);
    if (!match) return null;
    const version = `${match[1] || 0}.${match[2] || 0}.${match[3] || 0}`;
    return { version };
  }),
  compare: jest.fn((a: string, b: string): number => compareVersions(a, b)),
  gt: jest.fn((a: string, b: string): boolean => compareVersions(a, b) > 0),
  gte: jest.fn((a: string, b: string): boolean => compareVersions(a, b) >= 0),
  lte: jest.fn((a: string, b: string): boolean => compareVersions(a, b) <= 0),
}));

import {
  ConfigMigrator,
  getConfigMigrator,
  resetConfigMigrator,
  ConfigTransform,
} from '../../src/versioning/config-migrator';

describe('ConfigMigrator', () => {
  let migrator: ConfigMigrator;

  beforeEach(() => {
    jest.clearAllMocks();
    resetConfigMigrator();

    mockPathExists.mockResolvedValue(false);
    mockReadJson.mockResolvedValue({});

    migrator = new ConfigMigrator({
      configDir: '/test/config',
      configFile: 'settings.json',
      backupDir: '/test/backups',
      createBackup: true,
      dryRun: false,
    });
  });

  afterEach(() => {
    migrator.dispose();
  });

  describe('Constructor and Initialization', () => {
    it('should create migrator with default config', () => {
      const defaultMigrator = new ConfigMigrator();
      expect(defaultMigrator).toBeDefined();
      expect(defaultMigrator).toBeInstanceOf(ConfigMigrator);
      expect(defaultMigrator).toBeInstanceOf(EventEmitter);
      defaultMigrator.dispose();
    });

    it('should create migrator with custom config', () => {
      expect(migrator).toBeDefined();
      expect(migrator.isInitialized()).toBe(false);
    });

    it('should initialize correctly', async () => {
      await migrator.initialize();

      expect(migrator.isInitialized()).toBe(true);
      expect(mockEnsureDir).toHaveBeenCalledWith('/test/config');
      expect(mockEnsureDir).toHaveBeenCalledWith('/test/backups');
    });

    it('should emit initialized event', async () => {
      const handler = jest.fn();
      migrator.on('initialized', handler);

      await migrator.initialize();

      expect(handler).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      await migrator.initialize();
      const callCount = mockEnsureDir.mock.calls.length;

      await migrator.initialize();

      expect(mockEnsureDir).toHaveBeenCalledTimes(callCount);
    });

    it('should skip backup dir creation when backups disabled', async () => {
      const noBackupMigrator = new ConfigMigrator({
        configDir: '/test/config',
        createBackup: false,
      });

      await noBackupMigrator.initialize();

      const backupCalls = mockEnsureDir.mock.calls.filter((call) =>
        call[0].includes('backup')
      );
      expect(backupCalls.length).toBe(0);

      noBackupMigrator.dispose();
    });
  });

  describe('Transform Registration', () => {
    const createTransform = (
      version: string,
      name: string
    ): ConfigTransform => ({
      version,
      name,
      transform: (config) => config,
    });

    it('should register a valid transform', () => {
      const transform = createTransform('1.0.0', 'initial');

      migrator.registerTransform(transform);

      expect(migrator.getTransforms()).toHaveLength(1);
      expect(migrator.getTransforms()[0]).toBe(transform);
    });

    it('should emit transform:registered event', () => {
      const handler = jest.fn();
      migrator.on('transform:registered', handler);

      const transform = createTransform('1.0.0', 'test');
      migrator.registerTransform(transform);

      expect(handler).toHaveBeenCalledWith(transform);
    });

    it('should throw for invalid version format', () => {
      const transform = createTransform('invalid', 'test');

      expect(() => migrator.registerTransform(transform)).toThrow(
        'Invalid version format'
      );
    });

    it('should throw for duplicate version', () => {
      const transform1 = createTransform('1.0.0', 'first');
      const transform2 = createTransform('1.0.0', 'second');

      migrator.registerTransform(transform1);

      expect(() => migrator.registerTransform(transform2)).toThrow(
        'Transform already registered'
      );
    });

    it('should register multiple transforms', () => {
      const transforms = [
        createTransform('1.0.0', 'first'),
        createTransform('1.1.0', 'second'),
        createTransform('2.0.0', 'third'),
      ];

      migrator.registerTransforms(transforms);

      expect(migrator.getTransforms()).toHaveLength(3);
    });

    it('should return transforms sorted by version', () => {
      migrator.registerTransform(createTransform('2.0.0', 'third'));
      migrator.registerTransform(createTransform('1.0.0', 'first'));
      migrator.registerTransform(createTransform('1.5.0', 'second'));

      const transforms = migrator.getTransforms();

      expect(transforms[0].version).toBe('1.0.0');
      expect(transforms[1].version).toBe('1.5.0');
      expect(transforms[2].version).toBe('2.0.0');
    });

    it('should get transforms between versions', () => {
      migrator.registerTransform(createTransform('1.0.0', 'first'));
      migrator.registerTransform(createTransform('1.5.0', 'second'));
      migrator.registerTransform(createTransform('2.0.0', 'third'));
      migrator.registerTransform(createTransform('2.5.0', 'fourth'));

      const between = migrator.getTransformsBetween('1.0.0', '2.0.0');

      expect(between).toHaveLength(2);
      expect(between[0].version).toBe('1.5.0');
      expect(between[1].version).toBe('2.0.0');
    });
  });

  describe('Config Loading and Saving', () => {
    it('should load config from file', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({
        _version: '1.0.0',
        setting1: 'value1',
        setting2: 123,
      });

      const config = await migrator.loadConfig();

      expect(config).not.toBeNull();
      expect(config!.setting1).toBe('value1');
      expect(config!.setting2).toBe(123);
    });

    it('should return null when config does not exist', async () => {
      mockPathExists.mockResolvedValue(false);

      const config = await migrator.loadConfig();

      expect(config).toBeNull();
    });

    it('should return null on read error', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockRejectedValue(new Error('Read error'));

      const config = await migrator.loadConfig();

      expect(config).toBeNull();
    });

    it('should save config to file', async () => {
      const config = { setting1: 'value1' };

      await migrator.saveConfig(config);

      expect(mockWriteJson).toHaveBeenCalledWith(
        expect.stringContaining('settings.json'),
        config,
        { spaces: 2 }
      );
    });

    it('should emit config:saved event', async () => {
      const handler = jest.fn();
      migrator.on('config:saved', handler);

      await migrator.saveConfig({ setting1: 'value1' });

      expect(handler).toHaveBeenCalled();
    });

    it('should not save in dry run mode', async () => {
      const dryRunMigrator = new ConfigMigrator({
        configDir: '/test/config',
        dryRun: true,
      });

      await dryRunMigrator.saveConfig({ setting1: 'value1' });

      expect(mockWriteJson).not.toHaveBeenCalled();
      dryRunMigrator.dispose();
    });
  });

  describe('Backup and Restore', () => {
    it('should create backup of config', async () => {
      mockPathExists.mockResolvedValue(true);

      const backupPath = await migrator.createBackup();

      expect(mockCopy).toHaveBeenCalled();
      expect(backupPath).toContain('settings-');
      expect(backupPath).toContain('.json');
    });

    it('should emit backup:created event', async () => {
      mockPathExists.mockResolvedValue(true);

      const handler = jest.fn();
      migrator.on('backup:created', handler);

      await migrator.createBackup();

      expect(handler).toHaveBeenCalled();
    });

    it('should return null when config does not exist', async () => {
      mockPathExists.mockResolvedValue(false);

      const backupPath = await migrator.createBackup();

      expect(backupPath).toBeNull();
    });

    it('should not create backup in dry run mode', async () => {
      const dryRunMigrator = new ConfigMigrator({
        configDir: '/test/config',
        dryRun: true,
      });

      mockPathExists.mockResolvedValue(true);

      const backupPath = await dryRunMigrator.createBackup();

      expect(backupPath).toBeNull();
      expect(mockCopy).not.toHaveBeenCalled();
      dryRunMigrator.dispose();
    });

    it('should restore from backup', async () => {
      mockPathExists.mockResolvedValue(true);

      const result = await migrator.restoreFromBackup('/test/backup.json');

      expect(result).toBe(true);
      expect(mockCopy).toHaveBeenCalledWith(
        '/test/backup.json',
        expect.stringContaining('settings.json')
      );
    });

    it('should emit backup:restored event', async () => {
      mockPathExists.mockResolvedValue(true);

      const handler = jest.fn();
      migrator.on('backup:restored', handler);

      await migrator.restoreFromBackup('/test/backup.json');

      expect(handler).toHaveBeenCalledWith('/test/backup.json');
    });

    it('should throw when backup file not found', async () => {
      mockPathExists.mockResolvedValue(false);

      await expect(
        migrator.restoreFromBackup('/test/nonexistent.json')
      ).rejects.toThrow('Backup file not found');
    });

    it('should list available backups', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReaddir.mockResolvedValue([
        'settings-2024-01-01.json',
        'settings-2024-01-02.json',
        'other-file.txt',
      ]);

      const backups = await migrator.listBackups();

      expect(backups).toHaveLength(2);
      expect(backups[0]).toContain('settings-2024-01-02.json');
      expect(backups[1]).toContain('settings-2024-01-01.json');
    });

    it('should return empty list when backup dir does not exist', async () => {
      mockPathExists.mockResolvedValue(false);

      const backups = await migrator.listBackups();

      expect(backups).toEqual([]);
    });
  });

  describe('Config Version Management', () => {
    it('should get version from _version field', () => {
      const config = { _version: '1.0.0' };

      const version = migrator.getConfigVersion(config);

      expect(version).toBe('1.0.0');
    });

    it('should get version from version field', () => {
      const config = { version: '2.0.0' };

      const version = migrator.getConfigVersion(config);

      expect(version).toBe('2.0.0');
    });

    it('should get version from configVersion field', () => {
      const config = { configVersion: '3.0.0' };

      const version = migrator.getConfigVersion(config);

      expect(version).toBe('3.0.0');
    });

    it('should coerce non-semver versions', () => {
      const config = { _version: '1.0' };

      const version = migrator.getConfigVersion(config);

      expect(version).toBe('1.0.0');
    });

    it('should return 0.0.0 when no version', () => {
      const config = { setting: 'value' };

      const version = migrator.getConfigVersion(config);

      expect(version).toBe('0.0.0');
    });

    it('should set config version', () => {
      const config = { setting: 'value' };

      const updated = migrator.setConfigVersion(config, '2.0.0');

      expect(updated._version).toBe('2.0.0');
      expect(updated.setting).toBe('value');
    });
  });

  describe('Migration Execution', () => {
    beforeEach(async () => {
      await migrator.initialize();
    });

    it('should migrate config through transforms', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({
        _version: '1.0.0',
        oldSetting: 'value',
      });

      migrator.registerTransform({
        version: '2.0.0',
        name: 'upgrade',
        transform: (config) => ({
          ...config,
          newSetting: 'added',
        }),
      });

      const result = await migrator.migrate('2.0.0');

      expect(result.success).toBe(true);
      expect(result.transformsApplied).toBe(1);
      expect(result.fromVersion).toBe('1.0.0');
      expect(result.toVersion).toBe('2.0.0');
    });

    it('should emit migration events', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '1.0.0' });

      const startHandler = jest.fn();
      const completeHandler = jest.fn();

      migrator.on('migrate:start', startHandler);
      migrator.on('migrate:complete', completeHandler);

      migrator.registerTransform({
        version: '2.0.0',
        name: 'test',
        transform: (config) => config,
      });

      await migrator.migrate('2.0.0');

      expect(startHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
    });

    it('should emit transform events', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '1.0.0' });

      const transformStart = jest.fn();
      const transformComplete = jest.fn();

      migrator.on('transform:start', transformStart);
      migrator.on('transform:complete', transformComplete);

      migrator.registerTransform({
        version: '2.0.0',
        name: 'test',
        transform: (config) => config,
      });

      await migrator.migrate('2.0.0');

      expect(transformStart).toHaveBeenCalled();
      expect(transformComplete).toHaveBeenCalled();
    });

    it('should create backup before migration', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '1.0.0' });

      migrator.registerTransform({
        version: '2.0.0',
        name: 'test',
        transform: (config) => config,
      });

      const result = await migrator.migrate('2.0.0');

      expect(result.backup).toBeDefined();
      expect(mockCopy).toHaveBeenCalled();
    });

    it('should return error when config not found', async () => {
      mockPathExists.mockResolvedValue(false);

      const result = await migrator.migrate('2.0.0');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Configuration file not found');
    });

    it('should return error for invalid target version', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '1.0.0' });

      const result = await migrator.migrate('invalid');

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Invalid target version');
    });

    it('should return success when already at target version', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '2.0.0' });

      const result = await migrator.migrate('2.0.0');

      expect(result.success).toBe(true);
      expect(result.transformsApplied).toBe(0);
    });

    it('should return success when target is older', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '3.0.0' });

      const result = await migrator.migrate('2.0.0');

      expect(result.success).toBe(true);
      expect(result.toVersion).toBe('3.0.0');
    });

    it('should apply transforms in order', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '1.0.0', value: 1 });

      const callOrder: string[] = [];

      migrator.registerTransform({
        version: '1.5.0',
        name: 'first',
        transform: (config) => {
          callOrder.push('1.5.0');
          return { ...config, value: (config.value as number) * 2 };
        },
      });

      migrator.registerTransform({
        version: '2.0.0',
        name: 'second',
        transform: (config) => {
          callOrder.push('2.0.0');
          return { ...config, value: (config.value as number) + 10 };
        },
      });

      await migrator.migrate('2.0.0');

      expect(callOrder).toEqual(['1.5.0', '2.0.0']);
    });

    it('should handle transform failure', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '1.0.0' });

      const errorHandler = jest.fn();
      migrator.on('transform:error', errorHandler);

      migrator.registerTransform({
        version: '2.0.0',
        name: 'failing',
        transform: () => {
          throw new Error('Transform failed');
        },
      });

      const result = await migrator.migrate('2.0.0');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Transform 2.0.0 failed: Transform failed');
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should validate transform result', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '1.0.0' });

      migrator.registerTransform({
        version: '2.0.0',
        name: 'with-validation',
        transform: (config) => config,
        validate: () => false, // Always fail validation
      });

      const result = await migrator.migrate('2.0.0');

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Validation failed');
    });

    it('should track changes during migration', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({
        _version: '1.0.0',
        oldField: 'old',
        unchanged: 'same',
      });

      migrator.registerTransform({
        version: '2.0.0',
        name: 'changes',
        transform: (config) => ({
          ...config,
          newField: 'new',
          oldField: 'modified',
        }),
      });

      const result = await migrator.migrate('2.0.0');

      expect(result.changes.length).toBeGreaterThan(0);

      const addChange = result.changes.find(
        (c) => c.type === 'add' && c.path === 'newField'
      );
      expect(addChange).toBeDefined();

      const modifyChange = result.changes.find(
        (c) => c.type === 'modify' && c.path === 'oldField'
      );
      expect(modifyChange).toBeDefined();
    });

    it('should initialize if not initialized', async () => {
      const uninitMigrator = new ConfigMigrator({
        configDir: '/test/config',
        configFile: 'settings.json',
      });

      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '1.0.0' });

      uninitMigrator.registerTransform({
        version: '2.0.0',
        name: 'test',
        transform: (config) => config,
      });

      await uninitMigrator.migrate('2.0.0');

      expect(uninitMigrator.isInitialized()).toBe(true);
      uninitMigrator.dispose();
    });

    it('should update version when no transforms', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '1.0.0' });

      // No transforms registered
      const result = await migrator.migrate('2.0.0');

      expect(result.success).toBe(true);
      expect(result.toVersion).toBe('2.0.0');
      expect(mockWriteJson).toHaveBeenCalled();
    });
  });

  describe('Change Detection', () => {
    it('should detect added fields', async () => {
      await migrator.initialize();
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({ _version: '1.0.0', existing: 'value' });

      migrator.registerTransform({
        version: '2.0.0',
        name: 'add',
        transform: (config) => ({ ...config, newField: 'new' }),
      });

      const result = await migrator.migrate('2.0.0');

      const addChange = result.changes.find(
        (c) => c.type === 'add' && c.path === 'newField'
      );
      expect(addChange).toBeDefined();
    });

    it('should detect removed fields', async () => {
      await migrator.initialize();
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({
        _version: '1.0.0',
        existing: 'value',
        toRemove: 'gone',
      });

      migrator.registerTransform({
        version: '2.0.0',
        name: 'remove',
        transform: (config) => {
          const { toRemove, ...rest } = config as Record<string, unknown>;
          return rest;
        },
      });

      const result = await migrator.migrate('2.0.0');

      const removeChange = result.changes.find(
        (c) => c.type === 'remove' && c.path === 'toRemove'
      );
      expect(removeChange).toBeDefined();
    });

    it('should detect nested changes', async () => {
      await migrator.initialize();
      mockPathExists.mockResolvedValue(true);
      mockReadJson.mockResolvedValue({
        _version: '1.0.0',
        nested: { deep: { value: 'old' } },
      });

      migrator.registerTransform({
        version: '2.0.0',
        name: 'nested',
        transform: (config) => ({
          ...config,
          nested: { deep: { value: 'new' } },
        }),
      });

      const result = await migrator.migrate('2.0.0');

      const nestedChange = result.changes.find((c) =>
        c.path.includes('nested.deep.value')
      );
      expect(nestedChange).toBeDefined();
    });
  });

  describe('Validation', () => {
    it('should validate required fields', () => {
      const config = { field1: 'value1' };

      const result = migrator.validateConfig(config, ['field1', 'field2']);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: field2');
    });

    it('should pass validation when all required fields present', () => {
      const config = { field1: 'value1', field2: 'value2' };

      const result = migrator.validateConfig(config, ['field1', 'field2']);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass validation with no required fields', () => {
      const config = { field1: 'value1' };

      const result = migrator.validateConfig(config);

      expect(result.valid).toBe(true);
    });
  });

  describe('Apply Defaults', () => {
    it('should add missing default values', () => {
      const config = { existing: 'value' };
      const defaults = { existing: 'default', newField: 'default' };

      const result = migrator.applyDefaults(config, defaults);

      expect(result.existing).toBe('value'); // Not overwritten
      expect(result.newField).toBe('default'); // Added
    });

    it('should merge nested defaults', () => {
      const config = { nested: { existing: 'value' } };
      const defaults = { nested: { existing: 'default', newField: 'default' } };

      const result = migrator.applyDefaults(config, defaults);

      expect((result.nested as Record<string, unknown>).existing).toBe('value');
      expect((result.nested as Record<string, unknown>).newField).toBe('default');
    });

    it('should not overwrite arrays', () => {
      const config = { arr: [1, 2, 3] };
      const defaults = { arr: [4, 5, 6] };

      const result = migrator.applyDefaults(config, defaults);

      expect(result.arr).toEqual([1, 2, 3]);
    });

    it('should add array defaults when missing', () => {
      const config = {};
      const defaults = { arr: [1, 2, 3] };

      const result = migrator.applyDefaults(config, defaults);

      expect(result.arr).toEqual([1, 2, 3]);
    });
  });

  describe('Remove Deprecated Fields', () => {
    it('should remove simple deprecated fields', () => {
      const config = { keep: 'value', remove: 'deprecated' };

      const result = migrator.removeDeprecatedFields(config, ['remove']);

      expect(result.keep).toBe('value');
      expect(result.remove).toBeUndefined();
    });

    it('should remove nested deprecated fields', () => {
      const config = {
        nested: { keep: 'value', remove: 'deprecated' },
      };

      const result = migrator.removeDeprecatedFields(config, ['nested.remove']);

      expect((result.nested as Record<string, unknown>).keep).toBe('value');
      expect((result.nested as Record<string, unknown>).remove).toBeUndefined();
    });

    it('should handle non-existent fields gracefully', () => {
      const config = { keep: 'value' };

      const result = migrator.removeDeprecatedFields(config, ['nonexistent']);

      expect(result.keep).toBe('value');
    });

    it('should handle deeply nested paths', () => {
      const config = {
        a: { b: { c: { remove: 'deprecated', keep: 'value' } } },
      };

      const result = migrator.removeDeprecatedFields(config, ['a.b.c.remove']);

      expect(
        ((result.a as Record<string, unknown>).b as Record<string, unknown>)
          .c as Record<string, unknown>
      ).not.toHaveProperty('remove');
    });
  });

  describe('Rename Field', () => {
    it('should rename field', () => {
      const config = { oldName: 'value' };

      const result = migrator.renameField(config, 'oldName', 'newName');

      expect(result.newName).toBe('value');
      expect(result.oldName).toBeUndefined();
    });

    it('should preserve other fields', () => {
      const config = { oldName: 'value', other: 'keep' };

      const result = migrator.renameField(config, 'oldName', 'newName');

      expect(result.other).toBe('keep');
    });

    it('should handle non-existent field', () => {
      const config = { keep: 'value' };

      const result = migrator.renameField(config, 'nonexistent', 'newName');

      expect(result.keep).toBe('value');
      expect(result.newName).toBeUndefined();
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getConfigMigrator', () => {
      const instance1 = getConfigMigrator();
      const instance2 = getConfigMigrator();

      expect(instance1).toBe(instance2);
      resetConfigMigrator();
    });

    it('should reset singleton', () => {
      const instance1 = getConfigMigrator();
      resetConfigMigrator();
      const instance2 = getConfigMigrator();

      expect(instance1).not.toBe(instance2);
      resetConfigMigrator();
    });
  });

  describe('Dispose', () => {
    it('should clean up resources on dispose', () => {
      migrator.registerTransform({
        version: '1.0.0',
        name: 'test',
        transform: (config) => config,
      });

      migrator.dispose();

      expect(migrator.getTransforms()).toHaveLength(0);
      expect(migrator.isInitialized()).toBe(false);
    });

    it('should remove all event listeners on dispose', () => {
      const handler = jest.fn();
      migrator.on('transform:registered', handler);

      migrator.dispose();

      expect(migrator.listenerCount('transform:registered')).toBe(0);
    });
  });
});
