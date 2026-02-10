/**
 * Database Manager
 *
 * Central SQLite database manager for code-buddy.
 * Handles connection, migrations, and provides access to repositories.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SCHEMA_VERSION, MIGRATIONS } from './schema.js';
import { logger } from '../utils/logger.js';
import { TypedEventEmitter, DatabaseEvents } from '../events/index.js';

// ============================================================================
// Types
// ============================================================================

export interface DatabaseConfig {
  dbPath?: string;
  inMemory?: boolean;
  verbose?: boolean;
  walMode?: boolean;
}

export interface DatabaseStats {
  version: number;
  size: number;
  tables: string[];
  memoriesCount: number;
  sessionsCount: number;
  embeddingsCount: number;
  cacheSize: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: DatabaseConfig = {
  dbPath: path.join(os.homedir(), '.codebuddy', 'codebuddy.db'),
  inMemory: false,
  verbose: false,
  walMode: true,
};

// ============================================================================
// Database Manager
// ============================================================================

/**
 * Database Manager
 *
 * Uses TypedEventEmitter for type-safe event handling.
 * Emits events: db:initialized, db:error, db:migration, db:vacuum,
 * db:backup, db:closed, db:cleared
 */
export class DatabaseManager extends TypedEventEmitter<DatabaseEvents> {
  private db: Database.Database | null = null;
  private config: DatabaseConfig;
  private initialized: boolean = false;

  constructor(config: Partial<DatabaseConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Emit both typed db:* events and legacy event names for backwards compatibility.
   */
  private emitWithLegacy<K extends keyof DatabaseEvents>(
    typedEvent: K,
    legacyEvent: string,
    payload: Omit<DatabaseEvents[K], 'type' | 'timestamp'>
  ): void {
    this.emit(typedEvent, payload);
    (this as unknown as { emit: (event: string, data: unknown) => boolean }).emit(legacyEvent, payload);
  }

  /**
   * Initialize the database connection and run migrations
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure directory exists
      if (!this.config.inMemory && this.config.dbPath) {
        const dir = path.dirname(this.config.dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      // Open database
      const dbPath = this.config.inMemory ? ':memory:' : this.config.dbPath!;
      this.db = new Database(dbPath, {
        verbose: this.config.verbose ? (msg: unknown) => logger.debug(String(msg)) : undefined,
      });

      // Enable WAL mode for better concurrency
      if (this.config.walMode && !this.config.inMemory) {
        this.db.pragma('journal_mode = WAL');
      }

      // Performance optimizations
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 10000');
      this.db.pragma('temp_store = MEMORY');

      // Run migrations
      await this.runMigrations();

      this.initialized = true;
      this.emitWithLegacy('db:initialized', 'initialized', {});

    } catch (error) {
      this.emitWithLegacy('db:error', 'error', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) throw new Error('Database connection not established. Ensure initialize() was called and completed successfully.');

    // Check current version
    let currentVersion = 0;
    try {
      const result = this.db.prepare(
        'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
      ).get() as { version: number } | undefined;
      currentVersion = result?.version || 0;
    } catch {
      // Table doesn't exist yet, version is 0
    }

    // Apply pending migrations
    for (let version = currentVersion + 1; version <= SCHEMA_VERSION; version++) {
      const migration = MIGRATIONS[version];
      if (migration) {
        this.db.exec(migration);
        this.db.prepare(
          'INSERT INTO schema_version (version) VALUES (?)'
        ).run(version);
        this.emitWithLegacy('db:migration', 'migration', { version, applied: true });
      }
    }
  }

  /**
   * Get the database instance
   */
  getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get database statistics
   */
  getDatabaseStats(): DatabaseStats {
    if (!this.db) throw new Error('Database not initialized. Call initialize() before performing database operations.');

    const version = (this.db.prepare(
      'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
    ).get() as { version: number } | undefined)?.version || 0;

    const tables = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[];

    const memoriesCount = (this.db.prepare(
      'SELECT COUNT(*) as count FROM memories'
    ).get() as { count: number }).count;

    const sessionsCount = (this.db.prepare(
      'SELECT COUNT(*) as count FROM sessions'
    ).get() as { count: number }).count;

    const embeddingsCount = (this.db.prepare(
      'SELECT COUNT(*) as count FROM code_embeddings'
    ).get() as { count: number }).count;

    const cacheSize = (this.db.prepare(
      'SELECT COUNT(*) as count FROM cache'
    ).get() as { count: number }).count;

    // Get file size
    let size = 0;
    if (!this.config.inMemory && this.config.dbPath && fs.existsSync(this.config.dbPath)) {
      size = fs.statSync(this.config.dbPath).size;
    }

    return {
      version,
      size,
      tables: tables.map(t => t.name),
      memoriesCount,
      sessionsCount,
      embeddingsCount,
      cacheSize,
    };
  }

  /**
   * Format stats for display
   */
  formatStats(): string {
    const stats = this.getDatabaseStats();
    const sizeKB = (stats.size / 1024).toFixed(1);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    return `
Database Statistics
${'═'.repeat(40)}

Version: ${stats.version}
Size: ${stats.size < 1024 * 1024 ? `${sizeKB} KB` : `${sizeMB} MB`}
Path: ${this.config.dbPath || ':memory:'}

Tables (${stats.tables.length}):
${stats.tables.map(t => `  • ${t}`).join('\n')}

Data:
  • Memories: ${stats.memoriesCount.toLocaleString()}
  • Sessions: ${stats.sessionsCount.toLocaleString()}
  • Code Embeddings: ${stats.embeddingsCount.toLocaleString()}
  • Cache Entries: ${stats.cacheSize.toLocaleString()}
`.trim();
  }

  /**
   * Execute a raw SQL query
   */
  exec(sql: string): void {
    if (!this.db) throw new Error('Database not initialized. Call initialize() before performing database operations.');
    this.db.exec(sql);
  }

  /**
   * Prepare a statement
   */
  prepare(sql: string): Database.Statement {
    if (!this.db) throw new Error('Database not initialized. Call initialize() before performing database operations.');
    return this.db.prepare(sql);
  }

  /**
   * Run in a transaction
   */
  transaction<T>(fn: () => T): T {
    if (!this.db) throw new Error('Database not initialized. Call initialize() before performing database operations.');
    return this.db.transaction(fn)();
  }

  /**
   * Vacuum the database to reclaim space
   */
  vacuum(): void {
    if (!this.db) throw new Error('Database not initialized. Call initialize() before performing database operations.');
    this.db.exec('VACUUM');
    this.emitWithLegacy('db:vacuum', 'vacuum', {});
  }

  /**
   * Backup the database to a file
   */
  async backup(destPath: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized. Call initialize() before performing database operations.');

    return new Promise((resolve, reject) => {
      this.db!.backup(destPath)
        .then(() => {
          this.emitWithLegacy('db:backup', 'backup', { path: destPath });
          resolve();
        })
        .catch(reject);
    });
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      this.emitWithLegacy('db:closed', 'closed', {});
    }
  }

  /**
   * Clear all data (dangerous!)
   */
  clearAll(): void {
    if (!this.db) throw new Error('Database not initialized. Call initialize() before performing database operations.');

    const tables = [
      'memories', 'messages', 'sessions', 'code_embeddings',
      'tool_stats', 'repair_learning', 'analytics', 'conventions',
      'checkpoint_files', 'checkpoints', 'cache'
    ];

    this.transaction(() => {
      for (const table of tables) {
        this.db!.exec(`DELETE FROM ${table}`);
      }
    });

    this.emitWithLegacy('db:cleared', 'cleared', {});
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: DatabaseManager | null = null;

export function getDatabaseManager(config?: Partial<DatabaseConfig>): DatabaseManager {
  if (!instance) {
    instance = new DatabaseManager(config);
  }
  return instance;
}

export async function initializeDatabase(config?: Partial<DatabaseConfig>): Promise<DatabaseManager> {
  const manager = getDatabaseManager(config);
  if (!manager.isInitialized()) {
    await manager.initialize();
  }
  return manager;
}

export function resetDatabaseManager(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
