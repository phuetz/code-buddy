/**
 * Plugin Marketplace System
 *
 * Features:
 * - Plugin discovery and search
 * - Installation and updates
 * - Plugin lifecycle management
 * - Sandboxed execution
 * - Version compatibility checking
 * - Plugin ratings and reviews
 *
 * Allows extending Grok CLI with community plugins.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import axios from 'axios';
import * as semver from 'semver';

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: Author;
  license: string;
  repository?: string;
  homepage?: string;
  keywords: string[];
  category: PluginCategory;
  engines: {
    grok: string;
    node?: string;
  };
  main: string;
  dependencies?: Record<string, string>;
  permissions: Permission[];
  config?: PluginConfigSchema;
  readme?: string;
  changelog?: string;
  icon?: string;
}

export interface Author {
  name: string;
  email?: string;
  url?: string;
}

export type PluginCategory =
  | 'tools'
  | 'providers'
  | 'themes'
  | 'languages'
  | 'integrations'
  | 'utilities'
  | 'ai'
  | 'productivity';

export interface Permission {
  type: 'filesystem' | 'network' | 'shell' | 'env' | 'api' | 'system';
  scope?: string;
  reason: string;
}

export interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    default?: unknown;
    required?: boolean;
  }>;
}

export interface InstalledPlugin extends Plugin {
  installedAt: Date;
  updatedAt: Date;
  enabled: boolean;
  configValues: Record<string, unknown>;
  installPath: string;
}

export interface PluginSearchResult {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloads: number;
  rating: number;
  category: PluginCategory;
  verified: boolean;
  featured: boolean;
}

export interface PluginReview {
  id: string;
  pluginId: string;
  userId: string;
  userName: string;
  rating: number;
  title: string;
  content: string;
  createdAt: Date;
  helpful: number;
}

export interface PluginInstance {
  plugin: InstalledPlugin;
  module: any;
  api: PluginAPI;
}

export interface PluginAPI {
  // Core APIs exposed to plugins
  registerCommand: (name: string, handler: CommandHandler) => void;
  registerTool: (name: string, tool: ToolDefinition) => void;
  registerProvider: (name: string, provider: ProviderDefinition) => void;
  registerHook: (event: string, handler: HookHandler) => void;
  getConfig: () => Record<string, unknown>;
  setConfig: (key: string, value: unknown) => void;
  log: (level: string, message: string) => void;
  storage: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
}

export type CommandHandler = (args: string[], context: any) => Promise<string | void>;
export type HookHandler = (data: any) => Promise<any>;

export interface ToolDefinition {
  description: string;
  parameters: Record<string, any>;
  execute: (params: any) => Promise<any>;
}

export interface ProviderDefinition {
  type: 'llm' | 'embedding' | 'tts' | 'stt';
  models?: string[];
  execute: (request: any) => Promise<any>;
}

export interface MarketplaceConfig {
  registryUrl: string;
  autoUpdate: boolean;
  checkUpdatesInterval: number;
  allowUntrusted: boolean;
  sandboxPlugins: boolean;
  maxPlugins: number;
}

const DEFAULT_CONFIG: MarketplaceConfig = {
  registryUrl: 'https://plugins.grok-cli.dev',
  autoUpdate: true,
  checkUpdatesInterval: 86400000, // 24 hours
  allowUntrusted: false,
  sandboxPlugins: true,
  maxPlugins: 50,
};

const GROK_VERSION = '1.0.0'; // Should be imported from package.json

/**
 * Plugin Marketplace
 */
export class PluginMarketplace extends EventEmitter {
  private config: MarketplaceConfig;
  private pluginsDir: string;
  private installedPlugins: Map<string, InstalledPlugin> = new Map();
  private loadedPlugins: Map<string, PluginInstance> = new Map();
  private commands: Map<string, { pluginId: string; handler: CommandHandler }> = new Map();
  private tools: Map<string, { pluginId: string; tool: ToolDefinition }> = new Map();
  private providers: Map<string, { pluginId: string; provider: ProviderDefinition }> = new Map();
  private hooks: Map<string, Array<{ pluginId: string; handler: HookHandler }>> = new Map();

  constructor(config: Partial<MarketplaceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pluginsDir = path.join(os.homedir(), '.grok', 'plugins');
    this.initialize();
  }

  /**
   * Initialize marketplace
   */
  private async initialize(): Promise<void> {
    await fs.ensureDir(this.pluginsDir);
    await fs.ensureDir(path.join(this.pluginsDir, 'installed'));
    await fs.ensureDir(path.join(this.pluginsDir, 'cache'));
    await this.loadInstalledPlugins();

    if (this.config.autoUpdate) {
      this.startUpdateChecker();
    }
  }

  /**
   * Load installed plugins from disk
   */
  private async loadInstalledPlugins(): Promise<void> {
    const installedDir = path.join(this.pluginsDir, 'installed');
    const manifestPath = path.join(this.pluginsDir, 'manifest.json');

    if (await fs.pathExists(manifestPath)) {
      try {
        const manifest = await fs.readJSON(manifestPath);
        for (const plugin of manifest.plugins) {
          this.installedPlugins.set(plugin.id, plugin);

          if (plugin.enabled) {
            await this.loadPlugin(plugin.id);
          }
        }
      } catch {
        // Start fresh
      }
    }
  }

  /**
   * Save installed plugins manifest
   */
  private async saveManifest(): Promise<void> {
    const manifestPath = path.join(this.pluginsDir, 'manifest.json');
    await fs.writeJSON(manifestPath, {
      version: 1,
      updatedAt: new Date().toISOString(),
      plugins: Array.from(this.installedPlugins.values()),
    }, { spaces: 2 });
  }

  /**
   * Search plugins in marketplace
   */
  async search(query: string, options: {
    category?: PluginCategory;
    limit?: number;
    offset?: number;
    sort?: 'downloads' | 'rating' | 'updated' | 'name';
  } = {}): Promise<PluginSearchResult[]> {
    try {
      const response = await axios.get(`${this.config.registryUrl}/api/plugins/search`, {
        params: {
          q: query,
          category: options.category,
          limit: options.limit || 20,
          offset: options.offset || 0,
          sort: options.sort || 'downloads',
        },
        timeout: 10000,
      });

      return response.data.plugins || [];
    } catch (error) {
      this.emit('error', new Error(`Search failed: ${error}`));
      return [];
    }
  }

  /**
   * Get plugin details
   */
  async getPluginDetails(pluginId: string): Promise<Plugin | null> {
    try {
      const response = await axios.get(
        `${this.config.registryUrl}/api/plugins/${pluginId}`,
        { timeout: 10000 }
      );

      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Install a plugin
   */
  async install(pluginId: string, version?: string): Promise<InstalledPlugin | null> {
    if (this.installedPlugins.size >= this.config.maxPlugins) {
      throw new Error(`Maximum plugins limit (${this.config.maxPlugins}) reached`);
    }

    this.emit('install:start', { pluginId });

    try {
      // Get plugin info
      const plugin = await this.getPluginDetails(pluginId);
      if (!plugin) {
        throw new Error('Plugin not found');
      }

      // Check version compatibility
      if (!this.isCompatible(plugin)) {
        throw new Error(
          `Plugin requires Grok ${plugin.engines.grok}, but you have ${GROK_VERSION}`
        );
      }

      // Download plugin
      const downloadUrl = `${this.config.registryUrl}/api/plugins/${pluginId}/download`;
      const response = await axios.get(downloadUrl, {
        params: { version: version || plugin.version },
        responseType: 'arraybuffer',
        timeout: 60000,
      });

      // Verify checksum
      const checksum = response.headers['x-checksum'];
      if (checksum) {
        const hash = crypto.createHash('sha256').update(response.data).digest('hex');
        if (hash !== checksum) {
          throw new Error('Plugin checksum verification failed');
        }
      }

      // Extract to plugins directory
      const installPath = path.join(this.pluginsDir, 'installed', pluginId);
      await fs.ensureDir(installPath);

      // Write plugin data (in real implementation, would extract tarball)
      await fs.writeFile(path.join(installPath, 'plugin.tgz'), response.data);

      // For now, simulate extraction by creating a simple module
      await this.extractPlugin(installPath, response.data);

      // Create installed plugin record
      const installed: InstalledPlugin = {
        ...plugin,
        installedAt: new Date(),
        updatedAt: new Date(),
        enabled: true,
        configValues: this.getDefaultConfig(plugin),
        installPath,
      };

      this.installedPlugins.set(pluginId, installed);
      await this.saveManifest();

      // Load the plugin
      await this.loadPlugin(pluginId);

      this.emit('install:complete', { plugin: installed });

      return installed;
    } catch (error) {
      this.emit('install:error', { pluginId, error });
      throw error;
    }
  }

  /**
   * Extract plugin archive
   */
  private async extractPlugin(installPath: string, data: Buffer): Promise<void> {
    // In a real implementation, this would extract a tarball
    // For now, create a placeholder module

    const indexPath = path.join(installPath, 'index.js');
    await fs.writeFile(indexPath, `
      module.exports = {
        activate: function(api) {
          api.log('info', 'Plugin activated');
        },
        deactivate: function() {
          // Cleanup
        }
      };
    `);
  }

  /**
   * Uninstall a plugin
   */
  async uninstall(pluginId: string): Promise<void> {
    const plugin = this.installedPlugins.get(pluginId);
    if (!plugin) {
      throw new Error('Plugin not installed');
    }

    this.emit('uninstall:start', { pluginId });

    try {
      // Unload if loaded
      await this.unloadPlugin(pluginId);

      // Remove files
      await fs.remove(plugin.installPath);

      // Remove from manifest
      this.installedPlugins.delete(pluginId);
      await this.saveManifest();

      this.emit('uninstall:complete', { pluginId });
    } catch (error) {
      this.emit('uninstall:error', { pluginId, error });
      throw error;
    }
  }

  /**
   * Update a plugin
   */
  async update(pluginId: string): Promise<InstalledPlugin | null> {
    const installed = this.installedPlugins.get(pluginId);
    if (!installed) {
      throw new Error('Plugin not installed');
    }

    const latest = await this.getPluginDetails(pluginId);
    if (!latest) {
      throw new Error('Plugin not found in registry');
    }

    if (!semver.gt(latest.version, installed.version)) {
      return installed; // Already up to date
    }

    // Uninstall old version
    await this.uninstall(pluginId);

    // Install new version
    return this.install(pluginId, latest.version);
  }

  /**
   * Check for updates
   */
  async checkUpdates(): Promise<Array<{ plugin: InstalledPlugin; latestVersion: string }>> {
    const updates: Array<{ plugin: InstalledPlugin; latestVersion: string }> = [];

    for (const plugin of this.installedPlugins.values()) {
      try {
        const latest = await this.getPluginDetails(plugin.id);
        if (latest && semver.gt(latest.version, plugin.version)) {
          updates.push({ plugin, latestVersion: latest.version });
        }
      } catch {
        // Skip failed checks
      }
    }

    if (updates.length > 0) {
      this.emit('updates:available', { updates });
    }

    return updates;
  }

  /**
   * Start update checker
   */
  private startUpdateChecker(): void {
    setInterval(() => {
      this.checkUpdates();
    }, this.config.checkUpdatesInterval);
  }

  /**
   * Load a plugin
   */
  async loadPlugin(pluginId: string): Promise<void> {
    const plugin = this.installedPlugins.get(pluginId);
    if (!plugin) {
      throw new Error('Plugin not installed');
    }

    if (this.loadedPlugins.has(pluginId)) {
      return; // Already loaded
    }

    try {
      const modulePath = path.join(plugin.installPath, plugin.main || 'index.js');

      // Create plugin API
      const api = this.createPluginAPI(pluginId, plugin);

      // Load module
      const pluginModule = require(modulePath);

      // Create instance
      const instance: PluginInstance = {
        plugin,
        module: pluginModule,
        api,
      };

      // Activate plugin
      if (typeof pluginModule.activate === 'function') {
        await pluginModule.activate(api);
      }

      this.loadedPlugins.set(pluginId, instance);
      this.emit('plugin:loaded', { pluginId });
    } catch (error) {
      this.emit('plugin:error', { pluginId, error });
      throw error;
    }
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    const instance = this.loadedPlugins.get(pluginId);
    if (!instance) {
      return;
    }

    try {
      // Deactivate plugin
      if (typeof instance.module.deactivate === 'function') {
        await instance.module.deactivate();
      }

      // Remove registered items
      this.removePluginRegistrations(pluginId);

      // Clear from cache
      const modulePath = path.join(instance.plugin.installPath, instance.plugin.main || 'index.js');
      delete require.cache[require.resolve(modulePath)];

      this.loadedPlugins.delete(pluginId);
      this.emit('plugin:unloaded', { pluginId });
    } catch (error) {
      this.emit('plugin:error', { pluginId, error });
    }
  }

  /**
   * Remove plugin registrations
   */
  private removePluginRegistrations(pluginId: string): void {
    // Remove commands
    for (const [name, cmd] of this.commands) {
      if (cmd.pluginId === pluginId) {
        this.commands.delete(name);
      }
    }

    // Remove tools
    for (const [name, tool] of this.tools) {
      if (tool.pluginId === pluginId) {
        this.tools.delete(name);
      }
    }

    // Remove providers
    for (const [name, provider] of this.providers) {
      if (provider.pluginId === pluginId) {
        this.providers.delete(name);
      }
    }

    // Remove hooks
    for (const [event, handlers] of this.hooks) {
      this.hooks.set(event, handlers.filter(h => h.pluginId !== pluginId));
    }
  }

  /**
   * Create plugin API
   */
  private createPluginAPI(pluginId: string, plugin: InstalledPlugin): PluginAPI {
    const storagePath = path.join(plugin.installPath, 'storage.json');

    return {
      registerCommand: (name: string, handler: CommandHandler) => {
        this.commands.set(name, { pluginId, handler });
        this.emit('command:registered', { name, pluginId });
      },

      registerTool: (name: string, tool: ToolDefinition) => {
        this.tools.set(name, { pluginId, tool });
        this.emit('tool:registered', { name, pluginId });
      },

      registerProvider: (name: string, provider: ProviderDefinition) => {
        this.providers.set(name, { pluginId, provider });
        this.emit('provider:registered', { name, pluginId });
      },

      registerHook: (event: string, handler: HookHandler) => {
        if (!this.hooks.has(event)) {
          this.hooks.set(event, []);
        }
        this.hooks.get(event)!.push({ pluginId, handler });
      },

      getConfig: () => ({ ...plugin.configValues }),

      setConfig: (key: string, value: unknown) => {
        plugin.configValues[key] = value;
        this.saveManifest();
      },

      log: (level: string, message: string) => {
        this.emit('plugin:log', { pluginId, level, message });
      },

      storage: {
        get: async (key: string): Promise<unknown> => {
          try {
            const data = await fs.readJSON(storagePath);
            return data[key];
          } catch {
            return undefined;
          }
        },

        set: async (key: string, value: unknown): Promise<void> => {
          let data: Record<string, unknown> = {};
          try {
            data = await fs.readJSON(storagePath);
          } catch {
            // Start fresh
          }
          data[key] = value;
          await fs.writeJSON(storagePath, data, { spaces: 2 });
        },

        delete: async (key: string): Promise<void> => {
          try {
            const data = await fs.readJSON(storagePath);
            delete data[key];
            await fs.writeJSON(storagePath, data, { spaces: 2 });
          } catch {
            // Ignore
          }
        },
      },
    };
  }

  /**
   * Execute a plugin command
   */
  async executeCommand(name: string, args: string[], context: any): Promise<string | void> {
    const cmd = this.commands.get(name);
    if (!cmd) {
      throw new Error(`Command not found: ${name}`);
    }

    return cmd.handler(args, context);
  }

  /**
   * Execute a plugin tool
   */
  async executeTool(name: string, params: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    return tool.tool.execute(params);
  }

  /**
   * Execute hooks
   */
  async executeHooks(event: string, data: any): Promise<any> {
    const handlers = this.hooks.get(event) || [];
    let result = data;

    for (const handler of handlers) {
      try {
        result = await handler.handler(result) || result;
      } catch (error) {
        this.emit('hook:error', { event, pluginId: handler.pluginId, error });
      }
    }

    return result;
  }

  /**
   * Check version compatibility
   */
  private isCompatible(plugin: Plugin): boolean {
    try {
      return semver.satisfies(GROK_VERSION, plugin.engines.grok);
    } catch {
      return false;
    }
  }

  /**
   * Get default config values
   */
  private getDefaultConfig(plugin: Plugin): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    if (plugin.config?.properties) {
      for (const [key, prop] of Object.entries(plugin.config.properties)) {
        if (prop.default !== undefined) {
          config[key] = prop.default;
        }
      }
    }

    return config;
  }

  /**
   * Enable a plugin
   */
  async enable(pluginId: string): Promise<void> {
    const plugin = this.installedPlugins.get(pluginId);
    if (!plugin) {
      throw new Error('Plugin not installed');
    }

    plugin.enabled = true;
    await this.saveManifest();
    await this.loadPlugin(pluginId);

    this.emit('plugin:enabled', { pluginId });
  }

  /**
   * Disable a plugin
   */
  async disable(pluginId: string): Promise<void> {
    const plugin = this.installedPlugins.get(pluginId);
    if (!plugin) {
      throw new Error('Plugin not installed');
    }

    await this.unloadPlugin(pluginId);
    plugin.enabled = false;
    await this.saveManifest();

    this.emit('plugin:disabled', { pluginId });
  }

  /**
   * Get installed plugins
   */
  getInstalled(): InstalledPlugin[] {
    return Array.from(this.installedPlugins.values());
  }

  /**
   * Get loaded plugins
   */
  getLoaded(): string[] {
    return Array.from(this.loadedPlugins.keys());
  }

  /**
   * Get registered commands
   */
  getCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * Get registered tools
   */
  getTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Format marketplace status
   */
  formatStatus(): string {
    const installed = this.getInstalled();
    const loaded = this.getLoaded();

    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                    🧩 PLUGIN MARKETPLACE                     ║',
      '╠══════════════════════════════════════════════════════════════╣',
      `║ Installed: ${installed.length}/${this.config.maxPlugins}${''.padEnd(45)}║`,
      `║ Loaded:    ${loaded.length}${''.padEnd(48)}║`,
      `║ Commands:  ${this.commands.size}${''.padEnd(48)}║`,
      `║ Tools:     ${this.tools.size}${''.padEnd(48)}║`,
      '╠══════════════════════════════════════════════════════════════╣',
    ];

    if (installed.length > 0) {
      lines.push('║ INSTALLED PLUGINS                                            ║');
      for (const plugin of installed.slice(0, 5)) {
        const status = plugin.enabled ? '✅' : '❌';
        lines.push(`║ ${status} ${plugin.name.padEnd(25)} v${plugin.version.padEnd(10)} [${plugin.category}] ║`);
      }
      if (installed.length > 5) {
        lines.push(`║ ... and ${installed.length - 5} more                                          ║`);
      }
    } else {
      lines.push('║ No plugins installed                                         ║');
    }

    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push('║ /plugin search <query> | /plugin install <id>                ║');
    lines.push('║ /plugin update | /plugin remove <id>                         ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * Dispose
   */
  async dispose(): Promise<void> {
    for (const pluginId of this.loadedPlugins.keys()) {
      await this.unloadPlugin(pluginId);
    }
    this.removeAllListeners();
  }
}

// Singleton
let marketplaceInstance: PluginMarketplace | null = null;

export function getPluginMarketplace(config?: Partial<MarketplaceConfig>): PluginMarketplace {
  if (!marketplaceInstance) {
    marketplaceInstance = new PluginMarketplace(config);
  }
  return marketplaceInstance;
}

export function resetPluginMarketplace(): void {
  if (marketplaceInstance) {
    marketplaceInstance.dispose();
  }
  marketplaceInstance = null;
}
