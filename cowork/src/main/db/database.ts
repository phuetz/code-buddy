/**
 * SQLite database implementation using better-sqlite3
 * Provides persistent storage for sessions, messages, and other data
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, statSync, renameSync, openSync, readSync, closeSync } from 'fs';
import { log, logError, logWarn } from '../utils/logger';

export interface DatabaseInstance {
  // Raw database access (for advanced queries)
  raw: Database.Database;

  // Session operations
  sessions: {
    create: (session: SessionRow) => void;
    update: (id: string, updates: Partial<SessionRow>) => void;
    get: (id: string) => SessionRow | undefined;
    getAll: () => SessionRow[];
    delete: (id: string) => void;
  };

  // Message operations
  messages: {
    create: (message: MessageRow) => void;
    update: (id: string, updates: Partial<Pick<MessageRow, 'execution_time_ms'>>) => void;
    getBySessionId: (sessionId: string) => MessageRow[];
    delete: (id: string) => void;
    deleteBySessionId: (sessionId: string) => void;
    /**
     * Cross-session content search. Prefers the optional FTS5 message
     * index, then falls back to a case-insensitive substring scan.
     * The result is enriched with the parent session's title and
     * project_id for direct rendering in the global search overlay.
     */
    searchContent: (query: string, limit: number) => MessageSearchHit[];
  };

  traceSteps: {
    create: (step: TraceStepRow) => void;
    update: (id: string, updates: Partial<TraceStepRow>) => void;
    getBySessionId: (sessionId: string) => TraceStepRow[];
    deleteBySessionId: (sessionId: string) => void;
  };

  scheduledTasks: {
    create: (task: ScheduledTaskRow) => void;
    update: (id: string, updates: Partial<ScheduledTaskRow>) => void;
    get: (id: string) => ScheduledTaskRow | undefined;
    getAll: () => ScheduledTaskRow[];
    delete: (id: string) => void;
  };

  projects: {
    create: (project: ProjectRow) => void;
    update: (id: string, updates: Partial<ProjectRow>) => void;
    get: (id: string) => ProjectRow | undefined;
    getAll: () => ProjectRow[];
    delete: (id: string) => void;
  };

  // For compatibility with old interface
  prepare: (sql: string) => Database.Statement;
  exec: (sql: string) => void;
  pragma: (pragma: string) => unknown;
  close: () => void;
}

export interface SessionRow {
  id: string;
  title: string;
  claude_session_id: string | null;
  openai_thread_id: string | null;
  status: string;
  cwd: string | null;
  mounted_paths: string; // JSON string
  allowed_tools: string; // JSON string
  memory_enabled: number;
  model: string | null;
  intelligence?: string | null;
  project_id: string | null;
  is_background: number;
  execution_mode: string | null;
  permission_mode?: string | null;
  pinned?: number;
  archived?: number;
  tags?: string | null;
  source?: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  workspace_path: string | null;
  memory_config: string | null; // JSON string
  context_config: string | null; // JSON string
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string; // JSON string
  timestamp: number;
  token_usage: string | null; // JSON string
  metadata?: string | null; // JSON string
  execution_time_ms: number | null;
}

export interface MessageSearchHit {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
  session_title: string;
  project_id: string | null;
}

export interface TraceStepRow {
  id: string;
  session_id: string;
  type: string;
  status: string;
  title: string;
  content: string | null;
  tool_name: string | null;
  tool_input: string | null; // JSON string
  tool_output: string | null;
  is_error: number | null;
  timestamp: number;
  duration: number | null;
}

export interface ScheduledTaskRow {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  run_at: number;
  next_run_at: number | null;
  schedule_config: string | null;
  repeat_every: number | null;
  repeat_unit: string | null;
  enabled: number;
  last_run_at: number | null;
  last_run_session_id: string | null;
  last_error: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

let db: DatabaseInstance | null = null;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

function buildBackupPath(targetPath: string, suffix: string): string {
  return `${targetPath}.${suffix}-${Date.now()}`;
}

function moveIfExists(sourcePath: string, destinationPath: string): void {
  if (!existsSync(sourcePath)) {
    return;
  }
  renameSync(sourcePath, destinationPath);
}

function ensureDirectory(pathToEnsure: string, label: string): void {
  if (!existsSync(pathToEnsure)) {
    mkdirSync(pathToEnsure, { recursive: true });
    return;
  }

  const stats = statSync(pathToEnsure);
  if (stats.isDirectory()) {
    return;
  }

  const backupPath = buildBackupPath(pathToEnsure, 'backup');
  renameSync(pathToEnsure, backupPath);
  logWarn(`[Database] ${label} path is not a directory, moved to backup:`, backupPath);
  mkdirSync(pathToEnsure, { recursive: true });
}

function isSqliteFile(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = readSync(fd, buffer, 0, SQLITE_HEADER.length, 0);
    if (bytesRead < SQLITE_HEADER.length) {
      return false;
    }
    return buffer.equals(SQLITE_HEADER);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

function prepareDatabaseDirectory(userDataPath: string): string {
  ensureDirectory(userDataPath, 'userData');

  const dbDir = join(userDataPath, 'data');
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    return dbDir;
  }

  const stats = statSync(dbDir);
  if (stats.isDirectory()) {
    return dbDir;
  }

  const preservedPath = buildBackupPath(dbDir, isSqliteFile(dbDir) ? 'legacy-db' : 'conflict');
  renameSync(dbDir, preservedPath);
  mkdirSync(dbDir, { recursive: true });

  if (isSqliteFile(preservedPath)) {
    const recoveredDbPath = join(dbDir, 'cowork.db');
    renameSync(preservedPath, recoveredDbPath);
    moveIfExists(`${dbDir}-wal`, `${recoveredDbPath}-wal`);
    moveIfExists(`${dbDir}-shm`, `${recoveredDbPath}-shm`);
    logWarn('[Database] Recovered legacy SQLite file into:', recoveredDbPath);
  } else {
    logWarn(
      '[Database] Database directory path was occupied by a file, moved to backup:',
      preservedPath
    );
  }

  return dbDir;
}

/**
 * Get the database file path
 */
function getDatabasePath(): string {
  // Use electron's userData path for persistent storage
  const userDataPath = app.getPath('userData');
  const dbDir = prepareDatabaseDirectory(userDataPath);
  const dbPath = join(dbDir, 'cowork.db');

  if (existsSync(dbPath) && statSync(dbPath).isDirectory()) {
    const backupPath = buildBackupPath(dbPath, 'dir-backup');
    renameSync(dbPath, backupPath);
    logWarn('[Database] Database file path is a directory, moved to backup:', backupPath);
  }

  return dbPath;
}

/**
 * Initialize the database schema
 */
function initializeSchema(database: Database.Database): void {
  try {
    // Enable WAL mode for better performance
    database.pragma('journal_mode = WAL');

    // Create sessions table
    database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      claude_session_id TEXT,
      openai_thread_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      cwd TEXT,
      mounted_paths TEXT NOT NULL DEFAULT '[]',
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      memory_enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

    ensureColumn(database, 'sessions', 'openai_thread_id', 'openai_thread_id TEXT');
    ensureColumn(database, 'sessions', 'model', 'model TEXT');
    ensureColumn(database, 'sessions', 'intelligence', 'intelligence TEXT');
    ensureColumn(database, 'sessions', 'project_id', 'project_id TEXT');
    ensureColumn(database, 'sessions', 'is_background', 'is_background INTEGER DEFAULT 0');
    ensureColumn(database, 'sessions', 'execution_mode', 'execution_mode TEXT');
    ensureColumn(database, 'sessions', 'permission_mode', "permission_mode TEXT DEFAULT 'default'");
    ensureColumn(database, 'sessions', 'pinned', 'pinned INTEGER DEFAULT 0');
    ensureColumn(database, 'sessions', 'archived', 'archived INTEGER DEFAULT 0');
    ensureColumn(database, 'sessions', 'tags', 'tags TEXT');
    ensureColumn(database, 'sessions', 'source', 'source TEXT');

    // Create messages table
    database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      token_usage TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

    ensureColumn(database, 'messages', 'execution_time_ms', 'execution_time_ms INTEGER');
    ensureColumn(database, 'messages', 'metadata', 'metadata TEXT');

    // Create trace steps table
    database.exec(`
    CREATE TABLE IF NOT EXISTS trace_steps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      is_error INTEGER,
      timestamp INTEGER NOT NULL,
      duration INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

    // Create index for faster message queries
    database.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session_id 
    ON messages(session_id)
  `);

    database.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp 
    ON messages(session_id, timestamp)
  `);

    initializeMessageSearchIndex(database);

    database.exec(`
    CREATE INDEX IF NOT EXISTS idx_trace_steps_session_id
    ON trace_steps(session_id)
  `);

    database.exec(`
    CREATE INDEX IF NOT EXISTS idx_trace_steps_timestamp
    ON trace_steps(session_id, timestamp)
  `);

    // Create memory_entries table (for future use)
    database.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

    // Create skills table (for future use)
    database.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT,
      created_at INTEGER NOT NULL
    )
  `);

    database.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cwd TEXT NOT NULL,
      run_at INTEGER NOT NULL,
      next_run_at INTEGER,
      schedule_config TEXT,
      repeat_every INTEGER,
      repeat_unit TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      last_run_session_id TEXT,
      last_error TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
    ensureColumn(database, 'scheduled_tasks', 'schedule_config', 'schedule_config TEXT');
    ensureColumn(database, 'scheduled_tasks', 'metadata', 'metadata TEXT');

    database.exec(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run
    ON scheduled_tasks(enabled, next_run_at)
  `);

    createProjectsTable(database);

    log('[Database] Schema initialized');
  } catch (error) {
    logError('[Database] Schema initialization failed:', error);
    throw error;
  }
}

function createProjectsTable(database: Database.Database): void {
  const createSql = `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    workspace_path TEXT,
    memory_config TEXT,
    context_config TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`;
  database.exec(createSql);
  // Older Project Hub builds created the table before these JSON columns
  // existed. Keep both additions idempotent so prepared statements remain
  // compatible with every on-disk schema still supported by Cowork.
  ensureColumn(database, 'projects', 'memory_config', 'memory_config TEXT');
  ensureColumn(database, 'projects', 'context_config', 'context_config TEXT');

  const indexSql = `CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id)`;
  database.exec(indexSql);
}

function validateIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return name;
}

const ALLOWED_COLUMN_TYPES = [
  'TEXT NOT NULL DEFAULT',
  'INTEGER DEFAULT',
  'TEXT',
  'INTEGER',
  'REAL',
  'BLOB',
] as const;

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  validateIdentifier(table);
  validateIdentifier(column);

  // Reconstruct definition from validated parts to prevent SQL injection.
  // The definition format is: "<column> <TYPE_SUFFIX>" — extract the type
  // suffix that follows the column name and validate it against an allowlist.
  const prefix = column + ' ';
  if (!definition.startsWith(prefix)) {
    throw new Error(`Column definition must start with column name: ${definition}`);
  }
  const typeSuffix = definition.slice(prefix.length).trim().toUpperCase();
  const matchedType = ALLOWED_COLUMN_TYPES.find(
    (t) => typeSuffix === t || typeSuffix.startsWith(t + ' ')
  );
  if (!matchedType) {
    throw new Error(`Unsupported column type in definition: ${typeSuffix}`);
  }
  // Use only the validated column name + original (non-uppercased) suffix so
  // that default value tokens are preserved exactly as authored.
  const originalSuffix = definition.slice(prefix.length).trim();
  const safeDefinition = `${column} ${originalSuffix}`;

  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const exists = rows.some((row) => row.name === column);
  if (exists) {
    return;
  }
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${safeDefinition}`);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildMessageFtsQuery(query: string): string | null {
  const tokens = query
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((token) => token.toLowerCase())
    .filter(Boolean)
    .slice(0, 16);

  if (!tokens || tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' AND ');
}

function initializeMessageSearchIndex(database: Database.Database): void {
  try {
    // Check if table exists and does NOT have tokenize='trigram'
    let needsRebuild = false;
    try {
      const tableInfo = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages_fts'").get() as { sql: string } | undefined;
      if (tableInfo && !tableInfo.sql.includes("tokenize='trigram'") && !tableInfo.sql.includes('tokenize="trigram"')) {
        needsRebuild = true;
      }
    } catch {
      // Table doesn't exist or query failed
    }

    if (needsRebuild) {
      log('[Database] Rebuilding messages_fts with trigram tokenizer...');
      database.exec(`
        DROP TRIGGER IF EXISTS messages_ai;
        DROP TRIGGER IF EXISTS messages_ad;
        DROP TRIGGER IF EXISTS messages_au;
        DROP TABLE IF EXISTS messages_fts;
      `);
    }

    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        message_id UNINDEXED,
        session_id UNINDEXED,
        role UNINDEXED,
        tokenize='trigram'
      );

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(content, message_id, session_id, role)
        VALUES (new.content, new.id, new.session_id, new.role);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE message_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS messages_au
      AFTER UPDATE OF content, session_id, role ON messages BEGIN
        DELETE FROM messages_fts WHERE message_id = old.id;
        INSERT INTO messages_fts(content, message_id, session_id, role)
        VALUES (new.content, new.id, new.session_id, new.role);
      END;
    `);

    database.exec(`
      INSERT INTO messages_fts(content, message_id, session_id, role)
      SELECT m.content, m.id, m.session_id, m.role
        FROM messages m
       WHERE NOT EXISTS (
         SELECT 1 FROM messages_fts f WHERE f.message_id = m.id
       )
    `);
  } catch (error) {
    logWarn('[Database] Message FTS index unavailable; using LIKE fallback:', error);
  }
}

/**
 * Initialize the database
 */
export function initDatabase(): DatabaseInstance {
  if (db) return db;

  const dbPath = getDatabasePath();
  log('[Database] Opening database at:', dbPath);

  let rawDb: Database.Database;
  try {
    rawDb = new Database(dbPath);
  } catch (error) {
    logError('[Database] Failed to open database at:', dbPath, error);
    throw error;
  }

  // Enable foreign keys
  rawDb.pragma('foreign_keys = ON');

  // Initialize schema
  initializeSchema(rawDb);

  // Prepare statements for better performance
  const insertSession = rawDb.prepare(`
    INSERT OR REPLACE INTO sessions
    (id, title, claude_session_id, openai_thread_id, status, cwd, mounted_paths, allowed_tools, memory_enabled, model, intelligence, project_id, is_background, execution_mode, permission_mode, pinned, archived, tags, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Note: Dynamic update queries are built in sessions.update() for flexibility
  // const updateSessionStmt = rawDb.prepare(`
  //   UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?
  // `);

  const getSessionStmt = rawDb.prepare(`
    SELECT * FROM sessions WHERE id = ?
  `);

  const getAllSessionsStmt = rawDb.prepare(`
    SELECT * FROM sessions ORDER BY updated_at DESC
  `);

  const deleteSessionStmt = rawDb.prepare(`
    DELETE FROM sessions WHERE id = ?
  `);

  const insertMessage = rawDb.prepare(`
    INSERT INTO messages (id, session_id, role, content, timestamp, token_usage, execution_time_ms, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getMessagesBySessionStmt = rawDb.prepare(`
    SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC
  `);

  const updateMessageStmt = rawDb.prepare(`
    UPDATE messages SET execution_time_ms = ? WHERE id = ?
  `);

  const deleteMessageStmt = rawDb.prepare(`
    DELETE FROM messages WHERE id = ?
  `);

  const deleteMessagesBySessionStmt = rawDb.prepare(`
    DELETE FROM messages WHERE session_id = ?
  `);

  const searchMessagesByLikeStmt = rawDb.prepare(`
    SELECT m.id AS message_id,
           m.session_id,
           m.role,
           m.content,
           m.timestamp,
           s.title AS session_title,
           s.project_id
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
     WHERE LOWER(m.content) LIKE LOWER(?) ESCAPE '\\'
     ORDER BY m.timestamp DESC
     LIMIT ?
  `);

  let searchMessagesByFtsStmt: Database.Statement | null = null;
  try {
    searchMessagesByFtsStmt = rawDb.prepare(`
      SELECT f.message_id,
             f.session_id,
             f.role,
             f.content,
             m.timestamp,
             s.title AS session_title,
             s.project_id
        FROM messages_fts f
        JOIN messages m ON m.id = f.message_id
        JOIN sessions s ON s.id = f.session_id
       WHERE messages_fts MATCH ?
       ORDER BY bm25(messages_fts), m.timestamp DESC
       LIMIT ?
    `);
  } catch (error) {
    logWarn('[Database] Message FTS statement unavailable; using LIKE fallback:', error);
  }

  const insertTraceStep = rawDb.prepare(`
    INSERT OR REPLACE INTO trace_steps (
      id, session_id, type, status, title, content, tool_name, tool_input, tool_output, is_error, timestamp, duration
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getTraceStepsBySessionStmt = rawDb.prepare(`
    SELECT * FROM trace_steps WHERE session_id = ? ORDER BY timestamp ASC
  `);

  const deleteTraceStepsBySessionStmt = rawDb.prepare(`
    DELETE FROM trace_steps WHERE session_id = ?
  `);

  const insertScheduledTask = rawDb.prepare(`
    INSERT OR REPLACE INTO scheduled_tasks (
      id, title, prompt, cwd, run_at, next_run_at, schedule_config, repeat_every, repeat_unit, enabled, last_run_at, last_run_session_id, last_error, metadata, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getScheduledTaskStmt = rawDb.prepare(`
    SELECT * FROM scheduled_tasks WHERE id = ?
  `);

  const getAllScheduledTasksStmt = rawDb.prepare(`
    SELECT * FROM scheduled_tasks ORDER BY created_at ASC
  `);

  const deleteScheduledTaskStmt = rawDb.prepare(`
    DELETE FROM scheduled_tasks WHERE id = ?
  `);

  // Project prepared statements
  const insertProject = rawDb.prepare(`
    INSERT OR REPLACE INTO projects
    (id, name, description, workspace_path, memory_config, context_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getProjectStmt = rawDb.prepare(`SELECT * FROM projects WHERE id = ?`);
  const getAllProjectsStmt = rawDb.prepare(`SELECT * FROM projects ORDER BY updated_at DESC`);
  const deleteProjectStmt = rawDb.prepare(`DELETE FROM projects WHERE id = ?`);

  db = {
    raw: rawDb,

    sessions: {
      create: (session: SessionRow) => {
        insertSession.run(
          session.id,
          session.title,
          session.claude_session_id,
          session.openai_thread_id,
          session.status,
          session.cwd,
          session.mounted_paths,
          session.allowed_tools,
          session.memory_enabled,
          session.model,
          session.intelligence ?? null,
          session.project_id ?? null,
          session.is_background ?? 0,
          session.execution_mode ?? null,
          session.permission_mode ?? 'default',
          session.pinned ?? 0,
          session.archived ?? 0,
          session.tags ?? null,
          session.source ?? 'cowork',
          session.created_at,
          session.updated_at
        );
      },

      update: (id: string, updates: Partial<SessionRow>) => {
        // Columns that must never be overwritten after insert
        const IMMUTABLE_COLUMNS = new Set(['id', 'created_at']);

        // Build dynamic update query
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            if (IMMUTABLE_COLUMNS.has(key)) continue;
            validateIdentifier(key);
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }

        if (setClauses.length === 0) return;

        // Always update updated_at
        setClauses.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);

        const sql = `UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`;
        rawDb.prepare(sql).run(...values);
      },

      get: (id: string): SessionRow | undefined => {
        return getSessionStmt.get(id) as SessionRow | undefined;
      },

      getAll: (): SessionRow[] => {
        return getAllSessionsStmt.all() as SessionRow[];
      },

      delete: (id: string) => {
        // Messages will be deleted automatically due to ON DELETE CASCADE
        deleteSessionStmt.run(id);
      },
    },

    messages: {
      create: (message: MessageRow) => {
        insertMessage.run(
          message.id,
          message.session_id,
          message.role,
          message.content,
          message.timestamp,
          message.token_usage,
          message.execution_time_ms ?? null,
          message.metadata ?? null
        );
      },

      update: (id: string, updates: Partial<Pick<MessageRow, 'execution_time_ms'>>) => {
        if (updates.execution_time_ms !== undefined) {
          updateMessageStmt.run(updates.execution_time_ms, id);
        }
      },

      getBySessionId: (sessionId: string): MessageRow[] => {
        return getMessagesBySessionStmt.all(sessionId) as MessageRow[];
      },

      delete: (id: string) => {
        deleteMessageStmt.run(id);
      },

      deleteBySessionId: (sessionId: string) => {
        deleteMessagesBySessionStmt.run(sessionId);
      },

      searchContent: (query: string, limit: number): MessageSearchHit[] => {
        const trimmed = query.trim();
        if (trimmed.length === 0) return [];

        const cappedLimit = Math.max(1, Math.min(limit, 200));
        const ftsQuery = buildMessageFtsQuery(trimmed);
        if (searchMessagesByFtsStmt && ftsQuery) {
          try {
            return searchMessagesByFtsStmt.all(ftsQuery, cappedLimit) as MessageSearchHit[];
          } catch (error) {
            logWarn('[Database] Message FTS search failed; using LIKE fallback:', error);
          }
        }

        // Escape SQL LIKE wildcards so literal `_` and `%` do not match
        // arbitrary messages when the FTS tokenizer cannot build a query.
        const escaped = escapeLikePattern(trimmed);
        const pattern = `%${escaped}%`;
        return searchMessagesByLikeStmt.all(
          pattern,
          cappedLimit
        ) as MessageSearchHit[];
      },
    },

    traceSteps: {
      create: (step: TraceStepRow) => {
        insertTraceStep.run(
          step.id,
          step.session_id,
          step.type,
          step.status,
          step.title,
          step.content,
          step.tool_name,
          step.tool_input,
          step.tool_output,
          step.is_error,
          step.timestamp,
          step.duration
        );
      },

      update: (id: string, updates: Partial<TraceStepRow>) => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            validateIdentifier(key);
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }

        if (setClauses.length === 0) return;

        values.push(id);
        const sql = `UPDATE trace_steps SET ${setClauses.join(', ')} WHERE id = ?`;
        rawDb.prepare(sql).run(...values);
      },

      getBySessionId: (sessionId: string): TraceStepRow[] => {
        return getTraceStepsBySessionStmt.all(sessionId) as TraceStepRow[];
      },

      deleteBySessionId: (sessionId: string) => {
        deleteTraceStepsBySessionStmt.run(sessionId);
      },
    },

    scheduledTasks: {
      create: (task: ScheduledTaskRow) => {
        insertScheduledTask.run(
          task.id,
          task.title,
          task.prompt,
          task.cwd,
          task.run_at,
          task.next_run_at,
          task.schedule_config,
          task.repeat_every,
          task.repeat_unit,
          task.enabled,
          task.last_run_at,
          task.last_run_session_id,
          task.last_error,
          task.metadata,
          task.created_at,
          task.updated_at
        );
      },

      update: (id: string, updates: Partial<ScheduledTaskRow>) => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            validateIdentifier(key);
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }

        if (setClauses.length === 0) return;

        setClauses.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);

        const sql = `UPDATE scheduled_tasks SET ${setClauses.join(', ')} WHERE id = ?`;
        rawDb.prepare(sql).run(...values);
      },

      get: (id: string): ScheduledTaskRow | undefined => {
        return getScheduledTaskStmt.get(id) as ScheduledTaskRow | undefined;
      },

      getAll: (): ScheduledTaskRow[] => {
        return getAllScheduledTasksStmt.all() as ScheduledTaskRow[];
      },

      delete: (id: string) => {
        deleteScheduledTaskStmt.run(id);
      },
    },

    projects: {
      create: (project: ProjectRow) => {
        insertProject.run(
          project.id,
          project.name,
          project.description,
          project.workspace_path,
          project.memory_config,
          project.context_config,
          project.created_at,
          project.updated_at
        );
      },

      update: (id: string, updates: Partial<ProjectRow>) => {
        const IMMUTABLE_COLUMNS = new Set(['id', 'created_at']);
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            if (IMMUTABLE_COLUMNS.has(key)) continue;
            validateIdentifier(key);
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }

        if (setClauses.length === 0) return;

        setClauses.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);

        const sql = `UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`;
        rawDb.prepare(sql).run(...values);
      },

      get: (id: string): ProjectRow | undefined => {
        return getProjectStmt.get(id) as ProjectRow | undefined;
      },

      getAll: (): ProjectRow[] => {
        return getAllProjectsStmt.all() as ProjectRow[];
      },

      delete: (id: string) => {
        deleteProjectStmt.run(id);
      },
    },

    // Compatibility layer for old interface
    prepare: (sql: string) => rawDb.prepare(sql),
    exec: (sql: string) => rawDb.exec(sql),
    pragma: (pragma: string) => rawDb.pragma(pragma),
    close: () => {
      rawDb.close();
      db = null;
    },
  };

  log('[Database] SQLite database initialized successfully');
  return db!;
}

/**
 * Get the existing database instance
 */
export function getDatabase(): DatabaseInstance {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    log('[Database] Database closed');
  }
}
