export type DonutSegment = { label: string; value: number; tone?: string };
export type DonutArc = DonutSegment & { startAngle: number; endAngle: number; percent: number; largeArc: 0 | 1; path: string };

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

export function percentages(segments: DonutSegment[]): number[] {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, Number.isFinite(segment.value) ? segment.value : 0), 0);
  if (total === 0) return segments.map(() => 0);
  return segments.map((segment) => Math.max(0, segment.value) / total);
}

export function toArcs(segments: DonutSegment[], cx = 50, cy = 50, radius = 36, innerRadius = 22): DonutArc[] {
  let cursor = 0;
  return percentages(segments).map((percent, index) => {
    const segment = segments[index] as DonutSegment;
    const startAngle = cursor;
    const endAngle = cursor + percent * 360;
    cursor = endAngle;
    const startOuter = polar(cx, cy, radius, startAngle);
    const endOuter = polar(cx, cy, radius, endAngle);
    const startInner = polar(cx, cy, innerRadius, startAngle);
    const endInner = polar(cx, cy, innerRadius, endAngle);
    const largeArc: 0 | 1 = percent > 0.5 ? 1 : 0;
    const path = percent === 0 ? '' : [
      'M ' + startOuter.x.toFixed(2) + ' ' + startOuter.y.toFixed(2),
      'A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' 1 ' + endOuter.x.toFixed(2) + ' ' + endOuter.y.toFixed(2),
      'L ' + endInner.x.toFixed(2) + ' ' + endInner.y.toFixed(2),
      'A ' + innerRadius + ' ' + innerRadius + ' 0 ' + largeArc + ' 0 ' + startInner.x.toFixed(2) + ' ' + startInner.y.toFixed(2),
      'Z',
    ].join(' ');
    return { ...segment, startAngle, endAngle, percent, largeArc, path };
  });
}
