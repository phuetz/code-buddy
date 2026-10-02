/**
 * Pure helpers for the `table` artifact grid: CSV export + numeric-aware sort.
 * Kept dependency-free so they can be unit-tested without a DOM / RTL.
 *
 * @module renderer/utils/table-csv
 */

/** Escape a single CSV field: quote when it contains `,`/`"`/newline, double interior quotes. */
function escapeCsvField(field: string): string {
  const f = field ?? '';
  if (/[",\r\n]/.test(f)) {
    return `"${f.replace(/"/g, '""')}"`;
  }
  return f;
}

/** Serialize a table to RFC-4180-style CSV (CRLF line endings). */
export function tableToCsv(headers: string[], rows: string[][]): string {
  const out: string[] = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    out.push(row.map(escapeCsvField).join(','));
  }
  return out.join('\r\n');
}

/** Parse a cell into a number when it looks numeric (tolerates %, currency, thousands separators). */
function parseNumeric(value: string): number | null {
  const raw = (value ?? '').trim().replace(/[\s%$€£]/g, '');
  if (raw === '' || raw === '-' || raw === '+') return null;

  const match = /^[-+]?(?:\d{1,3}(?:[ \u202f.,]\d{3})+|\d*)(?:[.,]\d+)?$/.test(raw);
  if (!match) return null;

  const lastSepIndex = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  let cleaned = raw;

  if (lastSepIndex !== -1) {
    const afterSep = raw.slice(lastSepIndex + 1);
    const beforeSep = raw.slice(0, lastSepIndex);

    // With mixed separators, the last one marks the decimal part even when
    // it has three digits (for example 1,234.567).
    const hasMixedSeparators = beforeSep.includes('.') && raw.includes(',')
      || beforeSep.includes(',') && raw.includes('.');
    if (afterSep.length === 3 && !hasMixedSeparators) {
      cleaned = raw.replace(/[.,]/g, '');
    } else {
      cleaned = beforeSep.replace(/[.,]/g, '') + '.' + afterSep;
    }
  } else {
    cleaned = raw.replace(/[.,]/g, '');
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compare two cells: numeric when both parse as numbers (numbers sort before
 * strings), otherwise a locale-aware, numeric-tolerant string compare.
 */
export function compareTableCells(a: string, b: string): number {
  const na = parseNumeric(a);
  const nb = parseNumeric(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return (a ?? '').localeCompare(b ?? '', undefined, { numeric: true, sensitivity: 'base' });
}

/** Return a NEW array of rows sorted by a column, ascending or descending. */
export function sortTableRows(rows: string[][], colIndex: number, dir: 'asc' | 'desc'): string[][] {
  const sorted = [...rows].sort((r1, r2) => {
    const cmp = compareTableCells(r1[colIndex] ?? '', r2[colIndex] ?? '');
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}
