import { colorFor, normalizeCells } from './util/heat-model.js';

export type HeatmapProps = {
  rows: string[];
  cols: string[];
  cells: number[][];
};

const colorClasses = {
  empty: 'bg-muted',
  low: 'bg-primary/30',
  medium: 'bg-primary/60',
  high: 'bg-primary',
};

export function Heatmap({ rows, cols, cells }: HeatmapProps) {
  const normalized = normalizeCells(cells);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface p-4" role="img" aria-label="Heatmap">
      <div className="grid gap-1" style={{ gridTemplateColumns: '8rem repeat(' + cols.length + ', minmax(2rem, 1fr))' }}>
        <div />
        {cols.map((col) => <div key={col} className="truncate text-center text-xs text-muted-foreground">{col}</div>)}
        {rows.map((row, rowIndex) => (
          <div key={row} className="contents">
            <div className="truncate pr-2 text-xs text-muted-foreground">{row}</div>
            {cols.map((col, colIndex) => {
              const value = normalized[rowIndex]?.[colIndex] ?? 0;
              return <div key={row + col} title={row + ' / ' + col} className={'h-8 rounded-md border border-border ' + colorClasses[colorFor(value)]} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
