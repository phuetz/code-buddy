import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SqliteSessionBranchStore } from '../src/main/session/sqlite-session-branches';
import { SessionBranchingBridge } from '../src/main/session/session-branching';
import type { DatabaseInstance } from '../src/main/db/database';

const require = createRequire(import.meta.url);
let BetterSqlite: (new (path: string) => import('better-sqlite3').Database) | null = null;
for (const candidate of [
  'better-sqlite3',
  resolve(process.cwd(), '..', 'node_modules', 'better-sqlite3'),
]) {
  try {
    const loaded = require(candidate) as new (path: string) => import('better-sqlite3').Database;
    const probe = new loaded(':memory:');
    probe.close();
    BetterSqlite = loaded;
    break;
  } catch {
    // Electron and Node can use different native ABIs in local development.
  }
}

function fixture() {
  const database = new BetterSqlite!(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      claude_session_id TEXT,
      openai_thread_id TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      token_usage TEXT,
      execution_time_ms INTEGER,
      metadata TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE trace_steps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      is_error INTEGER,
      timestamp INTEGER NOT NULL,
      duration INTEGER,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    INSERT INTO sessions(id, claude_session_id, openai_thread_id, updated_at)
      VALUES ('session-1', 'claude-hidden-history', 'openai-hidden-history', 1);
  `);
  const insert = database.prepare(`
    INSERT INTO messages
      (id, session_id, role, content, timestamp, token_usage, execution_time_ms, metadata)
    VALUES (?, 'session-1', ?, ?, ?, NULL, NULL, NULL)
  `);
  insert.run('m1', 'user', '[{"type":"text","text":"one"}]', 1);
  insert.run('m2', 'assistant', '[{"type":"text","text":"two"}]', 2);
  insert.run('m3', 'user', '[{"type":"text","text":"three"}]', 3);
  const insertTrace = database.prepare(`
    INSERT INTO trace_steps
      (id, session_id, type, status, title, content, tool_name, tool_input,
       tool_output, is_error, timestamp, duration)
    VALUES (?, 'session-1', 'tool', 'completed', ?, NULL, NULL, NULL, NULL, 0, ?, NULL)
  `);
  insertTrace.run('t1', 'trace one', 1);
  insertTrace.run('t2', 'trace two', 2);
  insertTrace.run('t3', 'trace three', 3);
  return {
    database,
    store: new SqliteSessionBranchStore({ raw: database } as DatabaseInstance),
    ids: () =>
      (database
        .prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY timestamp, rowid')
        .all('session-1') as Array<{ id: string }>).map((row) => row.id),
    traceIds: () =>
      (database
        .prepare('SELECT id FROM trace_steps WHERE session_id = ? ORDER BY timestamp, rowid')
        .all('session-1') as Array<{ id: string }>).map((row) => row.id),
  };
}

describe.skipIf(!BetterSqlite)('SqliteSessionBranchStore', () => {
  it('forks inclusively from a persisted message and restores exact SQLite histories', () => {
    const { database, store, ids } = fixture();
    expect(store.list('session-1')).toEqual([
      expect.objectContaining({ id: 'main', messageCount: 3, isCurrent: true }),
    ]);

    const fork = store.fork('session-1', 'alternative', { messageId: 'm2' });
    expect(fork.branch).toMatchObject({
      parentId: 'main',
      parentMessageId: 'm2',
      parentMessageIndex: 1,
      messageCount: 2,
      isCurrent: true,
    });
    expect(ids()).toEqual(['m1', 'm2']);

    database.prepare(`
      INSERT INTO messages
        (id, session_id, role, content, timestamp, token_usage, execution_time_ms, metadata)
      VALUES ('m4', 'session-1', 'user', '[]', 4, NULL, NULL, NULL)
    `).run();
    store.checkout('session-1', 'main');
    expect(ids()).toEqual(['m1', 'm2', 'm3']);
    expect(database.prepare('SELECT claude_session_id, openai_thread_id FROM sessions').get())
      .toEqual({ claude_session_id: null, openai_thread_id: null });

    // A fresh store instance proves branch state survives process restart.
    const restoredStore = new SqliteSessionBranchStore({ raw: database } as DatabaseInstance);
    restoredStore.checkout('session-1', fork.branch.id);
    expect(ids()).toEqual(['m1', 'm2', 'm4']);
    expect(restoredStore.list('session-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fork.branch.id, messageCount: 3, isCurrent: true }),
        expect.objectContaining({ id: 'main', messageCount: 3, isCurrent: false }),
      ]),
    );
    database.close();
  });

  it('rolls back checkout when a stored snapshot is corrupt', () => {
    const { database, store, ids } = fixture();
    const fork = store.fork('session-1', 'safe fork', { messageId: 'm1' });
    store.checkout('session-1', 'main');
    const before = ids();
    database
      .prepare(
        'UPDATE conversation_branches SET snapshot = ? WHERE session_id = ? AND id = ?',
      )
      .run('{broken', 'session-1', fork.branch.id);

    expect(() => store.checkout('session-1', fork.branch.id)).toThrow(/corrupted/);
    expect(ids()).toEqual(before);
    expect(
      database
        .prepare(
          'SELECT id FROM conversation_branches WHERE session_id = ? AND is_current = 1',
        )
        .get('session-1'),
    ).toEqual({ id: 'main' });
    database.close();
  });

  it('rejects missing fork points without changing the active rows', () => {
    const { database, store, ids } = fixture();
    const before = ids();
    expect(() => store.fork('session-1', 'bad fork', { messageId: 'missing' })).toThrow(
      /no longer exists/,
    );
    expect(ids()).toEqual(before);
    expect(store.list('session-1')).toHaveLength(1);
    database.close();
  });

  it('rolls the SQLite fork back when journal-fence capture cannot commit', () => {
    const { database, store, ids } = fixture();
    const before = ids();

    expect(() =>
      store.fork('session-1', 'must roll back', { messageId: 'm2' }, () => {
        throw new Error('journal rotation failed');
      }),
    ).toThrow(/journal rotation failed/);

    expect(ids()).toEqual(before);
    expect(store.list('session-1')).toEqual([
      expect.objectContaining({ id: 'main', isCurrent: true, messageCount: 3 }),
    ]);
    database.close();
  });

  it('restores branch-local trace steps without leaking later branch work', () => {
    const { database, store, traceIds } = fixture();
    store.list('session-1');
    const fork = store.fork('session-1', 'trace fork', { messageId: 'm2' });
    expect(traceIds()).toEqual(['t1', 't2']);

    database.prepare(`
      INSERT INTO trace_steps
        (id, session_id, type, status, title, content, tool_name, tool_input,
         tool_output, is_error, timestamp, duration)
      VALUES ('t4', 'session-1', 'tool', 'completed', 'branch-only', NULL,
              NULL, NULL, NULL, 0, 4, NULL)
    `).run();

    store.checkout('session-1', 'main');
    expect(traceIds()).toEqual(['t1', 't2', 't3']);
    store.checkout('session-1', fork.branch.id);
    expect(traceIds()).toEqual(['t1', 't2', 't4']);
    database.close();
  });

  it('keeps append merge order when source messages and traces have older timestamps', () => {
    const { database, store, ids, traceIds } = fixture();
    const fork = store.fork('session-1', 'old timestamps', { messageId: 'm2' });
    database.prepare(`
      INSERT INTO messages
        (id, session_id, role, content, timestamp, token_usage, execution_time_ms, metadata)
      VALUES ('m4', 'session-1', 'assistant', '[]', 0, NULL, NULL, NULL)
    `).run();
    database.prepare(`
      INSERT INTO trace_steps
        (id, session_id, type, status, title, content, tool_name, tool_input,
         tool_output, is_error, timestamp, duration)
      VALUES ('t4', 'session-1', 'tool', 'completed', 'old trace', NULL,
              NULL, NULL, NULL, 0, 0, NULL)
    `).run();
    store.checkout('session-1', 'main');

    store.merge('session-1', fork.branch.id, 'append');

    expect(ids()).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(traceIds()).toEqual(['t1', 't2', 't3', 't4']);
    const timestamps = database
      .prepare('SELECT timestamp FROM messages WHERE session_id = ? ORDER BY timestamp, rowid')
      .all('session-1') as Array<{ timestamp: number }>;
    expect(timestamps.map((row) => row.timestamp)).toEqual([1, 2, 3, 4]);
    database.close();
  });

  it('commits the recovery-journal fence atomically with a branch mutation', () => {
    const { database, store, ids } = fixture();
    const fence = { byteOffset: 321, prefixSha256: 'a'.repeat(64) };
    store.fork('session-1', 'fenced', { messageId: 'm2' }, () => fence);
    expect(
      database
        .prepare(
          `SELECT byte_offset, prefix_sha256
             FROM conversation_branch_journal_fences
            WHERE session_id = ?`,
        )
        .get('session-1'),
    ).toEqual({ byte_offset: 321, prefix_sha256: 'a'.repeat(64) });

    const before = ids();
    expect(() =>
      store.merge('session-1', 'main', 'replace', () => {
        throw new Error('capture failed');
      }),
    ).toThrow(/capture failed/);
    expect(ids()).toEqual(before);
    expect(
      database
        .prepare('SELECT byte_offset FROM conversation_branch_journal_fences WHERE session_id = ?')
        .get('session-1'),
    ).toEqual({ byte_offset: 321 });
    database.close();
  });

  it('keeps a committed checkout safe when post-commit journal rotation fails', async () => {
    const { database } = fixture();
    const resetConversation = vi.fn();
    const bridge = new SessionBranchingBridge(
      { raw: database } as DatabaseInstance,
      {
        isBusy: () => false,
        captureRecoveryJournalFence: () => ({
          byteOffset: 99,
          prefixSha256: 'b'.repeat(64),
        }),
        rotateRecoveryJournal: () => {
          throw new Error('simulated filesystem failure');
        },
        resetConversation,
        getMessages: () => [],
      },
    );

    const result = await bridge.fork('session-1', 'durable despite cleanup', {
      messageId: 'm2',
    });

    expect(result).toMatchObject({ success: true, branch: { messageCount: 2 } });
    expect(resetConversation).toHaveBeenCalledWith('session-1');
    expect(
      database
        .prepare('SELECT byte_offset FROM conversation_branch_journal_fences WHERE session_id = ?')
        .get('session-1'),
    ).toEqual({ byte_offset: 99 });
    database.close();
  });
});
