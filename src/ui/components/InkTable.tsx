/**
 * InkTable - A table component for Ink (React for CLI)
 * Inspired by ink-table but integrated directly without ESM issues
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';

// ============================================================================
// Types
// ============================================================================

export type ScalarValue = string | number | boolean | null | undefined;
export type ScalarDict = Record<string, ScalarValue>;

export interface TableProps<T extends ScalarDict> {
  /** Array of row objects */
  data: T[];
  /** Specific columns to display (defaults to all keys from first row) */
  columns?: (keyof T)[];
  /** Cell padding (default: 1) */
  padding?: number;
  /** Border style: 'single' | 'double' | 'rounded' | 'none' */
  borderStyle?: 'single' | 'double' | 'rounded' | 'none';
  /** Max column width (default: 40) */
  maxColumnWidth?: number;
}

// ============================================================================
// Border Characters
// ============================================================================

interface BorderChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
  topMid: string;
  bottomMid: string;
  leftMid: string;
  rightMid: string;
  midMid: string;
}

const BORDER_STYLES: Record<string, BorderChars> = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
    topMid: '┬',
    bottomMid: '┴',
    leftMid: '├',
    rightMid: '┤',
    midMid: '┼',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
    topMid: '╦',
    bottomMid: '╩',
    leftMid: '╠',
    rightMid: '╣',
    midMid: '╬',
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    topMid: '┬',
    bottomMid: '┴',
    leftMid: '├',
    rightMid: '┤',
    midMid: '┼',
  },
  none: {
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
    horizontal: ' ',
    vertical: ' ',
    topMid: ' ',
    bottomMid: ' ',
    leftMid: ' ',
    rightMid: ' ',
    midMid: ' ',
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get visible width of a string (handles ANSI codes and emojis)
 * Uses string-width which correctly handles:
 * - ANSI escape codes
 * - Full-width characters (CJK)
 * - Emojis (width 2 in terminals)
 * - Variation selectors and ZWJ sequences
 */
function getStringWidth(str: string): number {
  return stringWidth(String(str));
}

/**
 * Pad a string to a specific width
 */
function padString(str: string, width: number, align: 'left' | 'center' | 'right' = 'left'): string {
  const strWidth = getStringWidth(str);
  const padding = Math.max(0, width - strWidth);

  if (padding === 0) return str;

  switch (align) {
    case 'center': {
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
    }
    case 'right':
      return ' '.repeat(padding) + str;
    case 'left':
    default:
      return str + ' '.repeat(padding);
  }
}

/**
 * Truncate a string with ellipsis if it exceeds max width
 */
function truncateString(str: string, maxWidth: number): string {
  const strWidth = getStringWidth(str);
  if (strWidth <= maxWidth) return str;
  if (maxWidth <= 3) return str.slice(0, maxWidth);
  return str.slice(0, maxWidth - 1) + '…';
}

/**
 * Strip markdown/HTML formatting from text for clean table display
 */
function stripMarkdown(text: string): string {
  return text
    // Handle <br> tags - convert to space for single line display
    .replace(/<br\s*\/?>/gi, ' ')
    // Remove code block markers (```language ... ```)
    .replace(/```[\w]*\n?/g, '')
    .replace(/```/g, '')
    // Remove inline HTML tags
    .replace(/<[^>]+>/g, '')
    // Markdown formatting
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** -> bold
    .replace(/\*([^*]+)\*/g, '$1')       // *italic* -> italic
    .replace(/__([^_]+)__/g, '$1')       // __bold__ -> bold
    .replace(/_([^_]+)_/g, '$1')         // _italic_ -> italic
    .replace(/`([^`]+)`/g, '$1')         // `code` -> code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url) -> link
    // LaTeX-style math notation
    .replace(/\\\(([^)]+)\\\)/g, '$1')   // \(O(n)\) -> O(n)
    .replace(/\\\[([^\]]+)\\\]/g, '$1')  // \[formula\] -> formula
    // Clean up extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format a cell value to string
 */
function formatValue(value: ScalarValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return stripMarkdown(String(value));
}

// ============================================================================
// Main Component
// ============================================================================

export function InkTable<T extends ScalarDict>({
  data,
  columns: columnsProp,
  padding = 1,
  borderStyle = 'single',
  maxColumnWidth = 60,
}: TableProps<T>): React.ReactElement | null {
  const chars = BORDER_STYLES[borderStyle] || BORDER_STYLES.single;

  // Determine columns to display
  const columns = useMemo(() => {
    if (columnsProp) return columnsProp;
    if (data.length === 0) return [];
    return Object.keys(data[0]) as (keyof T)[];
  }, [columnsProp, data]);

  // Calculate column widths
  const columnWidths = useMemo(() => {
    const widths: Record<string, number> = {};

    for (const col of columns) {
      const colName = String(col);
      let maxWidth = getStringWidth(colName);

      for (const row of data) {
        const cellValue = formatValue(row[col]);
        maxWidth = Math.max(maxWidth, getStringWidth(cellValue));
      }

      // Apply max column width limit
      widths[colName] = Math.min(maxWidth, maxColumnWidth) + padding * 2;
    }

    return widths;
  }, [columns, data, padding, maxColumnWidth]);

  if (columns.length === 0) {
    return null;
  }

  // Build horizontal line
  const buildHorizontalLine = (
    left: string,
    mid: string,
    right: string,
    line: string
  ): string => {
    const segments = columns.map((col) => line.repeat(columnWidths[String(col)]));
    return left + segments.join(mid) + right;
  };

  // Build row as a string for consistent rendering
  const buildRowString = (values: string[]): string => {
    const cells = values.map((value, index) => {
      const colName = String(columns[index]);
      const width = columnWidths[colName] - padding * 2;
      const truncated = truncateString(value, width);
      const padded = padString(truncated, width);
      return ' '.repeat(padding) + padded + ' '.repeat(padding);
    });
    return chars.vertical + cells.join(chars.vertical) + chars.vertical;
  };

  // Top border
  const topBorder = buildHorizontalLine(
    chars.topLeft,
    chars.topMid,
    chars.topRight,
    chars.horizontal
  );

  // Header separator
  const headerSeparator = buildHorizontalLine(
    chars.leftMid,
    chars.midMid,
    chars.rightMid,
    chars.horizontal
  );

  // Bottom border
  const bottomBorder = buildHorizontalLine(
    chars.bottomLeft,
    chars.bottomMid,
    chars.bottomRight,
    chars.horizontal
  );

  // Header values
  const headerValues = columns.map((col) => String(col));
  const headerRow = buildRowString(headerValues);

  // Data rows as strings
  const dataRowStrings = data.map((row) => {
    const values = columns.map((col) => formatValue(row[col]));
    return buildRowString(values);
  });

  return (
    <Box flexDirection="column">
      <Text color="gray">{topBorder}</Text>
      <Text bold color="cyan">{headerRow}</Text>
      <Text color="gray">{headerSeparator}</Text>
      {dataRowStrings.map((row, index) => (
        <Text key={index}>{row}</Text>
      ))}
      <Text color="gray">{bottomBorder}</Text>
    </Box>
  );
}

// ============================================================================
// Simplified Table from Markdown Data
// ============================================================================

export interface MarkdownTableData {
  headers: string[];
  rows: Record<string, string>[];
  alignments?: ('left' | 'center' | 'right')[];
}

export function MarkdownTable({
  data,
  borderStyle = 'single',
}: {
  data: MarkdownTableData;
  borderStyle?: 'single' | 'double' | 'rounded' | 'none';
}): React.ReactElement | null {
  if (!data.headers.length || !data.rows.length) {
    return null;
  }

  return (
    <InkTable
      data={data.rows}
      columns={data.headers}
      borderStyle={borderStyle}
      padding={1}
    />
  );
}

export default InkTable;
