import { toArcs, type DonutSegment } from './util/donut-model.js';

export type DonutProps = { segments: DonutSegment[] };

const toneClasses = ['fill-primary', 'fill-emerald-500', 'fill-amber-500', 'fill-red-500', 'fill-muted-foreground'];

function toneClass(tone: string | undefined, index: number): string {
  if (tone === 'success') return 'fill-emerald-500';
  if (tone === 'warning') return 'fill-amber-500';
  if (tone === 'danger') return 'fill-red-500';
  if (tone === 'muted') return 'fill-muted-foreground';
  return toneClasses[index % toneClasses.length] as string;
}

export function Donut({ segments }: DonutProps) {
  const arcs = toArcs(segments);

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4" role="img" aria-label="Donut chart">
      <svg width="112" height="112" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="36" className="fill-muted" />
        {arcs.map((arc, index) => arc.path ? <path key={arc.label} d={arc.path} className={toneClass(arc.tone, index)} /> : null)}
        <circle cx="50" cy="50" r="22" className="fill-surface" />
      </svg>
      <div className="min-w-0 flex-1 space-y-2">
        {arcs.map((arc, index) => (
          <div key={arc.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground"><span className={'h-2.5 w-2.5 rounded-full ' + toneClass(arc.tone, index)} />{arc.label}</span>
            <span className="tabular-nums text-foreground">{Math.round(arc.percent * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
