/**
 * Tests for Plugin Marketplace
 */

import { PluginMarketplace, getPluginMarketplace, resetPluginMarketplace } from '../src/plugins/marketplace';

// Mock dependencies
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  pathExists: jest.fn().mockResolvedValue(false),
  readJSON: jest.fn().mockResolvedValue({ plugins: [] }),
  writeJSON: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  remove: jest.fn().mockResolvedValue(undefined),
  createReadStream: jest.fn(),
}));

jest.mock('axios');

describe('PluginMarketplace', () => {
  let marketplace: PluginMarketplace;

  beforeEach(() => {
    resetPluginMarketplace();
    marketplace = new PluginMarketplace({
      autoUpdate: false,
      maxPlugins: 10,
    });
  });

  afterEach(async () => {
    await marketplace.dispose();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const m = new PluginMarketplace();
      expect(m).toBeDefined();
      m.dispose();
    });

    it('should accept custom config', async () => {
      const m = new PluginMarketplace({
        maxPlugins: 20,
        allowUntrusted: true,
      });
      expect(m).toBeDefined();
      await m.dispose();
    });
  });

  describe('getInstalled', () => {
    it('should return empty array initially', () => {
      const installed = marketplace.getInstalled();
      expect(installed).toEqual([]);
    });
  });

  describe('getLoaded', () => {
    it('should return empty array initially', () => {
      const loaded = marketplace.getLoaded();
      expect(loaded).toEqual([]);
    });
  });

  describe('getCommands', () => {
    it('should return empty array initially', () => {
      const commands = marketplace.getCommands();
      expect(commands).toEqual([]);
    });
  });

  describe('getTools', () => {
    it('should return empty array initially', () => {
      const tools = marketplace.getTools();
      expect(tools).toEqual([]);
    });
  });

  describe('executeHooks', () => {
    it('should return data when no hooks', async () => {
      const result = await marketplace.executeHooks('test', { value: 1 });
      expect(result).toEqual({ value: 1 });
    });
  });

  describe('formatStatus', () => {
    it('should render status', () => {
      const status = marketplace.formatStatus();

      expect(status).toContain('PLUGIN MARKETPLACE');
      expect(status).toContain('Installed');
      expect(status).toContain('No plugins installed');
    });
  });

  describe('events', () => {
    it('should emit command:registered event', () => {
      const handler = jest.fn();
      marketplace.on('command:registered', handler);

      // Manually trigger for testing
      marketplace.emit('command:registered', { name: 'test', pluginId: 'test-plugin' });

      expect(handler).toHaveBeenCalledWith({
        name: 'test',
        pluginId: 'test-plugin',
      });
    });

    it('should emit tool:registered event', () => {
      const handler = jest.fn();
      marketplace.on('tool:registered', handler);

      marketplace.emit('tool:registered', { name: 'test-tool', pluginId: 'test-plugin' });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      resetPluginMarketplace();
      const instance1 = getPluginMarketplace();
      const instance2 = getPluginMarketplace();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', async () => {
      const instance1 = getPluginMarketplace();
      resetPluginMarketplace();
      const instance2 = getPluginMarketplace();
      expect(instance1).not.toBe(instance2);
    });
  });
});
