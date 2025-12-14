/**
 * SQL Tool
 *
 * Execute SQL queries on SQLite databases.
 * Supports read operations and controlled write operations.
 */

import * as path from 'path';
import fs from 'fs-extra';
import type { ToolResult } from './index.js';

// ============================================================================
// Types
// ============================================================================

interface SQLParams {
  action: 'query' | 'schema' | 'tables' | 'describe' | 'execute';
  database: string;
  query?: string;
  table?: string;
  params?: unknown[];
}

// ============================================================================
// SQL Tool
// ============================================================================

export class SQLTool {
  name = 'sql';
  description = 'Execute SQL queries on SQLite databases';
  dangerLevel: 'safe' | 'low' | 'medium' | 'high' = 'high';

  inputSchema = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['query', 'schema', 'tables', 'describe', 'execute'],
        description: 'Action to perform',
      },
      database: {
        type: 'string',
        description: 'Path to SQLite database file',
      },
      query: {
        type: 'string',
        description: 'SQL query to execute (for query/execute actions)',
      },
      table: {
        type: 'string',
        description: 'Table name (for describe action)',
      },
      params: {
        type: 'array',
        description: 'Query parameters for parameterized queries',
      },
    },
    required: ['action', 'database'],
  };

  /**
   * Execute SQL operation
   */
  async execute(params: SQLParams): Promise<ToolResult> {
    try {
      const { action, database } = params;

      // Validate database path
      const dbPath = path.resolve(database);
      if (!await fs.pathExists(dbPath)) {
        return { success: false, error: `Database not found: ${dbPath}` };
      }

      // Dynamically import better-sqlite3
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let Database: any;
      try {
        const sqliteModule = await import('better-sqlite3');
        Database = sqliteModule.default || sqliteModule;
      } catch {
        return { success: false, error: 'SQLite driver not available. Install better-sqlite3.' };
      }

      const db = Database(dbPath, { readonly: action !== 'execute' });

      try {
        switch (action) {
          case 'tables':
            return this.listTables(db);
          case 'schema':
            return this.getSchema(db);
          case 'describe':
            return this.describeTable(db, params.table!);
          case 'query':
            return this.runQuery(db, params.query!, params.params);
          case 'execute':
            return this.executeStatement(db, params.query!, params.params);
          default:
            return { success: false, error: `Unknown action: ${action}` };
        }
      } finally {
        db.close();
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List all tables
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listTables(db: any): ToolResult {
    const tables = db.prepare(`
      SELECT name, type
      FROM sqlite_master
      WHERE type IN ('table', 'view')
      AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all() as Array<{ name: string; type: string }>;

    const result = tables.map(t => `${t.type === 'view' ? '📊' : '📋'} ${t.name}`).join('\n');

    return {
      success: true,
      content: `# Tables in database\n\n${result}`,
      metadata: { tableCount: tables.length },
    };
  }

  /**
   * Get full schema
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getSchema(db: any): ToolResult {
    const objects = db.prepare(`
      SELECT name, type, sql
      FROM sqlite_master
      WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all() as Array<{ name: string; type: string; sql: string }>;

    const parts: string[] = ['# Database Schema\n'];

    for (const obj of objects) {
      parts.push(`## ${obj.type}: ${obj.name}\n`);
      parts.push('```sql');
      parts.push(obj.sql);
      parts.push('```\n');
    }

    return { success: true, content: parts.join('\n') };
  }

  /**
   * Describe a specific table
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private describeTable(db: any, table: string): ToolResult {
    if (!table) {
      return { success: false, error: 'Table name required' };
    }

    // Get table info
    const columns = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;

    if (columns.length === 0) {
      return { success: false, error: `Table not found: ${table}` };
    }

    // Get indexes
    const indexes = db.prepare(`PRAGMA index_list("${table.replace(/"/g, '""')}")`).all() as Array<{
      name: string;
      unique: number;
    }>;

    // Get foreign keys
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list("${table.replace(/"/g, '""')}")`).all() as Array<{
      table: string;
      from: string;
      to: string;
    }>;

    // Get row count
    const countResult = db.prepare(`SELECT COUNT(*) as count FROM "${table.replace(/"/g, '""')}"`).get() as { count: number };

    const parts: string[] = [
      `# Table: ${table}`,
      '',
      `**Rows**: ${countResult.count}`,
      '',
      '## Columns',
      '',
      '| Name | Type | Nullable | Default | PK |',
      '|------|------|----------|---------|-----|',
    ];

    for (const col of columns) {
      parts.push(
        `| ${col.name} | ${col.type} | ${col.notnull ? 'NO' : 'YES'} | ${col.dflt_value || '-'} | ${col.pk ? '✓' : ''} |`
      );
    }

    if (indexes.length > 0) {
      parts.push('', '## Indexes', '');
      for (const idx of indexes) {
        parts.push(`- ${idx.name}${idx.unique ? ' (UNIQUE)' : ''}`);
      }
    }

    if (foreignKeys.length > 0) {
      parts.push('', '## Foreign Keys', '');
      for (const fk of foreignKeys) {
        parts.push(`- ${fk.from} → ${fk.table}(${fk.to})`);
      }
    }

    return { success: true, content: parts.join('\n') };
  }

  /**
   * Run SELECT query
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private runQuery(db: any, query: string, params?: unknown[]): ToolResult {
    if (!query) {
      return { success: false, error: 'Query required' };
    }

    // Validate query is read-only
    const normalizedQuery = query.trim().toUpperCase();
    if (!normalizedQuery.startsWith('SELECT') &&
        !normalizedQuery.startsWith('PRAGMA') &&
        !normalizedQuery.startsWith('EXPLAIN') &&
        !normalizedQuery.startsWith('WITH')) {
      return { success: false, error: 'Only SELECT queries allowed. Use execute action for modifications.' };
    }

    const stmt = db.prepare(query);
    const rows = params ? stmt.all(...params) : stmt.all();

    if (rows.length === 0) {
      return { success: true, content: 'No results found.' };
    }

    // Format as markdown table
    const columns = Object.keys(rows[0] as object);
    const parts: string[] = [
      `**${rows.length} row(s)**`,
      '',
      '| ' + columns.join(' | ') + ' |',
      '| ' + columns.map(() => '---').join(' | ') + ' |',
    ];

    for (const row of rows.slice(0, 100)) {
      const values = columns.map(col => {
        const val = (row as Record<string, unknown>)[col];
        if (val === null) return 'NULL';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val).slice(0, 50);
      });
      parts.push('| ' + values.join(' | ') + ' |');
    }

    if (rows.length > 100) {
      parts.push('', `... and ${rows.length - 100} more rows`);
    }

    return {
      success: true,
      content: parts.join('\n'),
      metadata: { rowCount: rows.length, columns },
    };
  }

  /**
   * Execute modification statement (INSERT, UPDATE, DELETE)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private executeStatement(db: any, query: string, params?: unknown[]): ToolResult {
    if (!query) {
      return { success: false, error: 'Query required' };
    }

    // Block dangerous operations
    const normalizedQuery = query.trim().toUpperCase();
    if (normalizedQuery.includes('DROP DATABASE') ||
        normalizedQuery.includes('DROP TABLE sqlite')) {
      return { success: false, error: 'Dangerous operation blocked' };
    }

    const stmt = db.prepare(query);
    const result = params ? stmt.run(...params) : stmt.run();

    return {
      success: true,
      content: `Query executed successfully.\nChanges: ${result.changes}\nLast Insert ID: ${result.lastInsertRowid}`,
      metadata: {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      },
    };
  }
}

// Singleton
let sqlToolInstance: SQLTool | null = null;

export function getSQLTool(): SQLTool {
  if (!sqlToolInstance) {
    sqlToolInstance = new SQLTool();
  }
  return sqlToolInstance;
}
