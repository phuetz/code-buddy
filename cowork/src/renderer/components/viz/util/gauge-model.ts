export type GaugeZone = 'empty' | 'good' | 'warn' | 'bad';

export function angleFor(value: number, max: number): number {
  const safeMax = max > 0 && Number.isFinite(max) ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  return -90 + ratio * 180;
}

export function zoneOf(value: number, max: number): GaugeZone {
  const safeMax = max > 0 && Number.isFinite(max) ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  if (ratio === 0) return 'empty';
  if (ratio < 0.7) return 'good';
  if (ratio < 0.9) return 'warn';
  return 'bad';
}
