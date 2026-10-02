import { resolveToolPath, getToolWorkingDirectory } from '../utils/tool-execution-context.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolResult } from '../types/index.js';
import { checkSecretFileAccess, formatSecretRefusal } from '../security/secret-files.js';
import { inferColumnTypes, numericStats, parseCsv } from './csv/csv-parse.js';

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const DEFAULT_PREVIEW_ROWS = 5;
const MAX_PREVIEW_ROWS = 50;

export interface CsvAnalyzeArgs {
  path: string;
  delimiter?: string;
  maxPreview?: number;
}

export class CsvAnalyzeTool {
  readonly name = 'csv_analyze';
  readonly description = 'Read-only deterministic CSV analysis: dimensions, inferred column types, numeric stats, and preview.';

  async execute(args: CsvAnalyzeArgs): Promise<ToolResult> {
    try {
      const filePath = await resolveReadableCsvPath(args.path);
      const delimiter = args.delimiter ?? ',';
      const maxPreview = clampPreview(args.maxPreview);
      const buffer = await fs.readFile(resolveToolPath(filePath));

      if (buffer.includes(0)) {
        return { success: false, error: 'Refusing to analyze binary-looking file containing NUL bytes' };
      }

      const rows = parseCsv(buffer.toString('utf8'), delimiter);
      if (rows.length === 0) {
        return { success: false, error: 'CSV is empty' };
      }

      const header = rows[0] ?? [];
      const dataRows = rows.slice(1);
      const columns = inferColumnTypes(rows);
      const output = renderMarkdown(path.basename(filePath), header, dataRows, columns, maxPreview);

      return { success: true, output };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

async function resolveReadableCsvPath(inputPath: string): Promise<string> {
  if (typeof inputPath !== 'string' || inputPath.trim().length === 0) {
    throw new Error('path must be a non-empty string');
  }
  if (inputPath.includes('\0')) {
    throw new Error('path must not contain NUL bytes');
  }

  const resolved = path.resolve(getToolWorkingDirectory(), inputPath);
  const verdict = checkSecretFileAccess(resolved, 'read');
  if (verdict.secret) throw new Error(formatSecretRefusal(resolved, verdict));
  const root = path.parse(resolved).root;
  if (resolved === root || ['/dev', '/proc', '/sys', '/run'].includes(resolved)) {
    throw new Error(`Refusing unsafe path: ${resolved}`);
  }

  const stat = await fs.stat(resolveToolPath(resolved));
  if (!stat.isFile()) {
    throw new Error(`path is not a file: ${resolved}`);
  }
  if (stat.size > MAX_CSV_BYTES) {
    throw new Error(`CSV exceeds ${MAX_CSV_BYTES} byte limit`);
  }

  return resolved;
}

function clampPreview(maxPreview: number | undefined): number {
  if (maxPreview === undefined) {
    return DEFAULT_PREVIEW_ROWS;
  }
  if (!Number.isInteger(maxPreview) || maxPreview < 0) {
    throw new Error('maxPreview must be a non-negative integer');
  }
  return Math.min(maxPreview, MAX_PREVIEW_ROWS);
}

function renderMarkdown(
  filename: string,
  header: string[],
  dataRows: string[][],
  columns: ReturnType<typeof inferColumnTypes>,
  maxPreview: number,
): string {
  const lines: string[] = [];
  lines.push(`# CSV analysis: ${escapeMarkdown(filename)}`);
  lines.push('');
  lines.push(`- Rows: ${dataRows.length}`);
  lines.push(`- Columns: ${header.length}`);
  lines.push('');
  lines.push('## Columns');
  lines.push('| Column | Type | Non-null | Nulls | Min | Max | Mean | Median |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');

  for (const column of columns) {
    const stats = column.type === 'number'
      ? numericStats(dataRows.map((row) => row[column.index] ?? ''))
      : null;
    lines.push([
      `| ${escapeTableCell(column.name)}`,
      column.type,
      String(column.nonNulls),
      String(column.nulls),
      formatNumber(stats?.min),
      formatNumber(stats?.max),
      formatNumber(stats?.mean),
      formatNumber(stats?.median),
    ].join(' | ') + ' |');
  }

  lines.push('');
  lines.push(`## Preview (${Math.min(maxPreview, dataRows.length)} of ${dataRows.length} rows)`);
  if (maxPreview === 0 || dataRows.length === 0) {
    lines.push('_No preview rows._');
    return lines.join('\n');
  }

  lines.push(`| ${header.map((value) => escapeTableCell(value)).join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of dataRows.slice(0, maxPreview)) {
    lines.push(`| ${row.map((value) => escapeTableCell(value)).join(' | ')} |`);
  }

  if (dataRows.length > maxPreview) {
    lines.push(`_Preview truncated: ${dataRows.length - maxPreview} more row(s)._`);
  }

  return lines.join('\n');
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : Number(value.toFixed(6)).toString();
}

function escapeMarkdown(value: string): string {
  return value.replace(/([*_`])/gu, '\\$1');
}

function escapeTableCell(value: string): string {
  return escapeMarkdown(value).replace(/\|/gu, '\\|').replace(/\r?\n/gu, '<br>');
}
