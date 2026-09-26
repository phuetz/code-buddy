/** Optional provenance contract shared by persistent memory and Lisa's user model. */
export type MemoryKind = 'preference' | 'observation' | 'hypothesis' | 'report';

export interface MemoryProvenance {
  /** Time of the observation, not the last read or file rewrite. */
  observedAt?: string;
  machine?: string;
  channel?: string;
  verification?: string;
  source?: string;
}

export const DEFAULT_FACT_FRESHNESS_DAYS = 7;

export function provenanceEnabled(): boolean {
  return process.env.CODEBUDDY_MEMORY_PROVENANCE === 'true';
}

export function normalizeProvenance(input?: MemoryProvenance): MemoryProvenance {
  if (!input) return {};
  const clean = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim()
      ? value.trim().replace(/\s+/g, ' ').split('')
        .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
        .join('').slice(0, 500) : undefined;
  const observedAt = clean(input.observedAt);
  return {
    ...(observedAt && Number.isFinite(Date.parse(observedAt)) ? { observedAt: new Date(observedAt).toISOString() } : {}),
    ...(clean(input.machine) ? { machine: clean(input.machine) } : {}),
    ...(clean(input.channel) ? { channel: clean(input.channel) } : {}),
    ...(clean(input.verification) ? { verification: clean(input.verification) } : {}),
    ...(clean(input.source) ? { source: clean(input.source) } : {}),
  };
}

export function formatProvenance(
  kind: MemoryKind,
  provenance: MemoryProvenance | undefined,
  now: Date = new Date(),
  freshnessDays: number = DEFAULT_FACT_FRESHNESS_DAYS,
): string {
  const labels: Record<MemoryKind, string> = {
    preference: 'préférence durable',
    observation: 'observation',
    hypothesis: 'hypothèse',
    report: 'ancien compte rendu',
  };
  const source = normalizeProvenance(provenance);
  const observed = source.observedAt ? new Date(source.observedAt).getTime() : NaN;
  const ageDays = Number.isFinite(observed) && observed <= now.getTime()
    ? Math.floor((now.getTime() - observed) / 86_400_000) : null;
  const freshness = ageDays === null ? 'fraîcheur inconnue'
    : ageDays > freshnessDays ? 'périmée : ne pas présenter comme actuelle'
    : 'fraîche à la date indiquée';
  return [
    labels[kind],
    source.observedAt ? `date ${source.observedAt}` : 'date inconnue',
    ageDays === null ? 'âge inconnu' : `âge ${ageDays} j`,
    freshness,
    source.machine ? `machine ${source.machine}` : 'machine inconnue',
    source.channel ? `canal ${source.channel}` : 'canal inconnu',
    source.verification ? `preuve ${source.verification}` : 'preuve inconnue',
    source.source ? `source ${source.source}`
      : source.machine || source.channel || source.verification ? 'source inconnue' : 'provenance inconnue',
  ].join(' ; ');
}
