/**
 * Deliverables — pure types and helpers for generated output items.
 *
 * @module renderer/components/deliverables
 */
export type DeliverableKind = 'deck' | 'sheet' | 'doc' | 'page' | 'image' | 'report';

export interface Deliverable {
  id: string;
  kind: DeliverableKind;
  title: string;
  createdAt: number;
  sizeLabel?: string;
}

const KIND_EMOJI: Record<DeliverableKind, string> = {
  deck: '📊',
  sheet: '📈',
  doc: '📄',
  page: '🌐',
  image: '🖼️',
  report: '📋',
};

export function kindEmoji(kind: DeliverableKind): string {
  return KIND_EMOJI[kind];
}

export function formatWhen(ts: number, now = Date.now()): string {
  const elapsedMs = Math.max(0, now - ts);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  if (elapsedSeconds < 60) return 'now';

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}
