/**
 * Excel Agent
 *
 * Specialized agent for Excel and CSV file manipulation.
 * Uses xlsx library for Excel files and built-in parsing for CSV.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, extname } from 'path';
import {
  SpecializedAgent,
  SpecializedAgentConfig,
  AgentTask,
  AgentResult,
  ExcelSheet,
  ExcelWorkbook,
  ExcelWriteOptions,
} from './types.js';

// ============================================================================
// Configuration
// ============================================================================

const EXCEL_AGENT_CONFIG: SpecializedAgentConfig = {
  id: 'excel-agent',
  name: 'Excel Agent',
  description: 'Read, write, and manipulate Excel and CSV files',
  capabilities: ['excel-read', 'excel-write', 'csv-parse'],
  fileExtensions: ['xlsx', 'xls', 'csv', 'tsv'],
  maxFileSize: 100 * 1024 * 1024, // 100MB
  requiredTools: [],
};

// ============================================================================
// CSV Parser
// ============================================================================

function parseCSV(content: string, delimiter: string = ','): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentCell);
        currentCell = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        if (char === '\r') i++; // Skip \n
      } else if (char !== '\r') {
        currentCell += char;
      }
    }
  }

  // Handle last cell/row
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

function formatCSV(data: unknown[][], delimiter: string = ','): string {
  return data.map(row =>
    row.map(cell => {
      const str = String(cell ?? '');
      if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(delimiter)
  ).join('\n');
}

// ============================================================================
// Excel Agent Implementation
// ============================================================================

export class ExcelAgent extends SpecializedAgent {
  private xlsx: any = null;

  constructor() {
    super(EXCEL_AGENT_CONFIG);
  }

  async initialize(): Promise<void> {
    try {
      // Dynamic import of xlsx
      // @ts-expect-error - Optional dependency
      const xlsxModule = await import('xlsx');
      this.xlsx = xlsxModule.default || xlsxModule;
      this.isInitialized = true;
      this.emit('initialized');
    } catch (_error) {
      // xlsx not available, CSV-only mode
      this.isInitialized = true;
      this.emit('initialized', { warning: 'xlsx not available, CSV-only mode' });
    }
  }

  getSupportedActions(): string[] {
    return ['read', 'write', 'sheets', 'convert', 'filter', 'stats', 'merge'];
  }

  getActionHelp(action: string): string {
    const help: Record<string, string> = {
      read: 'Read data from Excel/CSV file',
      write: 'Write data to Excel/CSV file',
      sheets: 'List all sheets in an Excel workbook',
      convert: 'Convert between Excel and CSV formats',
      filter: 'Filter rows based on conditions',
      stats: 'Get statistics about the data',
      merge: 'Merge multiple files',
    };
    return help[action] || `Unknown action: ${action}`;
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      switch (task.action) {
        case 'read':
          return await this.readFile(task, startTime);
        case 'write':
          return await this.writeFile(task, startTime);
        case 'sheets':
          return await this.listSheets(task, startTime);
        case 'convert':
          return await this.convertFile(task, startTime);
        case 'filter':
          return await this.filterData(task, startTime);
        case 'stats':
          return await this.getStats(task, startTime);
        case 'merge':
          return await this.mergeFiles(task, startTime);
        default:
          return {
            success: false,
            error: `Unknown action: ${task.action}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Excel processing error: ${error.message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  private async readFile(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No input file specified' };
    }

    const filePath = task.inputFiles[0];
    if (!existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const ext = extname(filePath).toLowerCase();
    const sheetName = task.params?.sheet as string | undefined;
    const limit = task.params?.limit as number | undefined;

    let workbook: ExcelWorkbook;

    if (ext === '.csv' || ext === '.tsv') {
      workbook = this.readCSVFile(filePath, ext === '.tsv' ? '\t' : ',');
    } else if (this.xlsx) {
      workbook = this.readExcelFile(filePath);
    } else {
      return {
        success: false,
        error: 'xlsx library not available. Install with: npm install xlsx',
      };
    }

    // Get specific sheet or first
    let sheet = sheetName
      ? workbook.sheets.find(s => s.name === sheetName)
      : workbook.sheets[0];

    if (!sheet) {
      return {
        success: false,
        error: sheetName ? `Sheet not found: ${sheetName}` : 'No sheets in workbook',
      };
    }

    // Apply limit
    if (limit && limit > 0) {
      sheet = {
        ...sheet,
        data: sheet.data.slice(0, limit + 1), // +1 for header
        rowCount: Math.min(sheet.rowCount, limit + 1),
      };
    }

    return {
      success: true,
      data: { workbook, sheet },
      output: this.formatSheetPreview(sheet),
      duration: Date.now() - startTime,
      metadata: {
        filename: basename(filePath),
        sheetCount: workbook.sheets.length,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
      },
    };
  }

  private async writeFile(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.outputFile) {
      return { success: false, error: 'No output file specified' };
    }

    const data = task.data as unknown[][] | undefined;
    if (!data || !Array.isArray(data)) {
      return { success: false, error: 'No data to write' };
    }

    const ext = extname(task.outputFile).toLowerCase();
    const options = task.params as ExcelWriteOptions | undefined;

    if (ext === '.csv' || ext === '.tsv') {
      const delimiter = ext === '.tsv' ? '\t' : ',';
      const content = formatCSV(data, delimiter);
      writeFileSync(task.outputFile, content, 'utf-8');
    } else if (this.xlsx) {
      const wb = this.xlsx.utils.book_new();
      const ws = this.xlsx.utils.aoa_to_sheet(data);

      if (options?.autoWidth) {
        ws['!cols'] = this.calculateColumnWidths(data);
      }

      if (options?.freezeHeader) {
        ws['!freeze'] = { xSplit: 0, ySplit: 1 };
      }

      this.xlsx.utils.book_append_sheet(wb, ws, options?.sheetName || 'Sheet1');
      this.xlsx.writeFile(wb, task.outputFile);
    } else {
      return {
        success: false,
        error: 'xlsx library not available for Excel output. Use .csv extension.',
      };
    }

    return {
      success: true,
      outputFile: task.outputFile,
      output: `Written ${data.length} rows to ${task.outputFile}`,
      duration: Date.now() - startTime,
    };
  }

  private async listSheets(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No input file specified' };
    }

    const filePath = task.inputFiles[0];
    if (!existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const ext = extname(filePath).toLowerCase();

    if (ext === '.csv' || ext === '.tsv') {
      return {
        success: true,
        data: [{ name: 'Sheet1', index: 0 }],
        output: 'CSV files have a single implicit sheet',
        duration: Date.now() - startTime,
      };
    }

    if (!this.xlsx) {
      return { success: false, error: 'xlsx library not available' };
    }

    const workbook = this.readExcelFile(filePath);
    const sheets = workbook.sheets.map(s => ({
      name: s.name,
      index: s.index,
      rows: s.rowCount,
      columns: s.columnCount,
    }));

    const output = sheets.map(s => `  ${s.index + 1}. ${s.name} (${s.rows} rows, ${s.columns} cols)`).join('\n');

    return {
      success: true,
      data: sheets,
      output: `Sheets in ${basename(filePath)}:\n${output}`,
      duration: Date.now() - startTime,
    };
  }

  private async convertFile(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No input file specified' };
    }

    if (!task.outputFile) {
      return { success: false, error: 'No output file specified' };
    }

    const inputFile = task.inputFiles[0];
    const inputExt = extname(inputFile).toLowerCase();
    const outputExt = extname(task.outputFile).toLowerCase();

    // Read input
    const readResult = await this.readFile({ action: 'read', inputFiles: [inputFile] }, startTime);
    if (!readResult.success) {
      return readResult;
    }

    const { sheet } = readResult.data as { workbook: ExcelWorkbook; sheet: ExcelSheet };

    // Write output
    return await this.writeFile(
      { action: 'write', outputFile: task.outputFile, data: sheet.data },
      startTime
    );
  }

  private async filterData(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No input file specified' };
    }

    const readResult = await this.readFile({ action: 'read', inputFiles: task.inputFiles }, startTime);
    if (!readResult.success) {
      return readResult;
    }

    const { sheet } = readResult.data as { workbook: ExcelWorkbook; sheet: ExcelSheet };
    const column = task.params?.column as string | number;
    const operator = task.params?.operator as string || '==';
    const value = task.params?.value;

    if (column === undefined || value === undefined) {
      return { success: false, error: 'Filter requires column and value parameters' };
    }

    // Find column index
    const headers = sheet.data[0] as string[];
    const colIndex = typeof column === 'number' ? column : headers.indexOf(column);

    if (colIndex < 0) {
      return { success: false, error: `Column not found: ${column}` };
    }

    // Filter rows
    const filteredData: unknown[][] = [headers];
    for (let i = 1; i < sheet.data.length; i++) {
      const row = sheet.data[i];
      const cellValue = row[colIndex];

      let matches = false;
      switch (operator) {
        case '==': matches = cellValue == value; break;
        case '!=': matches = cellValue != value; break;
        case '>': matches = Number(cellValue) > Number(value); break;
        case '<': matches = Number(cellValue) < Number(value); break;
        case '>=': matches = Number(cellValue) >= Number(value); break;
        case '<=': matches = Number(cellValue) <= Number(value); break;
        case 'contains': matches = String(cellValue).includes(String(value)); break;
        case 'startsWith': matches = String(cellValue).startsWith(String(value)); break;
        case 'endsWith': matches = String(cellValue).endsWith(String(value)); break;
        default: matches = cellValue == value;
      }

      if (matches) {
        filteredData.push(row);
      }
    }

    const filteredSheet: ExcelSheet = {
      ...sheet,
      data: filteredData,
      rowCount: filteredData.length,
    };

    return {
      success: true,
      data: filteredSheet,
      output: `Filtered ${sheet.rowCount - 1} rows to ${filteredData.length - 1} rows`,
      duration: Date.now() - startTime,
    };
  }

  private async getStats(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No input file specified' };
    }

    const readResult = await this.readFile({ action: 'read', inputFiles: task.inputFiles }, startTime);
    if (!readResult.success) {
      return readResult;
    }

    const { sheet } = readResult.data as { workbook: ExcelWorkbook; sheet: ExcelSheet };
    const headers = sheet.data[0] as string[];

    // Calculate stats per column
    const columnStats: Record<string, any> = {};

    for (let col = 0; col < headers.length; col++) {
      const values: unknown[] = [];
      for (let row = 1; row < sheet.data.length; row++) {
        values.push(sheet.data[row][col]);
      }

      const numericValues = values.filter(v => typeof v === 'number' || !isNaN(Number(v)));
      const nullCount = values.filter(v => v === null || v === undefined || v === '').length;

      const stats: any = {
        type: this.inferType(values),
        count: values.length,
        nullCount,
        uniqueCount: new Set(values.map(String)).size,
      };

      if (numericValues.length > values.length * 0.5) {
        const nums = numericValues.map(Number).filter(n => !isNaN(n));
        if (nums.length > 0) {
          stats.min = Math.min(...nums);
          stats.max = Math.max(...nums);
          stats.sum = nums.reduce((a, b) => a + b, 0);
          stats.mean = stats.sum / nums.length;
        }
      }

      columnStats[headers[col]] = stats;
    }

    return {
      success: true,
      data: {
        rowCount: sheet.rowCount - 1,
        columnCount: sheet.columnCount,
        columns: columnStats,
      },
      output: this.formatStats(columnStats, sheet.rowCount - 1),
      duration: Date.now() - startTime,
    };
  }

  private async mergeFiles(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length < 2) {
      return { success: false, error: 'At least 2 input files required for merge' };
    }

    if (!task.outputFile) {
      return { success: false, error: 'No output file specified' };
    }

    const allData: unknown[][] = [];
    let headers: unknown[] | null = null;

    for (const file of task.inputFiles) {
      const readResult = await this.readFile({ action: 'read', inputFiles: [file] }, startTime);
      if (!readResult.success) {
        return { ...readResult, error: `Failed to read ${file}: ${readResult.error}` };
      }

      const { sheet } = readResult.data as { workbook: ExcelWorkbook; sheet: ExcelSheet };

      if (!headers) {
        headers = sheet.data[0];
        allData.push(headers);
      }

      // Add rows (skip header if not first file)
      for (let i = 1; i < sheet.data.length; i++) {
        allData.push(sheet.data[i]);
      }
    }

    return await this.writeFile(
      { action: 'write', outputFile: task.outputFile, data: allData },
      startTime
    );
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private readCSVFile(filePath: string, delimiter: string): ExcelWorkbook {
    const content = readFileSync(filePath, 'utf-8');
    const data = parseCSV(content, delimiter);
    const headers = data[0]?.map(String) || [];

    const sheet: ExcelSheet = {
      name: 'Sheet1',
      index: 0,
      rowCount: data.length,
      columnCount: headers.length,
      data,
      headers,
    };

    return {
      filename: basename(filePath),
      sheets: [sheet],
      sheetNames: ['Sheet1'],
    };
  }

  private readExcelFile(filePath: string): ExcelWorkbook {
    const buffer = readFileSync(filePath);
    const wb = this.xlsx.read(buffer, { type: 'buffer' });

    const sheets: ExcelSheet[] = wb.SheetNames.map((name: string, index: number) => {
      const ws = wb.Sheets[name];
      const data = this.xlsx.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
      const headers = data[0]?.map(String) || [];

      return {
        name,
        index,
        rowCount: data.length,
        columnCount: headers.length,
        data,
        headers,
      };
    });

    return {
      filename: basename(filePath),
      sheets,
      sheetNames: wb.SheetNames,
      metadata: {
        creator: wb.Props?.Creator,
        lastModifiedBy: wb.Props?.LastAuthor,
        created: wb.Props?.CreatedDate,
        modified: wb.Props?.ModifiedDate,
      },
    };
  }

  private calculateColumnWidths(data: unknown[][]): any[] {
    const widths: number[] = [];
    for (const row of data) {
      for (let i = 0; i < row.length; i++) {
        const len = String(row[i] ?? '').length;
        widths[i] = Math.max(widths[i] || 0, Math.min(len, 50));
      }
    }
    return widths.map(w => ({ wch: w + 2 }));
  }

  private formatSheetPreview(sheet: ExcelSheet): string {
    const lines: string[] = [
      `Sheet: ${sheet.name} (${sheet.rowCount} rows, ${sheet.columnCount} cols)`,
      '─'.repeat(60),
    ];

    // Headers
    if (sheet.headers && sheet.headers.length > 0) {
      lines.push(sheet.headers.slice(0, 6).join(' | ') + (sheet.headers.length > 6 ? ' ...' : ''));
      lines.push('─'.repeat(60));
    }

    // First 5 rows
    for (let i = 1; i < Math.min(6, sheet.data.length); i++) {
      const row = sheet.data[i];
      const formatted = (row as unknown[]).slice(0, 6).map(c => String(c ?? '').slice(0, 15)).join(' | ');
      lines.push(formatted + (row.length > 6 ? ' ...' : ''));
    }

    if (sheet.data.length > 6) {
      lines.push(`... and ${sheet.data.length - 6} more rows`);
    }

    return lines.join('\n');
  }

  private formatStats(stats: Record<string, any>, rowCount: number): string {
    const lines: string[] = [
      '┌─────────────────────────────────────────────────────┐',
      '│              DATA STATISTICS                        │',
      '├─────────────────────────────────────────────────────┤',
      `│ Total Rows: ${String(rowCount).padEnd(40)}│`,
      '├─────────────────────────────────────────────────────┤',
    ];

    for (const [col, s] of Object.entries(stats)) {
      lines.push(`│ ${col.slice(0, 20).padEnd(20)} │ ${s.type.padEnd(10)} │ ${String(s.uniqueCount).padEnd(8)} unique │`);
      if (s.mean !== undefined) {
        lines.push(`│   min: ${String(s.min.toFixed(2)).padEnd(12)} max: ${String(s.max.toFixed(2)).padEnd(12)} mean: ${s.mean.toFixed(2).padEnd(10)}│`);
      }
    }

    lines.push('└─────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }

  private inferType(values: unknown[]): string {
    const types = new Set<string>();
    for (const v of values) {
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'number') types.add('number');
      else if (typeof v === 'boolean') types.add('boolean');
      else if (!isNaN(Number(v))) types.add('number');
      else if (!isNaN(Date.parse(String(v)))) types.add('date');
      else types.add('string');
    }
    if (types.size === 0) return 'null';
    if (types.size === 1) return [...types][0];
    return 'mixed';
  }
}

// ============================================================================
// Factory
// ============================================================================

let excelAgentInstance: ExcelAgent | null = null;

export function getExcelAgent(): ExcelAgent {
  if (!excelAgentInstance) {
    excelAgentInstance = new ExcelAgent();
  }
  return excelAgentInstance;
}

export async function createExcelAgent(): Promise<ExcelAgent> {
  const agent = getExcelAgent();
  if (!agent.isReady()) {
    await agent.initialize();
  }
  return agent;
}
