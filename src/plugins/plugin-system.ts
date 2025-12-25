/**
 * Plugin System for Code Buddy
 *
 * Enables extensibility through:
 * - Custom tool plugins
 * - Middleware plugins
 * - Theme plugins
 * - Integration plugins
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export type PluginType = 'tool' | 'middleware' | 'theme' | 'integration';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  type: PluginType;
  main: string;
  dependencies?: Record<string, string>;
  permissions?: string[];
  config?: Record<string, unknown>;
}

export interface PluginContext {
  /** Plugin directory path */
  pluginDir: string;
  /** Plugin configuration */
  config: Record<string, unknown>;
  /** Logger instance */
  log: (message: string, level?: 'debug' | 'info' | 'warn' | 'error') => void;
  /** Emit events */
  emit: (event: string, data: unknown) => void;
}

export interface SystemPlugin {
  manifest: PluginManifest;
  /** Called when plugin is loaded */
  onLoad?: (context: PluginContext) => Promise<void>;
  /** Called when plugin is unloaded */
  onUnload?: () => Promise<void>;
  /** Called when plugin is enabled */
  onEnable?: () => Promise<void>;
  /** Called when plugin is disabled */
  onDisable?: () => Promise<void>;
}

export interface ToolPlugin extends SystemPlugin {
  type: 'tool';
  /** Tool definition for OpenAI function calling format */
  getToolDefinition: () => {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  /** Execute the tool */
  execute: (args: Record<string, unknown>) => Promise<{
    success: boolean;
    output?: string;
    error?: string;
  }>;
}

export interface MiddlewarePlugin extends SystemPlugin {
  type: 'middleware';
  /** Priority (lower = earlier execution) */
  priority: number;
  /** Process request before sending to API */
  onRequest?: (request: unknown) => Promise<unknown>;
  /** Process response from API */
  onResponse?: (response: unknown) => Promise<unknown>;
  /** Process tool execution */
  onToolExecution?: (tool: string, args: unknown) => Promise<unknown>;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  instance: SystemPlugin;
  enabled: boolean;
  loadedAt: Date;
  path: string;
}

/**
 * Plugin Manager
 */
export class PluginManager extends EventEmitter {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private pluginDirs: string[] = [];

  constructor(pluginDirs?: string[]) {
    super();
    this.pluginDirs = pluginDirs || this.getDefaultPluginDirs();
  }

  /**
   * Get default plugin directories
   */
  private getDefaultPluginDirs(): string[] {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    return [
      path.join(homeDir, '.codebuddy', 'plugins'),
      path.join(process.cwd(), '.codebuddy', 'plugins'),
    ];
  }

  /**
   * Discover plugins in plugin directories
   */
  async discoverPlugins(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];

    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) continue;

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const manifestPath = path.join(dir, entry.name, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;

        try {
          const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
          const manifest = JSON.parse(manifestContent) as PluginManifest;
          manifests.push(manifest);
        } catch {
          // Skip invalid manifests
        }
      }
    }

    return manifests;
  }

  /**
   * Load a plugin by name
   */
  async loadPlugin(name: string): Promise<boolean> {
    // Find plugin directory
    let pluginDir: string | null = null;

    for (const dir of this.pluginDirs) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(path.join(candidate, 'manifest.json'))) {
        pluginDir = candidate;
        break;
      }
    }

    if (!pluginDir) {
      this.emit('error', { plugin: name, error: 'Plugin not found' });
      return false;
    }

    try {
      // Read manifest
      const manifestPath = path.join(pluginDir, 'manifest.json');
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent) as PluginManifest;

      // Validate manifest
      if (!this.validateManifest(manifest)) {
        throw new Error('Invalid manifest');
      }

      // Check if already loaded
      if (this.plugins.has(manifest.name)) {
        throw new Error('Plugin already loaded');
      }

      // Load the plugin module
      const mainPath = path.join(pluginDir, manifest.main);
      const pluginModule = await import(mainPath);
      const instance: SystemPlugin = pluginModule.default || pluginModule;

      // Create context
      const context: PluginContext = {
        pluginDir,
        config: manifest.config || {},
        log: (message, level = 'info') => {
          this.emit('log', { plugin: manifest.name, level, message });
        },
        emit: (event, data) => {
          this.emit(`plugin:${manifest.name}:${event}`, data);
        },
      };

      // Call onLoad if defined
      if (instance.onLoad) {
        await instance.onLoad(context);
      }

      // Store loaded plugin
      const loadedPlugin: LoadedPlugin = {
        manifest,
        instance,
        enabled: true,
        loadedAt: new Date(),
        path: pluginDir,
      };

      this.plugins.set(manifest.name, loadedPlugin);
      this.emit('loaded', { plugin: manifest.name });

      return true;
    } catch (error) {
      this.emit('error', {
        plugin: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    try {
      if (plugin.instance.onUnload) {
        await plugin.instance.onUnload();
      }

      this.plugins.delete(name);
      this.emit('unloaded', { plugin: name });
      return true;
    } catch (error) {
      this.emit('error', {
        plugin: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    try {
      if (plugin.instance.onEnable) {
        await plugin.instance.onEnable();
      }

      plugin.enabled = true;
      this.emit('enabled', { plugin: name });
      return true;
    } catch (error) {
      this.emit('error', {
        plugin: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    try {
      if (plugin.instance.onDisable) {
        await plugin.instance.onDisable();
      }

      plugin.enabled = false;
      this.emit('disabled', { plugin: name });
      return true;
    } catch (error) {
      this.emit('error', {
        plugin: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get all loaded plugins
   */
  getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugins by type
   */
  getPluginsByType(type: PluginType): LoadedPlugin[] {
    return this.getLoadedPlugins().filter((p) => p.manifest.type === type);
  }

  /**
   * Get enabled tool plugins
   */
  getToolPlugins(): ToolPlugin[] {
    return this.getPluginsByType('tool')
      .filter((p) => p.enabled)
      .map((p) => p.instance as ToolPlugin);
  }

  /**
   * Get enabled middleware plugins (sorted by priority)
   */
  getMiddlewarePlugins(): MiddlewarePlugin[] {
    return this.getPluginsByType('middleware')
      .filter((p) => p.enabled)
      .map((p) => p.instance as MiddlewarePlugin)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Validate plugin manifest
   */
  private validateManifest(manifest: PluginManifest): boolean {
    return !!(
      manifest.name &&
      manifest.version &&
      manifest.type &&
      manifest.main &&
      ['tool', 'middleware', 'theme', 'integration'].includes(manifest.type)
    );
  }

  /**
   * Load all discovered plugins
   */
  async loadAllPlugins(): Promise<{ loaded: string[]; failed: string[] }> {
    const manifests = await this.discoverPlugins();
    const loaded: string[] = [];
    const failed: string[] = [];

    for (const manifest of manifests) {
      const success = await this.loadPlugin(manifest.name);
      if (success) {
        loaded.push(manifest.name);
      } else {
        failed.push(manifest.name);
      }
    }

    return { loaded, failed };
  }

  /**
   * Unload all plugins
   */
  async unloadAllPlugins(): Promise<void> {
    for (const name of this.plugins.keys()) {
      await this.unloadPlugin(name);
    }
  }

  /**
   * Format plugins list for display
   */
  formatPluginList(): string {
    const plugins = this.getLoadedPlugins();

    if (plugins.length === 0) {
      return 'No plugins loaded.\n\nPlugin directories:\n' +
        this.pluginDirs.map((d) => `  - ${d}`).join('\n');
    }

    const lines = ['Loaded Plugins:', ''];

    for (const plugin of plugins) {
      const status = plugin.enabled ? '[ON]' : '[OFF]';
      lines.push(`${status} ${plugin.manifest.name} v${plugin.manifest.version}`);
      lines.push(`    Type: ${plugin.manifest.type}`);
      if (plugin.manifest.description) {
        lines.push(`    ${plugin.manifest.description}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Dispose and cleanup
   */
  async dispose(): Promise<void> {
    await this.unloadAllPlugins();
    this.removeAllListeners();
  }
}

// Singleton instance
let pluginManager: PluginManager | null = null;

/**
 * Get or create the plugin manager
 */
export function getPluginManager(): PluginManager {
  if (!pluginManager) {
    pluginManager = new PluginManager();
  }
  return pluginManager;
}

/**
 * Reset the plugin manager
 */
export async function resetPluginManager(): Promise<void> {
  if (pluginManager) {
    await pluginManager.dispose();
    pluginManager = null;
  }
}
