export type TimelineEvent = { t: number | string | Date; label: string; tone?: string };
export type TimelineLayoutEvent = TimelineEvent & { time: number; xPct: number; lane: number };

function toTime(value: number | string | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

export function timeRange(events: TimelineEvent[]): { start: number; end: number; span: number } {
  const times = events.map((event) => toTime(event.t)).filter(Number.isFinite);
  if (times.length === 0) return { start: 0, end: 1, span: 1 };
  const start = Math.min(...times);
  const end = Math.max(...times);
  return { start, end, span: start === end ? 1 : end - start };
}

export function layoutEvents(events: TimelineEvent[]): TimelineLayoutEvent[] {
  const range = timeRange(events);
  return [...events]
    .map((event) => ({ ...event, time: toTime(event.t) }))
    .filter((event) => Number.isFinite(event.time))
    .sort((a, b) => a.time - b.time || a.label.localeCompare(b.label))
    .map((event, index) => ({ ...event, xPct: ((event.time - range.start) / range.span) * 100, lane: index % 2 }));
}
