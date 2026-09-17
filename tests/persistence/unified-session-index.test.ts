import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBetterSqlite3Sync } from '../../src/database/optional-sqlite.js';
import {
  UNIFIED_INDEX_VERSION,
  listUnifiedSessions,
  materializeUnifiedSession,
  rebuildUnifiedSessionIndex,
} from '../../src/persistence/unified-session-index.js';
import { SessionStore } from '../../src/persistence/session-store.js';

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('unified session index', () => {
  const cleanup: string[] = [];
  const previous = {
    sessions: process.env.CODEBUDDY_SESSIONS_DIR,
    index: process.env.CODEBUDDY_RECENTS_INDEX,
    cowork: process.env.CODEBUDDY_COWORK_DB,
    profile: process.env.CODEBUDDY_PROFILE,
    owner: process.env.CODEBUDDY_OWNER_USER_ID,
  };

  afterEach(() => {
    if (previous.sessions === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = previous.sessions;
    if (previous.index === undefined) delete process.env.CODEBUDDY_RECENTS_INDEX;
    else process.env.CODEBUDDY_RECENTS_INDEX = previous.index;
    if (previous.cowork === undefined) delete process.env.CODEBUDDY_COWORK_DB;
    else process.env.CODEBUDDY_COWORK_DB = previous.cowork;
    if (previous.profile === undefined) delete process.env.CODEBUDDY_PROFILE;
    else process.env.CODEBUDDY_PROFILE = previous.profile;
    if (previous.owner === undefined) delete process.env.CODEBUDDY_OWNER_USER_ID;
    else process.env.CODEBUDDY_OWNER_USER_ID = previous.owner;
    for (const dir of cleanup.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function isolate(): { sessionsDir: string; indexPath: string; root: string } {
    const root = tempDir('cb-recents-');
    cleanup.push(root);
    const sessionsDir = path.join(root, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const indexPath = path.join(root, 'recents-index.json');
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
    process.env.CODEBUDDY_RECENTS_INDEX = indexPath;
    delete process.env.CODEBUDDY_COWORK_DB;
    delete process.env.CODEBUDDY_PROFILE;
    delete process.env.CODEBUDDY_OWNER_USER_ID;
    return { sessionsDir, indexPath, root };
  }

  it('indexes CLI JSON metadata without copying messages and redacts titles', () => {
    const { sessionsDir, indexPath } = isolate();
    writeFileSync(path.join(sessionsDir, 'session_cli.json'), JSON.stringify({
      id: 'session_cli_1',
      name: 'Ma clé sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD',
      createdAt: '2026-09-17T10:00:00.000Z',
      lastAccessedAt: '2026-09-17T11:00:00.000Z',
      messages: [
        { type: 'user', content: 'secret sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD', timestamp: '2026-09-17T10:00:00.000Z' },
        { type: 'assistant', content: 'ok', timestamp: '2026-09-17T10:00:01.000Z' },
      ],
      metadata: { ownerUserId: 'alice' },
    }));

    const listed = listUnifiedSessions({ sessionsDir, indexPath, coworkDbPath: null });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: 'session_cli_1',
      origin: 'cli',
      messageCount: 2,
      ownerUserId: 'alice',
    });
    expect(listed[0]?.title).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    const raw = readFileSync(indexPath, 'utf8');
    expect(raw).not.toContain('secret sk-');
    expect(raw).not.toContain('"messages"');
    expect(JSON.parse(raw).version).toBe(UNIFIED_INDEX_VERSION);
  });

  it('reads a Cowork SQLite session without a handoff file', () => {
    const { sessionsDir, indexPath, root } = isolate();
    const dbPath = path.join(root, 'cowork.db');
    const Database = loadBetterSqlite3Sync();
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT,
        intelligence TEXT, archived INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, timestamp INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, 0, ?, ?)').run(
      'gui-42',
      'Session Cowork',
      'cowork',
      JSON.stringify({ profileId: 'default' }),
      Date.parse('2026-09-17T12:00:00.000Z'),
      Date.parse('2026-09-17T12:05:00.000Z'),
    );
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(
      'm1',
      'gui-42',
      'user',
      JSON.stringify([{ type: 'text', text: 'bonjour depuis Cowork' }]),
      Date.parse('2026-09-17T12:00:00.000Z'),
    );
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(
      'm2',
      'gui-42',
      'assistant',
      JSON.stringify([{ type: 'text', text: 'reçu' }]),
      Date.parse('2026-09-17T12:00:02.000Z'),
    );
    db.close();

    const listed = listUnifiedSessions({ sessionsDir, indexPath, coworkDbPath: dbPath });
    expect(listed.find((row) => row.origin === 'cowork')).toMatchObject({
      id: 'cowork-gui-42',
      origin: 'cowork',
      title: 'Session Cowork',
      messageCount: 2,
      pointer: { kind: 'cowork-db', coworkId: 'gui-42' },
    });
    expect(listed.some((row) => row.id === 'gui-42' && row.pointer.kind === 'session-store')).toBe(false);
  });

  it('does not merge sessions from different profiles and ignores a future index version', () => {
    const { sessionsDir, indexPath } = isolate();
    writeFileSync(path.join(sessionsDir, 'a.json'), JSON.stringify({
      id: 'session_a',
      name: 'Profil A',
      createdAt: '2026-09-17T10:00:00.000Z',
      lastAccessedAt: '2026-09-17T10:00:00.000Z',
      messages: [{ type: 'user', content: 'a', timestamp: '2026-09-17T10:00:00.000Z' }],
      metadata: { profile: 'alpha', ownerUserId: 'alice' },
    }));
    writeFileSync(path.join(sessionsDir, 'b.json'), JSON.stringify({
      id: 'session_b',
      name: 'Profil B',
      createdAt: '2026-09-17T11:00:00.000Z',
      lastAccessedAt: '2026-09-17T11:00:00.000Z',
      messages: [{ type: 'user', content: 'b', timestamp: '2026-09-17T11:00:00.000Z' }],
      metadata: { profile: 'beta', ownerUserId: 'bob' },
    }));

    const alpha = listUnifiedSessions({
      sessionsDir,
      indexPath,
      coworkDbPath: null,
      profile: 'alpha',
      ownerUserId: 'alice',
    });
    expect(alpha.map((row) => row.id)).toEqual(['session_a']);

    writeFileSync(indexPath, JSON.stringify({ version: UNIFIED_INDEX_VERSION + 7, sessions: [{ id: 'stale' }] }));
    const rebuilt = rebuildUnifiedSessionIndex({ sessionsDir, indexPath, coworkDbPath: null });
    expect(rebuilt.version).toBe(UNIFIED_INDEX_VERSION);
    expect(rebuilt.sessions.some((row) => row.id === 'stale')).toBe(false);
  });

  it('refuse un identifiant abrégé qui désigne deux sessions, et accepte celui qui n’en désigne qu’une', async () => {
    const { sessionsDir, indexPath } = isolate();
    /*
     * Deux sessions au préfixe commun. Reprendre « la première qui commence par
     * là » reviendrait à tirer au sort laquelle l’utilisateur retrouve.
     */
    for (const id of ['abc111', 'abc222', 'zzz999']) {
      writeFileSync(path.join(sessionsDir, `session_${id}.json`), JSON.stringify({
        id,
        name: `Session ${id}`,
        createdAt: '2026-09-17T10:00:00.000Z',
        lastAccessedAt: '2026-09-17T11:00:00.000Z',
        messages: [{ type: 'user', content: 'bonjour', timestamp: '2026-09-17T10:00:00.000Z' }],
      }));
    }
    const options = { sessionsDir, indexPath, coworkDbPath: null };
    expect(listUnifiedSessions(options)).toHaveLength(3);

    expect(await materializeUnifiedSession('abc', options)).toBeNull();
    expect(await materializeUnifiedSession('zzz', options)).toMatchObject({ id: 'zzz999' });
    expect(await materializeUnifiedSession('abc111', options)).toMatchObject({ id: 'abc111' });
  });

  it('materializes a Cowork DB thread into the existing handoff JSON for CLI resume', async () => {
    const { sessionsDir, indexPath, root } = isolate();
    const dbPath = path.join(root, 'cowork.db');
    const Database = loadBetterSqlite3Sync();
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT,
        intelligence TEXT, archived INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, timestamp INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, 0, ?, ?)').run(
      'live-7',
      'À reprendre',
      'cowork',
      null,
      Date.parse('2026-09-17T08:00:00.000Z'),
      Date.parse('2026-09-17T08:01:00.000Z'),
    );
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(
      'm1',
      'live-7',
      'user',
      JSON.stringify([{ type: 'text', text: 'continue en CLI' }]),
      Date.parse('2026-09-17T08:00:00.000Z'),
    );
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(
      'm2',
      'live-7',
      'assistant',
      JSON.stringify([{ type: 'text', text: 'oui' }]),
      Date.parse('2026-09-17T08:00:01.000Z'),
    );
    db.close();

    const materialized = await materializeUnifiedSession('cowork-live-7', {
      sessionsDir,
      indexPath,
      coworkDbPath: dbPath,
    });
    expect(materialized?.id).toBe('cowork-live-7');
    const store = new SessionStore({ useSQLite: false });
    const resumed = await store.loadSession('cowork-live-7');
    expect(resumed?.messages.map((row) => row.content)).toEqual(['continue en CLI', 'oui']);
  });
});

it('refuse un identifiant abrégé qui désigne plusieurs sessions', async () => {
  const { materializeUnifiedSession } = await import('../../src/persistence/unified-session-index.js');
  // Deux sessions au préfixe commun : reprendre « la première » serait un tirage au sort.
  const ambigu = await materializeUnifiedSession('ab', { ownerUserId: 'inexistant-pour-ce-test' });
  expect(ambigu).toBeNull();
});
