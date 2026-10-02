import { describe, expect, it } from 'vitest';

import { compareTableCells, sortTableRows, tableToCsv } from '../src/renderer/utils/table-csv';

describe('tableToCsv', () => {
  it('escapes fields containing commas, quotes and newlines', () => {
    const csv = tableToCsv(
      ['name', 'note'],
      [['x,y', 'he said "hi"'], ['plain', 'line1\nline2']]
    );
    expect(csv).toBe(
      ['name,note', '"x,y","he said ""hi"""', 'plain,"line1\nline2"'].join('\r\n')
    );
  });

  it('leaves simple fields unquoted', () => {
    expect(tableToCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2');
  });
});

describe('compareTableCells', () => {
  it('orders numeric cells numerically, not lexically', () => {
    expect(compareTableCells('2', '10')).toBeLessThan(0);
    expect(compareTableCells('10', '2')).toBeGreaterThan(0);
  });

  it('tolerates currency / percent / thousands separators', () => {
    expect(compareTableCells('1,200', '900')).toBeGreaterThan(0);
    expect(compareTableCells('5%', '12%')).toBeLessThan(0);
  });

  it('sorts numbers before free-text strings', () => {
    expect(compareTableCells('3', 'alpha')).toBeLessThan(0);
    expect(compareTableCells('alpha', '3')).toBeGreaterThan(0);
  });

  it('rejects non-standard numeric formats (hex, exp, etc) and treats them as text', () => {
    expect(compareTableCells('0x10', '9')).toBeGreaterThan(0);
    expect(compareTableCells('1e3', '999')).toBeGreaterThan(0);
    expect(compareTableCells('0x10', '20')).toBeGreaterThan(0);
    expect(compareTableCells('1e3', '1001')).toBeGreaterThan(0);
  });

  it('correctly handles French decimal commas vs thousands separators', () => {
    expect(compareTableCells('1,5', '2')).toBeLessThan(0);
    expect(compareTableCells('12,50 %', '12,4 %')).toBeGreaterThan(0);
    expect(compareTableCells('1,234.567', '1,235')).toBeLessThan(0);
    expect(compareTableCells('1.234,567', '1,235')).toBeLessThan(0);
  });

  it('keeps a lone dot as a decimal separator', () => {
    expect(compareTableCells('1.234', '2')).toBeLessThan(0);
    expect(compareTableCells('1.234', '1.2')).toBeGreaterThan(0);
    expect(compareTableCells('1,235', '2')).toBeGreaterThan(0);
    expect(compareTableCells('1.234.567', '1000000')).toBeGreaterThan(0);
  });
});

describe('sortTableRows', () => {
  const rows = [
    ['Claude', '95'],
    ['GPT-5', '92'],
    ['Local', '80'],
  ];

  it('sorts ascending by a numeric column without mutating input', () => {
    const sorted = sortTableRows(rows, 1, 'asc');
    expect(sorted.map((r) => r[1])).toEqual(['80', '92', '95']);
    // original untouched
    expect(rows[0]?.[1]).toBe('95');
  });

  it('sorts descending by a string column', () => {
    const sorted = sortTableRows(rows, 0, 'desc');
    expect(sorted.map((r) => r[0])).toEqual(['Local', 'GPT-5', 'Claude']);
  });

  it('sorts rows with decimal commas correctly', () => {
    const sorted = sortTableRows([['1,5'], ['10'], ['2']], 0, 'asc');
    expect(sorted.map((r) => r[0])).toEqual(['1,5', '2', '10']);
  });
});
