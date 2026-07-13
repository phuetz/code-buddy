import type { DatabaseInstance } from '../db/database';
import type { SessionTextBlob } from './media-session-index';

interface MediaMessageRow {
  session_id: string;
  content: string;
}

interface MediaMessageStatement {
  all(): MediaMessageRow[];
}

interface RawDatabaseLike {
  prepare(sql: string): MediaMessageStatement;
}

const statements = new WeakMap<object, MediaMessageStatement>();

export function queryMediaMessageBlobs(
  database: Pick<DatabaseInstance, 'raw'>
): SessionTextBlob[] {
  const raw = database.raw as unknown as RawDatabaseLike;
  let statement = statements.get(database.raw);
  if (!statement) {
    statement = raw.prepare(`
      SELECT session_id, content
      FROM messages
      WHERE role = 'assistant'
        AND content LIKE '%MEDIA:%'
    `);
    statements.set(database.raw, statement);
  }

  return statement.all().map((row) => ({
    sessionId: row.session_id,
    text: row.content,
  }));
}
