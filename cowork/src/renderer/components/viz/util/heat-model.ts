export type HeatTone = 'empty' | 'low' | 'medium' | 'high';

export function normalizeCells(cells: number[][]): number[][] {
  const flat = cells.flat().filter(Number.isFinite);
  const min = flat.length ? Math.min(...flat) : 0;
  const max = flat.length ? Math.max(...flat) : 1;
  const span = max === min ? 1 : max - min;
  return cells.map((row) => row.map((cell) => Number.isFinite(cell) ? (cell - min) / span : 0));
}

export function colorFor(value: number): HeatTone {
  if (value <= 0) return 'empty';
  if (value < 0.34) return 'low';
  if (value < 0.67) return 'medium';
  return 'high';
}
