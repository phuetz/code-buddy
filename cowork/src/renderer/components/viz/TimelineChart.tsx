import { layoutEvents, type TimelineEvent } from './util/timeline-model.js';

export type TimelineChartProps = { events: TimelineEvent[] };

function dotClass(tone?: string): string {
  if (tone === 'success') return 'bg-emerald-500';
  if (tone === 'warning') return 'bg-amber-500';
  if (tone === 'danger') return 'bg-red-500';
  return 'bg-primary';
}

export function TimelineChart({ events }: TimelineChartProps) {
  const items = layoutEvents(events);

  return (
    <div className="rounded-lg border border-border bg-surface p-4" role="img" aria-label="Timeline chart">
      <div className="relative h-32 min-w-96 overflow-hidden">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
        {items.map((event) => (
          <div key={event.label + event.time} className="absolute w-32 -translate-x-1/2" style={{ left: String(event.xPct) + '%', top: event.lane === 0 ? '0.5rem' : '4.5rem' }}>
            <div className="mx-auto mb-2 h-3 w-3 rounded-full ring-4 ring-surface " />
            <div className={'mx-auto mb-2 h-3 w-3 rounded-full ring-4 ring-surface ' + dotClass(event.tone)} />
            <div className="truncate text-center text-xs text-muted-foreground">{event.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
