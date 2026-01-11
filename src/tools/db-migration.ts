/**
 * Database Migration Tool
 *
 * Manages schema migrations for SQLite database:
 * - Version tracking
 * - Up/down migrations
 * - Migration history
 * - Rollback support
 */

import Database from 'better-sqlite3';
import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import * as path from 'path';
import * as os from 'os';

export interface Migration {
  version: number;
  name: string;
  up: string; // SQL statements to apply
  down: string; // SQL statements to rollback
  appliedAt?: Date;
}

export interface MigrationHistory {
  version: number;
  name: string;
  appliedAt: Date;
  checksum: string;
}

export interface MigrationResult {
  success: boolean;
  migrationsApplied: number;
  currentVersion: number;
  error?: string;
}

export interface MigrationConfig {
  /** Database path */
  dbPath?: string;
  /** Migrations directory */
  migrationsDir?: string;
  /** Table name for tracking migrations */
  tableName?: string;
}

const DEFAULT_CONFIG: Required<MigrationConfig> = {
  dbPath: path.join(os.homedir(), '.codebuddy', 'codebuddy.db'),
  migrationsDir: path.join(__dirname, '../../database/migrations'),
  tableName: '_migrations',
};

/**
 * Built-in migrations for Code Buddy database
 */
const BUILTIN_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        working_directory TEXT,
        model TEXT,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tool_call_name TEXT,
        tool_call_success INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_last_accessed ON sessions(last_accessed_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_sessions_last_accessed;
      DROP INDEX IF EXISTS idx_messages_session_id;
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS sessions;
    `,
  },
  {
    version: 2,
    name: 'add_cache_table',
    up: `
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_cache_expires;
      DROP TABLE IF EXISTS cache;
    `,
  },
  {
    version: 3,
    name: 'add_checkpoints',
    up: `
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        description TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_file ON checkpoints(file_path);
    `,
    down: `
      DROP INDEX IF EXISTS idx_checkpoints_file;
      DROP INDEX IF EXISTS idx_checkpoints_session;
      DROP TABLE IF EXISTS checkpoints;
    `,
  },
  {
    version: 4,
    name: 'add_tool_history',
    up: `
      CREATE TABLE IF NOT EXISTS tool_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        tool_name TEXT NOT NULL,
        parameters TEXT,
        result TEXT,
        success INTEGER NOT NULL,
        duration_ms INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_history_session ON tool_history(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_history_tool ON tool_history(tool_name);
    `,
    down: `
      DROP INDEX IF EXISTS idx_tool_history_tool;
      DROP INDEX IF EXISTS idx_tool_history_session;
      DROP TABLE IF EXISTS tool_history;
    `,
  },
  {
    version: 5,
    name: 'add_metrics_table',
    up: `
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        tags TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
    `,
    down: `
      DROP INDEX IF EXISTS idx_metrics_timestamp;
      DROP INDEX IF EXISTS idx_metrics_name;
      DROP TABLE IF EXISTS metrics;
    `,
  },
];

/**
 * Database Migration Manager
 */
export class MigrationManager {
  private config: Required<MigrationConfig>;
  private db: Database.Database | null = null;
  private migrations: Migration[] = [];
  private vfs = UnifiedVfsRouter.Instance;

  constructor(config: MigrationConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.migrations = [...BUILTIN_MIGRATIONS];
  }

  /**
   * Initialize migration system
   */
  async initialize(): Promise<void> {
    // Ensure database directory exists
    await this.vfs.ensureDir(path.dirname(this.config.dbPath));

    // Open database
    this.db = new Database(this.config.dbPath);

    // Create migrations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.config.tableName} (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      )
    `);

    // Load custom migrations from directory
    await this.loadMigrationsFromDir();
  }

  /**
   * Load migrations from file system
   */
  private async loadMigrationsFromDir(): Promise<void> {
    if (!await this.vfs.exists(this.config.migrationsDir)) {
      return;
    }

    const entries = await this.vfs.readDirectory(this.config.migrationsDir);
    const migrationFiles = entries.filter(e => e.isFile && e.name.endsWith('.json')).map(e => e.name);

    for (const file of migrationFiles) {
      try {
        const contentStr = await this.vfs.readFile(path.join(this.config.migrationsDir, file));
        const content = JSON.parse(contentStr);
        if (content.version && content.name && content.up) {
          // Don't add if version already exists
          if (!this.migrations.find(m => m.version === content.version)) {
            this.migrations.push(content);
          }
        }
      } catch {
        // Skip invalid migration files
      }
    }

    // Sort by version
    this.migrations.sort((a, b) => a.version - b.version);
  }

  /**
   * Get current database version
   */
  getCurrentVersion(): number {
    if (!this.db) return 0;

    const result = this.db
      .prepare(`SELECT MAX(version) as version FROM ${this.config.tableName}`)
      .get() as { version: number | null };

    return result?.version || 0;
  }

  /**
   * Get pending migrations
   */
  getPendingMigrations(): Migration[] {
    const currentVersion = this.getCurrentVersion();
    return this.migrations.filter(m => m.version > currentVersion);
  }

  /**
   * Get applied migrations
   */
  getAppliedMigrations(): MigrationHistory[] {
    if (!this.db) return [];

    return this.db
      .prepare(`SELECT * FROM ${this.config.tableName} ORDER BY version ASC`)
      .all() as MigrationHistory[];
  }

  /**
   * Apply all pending migrations
   */
  migrate(): MigrationResult {
    if (!this.db) {
      return { success: false, migrationsApplied: 0, currentVersion: 0, error: 'Not initialized' };
    }

    const pending = this.getPendingMigrations();
    let applied = 0;

    try {
      for (const migration of pending) {
        this.applyMigration(migration);
        applied++;
      }

      return {
        success: true,
        migrationsApplied: applied,
        currentVersion: this.getCurrentVersion(),
      };
    } catch (error) {
      return {
        success: false,
        migrationsApplied: applied,
        currentVersion: this.getCurrentVersion(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Apply a single migration
   */
  private applyMigration(migration: Migration): void {
    if (!this.db) return;

    // Use transaction
    const transaction = this.db.transaction(() => {
      // Execute up SQL
      this.db!.exec(migration.up);

      // Record migration
      this.db!.prepare(`
        INSERT INTO ${this.config.tableName} (version, name, applied_at, checksum)
        VALUES (?, ?, ?, ?)
      `).run(
        migration.version,
        migration.name,
        new Date().toISOString(),
        this.computeChecksum(migration.up)
      );
    });

    transaction();
  }

  /**
   * Rollback last migration
   */
  rollback(): MigrationResult {
    if (!this.db) {
      return { success: false, migrationsApplied: 0, currentVersion: 0, error: 'Not initialized' };
    }

    const currentVersion = this.getCurrentVersion();
    if (currentVersion === 0) {
      return { success: true, migrationsApplied: 0, currentVersion: 0 };
    }

    const migration = this.migrations.find(m => m.version === currentVersion);
    if (!migration) {
      return { success: false, migrationsApplied: 0, currentVersion, error: 'Migration not found' };
    }

    try {
      const transaction = this.db.transaction(() => {
        // Execute down SQL
        this.db!.exec(migration.down);

        // Remove migration record
        this.db!.prepare(`DELETE FROM ${this.config.tableName} WHERE version = ?`)
          .run(migration.version);
      });

      transaction();

      return {
        success: true,
        migrationsApplied: 1,
        currentVersion: this.getCurrentVersion(),
      };
    } catch (error) {
      return {
        success: false,
        migrationsApplied: 0,
        currentVersion,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Rollback to specific version
   */
  rollbackTo(targetVersion: number): MigrationResult {
    let totalRolled = 0;
    let currentVersion = this.getCurrentVersion();

    while (currentVersion > targetVersion) {
      const result = this.rollback();
      if (!result.success) {
        return {
          success: false,
          migrationsApplied: totalRolled,
          currentVersion: this.getCurrentVersion(),
          error: result.error,
        };
      }
      totalRolled++;
      currentVersion = this.getCurrentVersion();
    }

    return {
      success: true,
      migrationsApplied: totalRolled,
      currentVersion: this.getCurrentVersion(),
    };
  }

  /**
   * Create a new migration file
   */
  async createMigration(name: string): Promise<string> {
    const version = Math.max(...this.migrations.map(m => m.version), 0) + 1;
    const filename = `${String(version).padStart(4, '0')}_${name}.json`;
    const filepath = path.join(this.config.migrationsDir, filename);

    const migration: Migration = {
      version,
      name,
      up: '-- Add your UP migration SQL here',
      down: '-- Add your DOWN migration SQL here',
    };

    await this.vfs.ensureDir(this.config.migrationsDir);
    await this.vfs.writeFile(filepath, JSON.stringify(migration, null, 2));

    return filepath;
  }

  /**
   * Get migration status
   */
  getStatus(): {
    currentVersion: number;
    latestVersion: number;
    pendingCount: number;
    appliedCount: number;
    pending: Migration[];
    applied: MigrationHistory[];
  } {
    const applied = this.getAppliedMigrations();
    const pending = this.getPendingMigrations();

    return {
      currentVersion: this.getCurrentVersion(),
      latestVersion: Math.max(...this.migrations.map(m => m.version), 0),
      pendingCount: pending.length,
      appliedCount: applied.length,
      pending,
      applied,
    };
  }

  /**
   * Format migration status for display
   */
  formatStatus(): string {
    const status = this.getStatus();
    const lines: string[] = [
      '== Database Migration Status ==',
      '',
      `Current Version: ${status.currentVersion}`,
      `Latest Version: ${status.latestVersion}`,
      `Applied: ${status.appliedCount} | Pending: ${status.pendingCount}`,
      '',
    ];

    if (status.applied.length > 0) {
      lines.push('Applied Migrations:');
      for (const m of status.applied) {
        const date = new Date(m.appliedAt).toLocaleString();
        lines.push(`  [v${m.version}] ${m.name} (${date})`);
      }
      lines.push('');
    }

    if (status.pending.length > 0) {
      lines.push('Pending Migrations:');
      for (const m of status.pending) {
        lines.push(`  [v${m.version}] ${m.name}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Compute checksum for migration SQL
   */
  private computeChecksum(sql: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance
let migrationManager: MigrationManager | null = null;

/**
 * Get or create migration manager
 */
export function getMigrationManager(config?: MigrationConfig): MigrationManager {
  if (!migrationManager) {
    migrationManager = new MigrationManager(config);
  }
  return migrationManager;
}

/**
 * Initialize and run pending migrations
 */
export async function runMigrations(config?: MigrationConfig): Promise<MigrationResult> {
  const manager = getMigrationManager(config);
  await manager.initialize();
  return manager.migrate();
}

export default MigrationManager;
