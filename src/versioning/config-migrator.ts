/**
 * Config Migrator
 *
 * Migrates configuration files between versions:
 * - Schema transformations
 * - Default value updates
 * - Deprecated field removal
 * - New field additions
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import semver from 'semver';
import { EventEmitter } from 'events';

export interface ConfigTransform {
  version: string;
  name: string;
  description?: string;
  transform: (config: Record<string, unknown>) => Record<string, unknown>;
  validate?: (config: Record<string, unknown>) => boolean;
}

export interface ConfigMigrationResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  transformsApplied: number;
  changes: ConfigChange[];
  errors: string[];
  backup?: string;
}

export interface ConfigChange {
  type: 'add' | 'remove' | 'modify' | 'rename';
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
  description?: string;
}

export interface ConfigMigratorConfig {
  configDir?: string;
  configFile?: string;
  backupDir?: string;
  createBackup?: boolean;
  dryRun?: boolean;
}

const DEFAULT_CONFIG: Required<ConfigMigratorConfig> = {
  configDir: path.join(os.homedir(), '.codebuddy', 'config'),
  configFile: 'settings.json',
  backupDir: path.join(os.homedir(), '.codebuddy', 'backups'),
  createBackup: true,
  dryRun: false,
};

/**
 * Config Migrator class
 */
export class ConfigMigrator extends EventEmitter {
  private config: Required<ConfigMigratorConfig>;
  private transforms: Map<string, ConfigTransform> = new Map();
  private initialized: boolean = false;

  constructor(config: ConfigMigratorConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize config migrator
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.ensureDir(this.config.configDir);

    if (this.config.createBackup) {
      await fs.ensureDir(this.config.backupDir);
    }

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Register a configuration transform
   */
  registerTransform(transform: ConfigTransform): void {
    if (!semver.valid(transform.version)) {
      throw new Error(`Invalid version format: ${transform.version}`);
    }

    if (this.transforms.has(transform.version)) {
      throw new Error(`Transform already registered for version: ${transform.version}`);
    }

    this.transforms.set(transform.version, transform);
    this.emit('transform:registered', transform);
  }

  /**
   * Register multiple transforms
   */
  registerTransforms(transforms: ConfigTransform[]): void {
    for (const transform of transforms) {
      this.registerTransform(transform);
    }
  }

  /**
   * Get all registered transforms sorted by version
   */
  getTransforms(): ConfigTransform[] {
    const transforms = Array.from(this.transforms.values());
    return transforms.sort((a, b) => semver.compare(a.version, b.version));
  }

  /**
   * Get transforms between two versions
   */
  getTransformsBetween(fromVersion: string, toVersion: string): ConfigTransform[] {
    return this.getTransforms().filter(
      (t) =>
        semver.gt(t.version, fromVersion) && semver.lte(t.version, toVersion)
    );
  }

  /**
   * Load configuration from file
   */
  async loadConfig(): Promise<Record<string, unknown> | null> {
    const configPath = path.join(this.config.configDir, this.config.configFile);

    if (!await fs.pathExists(configPath)) {
      return null;
    }

    try {
      return await fs.readJson(configPath);
    } catch {
      return null;
    }
  }

  /**
   * Save configuration to file
   */
  async saveConfig(config: Record<string, unknown>): Promise<void> {
    if (this.config.dryRun) return;

    const configPath = path.join(this.config.configDir, this.config.configFile);
    await fs.writeJson(configPath, config, { spaces: 2 });
    this.emit('config:saved', configPath);
  }

  /**
   * Create a backup of the current configuration
   */
  async createBackup(): Promise<string | null> {
    if (this.config.dryRun) return null;

    const configPath = path.join(this.config.configDir, this.config.configFile);

    if (!await fs.pathExists(configPath)) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${path.basename(this.config.configFile, '.json')}-${timestamp}.json`;
    const backupPath = path.join(this.config.backupDir, backupName);

    await fs.copy(configPath, backupPath);
    this.emit('backup:created', backupPath);

    return backupPath;
  }

  /**
   * Restore configuration from backup
   */
  async restoreFromBackup(backupPath: string): Promise<boolean> {
    if (!await fs.pathExists(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    const configPath = path.join(this.config.configDir, this.config.configFile);
    await fs.copy(backupPath, configPath);
    this.emit('backup:restored', backupPath);

    return true;
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<string[]> {
    if (!await fs.pathExists(this.config.backupDir)) {
      return [];
    }

    const files = await fs.readdir(this.config.backupDir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(this.config.backupDir, f))
      .sort()
      .reverse();
  }

  /**
   * Get configuration version
   */
  getConfigVersion(config: Record<string, unknown>): string {
    const version =
      (config._version as string) ||
      (config.version as string) ||
      (config.configVersion as string);

    if (!version) {
      return '0.0.0';
    }

    return semver.valid(version) || semver.coerce(version)?.version || '0.0.0';
  }

  /**
   * Set configuration version
   */
  setConfigVersion(
    config: Record<string, unknown>,
    version: string
  ): Record<string, unknown> {
    return {
      ...config,
      _version: version,
    };
  }

  /**
   * Migrate configuration to target version
   */
  async migrate(targetVersion: string): Promise<ConfigMigrationResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const result: ConfigMigrationResult = {
      success: false,
      fromVersion: '0.0.0',
      toVersion: targetVersion,
      transformsApplied: 0,
      changes: [],
      errors: [],
    };

    // Load current config
    let config = await this.loadConfig();

    if (!config) {
      result.errors.push('Configuration file not found');
      return result;
    }

    result.fromVersion = this.getConfigVersion(config);

    // Check if migration is needed
    if (!semver.valid(targetVersion)) {
      result.errors.push(`Invalid target version: ${targetVersion}`);
      return result;
    }

    if (semver.gte(result.fromVersion, targetVersion)) {
      result.success = true;
      result.toVersion = result.fromVersion;
      return result;
    }

    // Create backup
    if (this.config.createBackup) {
      result.backup = await this.createBackup() || undefined;
    }

    // Get applicable transforms
    const transforms = this.getTransformsBetween(result.fromVersion, targetVersion);

    if (transforms.length === 0) {
      // No transforms, just update version
      config = this.setConfigVersion(config, targetVersion);
      await this.saveConfig(config);
      result.success = true;
      result.toVersion = targetVersion;
      return result;
    }

    this.emit('migrate:start', { from: result.fromVersion, to: targetVersion });

    // Apply transforms
    for (const transform of transforms) {
      try {
        this.emit('transform:start', transform);

        const beforeConfig = JSON.stringify(config);
        config = transform.transform({ ...config });
        const afterConfig = JSON.stringify(config);

        // Track changes
        const changes = this.detectChanges(
          JSON.parse(beforeConfig),
          config
        );
        result.changes.push(...changes);

        // Validate if validator provided
        if (transform.validate && !transform.validate(config)) {
          throw new Error(`Validation failed for transform ${transform.version}`);
        }

        result.transformsApplied++;
        this.emit('transform:complete', transform);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`Transform ${transform.version} failed: ${errorMessage}`);
        this.emit('transform:error', { transform, error });

        // Restore from backup if available
        if (result.backup) {
          await this.restoreFromBackup(result.backup);
        }

        return result;
      }
    }

    // Update version
    config = this.setConfigVersion(config, targetVersion);
    result.toVersion = targetVersion;

    // Save migrated config
    await this.saveConfig(config);

    result.success = true;
    this.emit('migrate:complete', result);

    return result;
  }

  /**
   * Detect changes between two config objects
   */
  private detectChanges(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    prefix: string = ''
  ): ConfigChange[] {
    const changes: ConfigChange[] = [];

    // Check for removed and modified keys
    for (const key of Object.keys(before)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const beforeValue = before[key];
      const afterValue = after[key];

      if (!(key in after)) {
        changes.push({
          type: 'remove',
          path,
          oldValue: beforeValue,
        });
      } else if (
        typeof beforeValue === 'object' &&
        beforeValue !== null &&
        typeof afterValue === 'object' &&
        afterValue !== null &&
        !Array.isArray(beforeValue)
      ) {
        changes.push(
          ...this.detectChanges(
            beforeValue as Record<string, unknown>,
            afterValue as Record<string, unknown>,
            path
          )
        );
      } else if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
        changes.push({
          type: 'modify',
          path,
          oldValue: beforeValue,
          newValue: afterValue,
        });
      }
    }

    // Check for added keys
    for (const key of Object.keys(after)) {
      if (!(key in before)) {
        const path = prefix ? `${prefix}.${key}` : key;
        changes.push({
          type: 'add',
          path,
          newValue: after[key],
        });
      }
    }

    return changes;
  }

  /**
   * Validate configuration against schema
   */
  validateConfig(
    config: Record<string, unknown>,
    requiredFields: string[] = []
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const field of requiredFields) {
      if (!(field in config)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Apply default values to configuration
   */
  applyDefaults(
    config: Record<string, unknown>,
    defaults: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...config };

    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in result)) {
        result[key] = value;
      } else if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        typeof result[key] === 'object' &&
        result[key] !== null
      ) {
        result[key] = this.applyDefaults(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>
        );
      }
    }

    return result;
  }

  /**
   * Remove deprecated fields from configuration
   */
  removeDeprecatedFields(
    config: Record<string, unknown>,
    deprecated: string[]
  ): Record<string, unknown> {
    const result = { ...config };

    for (const field of deprecated) {
      const parts = field.split('.');

      if (parts.length === 1) {
        delete result[field];
      } else {
        let current: Record<string, unknown> = result;
        for (let i = 0; i < parts.length - 1; i++) {
          if (current[parts[i]] && typeof current[parts[i]] === 'object') {
            current = current[parts[i]] as Record<string, unknown>;
          } else {
            break;
          }
        }
        delete current[parts[parts.length - 1]];
      }
    }

    return result;
  }

  /**
   * Rename field in configuration
   */
  renameField(
    config: Record<string, unknown>,
    oldName: string,
    newName: string
  ): Record<string, unknown> {
    if (!(oldName in config)) {
      return config;
    }

    const result = { ...config };
    result[newName] = result[oldName];
    delete result[oldName];

    return result;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.transforms.clear();
    this.initialized = false;
    this.removeAllListeners();
  }
}

// Singleton instance
let configMigrator: ConfigMigrator | null = null;

/**
 * Get or create config migrator
 */
export function getConfigMigrator(config?: ConfigMigratorConfig): ConfigMigrator {
  if (!configMigrator) {
    configMigrator = new ConfigMigrator(config);
  }
  return configMigrator;
}

/**
 * Reset config migrator singleton
 */
export function resetConfigMigrator(): void {
  if (configMigrator) {
    configMigrator.dispose();
  }
  configMigrator = null;
}

export default ConfigMigrator;
