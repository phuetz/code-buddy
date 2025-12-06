/**
 * Data Analysis Agent
 *
 * Specialized agent for analyzing and transforming structured data.
 * Works with JSON, CSV, and in-memory data structures.
 */

import { existsSync, readFileSync } from 'fs';
import { extname } from 'path';
import {
  SpecializedAgent,
  SpecializedAgentConfig,
  AgentTask,
  AgentResult,
  DataColumn,
  DataStats,
  DataTransformOperation,
} from './types.js';
import { getErrorMessage } from '../../types/index.js';

// ============================================================================
// Configuration
// ============================================================================

const DATA_ANALYSIS_AGENT_CONFIG: SpecializedAgentConfig = {
  id: 'data-analysis-agent',
  name: 'Data Analysis Agent',
  description: 'Analyze, transform, and visualize structured data',
  capabilities: ['data-transform', 'data-visualize'],
  fileExtensions: ['json', 'csv', 'jsonl', 'ndjson'],
  maxFileSize: 200 * 1024 * 1024, // 200MB
  requiredTools: [],
};

// ============================================================================
// Data Analysis Agent Implementation
// ============================================================================

export class DataAnalysisAgent extends SpecializedAgent {
  constructor() {
    super(DATA_ANALYSIS_AGENT_CONFIG);
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
    this.emit('initialized');
  }

  getSupportedActions(): string[] {
    return [
      'analyze',
      'transform',
      'aggregate',
      'pivot',
      'join',
      'sort',
      'filter',
      'select',
      'describe',
      'correlate',
      'histogram',
      'group',
    ];
  }

  getActionHelp(action: string): string {
    const help: Record<string, string> = {
      analyze: 'Get comprehensive statistics about the data',
      transform: 'Apply transformation pipeline to data',
      aggregate: 'Aggregate data by groups (sum, avg, count, etc.)',
      pivot: 'Pivot data from long to wide format',
      join: 'Join two datasets on a common key',
      sort: 'Sort data by one or more columns',
      filter: 'Filter rows based on conditions',
      select: 'Select specific columns',
      describe: 'Get descriptive statistics for numeric columns',
      correlate: 'Calculate correlation matrix',
      histogram: 'Generate histogram data for a column',
      group: 'Group by one or more columns',
    };
    return help[action] || `Unknown action: ${action}`;
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // Load data
      let data: unknown[];
      if (task.data) {
        data = Array.isArray(task.data) ? task.data : [task.data];
      } else if (task.inputFiles && task.inputFiles.length > 0) {
        const loadResult = this.loadData(task.inputFiles[0]);
        if (!loadResult.success) {
          return loadResult;
        }
        data = loadResult.data as unknown[];
      } else {
        return { success: false, error: 'No data or input file provided' };
      }

      switch (task.action) {
        case 'analyze':
          return this.analyzeData(data, startTime);
        case 'describe':
          return this.describeData(data, startTime);
        case 'transform':
          return this.transformData(data, task.params?.operations as DataTransformOperation[], startTime);
        case 'aggregate':
          return this.aggregateData(data, task.params, startTime);
        case 'pivot':
          return this.pivotData(data, task.params, startTime);
        case 'join':
          return await this.joinData(data, task, startTime);
        case 'sort':
          return this.sortData(data, task.params, startTime);
        case 'filter':
          return this.filterData(data, task.params, startTime);
        case 'select':
          return this.selectColumns(data, task.params?.columns as string[], startTime);
        case 'correlate':
          return this.correlateData(data, startTime);
        case 'histogram':
          return this.histogramData(data, task.params?.column as string, task.params?.bins as number, startTime);
        case 'group':
          return this.groupData(data, task.params?.by as string[], startTime);
        default:
          return { success: false, error: `Unknown action: ${task.action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: `Data analysis error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  // ============================================================================
  // Actions
  // ============================================================================

  private analyzeData(data: unknown[], startTime: number): AgentResult {
    if (data.length === 0) {
      return { success: true, data: { rowCount: 0 }, output: 'Empty dataset' };
    }

    const firstRow = data[0] as Record<string, unknown>;
    const columns = Object.keys(firstRow);

    const columnStats: DataColumn[] = columns.map(col => {
      const values = data.map(row => (row as Record<string, unknown>)[col]);
      return this.analyzeColumn(col, values);
    });

    const stats: DataStats = {
      rowCount: data.length,
      columnCount: columns.length,
      columns: columnStats,
      missingValues: {},
    };

    // Calculate missing values
    for (const col of columnStats) {
      const nullCount = data.filter(row => {
        const val = (row as Record<string, unknown>)[col.name];
        return val === null || val === undefined || val === '';
      }).length;
      if (nullCount > 0) {
        stats.missingValues[col.name] = nullCount;
      }
    }

    // Numeric stats
    stats.numericStats = {};
    for (const col of columnStats.filter(c => c.type === 'number')) {
      const values = data
        .map(row => Number((row as Record<string, unknown>)[col.name]))
        .filter(v => !isNaN(v));

      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        stats.numericStats[col.name] = {
          min: Math.min(...values),
          max: Math.max(...values),
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          median: sorted[Math.floor(sorted.length / 2)],
          stdDev: this.stdDev(values),
        };
      }
    }

    return {
      success: true,
      data: stats,
      output: this.formatDataStats(stats),
      duration: Date.now() - startTime,
    };
  }

  private describeData(data: unknown[], startTime: number): AgentResult {
    if (data.length === 0) {
      return { success: true, data: {}, output: 'Empty dataset' };
    }

    const firstRow = data[0] as Record<string, unknown>;
    const columns = Object.keys(firstRow);

    const description: Record<string, any> = {};

    for (const col of columns) {
      const values = data
        .map(row => (row as Record<string, unknown>)[col])
        .filter(v => v !== null && v !== undefined);

      const numericValues = values.filter(v => typeof v === 'number' || !isNaN(Number(v)));

      if (numericValues.length > values.length * 0.5) {
        const nums = numericValues.map(Number).filter(n => !isNaN(n));
        const sorted = [...nums].sort((a, b) => a - b);

        description[col] = {
          count: nums.length,
          mean: nums.reduce((a, b) => a + b, 0) / nums.length,
          std: this.stdDev(nums),
          min: Math.min(...nums),
          '25%': sorted[Math.floor(sorted.length * 0.25)],
          '50%': sorted[Math.floor(sorted.length * 0.5)],
          '75%': sorted[Math.floor(sorted.length * 0.75)],
          max: Math.max(...nums),
        };
      } else {
        description[col] = {
          count: values.length,
          unique: new Set(values.map(String)).size,
          top: this.mode(values.map(String)),
          type: 'categorical',
        };
      }
    }

    return {
      success: true,
      data: description,
      output: this.formatDescription(description),
      duration: Date.now() - startTime,
    };
  }

  private transformData(
    data: unknown[],
    operations: DataTransformOperation[] | undefined,
    startTime: number
  ): AgentResult {
    if (!operations || operations.length === 0) {
      return { success: false, error: 'No transformation operations specified' };
    }

    let result = [...data];

    for (const op of operations) {
      switch (op.type) {
        case 'filter':
          result = this.applyFilter(result, op.params);
          break;
        case 'sort':
          result = this.applySort(result, op.params);
          break;
        case 'select':
          result = this.applySelect(result, op.params.columns as string[]);
          break;
        case 'rename':
          result = this.applyRename(result, op.params.mapping as Record<string, string>);
          break;
        default:
          return { success: false, error: `Unknown transform operation: ${op.type}` };
      }
    }

    return {
      success: true,
      data: result,
      output: `Transformed ${data.length} rows to ${result.length} rows`,
      duration: Date.now() - startTime,
    };
  }

  private aggregateData(
    data: unknown[],
    params: Record<string, unknown> | undefined,
    startTime: number
  ): AgentResult {
    if (!params) {
      return { success: false, error: 'Aggregation parameters required' };
    }

    const groupBy = params.groupBy as string[] | undefined;
    const aggregations = params.aggregations as Record<string, string> | undefined;

    if (!aggregations) {
      return { success: false, error: 'Aggregations required' };
    }

    // Group data
    const groups = new Map<string, unknown[]>();
    for (const row of data) {
      const key = groupBy
        ? groupBy.map(col => String((row as Record<string, unknown>)[col])).join('|')
        : 'all';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(row);
    }

    // Aggregate
    const result: unknown[] = [];
    for (const [key, rows] of groups) {
      const aggregated: Record<string, unknown> = {};

      // Add group keys
      if (groupBy) {
        const keyParts = key.split('|');
        groupBy.forEach((col, i) => {
          aggregated[col] = keyParts[i];
        });
      }

      // Apply aggregations
      for (const [col, func] of Object.entries(aggregations)) {
        const values = rows.map(r => (r as Record<string, unknown>)[col]);
        aggregated[`${col}_${func}`] = this.aggregate(values, func);
      }

      result.push(aggregated);
    }

    return {
      success: true,
      data: result,
      output: `Aggregated ${data.length} rows into ${result.length} groups`,
      duration: Date.now() - startTime,
    };
  }

  private pivotData(
    data: unknown[],
    params: Record<string, unknown> | undefined,
    startTime: number
  ): AgentResult {
    if (!params) {
      return { success: false, error: 'Pivot parameters required' };
    }

    const index = params.index as string;
    const columns = params.columns as string;
    const values = params.values as string;
    const aggFunc = (params.aggFunc as string) || 'first';

    if (!index || !columns || !values) {
      return { success: false, error: 'Pivot requires index, columns, and values parameters' };
    }

    // Get unique column values
    const uniqueCols = [...new Set(data.map(r => String((r as Record<string, unknown>)[columns])))];

    // Group by index
    const groups = new Map<string, Record<string, unknown[]>>();
    for (const row of data) {
      const r = row as Record<string, unknown>;
      const idx = String(r[index]);
      const col = String(r[columns]);
      const val = r[values];

      if (!groups.has(idx)) {
        groups.set(idx, {});
      }
      if (!groups.get(idx)![col]) {
        groups.get(idx)![col] = [];
      }
      groups.get(idx)![col].push(val);
    }

    // Build pivot table
    const result: unknown[] = [];
    for (const [idx, colValues] of groups) {
      const pivoted: Record<string, unknown> = { [index]: idx };
      for (const col of uniqueCols) {
        const vals = colValues[col] || [];
        pivoted[col] = this.aggregate(vals, aggFunc);
      }
      result.push(pivoted);
    }

    return {
      success: true,
      data: result,
      output: `Pivoted data: ${result.length} rows x ${uniqueCols.length + 1} columns`,
      duration: Date.now() - startTime,
    };
  }

  private async joinData(
    data: unknown[],
    task: AgentTask,
    startTime: number
  ): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length < 2) {
      return { success: false, error: 'Join requires a second input file' };
    }

    const rightFile = task.inputFiles[1];
    const loadResult = this.loadData(rightFile);
    if (!loadResult.success) {
      return loadResult;
    }
    const rightData = loadResult.data as unknown[];

    const leftKey = task.params?.leftKey as string;
    const rightKey = task.params?.rightKey as string || leftKey;
    const how = (task.params?.how as string) || 'inner';

    if (!leftKey) {
      return { success: false, error: 'Join key required' };
    }

    // Index right data
    const rightIndex = new Map<string, unknown[]>();
    for (const row of rightData) {
      const key = String((row as Record<string, unknown>)[rightKey]);
      if (!rightIndex.has(key)) {
        rightIndex.set(key, []);
      }
      rightIndex.get(key)!.push(row);
    }

    const result: unknown[] = [];

    for (const leftRow of data) {
      const key = String((leftRow as Record<string, unknown>)[leftKey]);
      const rightRows = rightIndex.get(key);

      if (rightRows) {
        for (const rightRow of rightRows) {
          result.push({ ...leftRow as object, ...rightRow as object });
        }
      } else if (how === 'left' || how === 'outer') {
        result.push(leftRow);
      }
    }

    // Add unmatched right rows for outer join
    if (how === 'outer' || how === 'right') {
      const leftKeys = new Set(data.map(r => String((r as Record<string, unknown>)[leftKey])));
      for (const rightRow of rightData) {
        const key = String((rightRow as Record<string, unknown>)[rightKey]);
        if (!leftKeys.has(key)) {
          result.push(rightRow);
        }
      }
    }

    return {
      success: true,
      data: result,
      output: `Joined ${data.length} + ${rightData.length} rows into ${result.length} rows`,
      duration: Date.now() - startTime,
    };
  }

  private sortData(
    data: unknown[],
    params: Record<string, unknown> | undefined,
    startTime: number
  ): AgentResult {
    const result = this.applySort(data, params || {});
    return {
      success: true,
      data: result,
      output: `Sorted ${result.length} rows`,
      duration: Date.now() - startTime,
    };
  }

  private filterData(
    data: unknown[],
    params: Record<string, unknown> | undefined,
    startTime: number
  ): AgentResult {
    const result = this.applyFilter(data, params || {});
    return {
      success: true,
      data: result,
      output: `Filtered ${data.length} rows to ${result.length} rows`,
      duration: Date.now() - startTime,
    };
  }

  private selectColumns(data: unknown[], columns: string[] | undefined, startTime: number): AgentResult {
    if (!columns || columns.length === 0) {
      return { success: false, error: 'Columns to select required' };
    }

    const result = this.applySelect(data, columns);
    return {
      success: true,
      data: result,
      output: `Selected ${columns.length} columns from ${data.length} rows`,
      duration: Date.now() - startTime,
    };
  }

  private correlateData(data: unknown[], startTime: number): AgentResult {
    if (data.length === 0) {
      return { success: true, data: {}, output: 'Empty dataset' };
    }

    const firstRow = data[0] as Record<string, unknown>;
    const numericCols = Object.keys(firstRow).filter(col => {
      const values = data.map(r => (r as Record<string, unknown>)[col]);
      return values.filter(v => typeof v === 'number' || !isNaN(Number(v))).length > data.length * 0.5;
    });

    const correlations: Record<string, Record<string, number>> = {};

    for (const col1 of numericCols) {
      correlations[col1] = {};
      const x = data.map(r => Number((r as Record<string, unknown>)[col1])).filter(n => !isNaN(n));

      for (const col2 of numericCols) {
        const y = data.map(r => Number((r as Record<string, unknown>)[col2])).filter(n => !isNaN(n));
        correlations[col1][col2] = this.pearsonCorrelation(x, y);
      }
    }

    return {
      success: true,
      data: correlations,
      output: this.formatCorrelationMatrix(correlations),
      duration: Date.now() - startTime,
    };
  }

  private histogramData(
    data: unknown[],
    column: string | undefined,
    bins: number | undefined,
    startTime: number
  ): AgentResult {
    if (!column) {
      return { success: false, error: 'Column required for histogram' };
    }

    const values = data
      .map(r => Number((r as Record<string, unknown>)[column]))
      .filter(n => !isNaN(n));

    if (values.length === 0) {
      return { success: false, error: `No numeric values in column: ${column}` };
    }

    const numBins = bins || 10;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const binWidth = (max - min) / numBins;

    const histogram: Array<{ bin: string; count: number; percentage: number }> = [];
    const counts = new Array(numBins).fill(0);

    for (const val of values) {
      const binIndex = Math.min(Math.floor((val - min) / binWidth), numBins - 1);
      counts[binIndex]++;
    }

    for (let i = 0; i < numBins; i++) {
      const binStart = min + i * binWidth;
      const binEnd = min + (i + 1) * binWidth;
      histogram.push({
        bin: `${binStart.toFixed(2)} - ${binEnd.toFixed(2)}`,
        count: counts[i],
        percentage: (counts[i] / values.length) * 100,
      });
    }

    return {
      success: true,
      data: histogram,
      output: this.formatHistogram(histogram, column),
      duration: Date.now() - startTime,
    };
  }

  private groupData(data: unknown[], by: string[] | undefined, startTime: number): AgentResult {
    if (!by || by.length === 0) {
      return { success: false, error: 'Group by columns required' };
    }

    const groups = new Map<string, unknown[]>();
    for (const row of data) {
      const key = by.map(col => String((row as Record<string, unknown>)[col])).join('|');
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(row);
    }

    const result = [...groups.entries()].map(([key, rows]) => ({
      key,
      count: rows.length,
      sample: rows[0],
    }));

    return {
      success: true,
      data: result,
      output: `Grouped ${data.length} rows into ${result.length} groups`,
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private loadData(filePath: string): AgentResult {
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
        // Try to convert to number
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

  private analyzeColumn(name: string, values: unknown[]): DataColumn {
    const types = new Set<string>();
    let nullable = false;

    for (const v of values) {
      if (v === null || v === undefined || v === '') {
        nullable = true;
        continue;
      }
      if (typeof v === 'number') types.add('number');
      else if (typeof v === 'boolean') types.add('boolean');
      else if (!isNaN(Number(v))) types.add('number');
      else types.add('string');
    }

    let type: DataColumn['type'] = 'null';
    if (types.size === 1) type = [...types][0] as DataColumn['type'];
    else if (types.size > 1) type = 'mixed';

    return {
      name,
      type,
      nullable,
      uniqueCount: new Set(values.map(String)).size,
      sampleValues: values.slice(0, 3),
    };
  }

  private applyFilter(data: unknown[], params: Record<string, unknown>): unknown[] {
    const column = params.column as string;
    const operator = (params.operator as string) || '==';
    const value = params.value;

    if (!column) return data;

    return data.filter(row => {
      const cellValue = (row as Record<string, unknown>)[column];
      switch (operator) {
        case '==': return cellValue == value;
        case '!=': return cellValue != value;
        case '>': return Number(cellValue) > Number(value);
        case '<': return Number(cellValue) < Number(value);
        case '>=': return Number(cellValue) >= Number(value);
        case '<=': return Number(cellValue) <= Number(value);
        case 'contains': return String(cellValue).includes(String(value));
        case 'in': return (value as unknown[]).includes(cellValue);
        default: return cellValue == value;
      }
    });
  }

  private applySort(data: unknown[], params: Record<string, unknown>): unknown[] {
    const column = params.column as string || params.by as string;
    const ascending = params.ascending !== false;

    if (!column) return data;

    return [...data].sort((a, b) => {
      const va = (a as Record<string, unknown>)[column];
      const vb = (b as Record<string, unknown>)[column];
      let cmp = 0;

      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb));
      }

      return ascending ? cmp : -cmp;
    });
  }

  private applySelect(data: unknown[], columns: string[]): unknown[] {
    return data.map(row => {
      const selected: Record<string, unknown> = {};
      for (const col of columns) {
        selected[col] = (row as Record<string, unknown>)[col];
      }
      return selected;
    });
  }

  private applyRename(data: unknown[], mapping: Record<string, string>): unknown[] {
    return data.map(row => {
      const renamed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        renamed[mapping[key] || key] = value;
      }
      return renamed;
    });
  }

  private aggregate(values: unknown[], func: string): unknown {
    const nums = values.filter(v => typeof v === 'number' || !isNaN(Number(v))).map(Number);

    switch (func) {
      case 'sum': return nums.reduce((a, b) => a + b, 0);
      case 'avg':
      case 'mean': return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      case 'min': return nums.length > 0 ? Math.min(...nums) : null;
      case 'max': return nums.length > 0 ? Math.max(...nums) : null;
      case 'count': return values.length;
      case 'first': return values[0];
      case 'last': return values[values.length - 1];
      case 'unique': return new Set(values.map(String)).size;
      default: return values[0];
    }
  }

  private stdDev(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(v => (v - mean) ** 2);
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  private mode(values: string[]): string {
    const counts = new Map<string, number>();
    for (const v of values) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    let maxCount = 0;
    let mode = '';
    for (const [v, c] of counts) {
      if (c > maxCount) {
        maxCount = c;
        mode = v;
      }
    }
    return mode;
  }

  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;

    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let denX = 0;
    let denY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  // ============================================================================
  // Formatting
  // ============================================================================

  private formatDataStats(stats: DataStats): string {
    const lines: string[] = [
      '┌─────────────────────────────────────────────────────┐',
      '│              DATA ANALYSIS                          │',
      '├─────────────────────────────────────────────────────┤',
      `│ Rows: ${String(stats.rowCount).padEnd(20)} Columns: ${String(stats.columnCount).padEnd(15)}│`,
      '├─────────────────────────────────────────────────────┤',
    ];

    for (const col of stats.columns) {
      lines.push(`│ ${col.name.slice(0, 20).padEnd(20)} │ ${col.type.padEnd(8)} │ ${String(col.uniqueCount).padEnd(8)} unique │`);
    }

    if (stats.numericStats && Object.keys(stats.numericStats).length > 0) {
      lines.push('├─────────────────────────────────────────────────────┤');
      lines.push('│ Numeric Statistics:                                 │');
      for (const [col, s] of Object.entries(stats.numericStats)) {
        lines.push(`│ ${col.slice(0, 15).padEnd(15)}: min=${s.min.toFixed(1).padEnd(8)} max=${s.max.toFixed(1).padEnd(8)} mean=${s.mean.toFixed(1)}│`);
      }
    }

    lines.push('└─────────────────────────────────────────────────────┘');
    return lines.join('\n');
  }

  private formatDescription(desc: Record<string, any>): string {
    const lines: string[] = ['Data Description:', '─'.repeat(50)];
    for (const [col, stats] of Object.entries(desc)) {
      lines.push(`\n${col}:`);
      for (const [key, val] of Object.entries(stats)) {
        const formatted = typeof val === 'number' ? val.toFixed(2) : String(val);
        lines.push(`  ${key}: ${formatted}`);
      }
    }
    return lines.join('\n');
  }

  private formatCorrelationMatrix(corr: Record<string, Record<string, number>>): string {
    const cols = Object.keys(corr);
    const lines: string[] = ['Correlation Matrix:', '─'.repeat(cols.length * 10 + 15)];

    // Header
    lines.push('           ' + cols.map(c => c.slice(0, 8).padEnd(8)).join(' '));

    // Rows
    for (const col1 of cols) {
      const values = cols.map(col2 => corr[col1][col2].toFixed(2).padEnd(8));
      lines.push(`${col1.slice(0, 10).padEnd(10)} ${values.join(' ')}`);
    }

    return lines.join('\n');
  }

  private formatHistogram(hist: Array<{ bin: string; count: number; percentage: number }>, column: string): string {
    const maxCount = Math.max(...hist.map(h => h.count));
    const barWidth = 30;

    const lines: string[] = [
      `Histogram for: ${column}`,
      '─'.repeat(60),
    ];

    for (const h of hist) {
      const barLength = Math.round((h.count / maxCount) * barWidth);
      const bar = '█'.repeat(barLength) + '░'.repeat(barWidth - barLength);
      lines.push(`${h.bin.padEnd(20)} ${bar} ${h.count} (${h.percentage.toFixed(1)}%)`);
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Factory
// ============================================================================

let dataAnalysisAgentInstance: DataAnalysisAgent | null = null;

export function getDataAnalysisAgent(): DataAnalysisAgent {
  if (!dataAnalysisAgentInstance) {
    dataAnalysisAgentInstance = new DataAnalysisAgent();
  }
  return dataAnalysisAgentInstance;
}

export async function createDataAnalysisAgent(): Promise<DataAnalysisAgent> {
  const agent = getDataAnalysisAgent();
  if (!agent.isReady()) {
    await agent.initialize();
  }
  return agent;
}
