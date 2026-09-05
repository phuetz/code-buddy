import fs from 'fs-extra';
import { pathToFileURL } from 'node:url';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import semver from 'semver';
import {
  Plugin,
  PluginManifest,
  PluginContext,
  PluginStatus,
  PluginMetadata,
  PluginIsolationConfig,
  PluginProvider,
  PluginProviderType,
  validateManifest,
  validatePluginConfig,
} from './types.js';
import { getToolManager, ToolRegistration } from '../tools/tool-manager.js';
import { getSlashCommandManager, SlashCommand } from '../commands/slash-commands.js';
import { createLogger, Logger } from '../utils/logger.js';
import { readJsonAtomicSync, readJsonAtomic, writeJsonAtomic } from '../utils/atomic-write.js';
import { IsolatedPluginRunner, createIsolatedPluginRunner } from './isolated-plugin-runner.js';
import { getBundledProviders } from './bundled/index.js';

// Re-export PluginProvider for backward compatibility
export type { PluginProvider } from './types.js';

export interface PluginManagerConfig {
  pluginDir: string;
  autoLoad?: boolean;
  /** Default isolation settings for all plugins */
  isolation?: PluginIsolationConfig;
  /** Force isolation for all plugins (ignore manifest.isolated setting) */
  forceIsolation?: boolean;
  /** Trusted plugin IDs — only these plugins auto-load without confirmation */
  trustedPlugins?: string[];
  /** If true, block all non-trusted plugins from loading (no prompt, just deny) */
  strictTrust?: boolean;
}

export class PluginManager extends EventEmitter {
  private plugins: Map<string, PluginMetadata> = new Map();
  private isolatedRunners: Map<string, IsolatedPluginRunner> = new Map();
  private providers: Map<string, PluginProvider> = new Map();
  private providersByType: Map<string, PluginProvider[]> = new Map();
  private pluginConfigs: Map<string, Record<string, unknown>> = new Map();
  private config: PluginManagerConfig;
  private logger: Logger;
  /** Registered context engine from plugins (Native Engine v2026.3.7 — last wins) */
  _registeredContextEngine: import('../context/context-engine.js').ContextEngine | null = null;

  constructor(config: Partial<PluginManagerConfig> = {}) {
    super();
    this.logger = createLogger({ source: 'PluginManager' });
    this.config = {
      pluginDir: config.pluginDir || path.join(process.cwd(), '.codebuddy', 'plugins'),
      autoLoad: config.autoLoad ?? true,
      isolation: config.isolation ?? { timeout: 30000 },
      forceIsolation: config.forceIsolation ?? true, // Default to isolated mode for security
      trustedPlugins: config.trustedPlugins ?? this.loadTrustedPlugins(),
      strictTrust: config.strictTrust ?? false,
    };
  }

  /**
   * Load bundled provider plugins (Native Engine v2026.3.14).
   * Called during initialization to register built-in providers.
   */
  async loadBundledProviders(): Promise<void> {
    const bundled = getBundledProviders();
    for (const provider of bundled) {
      try {
        await provider.initialize?.();
        await this.registerProvider(provider, 'bundled');
        this.logger.info(`Bundled provider loaded: ${provider.name}`);
      } catch (error) {
        this.logger.warn(`Failed to load bundled provider ${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Load trusted plugins list from .codebuddy/settings.json
   */
  private loadTrustedPlugins(): string[] {
    try {
      const settingsPath = path.join(process.cwd(), '.codebuddy', 'settings.json');
      const settings = readJsonAtomicSync<{ trustedPlugins?: unknown }>(settingsPath, {});
      if (Array.isArray(settings.trustedPlugins)) {
        return settings.trustedPlugins.filter((p: unknown): p is string => typeof p === 'string');
      }
    } catch {
      // Ignore — no settings or parse error
    }
    return [];
  }

  /**
   * Check if a plugin is trusted for auto-loading.
   * Untrusted workspace plugins are blocked from implicit loading.
   */
  isPluginTrusted(pluginId: string): boolean {
    return this.config.trustedPlugins?.includes(pluginId) ?? false;
  }

  /**
   * Add a plugin to the trusted list and persist to settings.
   */
  async trustPlugin(pluginId: string): Promise<void> {
    if (!this.config.trustedPlugins) {
      this.config.trustedPlugins = [];
    }
    if (!this.config.trustedPlugins.includes(pluginId)) {
      this.config.trustedPlugins.push(pluginId);
    }

    // Persist to .codebuddy/settings.json
    const settingsPath = path.join(process.cwd(), '.codebuddy', 'settings.json');
    try {
      let settings: Record<string, unknown> = {};
      settings = await readJsonAtomic<Record<string, unknown>>(settingsPath, {});
      settings.trustedPlugins = this.config.trustedPlugins;
      await writeJsonAtomic(settingsPath, settings);
      this.logger.info(`Plugin ${pluginId} added to trusted list`);
    } catch (err) {
      this.logger.warn(`Failed to persist trusted plugin: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Discover and load all plugins from the plugin directory
   */
  async discover(): Promise<void> {
    this.logger.debug(`Discovering plugins in ${this.config.pluginDir}`);
    this.emit('plugins:discovering', { pluginDir: this.config.pluginDir });

    if (!await fs.pathExists(this.config.pluginDir)) {
      this.logger.debug('Plugin directory does not exist, creating...');
      await fs.ensureDir(this.config.pluginDir);
      this.emit('plugins:discovered', { total: 0, loaded: 0, failed: 0 });
      return;
    }

    const entries = await fs.readdir(this.config.pluginDir, { withFileTypes: true });

    // Load all plugins in parallel for faster startup
    const directories = entries.filter(entry => entry.isDirectory());
    const total = directories.length;

    this.emit('plugins:loading', { total, phase: 'starting' });

    const results = await Promise.allSettled(
      directories.map(async (entry, index) => {
        const pluginPath = path.join(this.config.pluginDir, entry.name);
        this.emit('plugins:progress', {
          current: index + 1,
          total,
          pluginName: entry.name,
          phase: 'loading',
        });
        return this.loadPlugin(pluginPath);
      })
    );

    const loaded = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    const failed = total - loaded;

    this.emit('plugins:discovered', { total, loaded, failed });
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

      // Security: Plugin trust gate — block untrusted workspace plugins from auto-loading
      if (!this.isPluginTrusted(manifest.id)) {
        if (this.config.strictTrust) {
          this.logger.warn(`Plugin ${manifest.id} is not trusted and strictTrust is enabled — skipping`);
          this.emit('plugin:untrusted', { pluginId: manifest.id, path: normalizedPath });
          return false;
        }

        // Check if plugin is from workspace (not home dir)
        const homePluginDir = path.join(os.homedir(), '.codebuddy', 'plugins');
        const isWorkspacePlugin = !normalizedPath.startsWith(homePluginDir);

        if (isWorkspacePlugin) {
          this.logger.warn(
            `Workspace plugin "${manifest.id}" is not in the trusted list. ` +
            `Add it to trustedPlugins in .codebuddy/settings.json or call trustPlugin().`
          );
          this.emit('plugin:untrusted', { pluginId: manifest.id, path: normalizedPath });
          return false;
        }
      }

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
        // `entryPoint` est un chemin de FICHIER absolu ; le chargeur ESM veut une URL.
        // Sans cette conversion, Windows lève ERR_UNSUPPORTED_ESM_URL_SCHEME et aucun
        // greffon ne se charge. Sur POSIX, l'URL produite est équivalente au chemin nu.
        const module = await import(pathToFileURL(entryPoint).href);
        pluginInstance = new module.default();
      }
      // If isolated, the instance will be created in the worker thread

      // Phase K (V0.3) — wake PluginConflictDetector. Check for conflicts
      // BEFORE final registration so blocker conflicts (duplicate plugin
      // ID, plugin ID vs built-in tool name) abort the load with a clear
      // error. Non-blocker conflicts (missing dependency) log a warning
      // but proceed. Use manifest fields directly (Plugin interface in
      // conflict-detection.ts is a subset that maps cleanly).
      try {
        const { getPluginConflictDetector } = await import('./conflict-detection.js');
        const detector = getPluginConflictDetector();
        const report = detector.checkConflicts({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
        });
        if (report.hasConflicts) {
          const blockers = report.conflicts.filter(
            (c) => c.type === 'plugin_id_vs_tool' || c.type === 'duplicate_tool'
          );
          if (blockers.length > 0) {
            const msgs = blockers.map((c) => c.message).join('; ');
            this.logger.error(`Cannot load plugin ${manifest.id}: ${msgs}`);
            return false;
          }
          // Non-blocker (dependency_missing) — log + continue
          for (const c of report.conflicts) {
            this.logger.warn(`Plugin conflict for ${manifest.id}: ${c.message}`);
          }
        }
      } catch (err) {
        this.logger.debug(`Conflict detection skipped for ${manifest.id}`, { error: String(err) });
      }

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
      this.logger.warn(`Cannot activate plugin "${id}": not found`);
      return false;
    }

    // For non-isolated plugins, we need an instance
    if (!metadata.isolated && !metadata.instance) {
      this.logger.warn(`Cannot activate plugin "${id}": no instance (non-isolated mode)`);
      return false;
    }

    if (metadata.status === PluginStatus.ACTIVE) {
      return true;
    }

    this.emit('plugin:activating', {
      id,
      name: metadata.manifest.name,
      isolated: metadata.isolated,
    });

    try {
      if (metadata.isolated) {
        // Activate in isolated Worker Thread
        this.emit('plugin:progress', {
          id,
          phase: 'initializing-worker',
          message: `Starting isolated worker for ${metadata.manifest.name}...`,
        });
        await this.activateIsolatedPlugin(metadata);
      } else {
        // Legacy: activate in main thread
        // Load plugin-specific configuration
        this.emit('plugin:progress', {
          id,
          phase: 'loading-config',
          message: `Loading configuration for ${metadata.manifest.name}...`,
        });
        const pluginConfig = await this.loadPluginConfig(metadata.manifest);
        const context = this.createPluginContext(metadata, pluginConfig);

        this.emit('plugin:progress', {
          id,
          phase: 'activating',
          message: `Activating ${metadata.manifest.name}...`,
        });
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
      this.emit('plugin:activation-failed', {
        id,
        name: metadata.manifest.name,
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger.error(`Failed to activate plugin ${id}`, error as Error);
      return false;
    }
  }

  /**
   * Activate a plugin in an isolated Worker Thread
   */
  private async activateIsolatedPlugin(metadata: PluginMetadata): Promise<void> {
    // Load plugin-specific configuration before creating the runner
    this.emit('plugin:progress', {
      id: metadata.manifest.id,
      phase: 'loading-config',
      message: `Loading configuration for ${metadata.manifest.name}...`,
    });
    const pluginConfig = await this.loadPluginConfig(metadata.manifest);

    const runner = createIsolatedPluginRunner({
      pluginPath: metadata.path,
      pluginId: metadata.manifest.id,
      dataDir: path.join(this.config.pluginDir, metadata.manifest.id, 'data'),
      config: pluginConfig,
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

    runner.on('register-provider', async (provider: PluginProvider) => {
      this.logger.debug(`Isolated plugin ${metadata.manifest.id} registering provider: ${provider.name}`);
      try {
        await this.registerProvider(provider, metadata.manifest.id);
      } catch (error) {
        this.logger.error(`Failed to register provider from isolated plugin ${metadata.manifest.id}:`, error as Error);
      }
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
      
      registerProvider: (provider) => {
        this.registerProvider(provider, metadata.manifest.id);
      },

      registerContextEngine: (engine) => {
        // Security: non-trusted plugins cannot register ownsCompaction engines (Native Engine v2026.3.14)
        if (engine.ownsCompaction && !this.isPluginTrusted(metadata.manifest.id)) {
          this.logger.warn(`Plugin ${metadata.manifest.id} denied ownsCompaction context engine — not trusted`);
          this.emit('plugin:context-engine-denied', {
            pluginId: metadata.manifest.id,
            engineId: engine.id,
            reason: 'ownsCompaction requires trusted plugin',
          });
          return;
        }
        this.logger.info(`Plugin ${metadata.manifest.id} registering context engine: ${engine.id}`);
        this.emit('plugin:context-engine-registered', {
          pluginId: metadata.manifest.id,
          engineId: engine.id,
        });
        // Store for retrieval by ContextManagerV2
        this._registeredContextEngine = engine;
      },
    };
  }

  /**
   * Validate that a provider has the required methods based on its type
   */
  private validateProvider(provider: PluginProvider): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required base fields
    if (!provider.id || typeof provider.id !== 'string') {
      errors.push('Provider must have a valid id (string)');
    }
    if (!provider.name || typeof provider.name !== 'string') {
      errors.push('Provider must have a valid name (string)');
    }
    if (!provider.type || !['llm', 'embedding', 'search'].includes(provider.type)) {
      errors.push('Provider must have a valid type (llm, embedding, or search)');
    }
    if (typeof provider.initialize !== 'function') {
      errors.push('Provider must have an initialize() method');
    }

    // Validate type-specific methods
    switch (provider.type) {
      case 'llm':
        if (typeof provider.chat !== 'function' && typeof provider.complete !== 'function') {
          errors.push('LLM provider must have at least chat() or complete() method');
        }
        break;
      case 'embedding':
        if (typeof provider.embed !== 'function') {
          errors.push('Embedding provider must have an embed() method');
        }
        break;
      case 'search':
        if (typeof provider.search !== 'function') {
          errors.push('Search provider must have a search() method');
        }
        break;
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Register a provider from a plugin
   *
   * @param provider - The provider to register
   * @param pluginId - Optional: the ID of the plugin registering this provider
   * @throws Error if provider validation fails
   */
  async registerProvider(provider: PluginProvider, pluginId?: string): Promise<void> {
    const source = pluginId ? `plugin ${pluginId}` : 'unknown source';

    // Validate the provider
    const validation = this.validateProvider(provider);
    if (!validation.valid) {
      const errorMsg = `Invalid provider from ${source}: ${validation.errors.join(', ')}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Check for duplicate provider ID
    if (this.providers.has(provider.id)) {
      const errorMsg = `Provider with id '${provider.id}' is already registered`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    this.logger.debug(`Registering provider '${provider.name}' (${provider.id}) of type '${provider.type}' from ${source}`);

    try {
      // Initialize the provider
      await provider.initialize();

      // Store the provider
      this.providers.set(provider.id, provider);

      // Index by type for easy lookup
      const typeProviders = this.providersByType.get(provider.type) ?? [];
      typeProviders.push(provider);
      // Sort by priority (higher priority first)
      typeProviders.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      this.providersByType.set(provider.type, typeProviders);

      this.logger.info(`Registered provider: ${provider.name} (${provider.id}) [type: ${provider.type}]`);

      // Emit event for external listeners
      this.emit('plugin:provider-registered', {
        id: provider.id,
        name: provider.name,
        type: provider.type,
        priority: provider.priority ?? 0,
        pluginId
      });
    } catch (error) {
      const errorMsg = `Failed to initialize provider '${provider.id}' from ${source}: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Unregister a provider
   *
   * @param providerId - The ID of the provider to unregister
   */
  async unregisterProvider(providerId: string): Promise<boolean> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      this.logger.warn(`Cannot unregister provider '${providerId}': not found`);
      return false;
    }

    try {
      // Call shutdown if available
      if (provider.shutdown) {
        await provider.shutdown();
      }

      // Remove from main map
      this.providers.delete(providerId);

      // Remove from type index
      const typeProviders = this.providersByType.get(provider.type);
      if (typeProviders) {
        const index = typeProviders.findIndex(p => p.id === providerId);
        if (index !== -1) {
          typeProviders.splice(index, 1);
        }
        if (typeProviders.length === 0) {
          this.providersByType.delete(provider.type);
        }
      }

      this.logger.info(`Unregistered provider: ${provider.name} (${providerId})`);
      this.emit('plugin:provider-unregistered', { id: providerId, type: provider.type });
      return true;
    } catch (error) {
      this.logger.error(`Error unregistering provider '${providerId}': ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Get a provider by ID
   */
  getProvider(id: string): PluginProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get all providers of a specific type
   * Returns providers sorted by priority (highest first)
   */
  getProvidersByType(type: PluginProviderType): PluginProvider[] {
    return this.providersByType.get(type) ?? [];
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): PluginProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get the highest priority provider of a specific type
   */
  getPrimaryProvider(type: PluginProviderType): PluginProvider | undefined {
    const providers = this.getProvidersByType(type);
    return providers[0]; // Already sorted by priority
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

  /**
   * Discover and load plugins from npm packages in node_modules.
   *
   * Scans for packages matching `codebuddy-plugin-*` that declare a
   * `codebuddy.extensions` field in their package.json. Checks
   * `engines.codebuddy` for version compatibility before loading.
   *
   * Package.json example:
   * ```json
   * {
   *   "name": "codebuddy-plugin-example",
   *   "codebuddy": {
   *     "extensions": ["tools", "llm"]
   *   },
   *   "engines": {
   *     "codebuddy": ">=0.5.0"
   *   }
   * }
   * ```
   */
  async discoverNpmPlugins(): Promise<void> {
    const nodeModulesDir = path.join(process.cwd(), 'node_modules');

    if (!await fs.pathExists(nodeModulesDir)) {
      this.logger.debug('No node_modules directory found, skipping npm plugin discovery');
      return;
    }

    this.logger.debug('Discovering npm plugins in node_modules...');
    this.emit('npm-plugins:discovering', { dir: nodeModulesDir });

    let discovered = 0;
    let loaded = 0;
    let skipped = 0;

    try {
      const entries = await fs.readdir(nodeModulesDir, { withFileTypes: true });

      // Collect candidate directories: top-level `codebuddy-plugin-*` and
      // scoped packages like `@scope/codebuddy-plugin-*`
      const candidates: Array<{ name: string; dir: string }> = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        if (entry.name.startsWith('codebuddy-plugin-')) {
          candidates.push({
            name: entry.name,
            dir: path.join(nodeModulesDir, entry.name),
          });
        } else if (entry.name.startsWith('@')) {
          // Check scoped packages
          const scopeDir = path.join(nodeModulesDir, entry.name);
          try {
            const scopeEntries = await fs.readdir(scopeDir, { withFileTypes: true });
            for (const scopeEntry of scopeEntries) {
              if (scopeEntry.isDirectory() && scopeEntry.name.startsWith('codebuddy-plugin-')) {
                candidates.push({
                  name: `${entry.name}/${scopeEntry.name}`,
                  dir: path.join(scopeDir, scopeEntry.name),
                });
              }
            }
          } catch {
            // Ignore unreadable scope directories
          }
        }
      }

      for (const candidate of candidates) {
        discovered++;

        try {
          const pkgJsonPath = path.join(candidate.dir, 'package.json');
          if (!await fs.pathExists(pkgJsonPath)) {
            this.logger.debug(`Skipping ${candidate.name}: no package.json`);
            skipped++;
            continue;
          }

          const pkgJson = await fs.readJson(pkgJsonPath);

          // Check for codebuddy.extensions field
          if (!pkgJson.codebuddy?.extensions || !Array.isArray(pkgJson.codebuddy.extensions)) {
            this.logger.debug(`Skipping ${candidate.name}: no codebuddy.extensions field`);
            skipped++;
            continue;
          }

          // Check engines.codebuddy version compatibility
          const requiredVersion = pkgJson.engines?.codebuddy;
          if (requiredVersion && typeof requiredVersion === 'string') {
            // Read our own version from package.json
            const ourPkgPath = path.join(process.cwd(), 'package.json');
            let ourVersion = '0.0.0';
            try {
              const ourPkg = await fs.readJson(ourPkgPath);
              ourVersion = ourPkg.version || '0.0.0';
            } catch {
              // Fall through with 0.0.0
            }

            if (!semver.satisfies(ourVersion, requiredVersion)) {
              this.logger.warn(
                `Skipping npm plugin ${candidate.name}: requires codebuddy ${requiredVersion}, ` +
                `but current version is ${ourVersion}`
              );
              this.emit('npm-plugin:incompatible', {
                name: candidate.name,
                required: requiredVersion,
                current: ourVersion,
              });
              skipped++;
              continue;
            }
          }

          this.logger.info(`Loading npm plugin: ${candidate.name} (extensions: ${pkgJson.codebuddy.extensions.join(', ')})`);

          // Load the plugin from its directory
          const success = await this.loadPlugin(candidate.dir);
          if (success) {
            loaded++;
          } else {
            skipped++;
          }
        } catch (error) {
          this.logger.warn(
            `Failed to process npm plugin ${candidate.name}: ${error instanceof Error ? error.message : String(error)}`
          );
          skipped++;
        }
      }
    } catch (error) {
      this.logger.error(`Error scanning node_modules for plugins: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.logger.debug(`npm plugin discovery complete: ${discovered} found, ${loaded} loaded, ${skipped} skipped`);
    this.emit('npm-plugins:discovered', { discovered, loaded, skipped });
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
