/**
 * Push Cowork session metadata into the unified Recents index as sessions
 * are saved. Fail-open: a missing engine or unwritable cache never blocks
 * the SQLite write. Rebuild-on-list still reads this database directly.
 */

import { loadCoreModule } from '../utils/core-loader';
import type { Session } from '../../renderer/types';
import type { DatabaseInstance } from '../db/database';

interface RecentsIndexCore {
  upsertUnifiedSessionRecord(record: {
    id: string;
    origin: 'cli' | 'cowork' | 'mobile';
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    profile?: string;
    sourceId?: string;
    pointer: { kind: 'cowork-db'; coworkId: string };
  }): void;
}

function coworkCanonicalId(sourceId: string): string {
  const safe = sourceId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `cowork-${safe || 'session'}`;
}

export async function syncCoworkSessionToRecentsIndex(
  session: Session,
  db: DatabaseInstance,
): Promise<void> {
  try {
    if (session.source === 'cli-import') return;
    const core = await loadCoreModule<RecentsIndexCore>('persistence/unified-session-index.js');
    if (!core?.upsertUnifiedSessionRecord) return;
    const messageCount = db.messages.getBySessionId(session.id).length;
    const origin = session.source === 'cli-import' ? 'cli' : 'cowork';
    core.upsertUnifiedSessionRecord({
      id: origin === 'cowork' ? coworkCanonicalId(session.id) : session.id,
      origin,
      title: session.title || session.id,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
      messageCount,
      profile: session.intelligence?.profileId,
      sourceId: session.id,
      pointer: { kind: 'cowork-db', coworkId: session.id },
    });
  } catch {
    // Index is a cache. Listing rebuilds from SQLite.
  }
}
