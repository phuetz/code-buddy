/**
 * session-prune — pure filter logic for bulk-archiving old sessions
 * (Hermes parity: `sessions prune` with a full filter surface and a preview
 * that shows the matched age span).
 *
 * Pinned and already-archived sessions are NEVER matched; the active session
 * is excluded by the caller. Pure + deterministic (`now` injected).
 */

export interface PrunableSession {
  id: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  updatedAt: number;
}

export interface PruneFilter {
  /** Match sessions last updated more than N days ago (0/undefined = any age). */
  olderThanDays?: number;
  /** Case/diacritic-insensitive substring on the title (undefined = all). */
  titleMatch?: string;
}

export interface PrunePreview {
  matches: PrunableSession[];
  /** Oldest / newest updatedAt among matches (the Hermes age-span preview). */
  ageSpan: { oldest: number; newest: number } | null;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function previewPrune(
  sessions: ReadonlyArray<PrunableSession>,
  filter: PruneFilter,
  now: number,
): PrunePreview {
  const maxUpdatedAt = filter.olderThanDays && filter.olderThanDays > 0
    ? now - filter.olderThanDays * 24 * 60 * 60 * 1000
    : Number.POSITIVE_INFINITY;
  const needle = filter.titleMatch?.trim() ? fold(filter.titleMatch.trim()) : null;

  const matches = sessions.filter((session) => {
    if (session.pinned || session.archived) return false;
    if (session.updatedAt > maxUpdatedAt) return false;
    if (needle && !fold(session.title ?? '').includes(needle)) return false;
    return true;
  });

  if (matches.length === 0) return { matches: [], ageSpan: null };
  let oldest = Number.POSITIVE_INFINITY;
  let newest = 0;
  for (const m of matches) {
    if (m.updatedAt < oldest) oldest = m.updatedAt;
    if (m.updatedAt > newest) newest = m.updatedAt;
  }
  return { matches, ageSpan: { oldest, newest } };
}
