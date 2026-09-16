/**
 * Pure candidate detection and authored-widget matching for generative UI.
 * Detection deliberately does no I/O: callers decide which registry and gates
 * apply before rendering anything.
 *
 * @module widgets/widget-matcher
 */
import { widgetKind, type AuthoredWidget } from './widget-types.js';

const MIN_ANSWER_LENGTH = 200;

export interface PayloadWidgetCandidate {
  kind: 'payload';
  dataType: string;
  data: unknown;
}

export interface TableWidgetData {
  type: 'table';
  headers: Array<{ label: string }>;
  rows: Array<{ cells: Array<{ value: string }> }>;
}

export interface TableWidgetCandidate {
  kind: 'table';
  dataType: 'table';
  data: TableWidgetData;
}

export type WidgetCandidate = PayloadWidgetCandidate | TableWidgetCandidate;

/** Minimal authored shape accepted by the pure matcher (useful for tests/plugins). */
export interface AuthoredWidgetCandidate {
  dataTypes?: readonly string[];
  usedCount?: number;
}

function typedPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (widgetKind(record.data)) return record.data;
  if (widgetKind(record)) return record;
  const toolResult = record.toolResult;
  if (toolResult && typeof toolResult === 'object' && !Array.isArray(toolResult)) {
    const data = (toolResult as Record<string, unknown>).data;
    if (widgetKind(data)) return data;
  }
  return null;
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  if (!trimmed.includes('|')) return [];
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

function detectMarkdownTable(text: string): TableWidgetCandidate | null {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index + 2 < lines.length; index++) {
    const headers = splitMarkdownRow(lines[index] ?? '');
    const separator = splitMarkdownRow(lines[index + 1] ?? '');
    if (headers.length < 2 || separator.length !== headers.length || !isSeparatorRow(separator)) continue;

    const rows: string[][] = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex++) {
      const cells = splitMarkdownRow(lines[rowIndex] ?? '');
      if (cells.length !== headers.length) break;
      rows.push(cells);
    }
    // The separator is syntax, not visible data: header + two body rows is the
    // specified three-row minimum for a substantive markdown table.
    if (rows.length < 2) continue;
    return {
      kind: 'table',
      dataType: 'table',
      data: {
        type: 'table',
        headers: headers.map((label) => ({ label })),
        rows: rows.map((cells) => ({ cells: cells.map((value) => ({ value })) })),
      },
    };
  }
  return null;
}

/**
 * Detect at most one widgetable candidate. Typed payloads take precedence over
 * markdown tables. The 200-character gate applies only to markdown tables;
 * structured payloads already carry their own discriminator and data.
 */
export function detectWidgetable(text: string, payloads: readonly unknown[] = []): WidgetCandidate | null {
  for (const payload of payloads) {
    const data = typedPayload(payload);
    const dataType = widgetKind(data)?.trim().toLowerCase();
    if (dataType) return { kind: 'payload', dataType, data };
  }
  if (text.length < MIN_ANSWER_LENGTH) return null;
  return detectMarkdownTable(text);
}

/**
 * Select the declared authored widget with the highest usage count. Legacy
 * entries without dataTypes never match; ties preserve registry order.
 */
export function matchAuthored<T extends AuthoredWidgetCandidate>(
  dataType: string,
  registry: readonly T[]
): T | null {
  const normalizedType = dataType.trim().toLowerCase();
  if (!normalizedType) return null;
  let best: T | null = null;
  let bestCount = -1;
  for (const widget of registry) {
    const matches = widget.dataTypes?.some(
      (type) => typeof type === 'string' && type.trim().toLowerCase() === normalizedType
    );
    if (!matches) continue;
    const usedCount = typeof widget.usedCount === 'number' && Number.isFinite(widget.usedCount)
      ? widget.usedCount
      : 0;
    if (best === null || usedCount > bestCount) {
      best = widget;
      bestCount = usedCount;
    }
  }
  return best;
}

/** Strongly typed convenience alias for the on-disk registry. */
export function matchAuthoredWidget(
  dataType: string,
  registry: readonly AuthoredWidget[]
): AuthoredWidget | null {
  return matchAuthored(dataType, registry);
}
