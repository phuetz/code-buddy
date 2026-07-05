export type SparkPoint = { x: number; y: number; value: number };

export function niceScale(values: number[], height = 32): { min: number; max: number; span: number; height: number } {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { min: 0, max: 1, span: 1, height };
  const rawMin = Math.min(...finite);
  const rawMax = Math.max(...finite);
  if (rawMin === rawMax) {
    const pad = Math.max(1, Math.abs(rawMin) * 0.1);
    return { min: rawMin - pad, max: rawMax + pad, span: pad * 2, height };
  }
  const span = rawMax - rawMin;
  const pad = span * 0.08;
  return { min: rawMin - pad, max: rawMax + pad, span: span + pad * 2, height };
}

export function pointsFromValues(values: number[], width = 120, height = 32): SparkPoint[] {
  if (values.length === 0) return [];
  const scale = niceScale(values, height);
  const step = values.length <= 1 ? 0 : width / (values.length - 1);
  return values.map((value, index) => ({
    x: index * step,
    y: height - ((value - scale.min) / scale.span) * height,
    value,
  }));
}

export function pathFromValues(values: number[], width = 120, height = 32): string {
  const points = pointsFromValues(values, width, height);
  if (points.length === 0) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}
