import { PluginManager } from '../../src/plugins/plugin-manager.js';
import fs from 'fs-extra';
import path from 'path';
import { Plugin, PluginContext } from '../../src/plugins/types.js';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('../../src/tools/tool-manager.js', () => ({
  getToolManager: jest.fn().mockReturnValue({
    register: jest.fn()
  })
}));
jest.mock('../../src/commands/slash-commands.js', () => ({
  getSlashCommandManager: jest.fn().mockReturnValue({
    commands: new Map() // simulate the private map we access via ts-ignore
  })
}));

describe('PluginManager', () => {
  let manager: PluginManager;
  const mockPluginDir = '/mock/plugins';

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new PluginManager({ pluginDir: mockPluginDir, autoLoad: false });
  });

  describe('discover', () => {
    it('should create plugin directory if not exists', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(false);
      
      await manager.discover();
      
      expect(fs.ensureDir).toHaveBeenCalledWith(mockPluginDir);
    });

    it('should scan for plugins', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(true);
      (fs.readdir as unknown as jest.Mock).mockResolvedValue([
        { name: 'plugin-a', isDirectory: () => true },
        { name: 'not-a-plugin', isDirectory: () => false }
      ]);
      
      // Mock loadPlugin to avoid actual loading logic in this test
      const loadSpy = jest.spyOn(manager, 'loadPlugin').mockResolvedValue(true);
      
      await manager.discover();
      
      expect(loadSpy).toHaveBeenCalledWith(path.join(mockPluginDir, 'plugin-a'));
      expect(loadSpy).not.toHaveBeenCalledWith(path.join(mockPluginDir, 'not-a-plugin'));
    });
  });

  describe('lifecycle', () => {
    const pluginId = 'test-plugin';
    const pluginPath = path.join(mockPluginDir, pluginId);
    
    // Mock plugin implementation
    const mockActivate = jest.fn();
    const mockDeactivate = jest.fn();
    class MockPlugin implements Plugin {
      activate(ctx: PluginContext) { mockActivate(ctx); }
      deactivate() { mockDeactivate(); }
    }

    beforeEach(() => {
      // Mock file system for plugin loading
      (fs.pathExists as jest.Mock).mockImplementation(async (p) => {
        if (p === path.join(pluginPath, 'manifest.json')) return true;
        if (p === path.join(pluginPath, 'index.js')) return true;
        return false;
      });

      (fs.readJson as jest.Mock).mockResolvedValue({
        id: pluginId,
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin'
      });

      // Mock dynamic import
      // Since jest.mock is hoisted, we can't easily mock dynamic imports inside tests without babel config
      // We'll rely on mocking the internal loadPlugin behavior or restructuring.
      // For this unit test, we'll manually inject the plugin into the manager's map to test activation/deactivation
      // bypassing loadPlugin's import() call which is hard to mock here.
    });

    it('should activate a loaded plugin', async () => {
      // Manually inject loaded plugin state
      (manager as any).plugins.set(pluginId, {
        manifest: { id: pluginId, name: 'Test', version: '1.0' },
        status: 'loaded',
        path: pluginPath,
        instance: new MockPlugin()
      });

      const result = await manager.activatePlugin(pluginId);
      
      expect(result).toBe(true);
      expect(mockActivate).toHaveBeenCalled();
      expect((manager as any).plugins.get(pluginId).status).toBe('active');
    });

    it('should deactivate an active plugin', async () => {
      // Manually inject active plugin state
      (manager as any).plugins.set(pluginId, {
        manifest: { id: pluginId, name: 'Test', version: '1.0' },
        status: 'active',
        path: pluginPath,
        instance: new MockPlugin()
      });

      const result = await manager.deactivatePlugin(pluginId);
      
      expect(result).toBe(true);
      expect(mockDeactivate).toHaveBeenCalled();
      expect((manager as any).plugins.get(pluginId).status).toBe('disabled');
    });
  });
});
