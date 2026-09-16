import { PluginManager } from '../../src/plugins/plugin-manager.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { Plugin, PluginContext, PluginProvider, PluginProviderType } from '../../src/plugins/types.js';

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
jest.mock('../../src/plugins/isolated-plugin-runner.js', () => ({
  createIsolatedPluginRunner: jest.fn().mockReturnValue({
    on: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    activate: jest.fn().mockResolvedValue(undefined),
    deactivate: jest.fn().mockResolvedValue(undefined),
    terminate: jest.fn().mockResolvedValue(undefined)
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

    it('ignores managed storage folders but accepts an explicit plugin manifest there', async () => {
      (fs.pathExists as jest.Mock).mockImplementation(async (name) =>
        name === mockPluginDir || name === path.join(mockPluginDir, 'installed', 'manifest.json'));
      (fs.readdir as unknown as jest.Mock).mockResolvedValue([
        { name: 'cache', isDirectory: () => true },
        { name: 'installed', isDirectory: () => true },
        { name: 'plugin-a', isDirectory: () => true },
      ]);
      const loadSpy = jest.spyOn(manager, 'loadPlugin').mockResolvedValue(true);
      await manager.discover();
      expect(loadSpy).not.toHaveBeenCalledWith(path.join(mockPluginDir, 'cache'));
      expect(loadSpy).toHaveBeenCalledWith(path.join(mockPluginDir, 'installed'));
      expect(loadSpy).toHaveBeenCalledWith(path.join(mockPluginDir, 'plugin-a'));
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

  describe('provider registration', () => {
    /**
     * Helper to create a mock LLM provider
     */
    function createMockLLMProvider(overrides: Partial<PluginProvider> = {}): PluginProvider {
      return {
        id: 'test-llm-provider',
        name: 'Test LLM Provider',
        type: 'llm' as PluginProviderType,
        priority: 10,
        initialize: jest.fn().mockResolvedValue(undefined),
        shutdown: jest.fn().mockResolvedValue(undefined),
        chat: jest.fn().mockResolvedValue('response'),
        complete: jest.fn().mockResolvedValue('response'),
        ...overrides
      };
    }

    /**
     * Helper to create a mock embedding provider
     */
    function createMockEmbeddingProvider(overrides: Partial<PluginProvider> = {}): PluginProvider {
      return {
        id: 'test-embedding-provider',
        name: 'Test Embedding Provider',
        type: 'embedding' as PluginProviderType,
        priority: 5,
        initialize: jest.fn().mockResolvedValue(undefined),
        embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        ...overrides
      };
    }

    /**
     * Helper to create a mock search provider
     */
    function createMockSearchProvider(overrides: Partial<PluginProvider> = {}): PluginProvider {
      return {
        id: 'test-search-provider',
        name: 'Test Search Provider',
        type: 'search' as PluginProviderType,
        initialize: jest.fn().mockResolvedValue(undefined),
        search: jest.fn().mockResolvedValue([{ id: '1', content: 'result', score: 0.9 }]),
        ...overrides
      };
    }

    describe('registerProvider', () => {
      it('should register a valid LLM provider', async () => {
        const provider = createMockLLMProvider();

        await manager.registerProvider(provider);

        expect(provider.initialize).toHaveBeenCalled();
        expect(manager.getProvider('test-llm-provider')).toBe(provider);
        expect(manager.getProvidersByType('llm')).toContain(provider);
      });

      it('should register a valid embedding provider', async () => {
        const provider = createMockEmbeddingProvider();

        await manager.registerProvider(provider);

        expect(provider.initialize).toHaveBeenCalled();
        expect(manager.getProvider('test-embedding-provider')).toBe(provider);
        expect(manager.getProvidersByType('embedding')).toContain(provider);
      });

      it('should register a valid search provider', async () => {
        const provider = createMockSearchProvider();

        await manager.registerProvider(provider);

        expect(provider.initialize).toHaveBeenCalled();
        expect(manager.getProvider('test-search-provider')).toBe(provider);
        expect(manager.getProvidersByType('search')).toContain(provider);
      });

      it('should emit plugin:provider-registered event', async () => {
        const provider = createMockLLMProvider();
        const eventHandler = jest.fn();
        manager.on('plugin:provider-registered', eventHandler);

        await manager.registerProvider(provider, 'my-plugin');

        expect(eventHandler).toHaveBeenCalledWith({
          id: 'test-llm-provider',
          name: 'Test LLM Provider',
          type: 'llm',
          priority: 10,
          pluginId: 'my-plugin'
        });
      });

      it('should reject provider without id', async () => {
        const provider = createMockLLMProvider({ id: '' });

        await expect(manager.registerProvider(provider)).rejects.toThrow('Provider must have a valid id');
      });

      it('should reject provider without name', async () => {
        const provider = createMockLLMProvider({ name: '' });

        await expect(manager.registerProvider(provider)).rejects.toThrow('Provider must have a valid name');
      });

      it('should reject provider with invalid type', async () => {
        const provider = createMockLLMProvider({ type: 'invalid' as PluginProviderType });

        await expect(manager.registerProvider(provider)).rejects.toThrow('Provider must have a valid type');
      });

      it('should reject provider without initialize method', async () => {
        const provider = createMockLLMProvider();
        delete (provider as any).initialize;

        await expect(manager.registerProvider(provider)).rejects.toThrow('Provider must have an initialize() method');
      });

      it('should reject LLM provider without chat or complete method', async () => {
        const provider = createMockLLMProvider();
        delete (provider as any).chat;
        delete (provider as any).complete;

        await expect(manager.registerProvider(provider)).rejects.toThrow('LLM provider must have at least chat() or complete() method');
      });

      it('should reject embedding provider without embed method', async () => {
        const provider = createMockEmbeddingProvider();
        delete (provider as any).embed;

        await expect(manager.registerProvider(provider)).rejects.toThrow('Embedding provider must have an embed() method');
      });

      it('should reject search provider without search method', async () => {
        const provider = createMockSearchProvider();
        delete (provider as any).search;

        await expect(manager.registerProvider(provider)).rejects.toThrow('Search provider must have a search() method');
      });

      it('should reject duplicate provider ID', async () => {
        const provider1 = createMockLLMProvider();
        const provider2 = createMockLLMProvider({ name: 'Another Provider' });

        await manager.registerProvider(provider1);

        await expect(manager.registerProvider(provider2)).rejects.toThrow("Provider with id 'test-llm-provider' is already registered");
      });

      it('should handle initialization failure', async () => {
        const provider = createMockLLMProvider({
          initialize: jest.fn().mockRejectedValue(new Error('Init failed'))
        });

        await expect(manager.registerProvider(provider)).rejects.toThrow('Failed to initialize provider');
      });
    });

    describe('unregisterProvider', () => {
      it('should unregister a provider and call shutdown', async () => {
        const provider = createMockLLMProvider();
        await manager.registerProvider(provider);

        const result = await manager.unregisterProvider('test-llm-provider');

        expect(result).toBe(true);
        expect(provider.shutdown).toHaveBeenCalled();
        expect(manager.getProvider('test-llm-provider')).toBeUndefined();
        expect(manager.getProvidersByType('llm')).not.toContain(provider);
      });

      it('should emit plugin:provider-unregistered event', async () => {
        const provider = createMockLLMProvider();
        await manager.registerProvider(provider);
        const eventHandler = jest.fn();
        manager.on('plugin:provider-unregistered', eventHandler);

        await manager.unregisterProvider('test-llm-provider');

        expect(eventHandler).toHaveBeenCalledWith({
          id: 'test-llm-provider',
          type: 'llm'
        });
      });

      it('should return false for non-existent provider', async () => {
        const result = await manager.unregisterProvider('non-existent');

        expect(result).toBe(false);
      });

      it('should handle provider without shutdown method', async () => {
        const provider = createMockLLMProvider();
        delete (provider as any).shutdown;
        await manager.registerProvider(provider);

        const result = await manager.unregisterProvider('test-llm-provider');

        expect(result).toBe(true);
        expect(manager.getProvider('test-llm-provider')).toBeUndefined();
      });
    });

    describe('provider retrieval', () => {
      beforeEach(async () => {
        // Register multiple providers
        await manager.registerProvider(createMockLLMProvider({ id: 'llm-1', priority: 10 }));
        await manager.registerProvider(createMockLLMProvider({ id: 'llm-2', priority: 20 }));
        await manager.registerProvider(createMockEmbeddingProvider());
        await manager.registerProvider(createMockSearchProvider());
      });

      it('should get provider by ID', () => {
        expect(manager.getProvider('llm-1')).toBeDefined();
        expect(manager.getProvider('llm-1')?.id).toBe('llm-1');
      });

      it('should return undefined for unknown provider ID', () => {
        expect(manager.getProvider('unknown')).toBeUndefined();
      });

      it('should get all providers of a specific type', () => {
        const llmProviders = manager.getProvidersByType('llm');
        expect(llmProviders).toHaveLength(2);
      });

      it('should return providers sorted by priority (highest first)', () => {
        const llmProviders = manager.getProvidersByType('llm');
        expect(llmProviders[0].id).toBe('llm-2'); // priority 20
        expect(llmProviders[1].id).toBe('llm-1'); // priority 10
      });

      it('should return empty array for type with no providers', () => {
        const providers = manager.getProvidersByType('embedding');
        // We registered one embedding provider
        expect(providers).toHaveLength(1);

        // Now test with a fresh manager
        const freshManager = new PluginManager({ pluginDir: mockPluginDir, autoLoad: false });
        expect(freshManager.getProvidersByType('llm')).toEqual([]);
      });

      it('should get all registered providers', () => {
        const allProviders = manager.getAllProviders();
        expect(allProviders).toHaveLength(4);
      });

      it('should get primary (highest priority) provider', () => {
        const primaryLLM = manager.getPrimaryProvider('llm');
        expect(primaryLLM?.id).toBe('llm-2'); // highest priority
      });

      it('should return undefined when no providers of type exist', () => {
        const freshManager = new PluginManager({ pluginDir: mockPluginDir, autoLoad: false });
        expect(freshManager.getPrimaryProvider('llm')).toBeUndefined();
      });
    });

    describe('provider registration via plugin context', () => {
      it('should allow plugin to register provider through context', async () => {
        const pluginId = 'provider-plugin';
        const mockProvider = createMockLLMProvider({ id: 'plugin-llm-provider' });

        // Create a mock plugin that registers a provider
        const mockPluginActivate = jest.fn().mockImplementation((ctx: PluginContext) => {
          ctx.registerProvider(mockProvider);
        });

        // Manually inject loaded plugin state
        (manager as any).plugins.set(pluginId, {
          manifest: { id: pluginId, name: 'Provider Plugin', version: '1.0.0', description: 'Test' },
          status: 'loaded',
          path: '/mock/plugins/provider-plugin',
          instance: {
            activate: mockPluginActivate,
            deactivate: jest.fn()
          }
        });

        // Set up event listener
        const eventHandler = jest.fn();
        manager.on('plugin:provider-registered', eventHandler);

        // Activate the plugin
        await manager.activatePlugin(pluginId);

        // Verify provider was registered
        expect(mockPluginActivate).toHaveBeenCalled();
        expect(manager.getProvider('plugin-llm-provider')).toBe(mockProvider);
        expect(eventHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'plugin-llm-provider',
            pluginId: pluginId
          })
        );
      });
    });
  });

  describe('plugin configuration', () => {
    const pluginId = 'config-test-plugin';
    const userConfigDir = path.join(os.homedir(), '.codebuddy', 'plugins', pluginId);
    const userConfigPath = path.join(userConfigDir, 'config.json');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should load default config from manifest', async () => {
      const manifest = {
        id: pluginId,
        name: 'Config Test Plugin',
        version: '1.0.0',
        description: 'Test',
        defaultConfig: {
          setting1: 'default-value',
          setting2: 42
        }
      };

      // No user config exists
      (fs.pathExists as jest.Mock).mockResolvedValue(false);

      const config = await (manager as any).loadPluginConfig(manifest);

      expect(config).toEqual({
        setting1: 'default-value',
        setting2: 42
      });
    });

    it('should merge user config over defaults', async () => {
      const manifest = {
        id: pluginId,
        name: 'Config Test Plugin',
        version: '1.0.0',
        description: 'Test',
        defaultConfig: {
          setting1: 'default-value',
          setting2: 42,
          setting3: 'not-overridden'
        }
      };

      // User config exists
      (fs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        return p === userConfigPath;
      });

      (fs.readJson as jest.Mock).mockResolvedValue({
        setting1: 'user-value',
        setting2: 100
      });

      const config = await (manager as any).loadPluginConfig(manifest);

      expect(config).toEqual({
        setting1: 'user-value',  // overridden
        setting2: 100,          // overridden
        setting3: 'not-overridden' // kept from defaults
      });
    });

    it('should handle missing user config gracefully', async () => {
      const manifest = {
        id: pluginId,
        name: 'Config Test Plugin',
        version: '1.0.0',
        description: 'Test'
        // no defaultConfig
      };

      (fs.pathExists as jest.Mock).mockResolvedValue(false);

      const config = await (manager as any).loadPluginConfig(manifest);

      expect(config).toEqual({});
    });

    it('should handle invalid user config file', async () => {
      const manifest = {
        id: pluginId,
        name: 'Config Test Plugin',
        version: '1.0.0',
        description: 'Test',
        defaultConfig: {
          setting1: 'default'
        }
      };

      (fs.pathExists as jest.Mock).mockImplementation(async (p: string) => {
        return p === userConfigPath;
      });

      // Simulate JSON parse error
      (fs.readJson as jest.Mock).mockRejectedValue(new Error('Invalid JSON'));

      const config = await (manager as any).loadPluginConfig(manifest);

      // Should fall back to defaults
      expect(config).toEqual({
        setting1: 'default'
      });
    });

    it('should validate config against schema and emit event on errors', async () => {
      const manifest = {
        id: pluginId,
        name: 'Config Test Plugin',
        version: '1.0.0',
        description: 'Test',
        configSchema: {
          type: 'object',
          properties: {
            apiKey: { type: 'string' },
            port: { type: 'number' }
          },
          required: ['apiKey']
        },
        defaultConfig: {}
      };

      (fs.pathExists as jest.Mock).mockResolvedValue(false);

      const eventHandler = jest.fn();
      manager.on('plugin:config-validation-failed', eventHandler);

      await (manager as any).loadPluginConfig(manifest);

      // Should emit validation error event for missing required field
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId,
          errors: expect.any(Array)
        })
      );
    });

    it('should cache loaded config for retrieval', async () => {
      const manifest = {
        id: pluginId,
        name: 'Config Test Plugin',
        version: '1.0.0',
        description: 'Test',
        defaultConfig: {
          cached: 'value'
        }
      };

      (fs.pathExists as jest.Mock).mockResolvedValue(false);

      await (manager as any).loadPluginConfig(manifest);

      const cachedConfig = manager.getPluginConfig(pluginId);
      expect(cachedConfig).toEqual({
        cached: 'value'
      });
    });

    it('should return undefined for uncached plugin config', () => {
      const config = manager.getPluginConfig('non-existent-plugin');
      expect(config).toBeUndefined();
    });
  });
});
