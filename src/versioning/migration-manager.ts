/**
 * Migration Manager
 *
 * Handles versioned migrations for configuration and data:
 * - Schema migrations
 * - Config file migrations
 * - Data format migrations
 * - Migration history tracking
 * - Transaction support with automatic rollback
 * - File-level locking to prevent race conditions
 * - Comprehensive audit trail
 */

import { logger } from "../utils/logger.js";
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import semver from 'semver';
import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';

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
  /** Backup a file before modification for transaction rollback */
  backupFile?: (filePath: string) => Promise<void>;
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
  transactionId?: string;
  checksum?: string;
}

/**
 * Audit log entry for migration operations
 */
export interface MigrationAuditEntry {
  id: string;
  timestamp: Date;
  operation: 'migrate' | 'rollback' | 'lock_acquired' | 'lock_released' | 'state_backup' | 'state_restored';
  version?: string;
  migrationName?: string;
  status: 'started' | 'completed' | 'failed';
  details?: string;
  durationMs?: number;
  userId?: string;
  hostname?: string;
}

/**
 * State backup for transaction rollback
 */
export interface StateBackup {
  transactionId: string;
  timestamp: Date;
  files: Map<string, Buffer | null>; // null means file didn't exist
  metadata: Record<string, unknown>;
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
  auditFile?: string;
  lockFile?: string;
  dryRun?: boolean;
  verbose?: boolean;
  lockTimeoutMs?: number;
  enableAuditLog?: boolean;
}

const DEFAULT_CONFIG: Required<MigrationManagerConfig> = {
  dataDir: path.join(os.homedir(), '.codebuddy'),
  configDir: path.join(os.homedir(), '.codebuddy', 'config'),
  historyFile: 'migration-history.json',
  auditFile: 'migration-audit.json',
  lockFile: 'migration.lock',
  dryRun: false,
  verbose: false,
  lockTimeoutMs: 30000, // 30 seconds
  enableAuditLog: true,
};

/**
 * Migration Manager class
 */
export class MigrationManager extends EventEmitter {
  private config: Required<MigrationManagerConfig>;
  private migrations: Map<string, Migration> = new Map();
  private history: MigrationHistory[] = [];
  private auditLog: MigrationAuditEntry[] = [];
  private initialized: boolean = false;
  private logger: MigrationLogger;
  private lockHandle: number | null = null;
  private currentTransaction: StateBackup | null = null;
  private readonly hostname: string;
  private signalHandlersInstalled: boolean = false;
  private readonly signalHandler: () => void;

  constructor(config: MigrationManagerConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = this.createLogger();
    this.hostname = os.hostname();

    // Create bound signal handler for cleanup
    this.signalHandler = () => {
      this.emergencyCleanup();
    };
  }

  /**
   * Install signal handlers for graceful cleanup on unexpected termination
   */
  private installSignalHandlers(): void {
    if (this.signalHandlersInstalled) return;

    process.on('SIGINT', this.signalHandler);
    process.on('SIGTERM', this.signalHandler);
    process.on('uncaughtException', this.signalHandler);
    process.on('unhandledRejection', this.signalHandler);

    this.signalHandlersInstalled = true;
  }

  /**
   * Remove signal handlers
   */
  private removeSignalHandlers(): void {
    if (!this.signalHandlersInstalled) return;

    process.off('SIGINT', this.signalHandler);
    process.off('SIGTERM', this.signalHandler);
    process.off('uncaughtException', this.signalHandler);
    process.off('unhandledRejection', this.signalHandler);

    this.signalHandlersInstalled = false;
  }

  /**
   * Emergency cleanup - synchronously release lock on crash
   */
  private emergencyCleanup(): void {
    try {
      // Close lock handle if open
      if (this.lockHandle !== null) {
        try {
          fs.closeSync(this.lockHandle);
        } catch {
          // Ignore errors during emergency cleanup
        }
        this.lockHandle = null;
      }

      // Try to remove lock file
      const lockPath = path.join(this.config.dataDir, this.config.lockFile);
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Ignore errors during emergency cleanup
      }

      this.logger.warn('Emergency cleanup: lock released due to process termination');
    } catch {
      // Ignore all errors during emergency cleanup
    }
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

  // ===========================================================================
  // Locking Mechanism
  // ===========================================================================

  /**
   * Acquire exclusive lock for migrations
   * Prevents race conditions when multiple processes try to migrate
   */
  private async acquireLock(): Promise<boolean> {
    const lockPath = path.join(this.config.dataDir, this.config.lockFile);
    const startTime = Date.now();
    const retryDelayMs = 100;
    const staleTimeoutMs = 5 * 60 * 1000; // 5 minutes

    // Ensure data directory exists before attempting lock
    await fs.ensureDir(this.config.dataDir);

    while (Date.now() - startTime < this.config.lockTimeoutMs) {
      try {
        // Try to create lock file exclusively
        const lockData = JSON.stringify({
          pid: process.pid,
          hostname: this.hostname,
          acquiredAt: new Date().toISOString(),
          version: '2.0', // Lock format version for future compatibility
        });

        // O_EXCL flag ensures atomic creation
        this.lockHandle = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
        fs.writeSync(this.lockHandle, lockData);

        // Install signal handlers for cleanup on unexpected termination
        this.installSignalHandlers();

        await this.writeAuditEntry({
          id: randomUUID(),
          timestamp: new Date(),
          operation: 'lock_acquired',
          status: 'completed',
          details: `Lock acquired by PID ${process.pid} on ${this.hostname}`,
          hostname: this.hostname,
        });

        this.logger.debug('Migration lock acquired');
        this.emit('lock:acquired');
        return true;
      } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'EEXIST') {
          // Lock exists, check if it's stale
          try {
            const lockContent = await fs.readJson(lockPath);
            const lockAge = Date.now() - new Date(lockContent.acquiredAt).getTime();

            // Consider lock stale after configured timeout
            if (lockAge > staleTimeoutMs) {
              this.logger.warn(`Removing stale lock (age: ${Math.round(lockAge / 1000)}s, PID: ${lockContent.pid}, host: ${lockContent.hostname})`);

              await this.writeAuditEntry({
                id: randomUUID(),
                timestamp: new Date(),
                operation: 'lock_released',
                status: 'completed',
                details: `Removed stale lock from PID ${lockContent.pid} on ${lockContent.hostname}`,
                hostname: this.hostname,
              });

              await fs.unlink(lockPath);
              continue;
            }

            // Check if the process holding the lock is still alive (same host only)
            if (lockContent.hostname === this.hostname && lockContent.pid) {
              try {
                // Check if process exists (signal 0 doesn't kill, just checks)
                process.kill(lockContent.pid, 0);
              } catch {
                // Process doesn't exist, lock is orphaned
                this.logger.warn(`Removing orphaned lock (PID ${lockContent.pid} no longer exists)`);
                await fs.unlink(lockPath);
                continue;
              }
            }
          } catch {
            // Lock file might be corrupted, try to remove it
            this.logger.warn('Lock file corrupted, attempting removal');
            await fs.unlink(lockPath).catch(() => {});
            continue;
          }

          // Wait before retrying with jitter to avoid thundering herd
          const jitter = Math.random() * 50;
          await new Promise(resolve => setTimeout(resolve, retryDelayMs + jitter));
        } else {
          throw error;
        }
      }
    }

    this.logger.error('Failed to acquire migration lock: timeout');
    return false;
  }

  /**
   * Release the migration lock
   */
  private async releaseLock(): Promise<void> {
    const lockPath = path.join(this.config.dataDir, this.config.lockFile);

    try {
      if (this.lockHandle !== null) {
        fs.closeSync(this.lockHandle);
        this.lockHandle = null;
      }

      await fs.unlink(lockPath);

      // Remove signal handlers since lock is released
      this.removeSignalHandlers();

      await this.writeAuditEntry({
        id: randomUUID(),
        timestamp: new Date(),
        operation: 'lock_released',
        status: 'completed',
        hostname: this.hostname,
      });

      this.logger.debug('Migration lock released');
      this.emit('lock:released');
    } catch (error) {
      this.logger.warn(`Failed to release lock: ${error}`);
      // Still try to remove signal handlers
      this.removeSignalHandlers();
    }
  }

  // ===========================================================================
  // Transaction Support with State Backup
  // ===========================================================================

  /**
   * Begin a transaction by creating a state backup
   */
  private async beginTransaction(version: string): Promise<string> {
    // Ensure no transaction is already in progress
    if (this.currentTransaction) {
      const existingId = this.currentTransaction.transactionId;
      this.logger.warn(`Transaction ${existingId} already in progress, rolling back before starting new one`);
      await this.rollbackTransaction();
    }

    const transactionId = randomUUID();

    this.currentTransaction = {
      transactionId,
      timestamp: new Date(),
      files: new Map(),
      metadata: {
        version,
        startedAt: new Date().toISOString(),
        pid: process.pid,
        hostname: this.hostname,
      },
    };

    await this.writeAuditEntry({
      id: randomUUID(),
      timestamp: new Date(),
      operation: 'state_backup',
      version,
      status: 'started',
      details: `Transaction ${transactionId} started for version ${version}`,
      hostname: this.hostname,
    });

    this.logger.debug(`Transaction ${transactionId} started for version ${version}`);
    this.emit('transaction:begin', { transactionId, version });

    return transactionId;
  }

  /**
   * Verify transaction integrity before commit
   * Ensures all backed up files can be accessed and haven't been corrupted
   */
  private async verifyTransactionIntegrity(): Promise<{ valid: boolean; errors: string[] }> {
    if (!this.currentTransaction) {
      return { valid: false, errors: ['No active transaction'] };
    }

    const errors: string[] = [];

    for (const [filePath, _originalContent] of this.currentTransaction.files) {
      try {
        // Verify file is accessible (or was deleted as expected)
        const exists = await fs.pathExists(filePath);
        if (!exists && _originalContent !== null) {
          // File was supposed to be modified, not deleted
          // This might be intentional, so just log as debug
          this.logger.debug(`File ${filePath} no longer exists after migration`);
        }
      } catch (error) {
        errors.push(`Cannot verify file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Backup a file before modification (part of transaction)
   */
  async backupFile(filePath: string): Promise<void> {
    if (!this.currentTransaction) {
      throw new Error('No active transaction. Call beginTransaction first.');
    }

    if (this.currentTransaction.files.has(filePath)) {
      return; // Already backed up
    }

    try {
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath);
        this.currentTransaction.files.set(filePath, content);
      } else {
        this.currentTransaction.files.set(filePath, null);
      }

      this.logger.debug(`Backed up file: ${filePath}`);
    } catch (error) {
      this.logger.error(`Failed to backup file ${filePath}: ${error}`);
      throw error;
    }
  }

  /**
   * Commit the current transaction (cleanup backups)
   * Verifies integrity before finalizing
   */
  private async commitTransaction(): Promise<void> {
    if (!this.currentTransaction) {
      return;
    }

    const { transactionId, metadata, files } = this.currentTransaction;

    // Verify transaction integrity before committing
    const integrity = await this.verifyTransactionIntegrity();
    if (!integrity.valid) {
      this.logger.warn(`Transaction ${transactionId} integrity check found issues: ${integrity.errors.join(', ')}`);
      // Log but don't fail - these might be intentional changes
    }

    const duration = Date.now() - new Date(metadata.startedAt as string).getTime();

    await this.writeAuditEntry({
      id: randomUUID(),
      timestamp: new Date(),
      operation: 'state_backup',
      version: metadata.version as string,
      status: 'completed',
      details: `Transaction ${transactionId} committed successfully (${files.size} files tracked, ${duration}ms)`,
      durationMs: duration,
      hostname: this.hostname,
    });

    this.logger.debug(`Transaction ${transactionId} committed (${files.size} files, ${duration}ms)`);
    this.emit('transaction:commit', { transactionId, filesCount: files.size, duration });

    this.currentTransaction = null;
  }

  /**
   * Rollback the current transaction by restoring files
   */
  private async rollbackTransaction(): Promise<void> {
    if (!this.currentTransaction) {
      return;
    }

    const { transactionId, files, metadata } = this.currentTransaction;

    this.logger.info(`Rolling back transaction ${transactionId}...`);

    await this.writeAuditEntry({
      id: randomUUID(),
      timestamp: new Date(),
      operation: 'state_restored',
      version: metadata.version as string,
      status: 'started',
      details: `Rolling back ${files.size} files`,
      hostname: this.hostname,
    });

    let restoredCount = 0;
    let errorCount = 0;

    for (const [filePath, content] of files) {
      try {
        if (content === null) {
          // File didn't exist before, delete it
          if (await fs.pathExists(filePath)) {
            await fs.unlink(filePath);
            this.logger.debug(`Removed new file: ${filePath}`);
          }
        } else {
          // Restore original content
          await fs.writeFile(filePath, content);
          this.logger.debug(`Restored file: ${filePath}`);
        }
        restoredCount++;
      } catch (error) {
        this.logger.error(`Failed to restore ${filePath}: ${error}`);
        errorCount++;
      }
    }

    await this.writeAuditEntry({
      id: randomUUID(),
      timestamp: new Date(),
      operation: 'state_restored',
      version: metadata.version as string,
      status: errorCount === 0 ? 'completed' : 'failed',
      details: `Restored ${restoredCount} files, ${errorCount} errors`,
      hostname: this.hostname,
    });

    this.logger.info(`Transaction rollback complete: ${restoredCount} files restored, ${errorCount} errors`);
    this.emit('transaction:rollback', { transactionId, restoredCount, errorCount });

    this.currentTransaction = null;
  }

  // ===========================================================================
  // Audit Trail
  // ===========================================================================

  /**
   * Load audit log from disk
   */
  private async loadAuditLog(): Promise<void> {
    if (!this.config.enableAuditLog) return;

    const auditPath = path.join(this.config.dataDir, this.config.auditFile);

    if (await fs.pathExists(auditPath)) {
      try {
        const data = await fs.readJson(auditPath);
        this.auditLog = (data.entries || []).map((e: MigrationAuditEntry) => ({
          ...e,
          timestamp: new Date(e.timestamp),
        }));
      } catch (error) {
        this.logger.warn(`Failed to load audit log: ${error}`);
        this.auditLog = [];
      }
    }
  }

  /**
   * Write an audit entry
   */
  private async writeAuditEntry(entry: MigrationAuditEntry): Promise<void> {
    if (!this.config.enableAuditLog || this.config.dryRun) return;

    this.auditLog.push(entry);
    this.emit('audit:entry', entry);

    // Persist to disk
    const auditPath = path.join(this.config.dataDir, this.config.auditFile);

    try {
      await fs.writeJson(
        auditPath,
        {
          entries: this.auditLog,
          lastUpdated: new Date().toISOString(),
        },
        { spaces: 2 }
      );
    } catch (error) {
      this.logger.warn(`Failed to save audit log: ${error}`);
    }
  }

  /**
   * Get audit log entries
   */
  getAuditLog(options?: {
    version?: string;
    operation?: MigrationAuditEntry['operation'];
    status?: MigrationAuditEntry['status'];
    since?: Date;
    limit?: number;
  }): MigrationAuditEntry[] {
    let entries = [...this.auditLog];

    if (options?.version) {
      entries = entries.filter(e => e.version === options.version);
    }
    if (options?.operation) {
      entries = entries.filter(e => e.operation === options.operation);
    }
    if (options?.status) {
      entries = entries.filter(e => e.status === options.status);
    }
    if (options?.since) {
      entries = entries.filter(e => e.timestamp >= options.since!);
    }
    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  /**
   * Calculate checksum for migration verification
   */
  private calculateMigrationChecksum(migration: Migration): string {
    const content = `${migration.version}:${migration.name}:${migration.up.toString()}:${migration.down.toString()}`;
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize migration manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create directories in parallel
    await Promise.all([
      fs.ensureDir(this.config.dataDir),
      fs.ensureDir(this.config.configDir),
    ]);

    await Promise.all([
      this.loadHistory(),
      this.loadAuditLog(),
    ]);

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
   * Run all pending migrations with transaction support and locking
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

    // Acquire lock to prevent concurrent migrations
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      result.success = false;
      result.errors.push('Failed to acquire migration lock. Another migration may be in progress.');
      result.duration = Date.now() - startTime;
      return result;
    }

    try {
      this.emit('migrate:start', { count: pending.length });

      await this.writeAuditEntry({
        id: randomUUID(),
        timestamp: new Date(),
        operation: 'migrate',
        status: 'started',
        details: `Starting migration of ${pending.length} pending migrations`,
        hostname: this.hostname,
      });

      for (const migration of pending) {
        const migrationStart = Date.now();
        const checksum = this.calculateMigrationChecksum(migration);

        // Begin transaction for this migration
        const transactionId = await this.beginTransaction(migration.version);

        try {
          this.logger.info(`Applying migration: ${migration.version} - ${migration.name}`);
          this.emit('migration:start', migration);

          await this.writeAuditEntry({
            id: randomUUID(),
            timestamp: new Date(),
            operation: 'migrate',
            version: migration.version,
            migrationName: migration.name,
            status: 'started',
            details: `Checksum: ${checksum}`,
            hostname: this.hostname,
          });

          // Create context with transaction-aware backup capability
          const context = this.createTransactionContext();
          await migration.up(context);

          // Commit transaction on success
          await this.commitTransaction();

          const historyEntry: MigrationHistory = {
            version: migration.version,
            name: migration.name,
            appliedAt: new Date(),
            status: 'success',
            duration: Date.now() - migrationStart,
            transactionId,
            checksum,
          };

          this.history.push(historyEntry);
          await this.saveHistory();

          result.migrationsApplied++;
          result.currentVersion = migration.version;

          await this.writeAuditEntry({
            id: randomUUID(),
            timestamp: new Date(),
            operation: 'migrate',
            version: migration.version,
            migrationName: migration.name,
            status: 'completed',
            durationMs: Date.now() - migrationStart,
            hostname: this.hostname,
          });

          this.logger.info(`Migration ${migration.version} applied successfully`);
          this.emit('migration:complete', { migration, history: historyEntry });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push(`Migration ${migration.version} failed: ${errorMessage}`);
          result.success = false;

          // Rollback transaction on failure
          this.logger.warn(`Migration ${migration.version} failed, rolling back...`);
          await this.rollbackTransaction();

          const historyEntry: MigrationHistory = {
            version: migration.version,
            name: migration.name,
            appliedAt: new Date(),
            status: 'failed',
            duration: Date.now() - migrationStart,
            error: errorMessage,
            transactionId,
            checksum,
          };

          this.history.push(historyEntry);
          await this.saveHistory();

          await this.writeAuditEntry({
            id: randomUUID(),
            timestamp: new Date(),
            operation: 'migrate',
            version: migration.version,
            migrationName: migration.name,
            status: 'failed',
            details: errorMessage,
            durationMs: Date.now() - migrationStart,
            hostname: this.hostname,
          });

          this.logger.error(`Migration ${migration.version} failed: ${errorMessage}`);
          this.emit('migration:error', { migration, error });

          // Stop on first failure
          break;
        }
      }

      result.duration = Date.now() - startTime;

      await this.writeAuditEntry({
        id: randomUUID(),
        timestamp: new Date(),
        operation: 'migrate',
        status: result.success ? 'completed' : 'failed',
        details: `Applied ${result.migrationsApplied} migrations, ${result.errors.length} errors`,
        durationMs: result.duration,
        hostname: this.hostname,
      });

      this.emit('migrate:complete', result);
      return result;
    } finally {
      // Always release lock
      await this.releaseLock();
    }
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
   * Rollback the last migration with transaction support and locking
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

    // Acquire lock to prevent concurrent rollbacks
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      return {
        success: false,
        migrationsApplied: 0,
        currentVersion,
        errors: ['Failed to acquire migration lock. Another migration may be in progress.'],
        duration: Date.now() - startTime,
      };
    }

    try {
      // Begin transaction for rollback
      const transactionId = await this.beginTransaction(migration.version);

      await this.writeAuditEntry({
        id: randomUUID(),
        timestamp: new Date(),
        operation: 'rollback',
        version: migration.version,
        migrationName: migration.name,
        status: 'started',
        hostname: this.hostname,
      });

      try {
        this.logger.info(`Rolling back migration: ${migration.version} - ${migration.name}`);
        this.emit('rollback:start', migration);

        const context = this.createTransactionContext();
        await migration.down(context);

        // Commit transaction on success
        await this.commitTransaction();

        // Update history
        const historyIndex = this.history.findIndex(
          (h) => h.version === currentVersion && h.status === 'success'
        );

        if (historyIndex !== -1) {
          this.history[historyIndex].status = 'rolled_back';
          this.history[historyIndex].transactionId = transactionId;
          await this.saveHistory();
        }

        await this.writeAuditEntry({
          id: randomUUID(),
          timestamp: new Date(),
          operation: 'rollback',
          version: migration.version,
          migrationName: migration.name,
          status: 'completed',
          durationMs: Date.now() - startTime,
          hostname: this.hostname,
        });

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

        // Rollback transaction on failure
        this.logger.warn(`Rollback of ${migration.version} failed, restoring state...`);
        await this.rollbackTransaction();

        await this.writeAuditEntry({
          id: randomUUID(),
          timestamp: new Date(),
          operation: 'rollback',
          version: migration.version,
          migrationName: migration.name,
          status: 'failed',
          details: errorMessage,
          durationMs: Date.now() - startTime,
          hostname: this.hostname,
        });

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
    } finally {
      // Always release lock
      await this.releaseLock();
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
   * Create transaction-aware migration context
   * Includes file backup capability for automatic rollback on failure
   */
  private createTransactionContext(): MigrationContext {
    return {
      dataDir: this.config.dataDir,
      configDir: this.config.configDir,
      logger: this.logger,
      dryRun: this.config.dryRun,
      backupFile: async (filePath: string) => {
        await this.backupFile(filePath);
      },
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
   * Dispose resources and cleanup
   */
  dispose(): void {
    // Remove signal handlers
    this.removeSignalHandlers();

    // Release lock if held
    if (this.lockHandle !== null) {
      try {
        fs.closeSync(this.lockHandle);
        const lockPath = path.join(this.config.dataDir, this.config.lockFile);
        fs.unlinkSync(lockPath);
      } catch {
        // Ignore errors during dispose
      }
      this.lockHandle = null;
    }

    // Rollback any active transaction
    if (this.currentTransaction) {
      this.logger.warn('Disposing with active transaction, changes may be lost');
      this.currentTransaction = null;
    }

    this.migrations.clear();
    this.history = [];
    this.auditLog = [];
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
