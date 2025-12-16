import React, { useMemo } from 'react';
import { Text, Box } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { highlight } from 'cli-highlight';
import { InkTable } from '../components/ink-table.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Unicode box-drawing characters for tables
const TABLE_CHARS = {
  top: '─',
  'top-mid': '┬',
  'top-left': '┌',
  'top-right': '┐',
  bottom: '─',
  'bottom-mid': '┴',
  'bottom-left': '└',
  'bottom-right': '┘',
  left: '│',
  'left-mid': '├',
  mid: '─',
  'mid-mid': '┼',
  right: '│',
  'right-mid': '┤',
  middle: '│',
};

// ANSI color codes
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  cyan: '\x1b[36m',
  cyanBold: '\x1b[1;36m',
  gray: '\x1b[90m',
  magentaBold: '\x1b[1;35m',
  blueBold: '\x1b[1;34m',
  yellowBold: '\x1b[1;33m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  white: '\x1b[37m',
};

// Configure marked with terminal renderer
marked.setOptions({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TerminalRenderer has incompatible types with marked's Renderer
  renderer: new (TerminalRenderer as unknown as new (options: Record<string, unknown>) => marked.Renderer)({
    // Table options passed to cli-table3
    tableOptions: {
      chars: TABLE_CHARS,
      style: {
        head: ['cyan', 'bold'],
        border: ['gray'],
        'padding-left': 1,
        'padding-right': 1,
      },
      wordWrap: true,
    },
    // Syntax highlighting for code blocks
    code: (code: string, lang?: string) => {
      try {
        return lang
          ? highlight(code, { language: lang, ignoreIllegals: true })
          : highlight(code, { ignoreIllegals: true });
      } catch {
        return code;
      }
    },
    // Inline code styling
    codespan: (text: string) => `${ANSI.cyan}${text}${ANSI.reset}`,
    // Heading styles by level
    heading: (text: string, level: number) => {
      const colors = [
        ANSI.magentaBold,
        ANSI.blueBold,
        ANSI.yellowBold,
        ANSI.blue,
        ANSI.yellow,
        ANSI.white,
      ];
      const color = colors[Math.min(level - 1, colors.length - 1)];
      return `\n${color}${'#'.repeat(level)} ${text}${ANSI.reset}\n`;
    },
    // Text emphasis
    strong: (text: string) => `${ANSI.bold}${text}${ANSI.reset}`,
    em: (text: string) => `${ANSI.italic}${text}${ANSI.reset}`,
  }),
});

// ============================================================================
// TABLE DETECTION & PARSING
// ============================================================================

interface TableData {
  headers: string[];
  rows: Record<string, string>[];
  alignments: ('left' | 'center' | 'right')[];
}

interface TableInfo {
  startLine: number;
  endLine: number;
  isComplete: boolean;
  data: TableData | null;
  raw: string;
}

/**
 * Parse alignment from separator row
 * :--- = left, :---: = center, ---: = right
 */
function parseAlignment(separator: string): ('left' | 'center' | 'right')[] {
  return separator
    .split('|')
    .filter((s) => s.trim())
    .map((s) => {
      const trimmed = s.trim();
      const leftColon = trimmed.startsWith(':');
      const rightColon = trimmed.endsWith(':');
      if (leftColon && rightColon) return 'center';
      if (rightColon) return 'right';
      return 'left';
    });
}

/**
 * Parse a markdown table into structured data
 */
function parseMarkdownTable(tableLines: string[]): TableData | null {
  if (tableLines.length < 3) return null;

  // Parse header row
  const headerLine = tableLines[0];
  const headers = headerLine
    .split('|')
    .map((h) => h.trim())
    .filter((h) => h !== '');

  if (headers.length === 0) return null;

  // Parse separator row for alignment
  const separatorLine = tableLines[1];
  if (!separatorLine.includes('-')) return null;
  const alignments = parseAlignment(separatorLine);

  // Parse data rows
  const rows: Record<string, string>[] = [];
  for (let i = 2; i < tableLines.length; i++) {
    const line = tableLines[i].trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;

    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = cells[idx] || '';
    });
    rows.push(row);
  }

  return { headers, rows, alignments };
}

/**
 * Check if a line is a valid table separator (|---|---|)
 */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  // Must contain at least one dash sequence
  return /\|[\s:-]*-+[\s:-]*\|/.test(trimmed);
}

/**
 * Check if a line is a table row
 */
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
}

/**
 * Count columns in a table row
 */
function countColumns(line: string): number {
  return (line.match(/\|/g) || []).length - 1;
}

/**
 * Find all tables in markdown content with their positions and completeness
 */
function findTables(content: string): TableInfo[] {
  const lines = content.split('\n');
  const tables: TableInfo[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for potential table start (header row)
    if (isTableRow(line)) {
      const headerColCount = countColumns(line);
      const tableStartLine = i;
      const tableLines: string[] = [line];

      i++;

      // Check for separator row
      if (i < lines.length && isTableSeparator(lines[i])) {
        const sepColCount = countColumns(lines[i]);
        if (sepColCount === headerColCount) {
          tableLines.push(lines[i]);
          i++;

          // Collect data rows
          while (i < lines.length) {
            const dataLine = lines[i];
            if (!isTableRow(dataLine)) break;

            const dataColCount = countColumns(dataLine);
            // Allow flexible column count (some rows might have fewer)
            if (dataColCount > 0) {
              tableLines.push(dataLine);
              i++;
            } else {
              break;
            }
          }

          // Determine if table is complete
          const hasDataRows = tableLines.length > 2;
          const lastLine = tableLines[tableLines.length - 1];
          const lastLineComplete = lastLine.trim().endsWith('|');

          const raw = tableLines.join('\n');
          const data = parseMarkdownTable(tableLines);

          tables.push({
            startLine: tableStartLine,
            endLine: i,
            isComplete: hasDataRows && lastLineComplete,
            data,
            raw,
          });
          continue;
        }
      }

      // Not a valid table, reset
      i = tableStartLine + 1;
      continue;
    }

    i++;
  }

  return tables;
}

// ============================================================================
// TABLE RENDERING
// ============================================================================

/**
 * Strip ANSI codes for width calculation
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Calculate visible width of a string (excluding ANSI codes)
 */
function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Render table using custom Unicode box-drawing
 */
function renderTableCustom(data: TableData): string {
  const { headers, rows } = data;

  // Calculate column widths (max of header and all cells)
  const colWidths = headers.map((h, _colIdx) => {
    let maxWidth = visibleWidth(h);
    for (const row of rows) {
      const cellValue = row[h] || '';
      maxWidth = Math.max(maxWidth, visibleWidth(cellValue));
    }
    // Add padding and cap at 50 chars
    return Math.min(maxWidth + 2, 50);
  });

  const output: string[] = [];

  // Top border: ┌───┬───┬───┐
  output.push(
    TABLE_CHARS['top-left'] +
      colWidths.map((w) => TABLE_CHARS.top.repeat(w)).join(TABLE_CHARS['top-mid']) +
      TABLE_CHARS['top-right']
  );

  // Header row: │ H1 │ H2 │ H3 │
  const headerCells = headers.map((h, i) => {
    const padding = colWidths[i] - visibleWidth(h) - 1;
    return ' ' + h + ' '.repeat(Math.max(0, padding));
  });
  output.push(
    `${ANSI.cyanBold}${TABLE_CHARS.left}${headerCells.join(TABLE_CHARS.middle)}${TABLE_CHARS.right}${ANSI.reset}`
  );

  // Separator: ├───┼───┼───┤
  output.push(
    TABLE_CHARS['left-mid'] +
      colWidths.map((w) => TABLE_CHARS.mid.repeat(w)).join(TABLE_CHARS['mid-mid']) +
      TABLE_CHARS['right-mid']
  );

  // Data rows: │ D1 │ D2 │ D3 │
  for (const row of rows) {
    const cells = headers.map((h, i) => {
      const cellValue = row[h] || '';
      const cellWidth = visibleWidth(cellValue);
      const _padding = colWidths[i] - cellWidth - 1; // Used for intermediate calculation
      const truncated =
        cellWidth > colWidths[i] - 2
          ? stripAnsi(cellValue).slice(0, colWidths[i] - 3) + '…'
          : cellValue;
      const finalPadding = colWidths[i] - visibleWidth(truncated) - 1;
      return ' ' + truncated + ' '.repeat(Math.max(0, finalPadding));
    });
    output.push(TABLE_CHARS.left + cells.join(TABLE_CHARS.middle) + TABLE_CHARS.right);
  }

  // Bottom border: └───┴───┴───┘
  output.push(
    TABLE_CHARS['bottom-left'] +
      colWidths.map((w) => TABLE_CHARS.bottom.repeat(w)).join(TABLE_CHARS['bottom-mid']) +
      TABLE_CHARS['bottom-right']
  );

  return output.join('\n');
}

// ============================================================================
// CONTENT SEGMENTATION
// ============================================================================

type SegmentType = 'text' | 'table' | 'pending-table';

interface ContentSegment {
  type: SegmentType;
  content: string;
  tableData?: TableData;
}

/**
 * Split content into renderable segments (text and tables)
 */
function splitContent(content: string, isStreaming: boolean): ContentSegment[] {
  const tables = findTables(content);

  if (tables.length === 0) {
    return [{ type: 'text', content }];
  }

  const segments: ContentSegment[] = [];
  const lines = content.split('\n');
  let currentLine = 0;

  for (const table of tables) {
    // Text before table
    if (table.startLine > currentLine) {
      const textBefore = lines.slice(currentLine, table.startLine).join('\n');
      if (textBefore.trim()) {
        segments.push({ type: 'text', content: textBefore });
      }
    }

    // Table segment
    if (table.isComplete || !isStreaming) {
      segments.push({
        type: 'table',
        content: table.raw,
        tableData: table.data || undefined,
      });
    } else {
      // Incomplete table during streaming
      segments.push({
        type: 'pending-table',
        content: table.raw,
      });
    }

    currentLine = table.endLine;
  }

  // Text after last table
  if (currentLine < lines.length) {
    const textAfter = lines.slice(currentLine).join('\n');
    if (textAfter.trim()) {
      segments.push({ type: 'text', content: textAfter });
    }
  }

  return segments;
}

// ============================================================================
// COMPONENTS
// ============================================================================

interface CustomTableProps {
  data: TableData;
}

/**
 * Table renderer using integrated InkTable component
 * Memoized to prevent re-renders when other parts of content change
 */
const CustomTable = React.memo(function CustomTable({ data }: CustomTableProps) {
  return (
    <Box marginY={1}>
      <InkTable
        data={data.rows}
        columns={data.headers}
        borderStyle="single"
        padding={1}
      />
    </Box>
  );
});

interface PendingTableProps {
  lineCount: number;
  raw: string;
}

/**
 * Placeholder for incomplete tables during streaming
 * Memoized to prevent re-renders
 */
const PendingTable = React.memo(function PendingTable({ lineCount }: PendingTableProps) {
  return (
    <Box marginY={1} flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={2} paddingY={0}>
        <Text color="gray">⏳ Generating table ({lineCount} rows)...</Text>
      </Box>
    </Box>
  );
});

/**
 * Memoized text segment renderer
 */
const TextSegment = React.memo(function TextSegment({ content }: { content: string }) {
  const result = marked.parse(content);
  const rendered = typeof result === 'string' ? result : content;
  return <Text>{rendered}</Text>;
});

/**
 * Memoized table segment renderer with fallback
 */
const TableSegment = React.memo(function TableSegment({
  content,
  tableData,
}: {
  content: string;
  tableData?: TableData;
}) {
  if (tableData) {
    return <CustomTable data={tableData} />;
  }
  // Fallback: render raw markdown if parsing failed
  const result = marked.parse(content);
  const rendered = typeof result === 'string' ? result : content;
  return (
    <Box marginY={1}>
      <Text>{rendered}</Text>
    </Box>
  );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

/**
 * Renders markdown content with special handling for tables
 *
 * Features:
 * - Tables are only displayed when complete (during streaming)
 * - Custom Unicode box-drawing for nice table borders
 * - Proper handling of ANSI codes in cell content
 * - Support for alignment (left, center, right)
 */
export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  isStreaming = false,
}: MarkdownRendererProps) {
  const segments = useMemo(() => splitContent(content, isStreaming), [content, isStreaming]);

  try {
    // Single text segment - use TextSegment
    if (segments.length === 1 && segments[0].type === 'text') {
      return <TextSegment content={content} />;
    }

    // Multiple segments - render each using memoized components
    return (
      <Box flexDirection="column">
        {segments.map((segment, index) => {
          switch (segment.type) {
            case 'text':
              return <TextSegment key={`text-${index}`} content={segment.content} />;

            case 'table':
              return (
                <TableSegment
                  key={`table-${index}`}
                  content={segment.content}
                  tableData={segment.tableData}
                />
              );

            case 'pending-table': {
              const lineCount = segment.content.split('\n').length;
              return <PendingTable key={`pending-${index}`} lineCount={lineCount} raw={segment.content} />;
            }

            default:
              return null;
          }
        })}
      </Box>
    );
  } catch (error) {
    // Fallback to plain text on error
    console.error('Markdown rendering error:', error);
    return <Text>{content}</Text>;
  }
});

// Export utility functions for testing
export { findTables, parseMarkdownTable, renderTableCustom, splitContent };
