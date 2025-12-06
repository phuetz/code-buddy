/**
 * SQL Agent
 *
 * Specialized agent for executing SQL queries on data files.
 * Uses better-sqlite3 for in-memory SQL queries or alasql as fallback.
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { basename, extname } from 'path';
import {
  SpecializedAgent,
  SpecializedAgentConfig,
  AgentTask,
  AgentResult,
  SQLQueryResult,
  SQLTableInfo,
} from './types.js';
import { getErrorMessage } from '../../types/index.js';

// ============================================================================
// Configuration
// ============================================================================

const SQL_AGENT_CONFIG: SpecializedAgentConfig = {
  id: 'sql-agent',
  name: 'SQL Agent',
  description: 'Execute SQL queries on CSV, JSON, and SQLite files',
  capabilities: ['sql-query'],
  fileExtensions: ['csv', 'json', 'jsonl', 'sqlite', 'db'],
  maxFileSize: 500 * 1024 * 1024, // 500MB
  requiredTools: [],
};

// ============================================================================
// SQL Agent Implementation
// ============================================================================

export class SQLAgent extends SpecializedAgent {
  private sqlite: any = null;
  private alasql: any = null;
  private tempDir: string | null = null;

  constructor() {
    super(SQL_AGENT_CONFIG);
  }

  async initialize(): Promise<void> {
    // Try to load better-sqlite3 first
    try {
      const sqliteModule = await import('better-sqlite3');
      this.sqlite = sqliteModule.default || sqliteModule;
      this.isInitialized = true;
      this.emit('initialized', { engine: 'better-sqlite3' });
      return;
    } catch (_error) {
      // better-sqlite3 not available
    }

    // Fallback to alasql
    try {
      // @ts-expect-error - Optional dependency
      const alasqlModule = await import('alasql');
      this.alasql = alasqlModule.default || alasqlModule;
      this.isInitialized = true;
      this.emit('initialized', { engine: 'alasql' });
      return;
    } catch (_error) {
      // alasql not available either
    }

    // Neither available - use basic implementation
    this.isInitialized = true;
    this.emit('initialized', { engine: 'basic', warning: 'No SQL engine available. Limited functionality.' });
  }

  async cleanup(): Promise<void> {
    if (this.tempDir) {
      try {
        rmSync(this.tempDir, { recursive: true, force: true });
      } catch (_error) {
        // Ignore cleanup errors
      }
      this.tempDir = null;
    }
    await super.cleanup();
  }

  getSupportedActions(): string[] {
    return ['query', 'tables', 'schema', 'import', 'export', 'create'];
  }

  getActionHelp(action: string): string {
    const help: Record<string, string> = {
      query: 'Execute SQL query on loaded data',
      tables: 'List all available tables',
      schema: 'Show schema for a table',
      import: 'Import data from file into a table',
      export: 'Export query results to a file',
      create: 'Create a table from data',
    };
    return help[action] || `Unknown action: ${action}`;
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      switch (task.action) {
        case 'query':
          return await this.executeQuery(task, startTime);
        case 'tables':
          return await this.listTables(task, startTime);
        case 'schema':
          return await this.getSchema(task, startTime);
        case 'import':
          return await this.importData(task, startTime);
        case 'export':
          return await this.exportData(task, startTime);
        case 'create':
          return await this.createTable(task, startTime);
        default:
          return { success: false, error: `Unknown action: ${task.action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: `SQL error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  // ============================================================================
  // Actions
  // ============================================================================

  private async executeQuery(task: AgentTask, startTime: number): Promise<AgentResult> {
    const query = task.params?.query as string;
    if (!query) {
      return { success: false, error: 'SQL query required' };
    }

    // Load data from files if provided
    const tables = new Map<string, unknown[]>();
    if (task.inputFiles && task.inputFiles.length > 0) {
      for (const file of task.inputFiles) {
        const loadResult = this.loadFile(file);
        if (!loadResult.success) {
          return loadResult;
        }
        const tableName = this.fileToTableName(file);
        tables.set(tableName, loadResult.data as unknown[]);
      }
    }

    // Add in-memory data if provided
    if (task.data && task.params?.tableName) {
      const data = Array.isArray(task.data) ? task.data : [task.data];
      tables.set(task.params.tableName as string, data);
    }

    // Execute query
    let result: SQLQueryResult;

    if (this.sqlite) {
      result = await this.executeSQLite(query, tables);
    } else if (this.alasql) {
      result = await this.executeAlasql(query, tables);
    } else {
      result = this.executeBasic(query, tables);
    }

    return {
      success: true,
      data: result,
      output: this.formatQueryResult(result),
      duration: Date.now() - startTime,
      metadata: {
        columns: result.columns,
        rowCount: result.rowCount,
        queryTime: result.duration,
      },
    };
  }

  private async listTables(task: AgentTask, startTime: number): Promise<AgentResult> {
    const tables: SQLTableInfo[] = [];

    if (task.inputFiles) {
      for (const file of task.inputFiles) {
        const loadResult = this.loadFile(file);
        if (loadResult.success) {
          const data = loadResult.data as unknown[];
          const tableName = this.fileToTableName(file);

          tables.push({
            name: tableName,
            columns: this.inferColumns(data),
            rowCount: data.length,
          });
        }
      }
    }

    if (tables.length === 0) {
      return {
        success: true,
        data: [],
        output: 'No tables loaded. Provide input files to create tables.',
        duration: Date.now() - startTime,
      };
    }

    const output = tables.map(t =>
      `${t.name}: ${t.rowCount} rows, ${t.columns.length} columns`
    ).join('\n');

    return {
      success: true,
      data: tables,
      output: `Available tables:\n${output}`,
      duration: Date.now() - startTime,
    };
  }

  private async getSchema(task: AgentTask, startTime: number): Promise<AgentResult> {
    const tableName = task.params?.table as string;

    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No input file provided' };
    }

    // Find the file for the table
    const file = tableName
      ? task.inputFiles.find(f => this.fileToTableName(f) === tableName)
      : task.inputFiles[0];

    if (!file) {
      return { success: false, error: `Table not found: ${tableName}` };
    }

    const loadResult = this.loadFile(file);
    if (!loadResult.success) {
      return loadResult;
    }

    const data = loadResult.data as unknown[];
    const columns = this.inferColumns(data);

    const schema: SQLTableInfo = {
      name: this.fileToTableName(file),
      columns,
      rowCount: data.length,
    };

    return {
      success: true,
      data: schema,
      output: this.formatSchema(schema),
      duration: Date.now() - startTime,
    };
  }

  private async importData(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No input file provided' };
    }

    const results: Array<{ file: string; table: string; rows: number }> = [];

    for (const file of task.inputFiles) {
      const loadResult = this.loadFile(file);
      if (loadResult.success) {
        const data = loadResult.data as unknown[];
        results.push({
          file: basename(file),
          table: this.fileToTableName(file),
          rows: data.length,
        });
      }
    }

    return {
      success: true,
      data: results,
      output: `Imported ${results.length} files:\n` +
        results.map(r => `  ${r.table}: ${r.rows} rows from ${r.file}`).join('\n'),
      duration: Date.now() - startTime,
    };
  }

  private async exportData(task: AgentTask, startTime: number): Promise<AgentResult> {
    const query = task.params?.query as string;
    const outputFile = task.outputFile;

    if (!query) {
      return { success: false, error: 'SQL query required' };
    }

    if (!outputFile) {
      return { success: false, error: 'Output file required' };
    }

    // Execute query first
    const queryResult = await this.executeQuery(task, startTime);
    if (!queryResult.success) {
      return queryResult;
    }

    const result = queryResult.data as SQLQueryResult;
    const ext = extname(outputFile).toLowerCase();

    // Convert to output format
    let content: string;
    if (ext === '.json') {
      const rows = result.rows.map(row => {
        const obj: Record<string, unknown> = {};
        row.forEach((val, i) => {
          obj[result.columns[i]] = val;
        });
        return obj;
      });
      content = JSON.stringify(rows, null, 2);
    } else {
      // CSV
      const lines = [result.columns.join(',')];
      for (const row of result.rows) {
        lines.push(row.map(v => this.escapeCSV(v)).join(','));
      }
      content = lines.join('\n');
    }

    writeFileSync(outputFile, content, 'utf-8');

    return {
      success: true,
      outputFile,
      output: `Exported ${result.rowCount} rows to ${outputFile}`,
      duration: Date.now() - startTime,
    };
  }

  private async createTable(task: AgentTask, startTime: number): Promise<AgentResult> {
    const tableName = task.params?.tableName as string;
    const data = task.data;

    if (!tableName) {
      return { success: false, error: 'Table name required' };
    }

    if (!data) {
      return { success: false, error: 'Data required' };
    }

    const rows = Array.isArray(data) ? data : [data];
    const columns = this.inferColumns(rows);

    return {
      success: true,
      data: { tableName, columns, rowCount: rows.length },
      output: `Created table ${tableName} with ${rows.length} rows and ${columns.length} columns`,
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // SQL Engines
  // ============================================================================

  private async executeSQLite(query: string, tables: Map<string, unknown[]>): Promise<SQLQueryResult> {
    const startTime = Date.now();

    // Create in-memory database
    const db = new this.sqlite(':memory:');

    try {
      // Create tables and insert data
      for (const [tableName, data] of tables) {
        if (data.length === 0) continue;

        const columns = Object.keys(data[0] as object);
        const columnDefs = columns.map(c => `"${c}" TEXT`).join(', ');

        db.exec(`CREATE TABLE "${tableName}" (${columnDefs})`);

        const insert = db.prepare(
          `INSERT INTO "${tableName}" VALUES (${columns.map(() => '?').join(', ')})`
        );

        const insertMany = db.transaction((rows: unknown[]) => {
          for (const row of rows) {
            const values = columns.map(c => {
              const val = (row as Record<string, unknown>)[c];
              return val === null || val === undefined ? null : String(val);
            });
            insert.run(...values);
          }
        });

        insertMany(data);
      }

      // Execute query
      const stmt = db.prepare(query);
      const isSelect = query.trim().toUpperCase().startsWith('SELECT');

      if (isSelect) {
        const rows = stmt.all();
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

        return {
          columns,
          rows: rows.map((r: any) => columns.map(c => (r as Record<string, unknown>)[c])),
          rowCount: rows.length,
          duration: Date.now() - startTime,
        };
      } else {
        const info = stmt.run();
        return {
          columns: ['changes'],
          rows: [[info.changes]],
          rowCount: 1,
          duration: Date.now() - startTime,
        };
      }
    } finally {
      db.close();
    }
  }

  private async executeAlasql(query: string, tables: Map<string, unknown[]>): Promise<SQLQueryResult> {
    const startTime = Date.now();

    // Register tables
    for (const [tableName, data] of tables) {
      this.alasql.tables[tableName] = { data: [...data] };
    }

    try {
      const result = this.alasql(query);

      if (Array.isArray(result) && result.length > 0) {
        const columns = Object.keys(result[0]);
        return {
          columns,
          rows: result.map(r => columns.map(c => r[c])),
          rowCount: result.length,
          duration: Date.now() - startTime,
        };
      }

      return {
        columns: ['result'],
        rows: [[result]],
        rowCount: 1,
        duration: Date.now() - startTime,
      };
    } finally {
      // Clean up
      for (const tableName of tables.keys()) {
        delete this.alasql.tables[tableName];
      }
    }
  }

  private executeBasic(query: string, tables: Map<string, unknown[]>): SQLQueryResult {
    const startTime = Date.now();

    // Very basic SQL parser for simple SELECT queries
    const selectMatch = query.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i);

    if (!selectMatch) {
      throw new Error('Only basic SELECT queries are supported without a SQL engine');
    }

    const [, selectClause, tableName, whereClause, orderByClause, limitClause] = selectMatch;

    const data = tables.get(tableName);
    if (!data || data.length === 0) {
      return { columns: [], rows: [], rowCount: 0, duration: Date.now() - startTime };
    }

    let result = [...data];

    // Apply WHERE
    if (whereClause) {
      const match = whereClause.match(/(\w+)\s*(=|!=|>|<|>=|<=|LIKE)\s*['"]?([^'"]+)['"]?/i);
      if (match) {
        const [, col, op, val] = match;
        result = result.filter(row => {
          const cellVal = (row as Record<string, unknown>)[col];
          switch (op.toUpperCase()) {
            case '=': return String(cellVal) === val;
            case '!=': return String(cellVal) !== val;
            case '>': return Number(cellVal) > Number(val);
            case '<': return Number(cellVal) < Number(val);
            case '>=': return Number(cellVal) >= Number(val);
            case '<=': return Number(cellVal) <= Number(val);
            case 'LIKE':
              const pattern = val.replace(/%/g, '.*').replace(/_/g, '.');
              return new RegExp(`^${pattern}$`, 'i').test(String(cellVal));
            default: return true;
          }
        });
      }
    }

    // Apply ORDER BY
    if (orderByClause) {
      const [col, dir] = orderByClause.trim().split(/\s+/);
      const asc = !dir || dir.toUpperCase() !== 'DESC';
      result.sort((a, b) => {
        const va = (a as Record<string, unknown>)[col];
        const vb = (b as Record<string, unknown>)[col];
        const cmp = String(va).localeCompare(String(vb));
        return asc ? cmp : -cmp;
      });
    }

    // Apply LIMIT
    if (limitClause) {
      result = result.slice(0, parseInt(limitClause, 10));
    }

    // Select columns
    let columns: string[];
    if (selectClause.trim() === '*') {
      columns = Object.keys(data[0] as object);
    } else {
      columns = selectClause.split(',').map(c => c.trim().replace(/["`]/g, ''));
    }

    return {
      columns,
      rows: result.map(r => columns.map(c => (r as Record<string, unknown>)[c])),
      rowCount: result.length,
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private loadFile(filePath: string): AgentResult {
    if (!existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const ext = extname(filePath).toLowerCase();
    const content = readFileSync(filePath, 'utf-8');

    try {
      if (ext === '.json') {
        const parsed = JSON.parse(content);
        return { success: true, data: Array.isArray(parsed) ? parsed : [parsed] };
      } else if (ext === '.jsonl' || ext === '.ndjson') {
        const lines = content.split('\n').filter(l => l.trim());
        return { success: true, data: lines.map(l => JSON.parse(l)) };
      } else if (ext === '.csv') {
        return { success: true, data: this.parseCSV(content) };
      } else {
        return { success: false, error: `Unsupported file type: ${ext}` };
      }
    } catch (error) {
      return { success: false, error: `Parse error: ${getErrorMessage(error)}` };
    }
  }

  private parseCSV(content: string): Record<string, unknown>[] {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return [];

    const headers = this.parseCSVLine(lines[0]);
    const data: Record<string, unknown>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      const row: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        const val = values[j];
        const num = Number(val);
        row[headers[j]] = !isNaN(num) && val !== '' ? num : val;
      }
      data.push(row);
    }

    return data;
  }

  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          values.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }
    values.push(current);

    return values;
  }

  private fileToTableName(filePath: string): string {
    return basename(filePath)
      .replace(extname(filePath), '')
      .replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private inferColumns(data: unknown[]): Array<{ name: string; type: string; nullable: boolean }> {
    if (data.length === 0) return [];

    const firstRow = data[0] as Record<string, unknown>;
    return Object.entries(firstRow).map(([name, value]) => ({
      name,
      type: this.inferType(value),
      nullable: data.some(r => {
        const v = (r as Record<string, unknown>)[name];
        return v === null || v === undefined || v === '';
      }),
    }));
  }

  private inferType(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return 'NUMBER';
    if (typeof value === 'boolean') return 'BOOLEAN';
    if (!isNaN(Number(value))) return 'NUMBER';
    if (!isNaN(Date.parse(String(value)))) return 'DATE';
    return 'TEXT';
  }

  private escapeCSV(value: unknown): string {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  // ============================================================================
  // Formatting
  // ============================================================================

  private formatQueryResult(result: SQLQueryResult): string {
    if (result.rowCount === 0) {
      return 'Query returned 0 rows';
    }

    const lines: string[] = [];

    // Calculate column widths
    const widths = result.columns.map((col, i) => {
      const maxDataWidth = Math.max(
        ...result.rows.map(row => String(row[i] ?? '').length)
      );
      return Math.min(Math.max(col.length, maxDataWidth), 30);
    });

    // Header
    const header = result.columns.map((col, i) => col.slice(0, widths[i]).padEnd(widths[i])).join(' │ ');
    const separator = widths.map(w => '─'.repeat(w)).join('─┼─');

    lines.push(header);
    lines.push(separator);

    // Rows (limit to 20)
    const displayRows = result.rows.slice(0, 20);
    for (const row of displayRows) {
      const formatted = row.map((val, i) =>
        String(val ?? '').slice(0, widths[i]).padEnd(widths[i])
      ).join(' │ ');
      lines.push(formatted);
    }

    if (result.rowCount > 20) {
      lines.push(`... and ${result.rowCount - 20} more rows`);
    }

    lines.push('');
    lines.push(`${result.rowCount} rows in ${result.duration}ms`);

    return lines.join('\n');
  }

  private formatSchema(schema: SQLTableInfo): string {
    const lines: string[] = [
      `Table: ${schema.name}`,
      `Rows: ${schema.rowCount}`,
      '─'.repeat(50),
      'Column'.padEnd(25) + 'Type'.padEnd(15) + 'Nullable',
      '─'.repeat(50),
    ];

    for (const col of schema.columns) {
      lines.push(
        col.name.padEnd(25) +
        col.type.padEnd(15) +
        (col.nullable ? 'YES' : 'NO')
      );
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Factory
// ============================================================================

let sqlAgentInstance: SQLAgent | null = null;

export function getSQLAgent(): SQLAgent {
  if (!sqlAgentInstance) {
    sqlAgentInstance = new SQLAgent();
  }
  return sqlAgentInstance;
}

export async function createSQLAgent(): Promise<SQLAgent> {
  const agent = getSQLAgent();
  if (!agent.isReady()) {
    await agent.initialize();
  }
  return agent;
}
