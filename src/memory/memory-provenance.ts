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
      ? value.trim().normalize('NFKC').replace(/\s+/g, ' ')
        .replace(/[\p{Cc}\p{Cf}\u115F\u1160\u2800\u3164\uFFA0]/gu, '').slice(0, 500) : undefined;
  const observedAt = clean(input.observedAt);
  return {
    ...(observedAt && Number.isFinite(Date.parse(observedAt)) ? { observedAt: new Date(observedAt).toISOString() } : {}),
    ...(clean(input.machine) ? { machine: clean(input.machine) } : {}),
    ...(clean(input.channel) ? { channel: clean(input.channel) } : {}),
    ...(clean(input.verification) ? { verification: clean(input.verification) } : {}),
    ...(clean(input.source) ? { source: clean(input.source) } : {}),
  };
}

/** ASCII-only detection view; the original text remains intact in storage. */
export function memoryPromptScanText(value: string): string {
  return value.normalize('NFKC').normalize('NFKD')
    .replace(/\p{M}/gu, '').replace(/\s+/gu, ' ')
    .replace(/[^\x20-\x7E]/g, '');
}

export function unsafeMemoryPromptText(value: string): boolean {
  const words = memoryPromptScanText(value);
  // Imported legacy metadata may bypass today's write guard. Treat it as data
  // and omit instructions even when their parts occupy different fields or
  // appear in a different order.
  return (/\b(ignore|override|bypass|discard)\b/i.test(words)
      && /\b(system|developer|previous|prior|above)\b/i.test(words)
      && /\b(instructions?|prompt|rules?)\b/i.test(words))
    || /\b(exfiltrate|steal|leak|send|upload|post)\b.{0,100}\b(api[-_ ]?key|token|secret|password|credential|private key)\b/i.test(words);
}

function safePromptField(value?: string): string | undefined {
  if (!value || unsafeMemoryPromptText(value)) return undefined;
  return value.replaceAll('<', '‹').replaceAll('>', '›');
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
  const normalized = normalizeProvenance(provenance);
  const fields = [normalized.machine, normalized.channel, normalized.verification, normalized.source]
    .filter((value): value is string => Boolean(value));
  const metadataSplitUnsafe = unsafeMemoryPromptText(fields.filter((field) => !unsafeMemoryPromptText(field)).join(' '));
  const source: MemoryProvenance = {
    ...normalized,
    machine: metadataSplitUnsafe ? undefined : safePromptField(normalized.machine),
    channel: metadataSplitUnsafe ? undefined : safePromptField(normalized.channel),
    verification: metadataSplitUnsafe ? undefined : safePromptField(normalized.verification),
    source: metadataSplitUnsafe ? undefined : safePromptField(normalized.source),
  };
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
