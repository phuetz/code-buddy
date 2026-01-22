import { handlePlugins } from '../../src/commands/handlers/plugin-handlers.js';
import { getPluginMarketplace } from '../../src/plugins/marketplace.js';
import { getPluginManager } from '../../src/plugins/plugin-manager.js';

// Mock dependencies
jest.mock('../../src/plugins/marketplace.js', () => ({
  getPluginMarketplace: jest.fn()
}));

jest.mock('../../src/plugins/plugin-manager.js', () => ({
  getPluginManager: jest.fn()
}));

describe('Plugin CLI Integration', () => {
  const mockMarketplace = {
    getInstalled: jest.fn(),
    search: jest.fn(),
    install: jest.fn(),
    uninstall: jest.fn(),
    formatStatus: jest.fn()
  };

  const mockPluginManager = {
    getAllPlugins: jest.fn(),
    activatePlugin: jest.fn(),
    deactivatePlugin: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getPluginMarketplace as jest.Mock).mockReturnValue(mockMarketplace);
    (getPluginManager as jest.Mock).mockReturnValue(mockPluginManager);
  });

  describe('list', () => {
    it('should list both installed and loaded plugins', async () => {
      mockMarketplace.getInstalled.mockReturnValue([
        { id: 'marketplace-plugin', version: '1.0.0', description: 'Marketplace Plugin', enabled: true }
      ]);
      mockPluginManager.getAllPlugins.mockReturnValue([
        { 
          manifest: { name: 'Local Plugin', version: '0.0.1', description: 'Local' },
          status: 'active'
        }
      ]);

      const result = await handlePlugins(['list']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Running (New System):');
      expect(result.entry?.content).toContain('Local Plugin');
      expect(result.entry?.content).toContain('Installed (Legacy):');
      expect(result.entry?.content).toContain('marketplace-plugin');
    });

    it('should handle empty lists', async () => {
      mockMarketplace.getInstalled.mockReturnValue([]);
      mockPluginManager.getAllPlugins.mockReturnValue([]);

      const result = await handlePlugins(['list']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('No plugins installed or loaded');
    });
  });

  describe('enable/disable', () => {
    it('should activate a plugin', async () => {
      mockPluginManager.activatePlugin.mockResolvedValue(true);

      const result = await handlePlugins(['enable', 'my-plugin']);

      expect(mockPluginManager.activatePlugin).toHaveBeenCalledWith('my-plugin');
      expect(result.entry?.content).toContain('✅ Plugin my-plugin activated');
    });

    it('should handle activation failure', async () => {
      mockPluginManager.activatePlugin.mockResolvedValue(false);

      const result = await handlePlugins(['enable', 'bad-plugin']);

      expect(result.entry?.content).toContain('❌ Failed to activate plugin');
    });

    it('should deactivate a plugin', async () => {
      mockPluginManager.deactivatePlugin.mockResolvedValue(true);

      const result = await handlePlugins(['disable', 'my-plugin']);

      expect(mockPluginManager.deactivatePlugin).toHaveBeenCalledWith('my-plugin');
      expect(result.entry?.content).toContain('✅ Plugin my-plugin deactivated');
    });
  });

  describe('status', () => {
    it('should show combined status', async () => {
      mockMarketplace.formatStatus.mockReturnValue('Marketplace Status OK');
      mockPluginManager.getAllPlugins.mockReturnValue([
        { 
          manifest: { name: 'Active Plugin' },
          status: 'active'
        }
      ]);

      const result = await handlePlugins(['status']);

      expect(result.entry?.content).toContain('🔌 Plugin System Status');
      expect(result.entry?.content).toContain('Active Plugins: 1');
      expect(result.entry?.content).toContain('Legacy Marketplace:');
      expect(result.entry?.content).toContain('Marketplace Status OK');
    });
  });
});
