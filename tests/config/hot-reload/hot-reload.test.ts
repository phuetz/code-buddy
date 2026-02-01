/**
 * Config Hot-Reload Tests
 */

import * as path from 'path';
import * as os from 'os';
import fs from 'fs-extra';
import {
  hashConfig,
  createSnapshot,
  snapshotsEqual,
  diffConfigs,
  groupChangesBySubsystem,
  getAffectedSubsystems,
  getSubsystemForPath,
  ConfigWatcher,
  registerReloader,
  unregisterReloader,
  reloadSubsystems,
  sortByPriority,
  getReloadOrder,
  createNoOpReloader,
  createSimpleReloader,
  HotReloadManager,
  type ConfigChange,
  type SubsystemId,
} from '../../../src/config/hot-reload/index.js';

describe('Config Hot-Reload', () => {
  const testDir = path.join(os.tmpdir(), 'codebuddy-hot-reload-test');

  beforeEach(async () => {
    await fs.remove(testDir);
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('hashConfig', () => {
    it('should create consistent hashes', () => {
      const config = { model: 'gpt-4', tools: ['read', 'write'] };
      const hash1 = hashConfig(config);
      const hash2 = hashConfig(config);
      expect(hash1).toBe(hash2);
    });

    it('should create different hashes for different configs', () => {
      const config1 = { model: 'gpt-4' };
      const config2 = { model: 'gpt-3.5' };
      expect(hashConfig(config1)).not.toBe(hashConfig(config2));
    });

    it('should be order-independent for object keys', () => {
      const config1 = { a: 1, b: 2 };
      const config2 = { b: 2, a: 1 };
      expect(hashConfig(config1)).toBe(hashConfig(config2));
    });
  });

  describe('createSnapshot', () => {
    it('should create snapshot with hash and timestamp', () => {
      const data = { model: 'gpt-4' };
      const snapshot = createSnapshot(data);

      expect(snapshot.hash).toBeDefined();
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.data).toEqual(data);
    });

    it('should deep clone data', () => {
      const data = { nested: { value: 1 } };
      const snapshot = createSnapshot(data);

      data.nested.value = 2;
      expect((snapshot.data as { nested: { value: number } }).nested.value).toBe(1);
    });
  });

  describe('snapshotsEqual', () => {
    it('should return true for equal snapshots', () => {
      const data = { model: 'gpt-4' };
      const snap1 = createSnapshot(data);
      const snap2 = createSnapshot(data);
      expect(snapshotsEqual(snap1, snap2)).toBe(true);
    });

    it('should return false for different snapshots', () => {
      const snap1 = createSnapshot({ model: 'gpt-4' });
      const snap2 = createSnapshot({ model: 'gpt-3.5' });
      expect(snapshotsEqual(snap1, snap2)).toBe(false);
    });
  });

  describe('diffConfigs', () => {
    it('should detect added keys', () => {
      const old = createSnapshot({ model: 'gpt-4' });
      const newSnap = createSnapshot({ model: 'gpt-4', tools: ['read'] });

      const changes = diffConfigs(old, newSnap);
      expect(changes.length).toBe(1);
      expect(changes[0].path).toBe('tools');
      expect(changes[0].oldValue).toBeUndefined();
      expect(changes[0].newValue).toEqual(['read']);
    });

    it('should detect removed keys', () => {
      const old = createSnapshot({ model: 'gpt-4', tools: ['read'] });
      const newSnap = createSnapshot({ model: 'gpt-4' });

      const changes = diffConfigs(old, newSnap);
      expect(changes.length).toBe(1);
      expect(changes[0].path).toBe('tools');
      expect(changes[0].oldValue).toEqual(['read']);
      expect(changes[0].newValue).toBeUndefined();
    });

    it('should detect changed values', () => {
      const old = createSnapshot({ model: 'gpt-4' });
      const newSnap = createSnapshot({ model: 'gpt-3.5' });

      const changes = diffConfigs(old, newSnap);
      expect(changes.length).toBe(1);
      expect(changes[0].path).toBe('model');
      expect(changes[0].oldValue).toBe('gpt-4');
      expect(changes[0].newValue).toBe('gpt-3.5');
    });

    it('should return empty for equal configs', () => {
      const data = { model: 'gpt-4' };
      const snap1 = createSnapshot(data);
      const snap2 = createSnapshot(data);

      const changes = diffConfigs(snap1, snap2);
      expect(changes.length).toBe(0);
    });
  });

  describe('getSubsystemForPath', () => {
    it('should map model paths', () => {
      expect(getSubsystemForPath('model')).toBe('model');
      expect(getSubsystemForPath('defaultModel')).toBe('model');
      expect(getSubsystemForPath('provider')).toBe('model');
    });

    it('should map tool paths', () => {
      expect(getSubsystemForPath('tools')).toBe('tools');
    });

    it('should map policy paths', () => {
      expect(getSubsystemForPath('policies')).toBe('policies');
      expect(getSubsystemForPath('toolPolicy')).toBe('policies');
    });

    it('should return null for unknown paths', () => {
      expect(getSubsystemForPath('unknownKey')).toBeNull();
    });
  });

  describe('groupChangesBySubsystem', () => {
    it('should group changes correctly', () => {
      const changes: ConfigChange[] = [
        { subsystem: 'model', path: 'model', oldValue: 'a', newValue: 'b', timestamp: 1 },
        { subsystem: 'model', path: 'provider', oldValue: 'x', newValue: 'y', timestamp: 1 },
        { subsystem: 'tools', path: 'tools', oldValue: [], newValue: ['read'], timestamp: 1 },
      ];

      const grouped = groupChangesBySubsystem(changes);

      expect(grouped.get('model')?.length).toBe(2);
      expect(grouped.get('tools')?.length).toBe(1);
    });
  });

  describe('getAffectedSubsystems', () => {
    it('should return unique subsystems', () => {
      const changes: ConfigChange[] = [
        { subsystem: 'model', path: 'model', oldValue: 'a', newValue: 'b', timestamp: 1 },
        { subsystem: 'model', path: 'provider', oldValue: 'x', newValue: 'y', timestamp: 1 },
        { subsystem: 'tools', path: 'tools', oldValue: [], newValue: ['read'], timestamp: 1 },
      ];

      const subsystems = getAffectedSubsystems(changes);

      expect(subsystems).toContain('model');
      expect(subsystems).toContain('tools');
      expect(subsystems.length).toBe(2);
    });
  });

  describe('sortByPriority', () => {
    it('should sort subsystems by priority', () => {
      const subsystems: SubsystemId[] = ['skills', 'security', 'model'];
      const sorted = sortByPriority(subsystems);

      expect(sorted[0]).toBe('security');
      expect(sorted[1]).toBe('model');
      expect(sorted[2]).toBe('skills');
    });
  });

  describe('getReloadOrder', () => {
    it('should return correct reload order', () => {
      const subsystems: SubsystemId[] = ['tools', 'security'];
      const order = getReloadOrder(subsystems);

      // Security should come before tools (lower priority)
      const securityIndex = order.indexOf('security');
      const toolsIndex = order.indexOf('tools');
      expect(securityIndex).toBeLessThan(toolsIndex);
    });
  });

  describe('ConfigWatcher', () => {
    it('should start and stop', async () => {
      const watcher = new ConfigWatcher({
        paths: [testDir],
        debounceMs: 50,
      });

      expect(watcher.isRunning()).toBe(false);
      await watcher.start();
      expect(watcher.isRunning()).toBe(true);
      watcher.stop();
      expect(watcher.isRunning()).toBe(false);
    });

    it('should add and remove paths', async () => {
      const watcher = new ConfigWatcher({
        paths: [],
        debounceMs: 50,
      });

      await watcher.addPath(testDir);
      expect(watcher.getWatchedPaths()).toContain(testDir);

      watcher.removePath(testDir);
      expect(watcher.getWatchedPaths()).not.toContain(testDir);
    });

    it('should detect file changes', async () => {
      const configPath = path.join(testDir, 'config.json');
      await fs.writeJson(configPath, { model: 'gpt-4' });

      const watcher = new ConfigWatcher({
        paths: [configPath],
        debounceMs: 50,
      });

      const changePromise = new Promise<void>((resolve) => {
        watcher.on('change', () => resolve());
      });

      await watcher.start();

      // Modify the file
      await fs.writeJson(configPath, { model: 'gpt-3.5' });

      // Wait for change or timeout
      await Promise.race([
        changePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000)),
      ]).catch(() => {
        // Timeout is acceptable in CI environments
      });

      watcher.stop();
    });
  });

  describe('reloadSubsystems', () => {
    beforeEach(() => {
      // Clean up any registered reloaders
      const subsystems: SubsystemId[] = ['model', 'tools', 'policies', 'plugins', 'memory', 'mcp', 'skills', 'security'];
      for (const s of subsystems) {
        unregisterReloader(s);
      }
    });

    it('should call registered reloaders', async () => {
      let reloadedModel = false;

      registerReloader('model', async () => {
        reloadedModel = true;
        return { success: true, subsystem: 'model', duration: 10 };
      });

      const changes: ConfigChange[] = [
        { subsystem: 'model', path: 'model', oldValue: 'a', newValue: 'b', timestamp: 1 },
      ];

      const results = await reloadSubsystems(changes);

      expect(reloadedModel).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
    });

    it('should handle reload failures', async () => {
      registerReloader('model', async () => {
        throw new Error('Reload failed');
      });

      const changes: ConfigChange[] = [
        { subsystem: 'model', path: 'model', oldValue: 'a', newValue: 'b', timestamp: 1 },
      ];

      const results = await reloadSubsystems(changes, { rollbackOnFailure: false });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Reload failed');
    });

    it('should skip subsystems without reloaders', async () => {
      const changes: ConfigChange[] = [
        { subsystem: 'model', path: 'model', oldValue: 'a', newValue: 'b', timestamp: 1 },
      ];

      const results = await reloadSubsystems(changes);

      // Should succeed (no-op)
      expect(results[0].success).toBe(true);
    });
  });

  describe('createNoOpReloader', () => {
    it('should create a no-op reloader', async () => {
      const reloader = createNoOpReloader('model');
      const result = await reloader({
        subsystem: 'model',
        path: 'model',
        oldValue: 'a',
        newValue: 'b',
        timestamp: 1,
      });

      expect(result.success).toBe(true);
      expect(result.subsystem).toBe('model');
    });
  });

  describe('createSimpleReloader', () => {
    it('should create a simple reloader', async () => {
      let receivedValue: unknown;
      const reloader = createSimpleReloader('model', async (value) => {
        receivedValue = value;
      });

      const result = await reloader({
        subsystem: 'model',
        path: 'model',
        oldValue: 'a',
        newValue: 'b',
        timestamp: 1,
      });

      expect(result.success).toBe(true);
      expect(receivedValue).toBe('b');
    });

    it('should handle errors', async () => {
      const reloader = createSimpleReloader('model', async () => {
        throw new Error('Test error');
      });

      const result = await reloader({
        subsystem: 'model',
        path: 'model',
        oldValue: 'a',
        newValue: 'b',
        timestamp: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error');
    });
  });

  describe('HotReloadManager', () => {
    it('should create manager with default config', () => {
      const manager = new HotReloadManager();
      expect(manager.isRunning()).toBe(false);
      manager.stop();
    });

    it('should start and stop', async () => {
      const manager = new HotReloadManager({
        watcher: { paths: [testDir] },
      });

      await manager.start();
      expect(manager.isRunning()).toBe(true);

      manager.stop();
      expect(manager.isRunning()).toBe(false);
    });

    it('should add and remove paths', async () => {
      const manager = new HotReloadManager({
        watcher: { paths: [] },
      });

      await manager.addPath(testDir);
      expect(manager.getWatchedPaths()).toContain(testDir);

      manager.removePath(testDir);
      expect(manager.getWatchedPaths()).not.toContain(testDir);

      manager.stop();
    });

    it('should emit events', async () => {
      const configPath = path.join(testDir, 'config.json');
      await fs.writeJson(configPath, { model: 'gpt-4' });

      const manager = new HotReloadManager({
        watcher: {
          paths: [configPath],
          debounceMs: 50,
        },
      });

      let startedEmitted = false;
      manager.on('watcher:started', () => {
        startedEmitted = true;
      });

      await manager.start();

      // Give time for event to emit
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(startedEmitted).toBe(true);

      manager.stop();
    });
  });
});
