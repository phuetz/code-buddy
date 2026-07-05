import { angleFor, zoneOf } from './util/gauge-model.js';

export type GaugeMeterProps = {
  value: number;
  max: number;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
};

function strokeClass(tone: GaugeMeterProps['tone'], zone: string): string {
  if (tone === 'success' || zone === 'good') return 'stroke-emerald-500';
  if (tone === 'warning' || zone === 'warn') return 'stroke-amber-500';
  if (tone === 'danger' || zone === 'bad') return 'stroke-red-500';
  return 'stroke-primary';
}

export function GaugeMeter({ value, max, tone = 'primary' }: GaugeMeterProps) {
  const zone = zoneOf(value, max);
  const angle = angleFor(value, max);
  const ratio = Math.min(1, Math.max(0, value / (max || 1)));
  const dash = 126 * ratio;

  return (
    <div className="rounded-lg border border-border bg-surface p-4" role="img" aria-label="Gauge meter">
      <svg width="160" height="96" viewBox="0 0 160 96" className="mx-auto">
        <path d="M 24 80 A 56 56 0 0 1 136 80" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-muted" />
        <path d="M 24 80 A 56 56 0 0 1 136 80" fill="none" strokeWidth="12" strokeLinecap="round" strokeDasharray={String(dash) + ' 126'} className={strokeClass(tone, zone)} />
        <line x1="80" y1="80" x2="80" y2="34" strokeWidth="3" strokeLinecap="round" className="stroke-foreground" transform={'rotate(' + angle + ' 80 80)'} />
        <circle cx="80" cy="80" r="5" className="fill-foreground" />
      </svg>
      <div className="text-center text-2xl font-semibold tabular-nums text-foreground">{value}<span className="text-sm text-muted-foreground">/{max}</span></div>
    </div>
  );
}
