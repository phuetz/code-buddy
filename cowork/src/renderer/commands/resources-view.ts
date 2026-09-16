/** Pure text for the read-only Cowork resources list (P8). */
export interface ResourceRowView {
  id: string;
  kind: string;
  hostId: string;
  declaredCapabilities: string[];
  endpointRef: string;
  state: string;
  reason: string;
  checkedAt: number | null;
}

const STATE_LABELS: Record<string, string> = {
  online: 'en ligne',
  offline: 'hors ligne',
  unknown: 'inconnu',
  stale: 'observation périmée',
};

export function resourceStateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

export function resourceStateTone(state: string): 'success' | 'danger' | 'warning' | 'muted' {
  if (state === 'online') return 'success';
  if (state === 'offline') return 'danger';
  if (state === 'stale') return 'warning';
  return 'muted';
}

export function formatResourceDetail(row: ResourceRowView, now = Date.now()): string {
  const checked = row.checkedAt === null ? 'jamais sondée' : `sondée il y a ${Math.max(0, Math.round((now - row.checkedAt) / 60_000))} min`;
  return `${row.kind} · ${row.hostId} · ${row.declaredCapabilities.join(', ')} · réf. ${row.endpointRef} · ${checked} (${row.reason})`;
}
