/**
 * Migration Manager
 *
 * Handles versioned migrations for configuration and data:
 * - Schema migrations
 * - Config file migrations
 * - Data format migrations
 * - Migration history tracking
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import semver from 'semver';
import { EventEmitter } from 'events';

export interface Migration {
  version: string;
  name: string;
  description?: string;
  up: (context: MigrationContext) => Promise<void>;
  down: (context: MigrationContext) => Promise<void>;
  appliedAt?: Date;
}

export interface MigrationContext {
  dataDir: string;
  configDir: string;
  logger: MigrationLogger;
  dryRun: boolean;
}

export interface MigrationLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

export interface MigrationHistory {
  version: string;
  name: string;
  appliedAt: Date;
  status: 'success' | 'failed' | 'rolled_back';
  duration: number;
  error?: string;
}

export interface MigrationResult {
  success: boolean;
  migrationsApplied: number;
  currentVersion: string;
  errors: string[];
  duration: number;
}

export interface MigrationManagerConfig {
  dataDir?: string;
  configDir?: string;
  historyFile?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

const DEFAULT_CONFIG: Required<MigrationManagerConfig> = {
  dataDir: path.join(os.homedir(), '.codebuddy'),
  configDir: path.join(os.homedir(), '.codebuddy', 'config'),
  historyFile: 'migration-history.json',
  dryRun: false,
  verbose: false,
};

/**
 * Migration Manager class
 */
export class MigrationManager extends EventEmitter {
  private config: Required<MigrationManagerConfig>;
  private migrations: Map<string, Migration> = new Map();
  private history: MigrationHistory[] = [];
  private initialized: boolean = false;
  private logger: MigrationLogger;

  constructor(config: MigrationManagerConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = this.createLogger();
  }

  /**
   * Create default logger
   */
  private createLogger(): MigrationLogger {
    const verbose = this.config.verbose;
    return {
      info: (msg: string) => {
        this.emit('log', { level: 'info', message: msg });
        if (verbose) console.log(`[INFO] ${msg}`);
      },
      warn: (msg: string) => {
        this.emit('log', { level: 'warn', message: msg });
        if (verbose) console.warn(`[WARN] ${msg}`);
      },
      error: (msg: string) => {
        this.emit('log', { level: 'error', message: msg });
        if (verbose) console.error(`[ERROR] ${msg}`);
      },
      debug: (msg: string) => {
        this.emit('log', { level: 'debug', message: msg });
        if (verbose) console.log(`[DEBUG] ${msg}`);
      },
    };
  }

  /**
   * Initialize migration manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.ensureDir(this.config.dataDir);
    await fs.ensureDir(this.config.configDir);

    await this.loadHistory();
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Load migration history from disk
   */
  private async loadHistory(): Promise<void> {
    const historyPath = path.join(this.config.dataDir, this.config.historyFile);

    if (await fs.pathExists(historyPath)) {
      try {
        const data = await fs.readJson(historyPath);
        this.history = (data.history || []).map((h: MigrationHistory) => ({
          ...h,
          appliedAt: new Date(h.appliedAt),
        }));
      } catch (error) {
        this.logger.warn(`Failed to load migration history: ${error}`);
        this.history = [];
      }
    }
  }

  /**
   * Save migration history to disk
   */
  private async saveHistory(): Promise<void> {
    if (this.config.dryRun) return;

    const historyPath = path.join(this.config.dataDir, this.config.historyFile);
    await fs.writeJson(historyPath, { history: this.history }, { spaces: 2 });
  }

  /**
   * Register a migration
   */
  registerMigration(migration: Migration): void {
    if (!semver.valid(migration.version)) {
      throw new Error(`Invalid version format: ${migration.version}`);
    }

    if (this.migrations.has(migration.version)) {
      throw new Error(`Migration already registered for version: ${migration.version}`);
    }

    this.migrations.set(migration.version, migration);
    this.emit('migration:registered', migration);
  }

  /**
   * Register multiple migrations
   */
  registerMigrations(migrations: Migration[]): void {
    for (const migration of migrations) {
      this.registerMigration(migration);
    }
  }

  /**
   * Get all registered migrations sorted by version
   */
  getMigrations(): Migration[] {
    const migrations = Array.from(this.migrations.values());
    return migrations.sort((a, b) => semver.compare(a.version, b.version));
  }

  /**
   * Get pending migrations (not yet applied)
   */
  getPendingMigrations(): Migration[] {
    const appliedVersions = new Set(
      this.history
        .filter((h) => h.status === 'success')
        .map((h) => h.version)
    );

    return this.getMigrations().filter((m) => !appliedVersions.has(m.version));
  }

  /**
   * Get applied migrations
   */
  getAppliedMigrations(): MigrationHistory[] {
    return this.history.filter((h) => h.status === 'success');
  }

  /**
   * Get current version (latest applied migration)
   */
  getCurrentVersion(): string {
    const applied = this.getAppliedMigrations();
    if (applied.length === 0) return '0.0.0';

    const versions = applied.map((h) => h.version);
    return versions.sort((a, b) => semver.compare(b, a))[0];
  }

  /**
   * Get latest available version
   */
  getLatestVersion(): string {
    const migrations = this.getMigrations();
    if (migrations.length === 0) return '0.0.0';
    return migrations[migrations.length - 1].version;
  }

  /**
   * Check if migrations are pending
   */
  hasPendingMigrations(): boolean {
    return this.getPendingMigrations().length > 0;
  }

  /**
   * Run all pending migrations
   */
  async migrate(): Promise<MigrationResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const result: MigrationResult = {
      success: true,
      migrationsApplied: 0,
      currentVersion: this.getCurrentVersion(),
      errors: [],
      duration: 0,
    };

    const pending = this.getPendingMigrations();

    if (pending.length === 0) {
      this.logger.info('No pending migrations');
      result.duration = Date.now() - startTime;
      return result;
    }

    this.emit('migrate:start', { count: pending.length });

    for (const migration of pending) {
      const migrationStart = Date.now();

      try {
        this.logger.info(`Applying migration: ${migration.version} - ${migration.name}`);
        this.emit('migration:start', migration);

        const context = this.createContext();
        await migration.up(context);

        const historyEntry: MigrationHistory = {
          version: migration.version,
          name: migration.name,
          appliedAt: new Date(),
          status: 'success',
          duration: Date.now() - migrationStart,
        };

        this.history.push(historyEntry);
        await this.saveHistory();

        result.migrationsApplied++;
        result.currentVersion = migration.version;

        this.logger.info(`Migration ${migration.version} applied successfully`);
        this.emit('migration:complete', { migration, history: historyEntry });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`Migration ${migration.version} failed: ${errorMessage}`);
        result.success = false;

        const historyEntry: MigrationHistory = {
          version: migration.version,
          name: migration.name,
          appliedAt: new Date(),
          status: 'failed',
          duration: Date.now() - migrationStart,
          error: errorMessage,
        };

        this.history.push(historyEntry);
        await this.saveHistory();

        this.logger.error(`Migration ${migration.version} failed: ${errorMessage}`);
        this.emit('migration:error', { migration, error });

        // Stop on first failure
        break;
      }
    }

    result.duration = Date.now() - startTime;
    this.emit('migrate:complete', result);

    return result;
  }

  /**
   * Migrate to a specific version
   */
  async migrateTo(targetVersion: string): Promise<MigrationResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!semver.valid(targetVersion)) {
      return {
        success: false,
        migrationsApplied: 0,
        currentVersion: this.getCurrentVersion(),
        errors: [`Invalid target version: ${targetVersion}`],
        duration: 0,
      };
    }

    const currentVersion = this.getCurrentVersion();

    if (semver.eq(currentVersion, targetVersion)) {
      return {
        success: true,
        migrationsApplied: 0,
        currentVersion,
        errors: [],
        duration: 0,
      };
    }

    if (semver.gt(targetVersion, currentVersion)) {
      // Forward migration
      const pending = this.getPendingMigrations().filter(
        (m) => semver.lte(m.version, targetVersion)
      );

      const originalPending = this.getPendingMigrations();
      // Temporarily filter migrations
      const toRemove = originalPending.filter(
        (m) => !pending.includes(m)
      );

      for (const m of toRemove) {
        this.migrations.delete(m.version);
      }

      const result = await this.migrate();

      // Restore removed migrations
      for (const m of toRemove) {
        this.migrations.set(m.version, m);
      }

      return result;
    } else {
      // Rollback
      return this.rollbackTo(targetVersion);
    }
  }

  /**
   * Rollback the last migration
   */
  async rollback(): Promise<MigrationResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const currentVersion = this.getCurrentVersion();

    if (currentVersion === '0.0.0') {
      return {
        success: true,
        migrationsApplied: 0,
        currentVersion,
        errors: [],
        duration: Date.now() - startTime,
      };
    }

    const migration = this.migrations.get(currentVersion);

    if (!migration) {
      return {
        success: false,
        migrationsApplied: 0,
        currentVersion,
        errors: [`Migration not found for version: ${currentVersion}`],
        duration: Date.now() - startTime,
      };
    }

    try {
      this.logger.info(`Rolling back migration: ${migration.version} - ${migration.name}`);
      this.emit('rollback:start', migration);

      const context = this.createContext();
      await migration.down(context);

      // Update history
      const historyIndex = this.history.findIndex(
        (h) => h.version === currentVersion && h.status === 'success'
      );

      if (historyIndex !== -1) {
        this.history[historyIndex].status = 'rolled_back';
        await this.saveHistory();
      }

      this.logger.info(`Migration ${migration.version} rolled back successfully`);
      this.emit('rollback:complete', migration);

      return {
        success: true,
        migrationsApplied: 1,
        currentVersion: this.getCurrentVersion(),
        errors: [],
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Rollback failed: ${errorMessage}`);
      this.emit('rollback:error', { migration, error });

      return {
        success: false,
        migrationsApplied: 0,
        currentVersion,
        errors: [`Rollback failed: ${errorMessage}`],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Rollback to a specific version
   */
  async rollbackTo(targetVersion: string): Promise<MigrationResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    let totalRolledBack = 0;
    const errors: string[] = [];

    while (semver.gt(this.getCurrentVersion(), targetVersion)) {
      const result = await this.rollback();

      if (!result.success) {
        errors.push(...result.errors);
        break;
      }

      totalRolledBack++;
    }

    return {
      success: errors.length === 0,
      migrationsApplied: totalRolledBack,
      currentVersion: this.getCurrentVersion(),
      errors,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Create migration context
   */
  private createContext(): MigrationContext {
    return {
      dataDir: this.config.dataDir,
      configDir: this.config.configDir,
      logger: this.logger,
      dryRun: this.config.dryRun,
    };
  }

  /**
   * Get migration history
   */
  getHistory(): MigrationHistory[] {
    return [...this.history];
  }

  /**
   * Clear migration history (use with caution)
   */
  async clearHistory(): Promise<void> {
    this.history = [];
    await this.saveHistory();
    this.emit('history:cleared');
  }

  /**
   * Get migration status
   */
  getStatus(): {
    currentVersion: string;
    latestVersion: string;
    pendingCount: number;
    appliedCount: number;
    hasPending: boolean;
  } {
    return {
      currentVersion: this.getCurrentVersion(),
      latestVersion: this.getLatestVersion(),
      pendingCount: this.getPendingMigrations().length,
      appliedCount: this.getAppliedMigrations().length,
      hasPending: this.hasPendingMigrations(),
    };
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
    this.migrations.clear();
    this.history = [];
    this.initialized = false;
    this.removeAllListeners();
  }
}

// Singleton instance
let migrationManager: MigrationManager | null = null;

/**
 * Get or create migration manager
 */
export function getMigrationManager(config?: MigrationManagerConfig): MigrationManager {
  if (!migrationManager) {
    migrationManager = new MigrationManager(config);
  }
  return migrationManager;
}

/**
 * Reset migration manager singleton
 */
export function resetMigrationManager(): void {
  if (migrationManager) {
    migrationManager.dispose();
  }
  migrationManager = null;
}

export default MigrationManager;
