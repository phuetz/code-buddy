/**
 * Database Schema Definitions
 *
 * SQLite schema for code-buddy persistent storage including:
 * - Memories with vector embeddings
 * - Session history with costs
 * - Code embeddings for semantic search
 * - Tool statistics and learning
 * - Analytics and cost tracking
 */

// ============================================================================
// Schema Version
// ============================================================================

export const SCHEMA_VERSION = 2;

// ============================================================================
// Table Definitions
// ============================================================================

export const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- MEMORIES TABLE
-- Stores persistent memories with embeddings for semantic search
-- ============================================================================
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('fact', 'preference', 'pattern', 'decision', 'context', 'summary', 'instruction', 'error', 'definition', 'convention')),
  scope TEXT NOT NULL CHECK(scope IN ('user', 'project')),
  project_id TEXT,
  content TEXT NOT NULL,
  embedding BLOB,  -- Float32Array as binary
  importance REAL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
  access_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_accessed TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  metadata TEXT,  -- JSON for additional data
  UNIQUE(scope, project_id, content)
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, project_id);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed DESC);

-- ============================================================================
-- SESSIONS TABLE
-- Stores conversation sessions with full history
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  project_path TEXT,
  name TEXT,
  model TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  total_tokens_in INTEGER DEFAULT 0,
  total_tokens_out INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  tool_calls_count INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  metadata TEXT  -- JSON
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

-- ============================================================================
-- MESSAGES TABLE
-- Individual messages within sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  tool_calls TEXT,  -- JSON array of tool calls
  tool_call_id TEXT,
  tokens INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT  -- JSON
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

-- ============================================================================
-- CODE EMBEDDINGS TABLE
-- Vector embeddings for code chunks
-- ============================================================================
CREATE TABLE IF NOT EXISTS code_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  chunk_hash TEXT NOT NULL,
  embedding BLOB NOT NULL,  -- Float32Array as binary
  symbol_type TEXT,  -- function, class, interface, etc.
  symbol_name TEXT,
  start_line INTEGER,
  end_line INTEGER,
  language TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, file_path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_code_embeddings_project ON code_embeddings(project_id);
CREATE INDEX IF NOT EXISTS idx_code_embeddings_file ON code_embeddings(project_id, file_path);
CREATE INDEX IF NOT EXISTS idx_code_embeddings_symbol ON code_embeddings(symbol_type, symbol_name);

-- ============================================================================
-- TOOL STATISTICS TABLE
-- Tracks tool usage, success rates, and performance
-- ============================================================================
CREATE TABLE IF NOT EXISTS tool_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  project_id TEXT,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  total_time_ms INTEGER DEFAULT 0,
  avg_time_ms REAL GENERATED ALWAYS AS (
    CASE WHEN (success_count + failure_count) > 0
    THEN total_time_ms * 1.0 / (success_count + failure_count)
    ELSE 0 END
  ) STORED,
  cache_hits INTEGER DEFAULT 0,
  cache_misses INTEGER DEFAULT 0,
  last_used TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tool_name, project_id)
);

CREATE INDEX IF NOT EXISTS idx_tool_stats_name ON tool_stats(tool_name);

-- ============================================================================
-- REPAIR LEARNING TABLE
-- Stores what repair strategies work for which error patterns
-- ============================================================================
CREATE TABLE IF NOT EXISTS repair_learning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  error_pattern TEXT NOT NULL,  -- Normalized error message pattern
  error_type TEXT NOT NULL CHECK(error_type IN ('compile', 'runtime', 'test', 'lint', 'type')),
  strategy TEXT NOT NULL,
  context_hash TEXT,  -- Hash of surrounding code context
  language TEXT,
  framework TEXT,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  success_rate REAL GENERATED ALWAYS AS (
    CASE WHEN (success_count + failure_count) > 0
    THEN success_count * 1.0 / (success_count + failure_count)
    ELSE 0 END
  ) STORED,
  avg_attempts REAL DEFAULT 1,
  last_used TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  examples TEXT,  -- JSON array of successful fix examples
  UNIQUE(error_pattern, strategy, context_hash)
);

CREATE INDEX IF NOT EXISTS idx_repair_learning_pattern ON repair_learning(error_pattern);
CREATE INDEX IF NOT EXISTS idx_repair_learning_success ON repair_learning(success_rate DESC);

-- ============================================================================
-- ANALYTICS TABLE
-- Daily aggregated usage statistics
-- ============================================================================
CREATE TABLE IF NOT EXISTS analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  project_id TEXT,
  model TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  requests INTEGER DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  avg_response_time_ms REAL DEFAULT 0,
  cache_hit_rate REAL DEFAULT 0,
  session_count INTEGER DEFAULT 0,
  UNIQUE(date, project_id, model)
);

CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics(date DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_project ON analytics(project_id, date DESC);

-- ============================================================================
-- CONVENTIONS TABLE
-- Learned coding conventions per project
-- ============================================================================
CREATE TABLE IF NOT EXISTS conventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL,  -- naming, structure, style, testing, docs
  pattern TEXT NOT NULL,
  description TEXT,
  confidence REAL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1),
  occurrences INTEGER DEFAULT 1,
  examples TEXT,  -- JSON array of examples
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, category, pattern)
);

CREATE INDEX IF NOT EXISTS idx_conventions_project ON conventions(project_id);
CREATE INDEX IF NOT EXISTS idx_conventions_confidence ON conventions(confidence DESC);

-- ============================================================================
-- CHECKPOINTS TABLE
-- File checkpoints for undo/restore
-- ============================================================================
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  file_count INTEGER DEFAULT 0,
  total_size INTEGER DEFAULT 0,
  metadata TEXT  -- JSON
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON checkpoints(project_id, created_at DESC);

-- ============================================================================
-- CHECKPOINT FILES TABLE
-- Individual file snapshots
-- ============================================================================
CREATE TABLE IF NOT EXISTS checkpoint_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  content TEXT,
  content_hash TEXT,
  existed INTEGER DEFAULT 1,
  UNIQUE(checkpoint_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_files_checkpoint ON checkpoint_files(checkpoint_id);

-- ============================================================================
-- CACHE TABLE
-- General-purpose cache with TTL
-- ============================================================================
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  embedding BLOB,  -- Optional embedding for semantic cache
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  hits INTEGER DEFAULT 0,
  category TEXT  -- api, tool, search, etc.
);

CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_category ON cache(category);
`;

// ============================================================================
// Migration Scripts
// ============================================================================

export const MIGRATIONS: Record<number, string> = {
  1: SCHEMA_SQL,
  2: `
-- ============================================================================
-- MESSAGE FULL-TEXT SEARCH
-- Enables fast session search without scanning JSON session files.
-- ============================================================================
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  session_id UNINDEXED,
  role UNINDEXED,
  content='messages',
  content_rowid='id',
  tokenize='unicode61'
);

INSERT INTO messages_fts(messages_fts) VALUES('rebuild');

DROP TRIGGER IF EXISTS messages_ai;
DROP TRIGGER IF EXISTS messages_ad;
DROP TRIGGER IF EXISTS messages_au;

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content, session_id, role)
  VALUES (new.id, COALESCE(new.content, ''), new.session_id, new.role);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
  VALUES ('delete', old.id, COALESCE(old.content, ''), old.session_id, old.role);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
  VALUES ('delete', old.id, COALESCE(old.content, ''), old.session_id, old.role);

  INSERT INTO messages_fts(rowid, content, session_id, role)
  VALUES (new.id, COALESCE(new.content, ''), new.session_id, new.role);
END;
`,
};

// ============================================================================
// Helper Types
// ============================================================================

export interface Memory {
  id: string;
  type: MemoryType;
  scope: 'user' | 'project';
  project_id?: string;
  content: string;
  embedding?: Float32Array;
  importance: number;
  access_count: number;
  created_at: string;
  last_accessed: string;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

export type MemoryType =
  | 'fact'
  | 'preference'
  | 'pattern'
  | 'decision'
  | 'context'
  | 'summary'
  | 'instruction'
  | 'error'
  | 'definition'
  | 'convention';

export interface Session {
  id: string;
  parent_session_id?: string;
  project_id?: string;
  project_path?: string;
  name?: string;
  model?: string;
  created_at: string;
  updated_at: string;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost: number;
  message_count: number;
  tool_calls_count: number;
  is_archived: boolean;
  metadata?: Record<string, unknown>;
}

export interface Message {
  id?: number;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
  tokens?: number;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface CodeEmbedding {
  id?: number;
  project_id: string;
  file_path: string;
  chunk_index: number;
  chunk_text: string;
  chunk_hash: string;
  embedding: Float32Array;
  symbol_type?: string;
  symbol_name?: string;
  start_line?: number;
  end_line?: number;
  language?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ToolStats {
  id?: number;
  tool_name: string;
  project_id?: string;
  success_count: number;
  failure_count: number;
  total_time_ms: number;
  avg_time_ms: number;
  cache_hits: number;
  cache_misses: number;
  last_used: string;
  updated_at: string;
}

export interface RepairLearning {
  id?: number;
  error_pattern: string;
  error_type: 'compile' | 'runtime' | 'test' | 'lint' | 'type';
  strategy: string;
  context_hash?: string;
  language?: string;
  framework?: string;
  success_count: number;
  failure_count: number;
  success_rate: number;
  avg_attempts: number;
  last_used: string;
  created_at: string;
  examples?: string[];
}

export interface Analytics {
  id?: number;
  date: string;
  project_id?: string;
  model?: string;
  tokens_in: number;
  tokens_out: number;
  cost: number;
  requests: number;
  tool_calls: number;
  errors: number;
  avg_response_time_ms: number;
  cache_hit_rate: number;
  session_count: number;
}

export interface Convention {
  id?: number;
  project_id: string;
  category: string;
  pattern: string;
  description?: string;
  confidence: number;
  occurrences: number;
  examples?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface Checkpoint {
  id: string;
  project_id: string;
  description?: string;
  created_at: string;
  file_count: number;
  total_size: number;
  metadata?: Record<string, unknown>;
}

export interface CheckpointFile {
  id?: number;
  checkpoint_id: string;
  file_path: string;
  content?: string;
  content_hash?: string;
  existed: boolean;
}
