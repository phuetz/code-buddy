export type BarDatum = { label: string; value: number };
export type BarItem = BarDatum & { widthPct: number; rank: number };

export function maxValue(data: BarDatum[]): number {
  const max = Math.max(0, ...data.map((item) => Number.isFinite(item.value) ? item.value : 0));
  return max === 0 ? 1 : max;
}

export function sortBars(data: BarDatum[]): BarDatum[] {
  return [...data].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function barWidths(data: BarDatum[]): BarItem[] {
  const max = maxValue(data);
  return sortBars(data).map((item, index) => ({
    ...item,
    value: Number.isFinite(item.value) ? item.value : 0,
    widthPct: Math.max(0, (item.value / max) * 100),
    rank: index + 1,
  }));
}
