import { pathFromValues, pointsFromValues } from './util/scale.js';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'muted';

export type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  tone?: Tone;
};

const toneClasses: Record<Tone, { stroke: string; fill: string; point: string }> = {
  primary: { stroke: 'stroke-primary', fill: 'fill-primary/15', point: 'fill-primary' },
  success: { stroke: 'stroke-emerald-500', fill: 'fill-emerald-500/15', point: 'fill-emerald-500' },
  warning: { stroke: 'stroke-amber-500', fill: 'fill-amber-500/15', point: 'fill-amber-500' },
  danger: { stroke: 'stroke-red-500', fill: 'fill-red-500/15', point: 'fill-red-500' },
  muted: { stroke: 'stroke-muted-foreground', fill: 'fill-muted', point: 'fill-muted-foreground' },
};

export function Sparkline({ values, width = 120, height = 32, tone = 'primary' }: SparklineProps) {
  const path = pathFromValues(values, width, height);
  const points = pointsFromValues(values, width, height);
  const last = points.at(-1);
  const area = path ? `${path} L ${width.toFixed(2)} ${height.toFixed(2)} L 0 ${height.toFixed(2)} Z` : '';
  const classes = toneClasses[tone];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Sparkline" className="overflow-visible">
      {area ? <path d={area} className={classes.fill} /> : null}
      {path ? <path d={path} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={classes.stroke} /> : null}
      {last ? <circle cx={last.x} cy={last.y} r="3" className={classes.point} /> : null}
    </svg>
  );
}
