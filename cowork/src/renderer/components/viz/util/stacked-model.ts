export type StackedPart = { label: string; value: number; tone: string };
export type StackedSegment = StackedPart & { startPct: number; widthPct: number; percent: number };

export function totalValue(parts: StackedPart[]): number {
  const total = parts.reduce((sum, part) => sum + Math.max(0, Number.isFinite(part.value) ? part.value : 0), 0);
  return total === 0 ? 1 : total;
}

export function stackParts(parts: StackedPart[]): StackedSegment[] {
  const total = totalValue(parts);
  let cursor = 0;
  return parts.map((part) => {
    const value = Math.max(0, Number.isFinite(part.value) ? part.value : 0);
    const percent = value / total;
    const segment = { ...part, value, startPct: cursor * 100, widthPct: percent * 100, percent };
    cursor += percent;
    return segment;
  });
}
