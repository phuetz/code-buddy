import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import {
  Plugin,
  PluginManifest,
  PluginContext,
  PluginStatus,
  PluginMetadata,
  PluginIsolationConfig,
  validateManifest,
  validatePluginConfig,
} from './types.js';
import { getToolManager, ToolRegistration } from '../tools/tool-manager.js';
import { getSlashCommandManager, SlashCommand } from '../commands/slash-commands.js';
import { createLogger, Logger } from '../utils/logger.js';
import { IsolatedPluginRunner, createIsolatedPluginRunner } from './isolated-plugin-runner.js';

/**
 * Plugin Provider interface
 * Allows plugins to provide additional capabilities (e.g., LLM providers, storage backends)
 */
export interface PluginProvider {
  /** Unique identifier for this provider */
  id: string;
  /** Type of provider (e.g., 'llm', 'storage', 'auth') */
  type: string;
  /** Human-readable name */
  name: string;
  /** Priority for provider selection (higher = preferred) */
  priority?: number;
  /** Provider-specific configuration */
  config?: Record<string, unknown>;
  /** Initialize the provider */
  initialize?(): Promise<void>;
  /** Shutdown the provider */
  shutdown?(): Promise<void>;
}

export interface PluginManagerConfig {
  pluginDir: string;
  autoLoad?: boolean;
  /** Default isolation settings for all plugins */
  isolation?: PluginIsolationConfig;
  /** Force isolation for all plugins (ignore manifest.isolated setting) */
  forceIsolation?: boolean;
}

export class PluginManager extends EventEmitter {
  private plugins: Map<string, PluginMetadata> = new Map();
  private isolatedRunners: Map<string, IsolatedPluginRunner> = new Map();
  private providers: Map<string, PluginProvider> = new Map();
  private providersByType: Map<string, PluginProvider[]> = new Map();
  private pluginConfigs: Map<string, Record<string, unknown>> = new Map();
  private config: PluginManagerConfig;
  private logger: Logger;

  constructor(config: Partial<PluginManagerConfig> = {}) {
    super();
    this.logger = createLogger({ source: 'PluginManager' });
    this.config = {
      pluginDir: config.pluginDir || path.join(process.cwd(), '.codebuddy', 'plugins'),
      autoLoad: config.autoLoad ?? true,
      isolation: config.isolation ?? { timeout: 30000 },
      forceIsolation: config.forceIsolation ?? true, // Default to isolated mode for security
    };
  }

  /**
   * Discover and load all plugins from the plugin directory
   */
  async discover(): Promise<void> {
    this.logger.debug(`Discovering plugins in ${this.config.pluginDir}`);
    
    if (!await fs.pathExists(this.config.pluginDir)) {
      this.logger.debug('Plugin directory does not exist, creating...');
      await fs.ensureDir(this.config.pluginDir);
      return;
    }

    const entries = await fs.readdir(this.config.pluginDir, { withFileTypes: true });

    // Load all plugins in parallel for faster startup
    const directories = entries.filter(entry => entry.isDirectory());
    await Promise.allSettled(
      directories.map(entry =>
        this.loadPlugin(path.join(this.config.pluginDir, entry.name))
      )
    );
  }

  /**
   * Determine if a plugin should run in isolation
   */
  private shouldIsolate(manifest: PluginManifest): boolean {
    if (this.config.forceIsolation) {
      return true;
    }
    // Default to isolated unless explicitly set to false
    return manifest.isolated !== false;
  }

  /**
   * Load plugin-specific configuration
   *
   * Configuration is loaded from multiple sources with the following priority (highest first):
   * 1. User config: ~/.codebuddy/plugins/<plugin-id>/config.json
   * 2. Default config from manifest: manifest.defaultConfig
   *
   * The final config is merged and validated against the plugin's configSchema if provided.
   */
  private async loadPluginConfig(manifest: PluginManifest): Promise<Record<string, unknown>> {
    const pluginId = manifest.id;

    // Start with defaults from manifest
    let config: Record<string, unknown> = { ...(manifest.defaultConfig ?? {}) };

    // Try to load user config from ~/.codebuddy/plugins/<plugin-id>/config.json
    const userConfigPath = path.join(os.homedir(), '.codebuddy', 'plugins', pluginId, 'config.json');

    if (await fs.pathExists(userConfigPath)) {
      try {
        const userConfig = await fs.readJson(userConfigPath);

        if (typeof userConfig === 'object' && userConfig !== null && !Array.isArray(userConfig)) {
          // Merge user config over defaults (user config takes precedence)
          config = { ...config, ...userConfig };
          this.logger.debug(`Loaded user config for plugin ${pluginId} from ${userConfigPath}`);
        } else {
          this.logger.warn(`Invalid user config for plugin ${pluginId}: must be an object`);
        }
      } catch (error) {
        this.logger.warn(`Failed to load user config for plugin ${pluginId}: ${error instanceof Error ? error.message : String(error)}`);
        // Continue with defaults
      }
    }

    // Validate against schema if provided
    if (manifest.configSchema) {
      const validationResult = validatePluginConfig(config, manifest.configSchema);

      if (!validationResult.valid) {
        this.logger.warn(`Plugin ${pluginId} config validation errors:`);
        for (const err of validationResult.errors) {
          this.logger.warn(`  - ${err}`);
        }
        this.emit('plugin:config-validation-failed', {
          pluginId,
          errors: validationResult.errors
        });
        // Continue with potentially invalid config - let the plugin handle it
      }
    }

    // Cache the loaded config
    this.pluginConfigs.set(pluginId, config);

    return config;
  }

  /**
   * Get the loaded configuration for a plugin
   */
  getPluginConfig(pluginId: string): Record<string, unknown> | undefined {
    return this.pluginConfigs.get(pluginId);
  }

  /**
   * Load a specific plugin from a directory
   */
  async loadPlugin(pluginPath: string): Promise<boolean> {
    try {
      // Security: Validate plugin path
      const normalizedPath = path.normalize(pluginPath);
      if (normalizedPath.includes('..') || !path.isAbsolute(normalizedPath)) {
        this.logger.error(`Invalid plugin path (path traversal detected): ${pluginPath}`);
        return false;
      }

      const manifestPath = path.join(normalizedPath, 'manifest.json');

      if (!await fs.pathExists(manifestPath)) {
        this.logger.warn(`No manifest.json found in ${normalizedPath}`);
        return false;
      }

      // Read and parse manifest
      let rawManifest: unknown;
      try {
        rawManifest = await fs.readJson(manifestPath);
      } catch (parseError) {
        this.logger.error(`Failed to parse manifest.json in ${normalizedPath}:`, parseError as Error);
        return false;
      }

      // Validate manifest structure and content
      const validationResult = validateManifest(rawManifest);
      if (!validationResult.valid) {
        this.logger.error(`Invalid manifest in ${normalizedPath}:`);
        for (const error of validationResult.errors) {
          this.logger.error(`  - ${error}`);
        }
        this.emit('plugin:validation-failed', {
          path: normalizedPath,
          errors: validationResult.errors
        });
        return false;
      }

      const manifest = rawManifest as PluginManifest;

      // Security: Verify plugin ID matches directory name
      const dirName = path.basename(normalizedPath);
      if (manifest.id !== dirName) {
        this.logger.warn(`Plugin ID mismatch: manifest says '${manifest.id}' but directory is '${dirName}'`);
        // Allow but log - could be intentional
      }

      if (this.plugins.has(manifest.id)) {
        this.logger.warn(`Plugin ${manifest.id} already loaded`);
        return false;
      }

      // Dynamic import of the plugin entry point
      const entryPoint = path.join(normalizedPath, 'index.js'); // Assuming compiled JS
      if (!await fs.pathExists(entryPoint)) {
         this.logger.error(`Plugin entry point not found: ${entryPoint}`);
         return false;
      }

      // Security: Force isolation for any plugin requesting dangerous permissions
      const shouldIsolate = this.shouldIsolate(manifest);
      const hasDangerousPermissions = Boolean(
        manifest.permissions?.shell ||
        manifest.permissions?.filesystem === true ||
        manifest.permissions?.network === true
      );

      if (hasDangerousPermissions && !shouldIsolate) {
        this.logger.error(
          `Plugin ${manifest.id} requests dangerous permissions but isolation is disabled. ` +
          `This is not allowed for security reasons.`
        );
        return false;
      }

      let pluginInstance: Plugin | undefined;

      if (!shouldIsolate) {
        // Legacy: Load in main thread (not recommended)
        // Only allowed for plugins with minimal permissions
        this.logger.warn(`Plugin ${manifest.id} running in main thread (not isolated)`);
        const module = await import(entryPoint);
        pluginInstance = new module.default();
      }
      // If isolated, the instance will be created in the worker thread

      const metadata: PluginMetadata = {
        manifest,
        status: PluginStatus.LOADED,
        path: normalizedPath,
        instance: pluginInstance,
        isolated: shouldIsolate
      };

      this.plugins.set(manifest.id, metadata);
      this.logger.info(`Loaded plugin: ${manifest.name} (${manifest.version}) [isolated: ${shouldIsolate}]`);
      this.emit('plugin:loaded', metadata);

      if (this.config.autoLoad) {
        await this.activatePlugin(manifest.id);
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to load plugin from ${pluginPath}`, error as Error);
      return false;
    }
  }

  /**
   * Activate a loaded plugin
   */
  async activatePlugin(id: string): Promise<boolean> {
    const metadata = this.plugins.get(id);
    if (!metadata) {
      return false;
    }

    // For non-isolated plugins, we need an instance
    if (!metadata.isolated && !metadata.instance) {
      return false;
    }

    if (metadata.status === PluginStatus.ACTIVE) {
      return true;
    }

    try {
      if (metadata.isolated) {
        // Activate in isolated Worker Thread
        await this.activateIsolatedPlugin(metadata);
      } else {
        // Legacy: activate in main thread
        // Load plugin-specific configuration
        const pluginConfig = await this.loadPluginConfig(metadata.manifest);
        const context = this.createPluginContext(metadata, pluginConfig);
        await metadata.instance!.activate(context);
      }

      metadata.status = PluginStatus.ACTIVE;
      this.plugins.set(id, metadata);
      this.emit('plugin:activated', metadata);
      this.logger.info(`Activated plugin: ${metadata.manifest.name}`);
      return true;
    } catch (error) {
      metadata.status = PluginStatus.ERROR;
      metadata.error = error as Error;
      this.plugins.set(id, metadata);
      this.logger.error(`Failed to activate plugin ${id}`, error as Error);
      return false;
    }
  }

  /**
   * Activate a plugin in an isolated Worker Thread
   */
  private async activateIsolatedPlugin(metadata: PluginMetadata): Promise<void> {
    const runner = createIsolatedPluginRunner({
      pluginPath: metadata.path,
      pluginId: metadata.manifest.id,
      dataDir: path.join(this.config.pluginDir, metadata.manifest.id, 'data'),
      config: {}, // TODO: Load plugin-specific config
      permissions: metadata.manifest.permissions ?? {},
      timeout: this.config.isolation?.timeout ?? 30000,
    });

    // Set up event handlers for tool/command registration from the isolated plugin
    runner.on('register-tool', (tool: ToolRegistration) => {
      this.logger.debug(`Isolated plugin ${metadata.manifest.id} registering tool: ${tool.name}`);
      getToolManager().register(tool);
    });

    runner.on('register-command', (command: SlashCommand) => {
      this.logger.debug(`Isolated plugin ${metadata.manifest.id} registering command: ${command.name}`);
      const manager = getSlashCommandManager();
      manager['commands'].set(command.name, command);
    });

    runner.on('error', (error: Error) => {
      this.logger.error(`Isolated plugin ${metadata.manifest.id} error:`, error);
      metadata.status = PluginStatus.ERROR;
      metadata.error = error;
      this.plugins.set(metadata.manifest.id, metadata);
      this.emit('plugin:error', { metadata, error });
    });

    runner.on('exit', (code: number) => {
      this.logger.warn(`Isolated plugin ${metadata.manifest.id} worker exited with code ${code}`);
      if (code !== 0) {
        metadata.status = PluginStatus.ERROR;
        this.plugins.set(metadata.manifest.id, metadata);
      }
      this.isolatedRunners.delete(metadata.manifest.id);
    });

    // Start the worker and initialize the plugin
    await runner.start();

    // Store the runner
    this.isolatedRunners.set(metadata.manifest.id, runner);

    // Activate the plugin
    await runner.activate();
  }

  /**
   * Deactivate a plugin
   */
  async deactivatePlugin(id: string): Promise<boolean> {
    const metadata = this.plugins.get(id);
    if (!metadata || metadata.status !== PluginStatus.ACTIVE) {
      return false;
    }

    try {
      if (metadata.isolated) {
        // Deactivate isolated plugin
        await this.deactivateIsolatedPlugin(id);
      } else {
        // Legacy: deactivate in main thread
        if (metadata.instance) {
          await metadata.instance.deactivate();
        }
      }

      metadata.status = PluginStatus.DISABLED;
      this.plugins.set(id, metadata);
      this.emit('plugin:deactivated', metadata);
      this.logger.info(`Deactivated plugin: ${metadata.manifest.name}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to deactivate plugin ${id}`, error as Error);
      return false;
    }
  }

  /**
   * Deactivate an isolated plugin and terminate its worker
   */
  private async deactivateIsolatedPlugin(id: string): Promise<void> {
    const runner = this.isolatedRunners.get(id);
    if (!runner) {
      return;
    }

    try {
      await runner.deactivate();
    } catch (err) {
      this.logger.warn(`Error deactivating isolated plugin ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }

    await runner.terminate();
    this.isolatedRunners.delete(id);
  }

  /**
   * Create the context object passed to the plugin
   */
  private createPluginContext(metadata: PluginMetadata, pluginConfig: Record<string, unknown> = {}): PluginContext {
    return {
      logger: this.logger.child(metadata.manifest.id),
      config: pluginConfig,
      dataDir: path.join(this.config.pluginDir, metadata.manifest.id, 'data'),
      
      registerTool: (tool) => {
        this.logger.debug(`Plugin ${metadata.manifest.id} registering tool: ${tool.name}`);
        getToolManager().register(tool);
      },
      
      registerCommand: (command) => {
        this.logger.debug(`Plugin ${metadata.manifest.id} registering command: ${command.name}`);
        // We need to access the private commands map or add a public method to SlashCommandManager
        // For now, let's assume we can extend SlashCommandManager or cast to any
        // Better solution: Add registerCommand to SlashCommandManager public API
        const manager = getSlashCommandManager();
        // Access commands map via bracket notation
        manager['commands'].set(command.name, command); 
      },
      
      registerProvider: (_provider) => {
        // TODO: Implement provider registration
        this.logger.warn(`Plugin ${metadata.manifest.id} tried to register provider (not implemented)`);
      }
    };
  }

  /**
   * Get all plugins
   */
  getAllPlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a specific plugin
   */
  getPlugin(id: string): PluginMetadata | undefined {
    return this.plugins.get(id);
  }
}

// Singleton instance
let pluginManagerInstance: PluginManager | null = null;

export function getPluginManager(): PluginManager {
  if (!pluginManagerInstance) {
    pluginManagerInstance = new PluginManager();
  }
  return pluginManagerInstance;
}
