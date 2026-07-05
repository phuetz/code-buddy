import { barWidths, type BarDatum } from './util/bar-model.js';

export type BarChartProps = {
  data: BarDatum[];
  horizontal?: boolean;
};

export function BarChart({ data, horizontal = false }: BarChartProps) {
  const bars = barWidths(data);

  if (bars.length === 0) {
    return <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">Aucune donnée</div>;
  }

  if (horizontal) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-surface p-4" role="img" aria-label="Bar chart horizontal">
        {bars.map((bar) => (
          <div key={bar.label} className="grid grid-cols-[7rem_1fr_4rem] items-center gap-3 text-sm">
            <span className="truncate text-muted-foreground">{bar.label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: String(bar.widthPct) + '%' }} />
            </div>
            <span className="text-right tabular-nums text-foreground">{bar.value}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-48 items-end gap-3 overflow-x-auto rounded-lg border border-border bg-surface p-4" role="img" aria-label="Bar chart vertical">
      {bars.map((bar) => (
        <div key={bar.label} className="flex min-w-12 flex-1 flex-col items-center gap-2">
          <span className="text-xs tabular-nums text-foreground">{bar.value}</span>
          <div className="flex h-32 w-full items-end rounded-md bg-muted">
            <div className="w-full rounded-md bg-primary" style={{ height: String(bar.widthPct) + '%' }} />
          </div>
          <span className="max-w-20 truncate text-xs text-muted-foreground">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}
