import { stackParts, type StackedPart } from './util/stacked-model.js';

export type StackedBarProps = { parts: StackedPart[] };

function partClass(tone: string): string {
  if (tone === 'success') return 'bg-emerald-500';
  if (tone === 'warning') return 'bg-amber-500';
  if (tone === 'danger') return 'bg-red-500';
  if (tone === 'muted') return 'bg-muted-foreground';
  return 'bg-primary';
}

export function StackedBar({ parts }: StackedBarProps) {
  const segments = stackParts(parts);

  return (
    <div className="rounded-lg border border-border bg-surface p-4" role="img" aria-label="Stacked bar">
      <div className="relative h-5 overflow-hidden rounded-full bg-muted">
        {segments.map((segment) => (
          <div key={segment.label} className={'absolute top-0 h-full ' + partClass(segment.tone)} style={{ left: String(segment.startPct) + '%', width: String(segment.widthPct) + '%' }} />
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground"><span className={'h-2.5 w-2.5 rounded-full ' + partClass(segment.tone)} />{segment.label}</span>
            <span className="tabular-nums text-foreground">{Math.round(segment.percent * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
