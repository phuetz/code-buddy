import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUserToken } from '../../src/server/auth/jwt.js';
import { SessionStore } from '../../src/persistence/session-store.js';
import { mobilePwaRouter } from '../../src/server/mobile/index.js';
import {
  setResumeSessionStoreFactoryForTests,
  setResumeTurnRunnerForTests,
} from '../../src/server/mobile/resume-sessions.js';

const SECRET = 'mobile-resume-sessions-test-secret-32b';

describe('mobile resume sessions API', () => {
  const previousDir = process.env.CODEBUDDY_SESSIONS_DIR;
  const previousSecret = process.env.JWT_SECRET;
  const previousOwner = process.env.CODEBUDDY_OWNER_USER_ID;
  const previousCowork = process.env.CODEBUDDY_COWORK_DB;
  const previousIndex = process.env.CODEBUDDY_RECENTS_INDEX;
  let sessionsDir: string;
  let server: http.Server;
  let baseUrl: string;
  let store: SessionStore;

  beforeEach(async () => {
    sessionsDir = mkdtempSync(path.join(os.tmpdir(), 'cb-resume-sess-'));
    mkdirSync(sessionsDir, { recursive: true });
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
    process.env.CODEBUDDY_RECENTS_INDEX = path.join(sessionsDir, 'recents-index.json');
    process.env.CODEBUDDY_COWORK_DB = path.join(sessionsDir, 'missing-cowork.db');
    process.env.JWT_SECRET = SECRET;
    delete process.env.CODEBUDDY_OWNER_USER_ID;
    store = new SessionStore({ useSQLite: false });
    setResumeSessionStoreFactoryForTests(() => new SessionStore({ useSQLite: false }));
    setResumeTurnRunnerForTests(async ({ message }) => ({ reply: `suite:${message}` }));
    const app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected port');
    baseUrl = `http://127.0.0.1:${address.port}/__codebuddy__/mobile`;
  });

  afterEach(async () => {
    setResumeTurnRunnerForTests(null);
    setResumeSessionStoreFactoryForTests(null);
    if (previousDir === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = previousDir;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousOwner === undefined) delete process.env.CODEBUDDY_OWNER_USER_ID;
    else process.env.CODEBUDDY_OWNER_USER_ID = previousOwner;
    if (previousCowork === undefined) delete process.env.CODEBUDDY_COWORK_DB;
    else process.env.CODEBUDDY_COWORK_DB = previousCowork;
    if (previousIndex === undefined) delete process.env.CODEBUDDY_RECENTS_INDEX;
    else process.env.CODEBUDDY_RECENTS_INDEX = previousIndex;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  async function seedSession(opts: {
    name: string;
    ownerUserId?: string;
    origin?: 'cli' | 'cowork';
    secretLine?: string;
  }): Promise<string> {
    const session = await store.createSession(opts.name, 'test-model');
    session.messages = [
      {
        type: 'user',
        content: opts.secretLine ?? 'bonjour depuis la CLI',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant',
        content: 'réponse CLI',
        timestamp: new Date().toISOString(),
      },
    ];
    session.metadata = {
      ...(opts.ownerUserId ? { ownerUserId: opts.ownerUserId } : {}),
      ...(opts.origin === 'cowork'
        ? { handoffSource: 'cowork', handoffSourceId: 'cowork-gui-1' }
        : {}),
    };
    await store.saveSession(session);
    return session.id;
  }

  function token(userId: string): string {
    return createUserToken(userId, ['chat'], SECRET);
  }

  it('lists recent sessions with origin and hides another profile', async () => {
    const mine = await seedSession({ name: 'Ma session CLI', ownerUserId: 'alice' });
    const cowork = await seedSession({
      name: 'Export Cowork',
      ownerUserId: 'alice',
      origin: 'cowork',
    });
    await seedSession({ name: 'Session de Bob', ownerUserId: 'bob' });

    const res = await fetch(`${baseUrl}/sessions`, {
      headers: { Authorization: `Bearer ${token('alice')}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      sessions: Array<{ id: string; title: string; origin: string; messageCount: number }>;
    };
    const ids = body.sessions.map((row) => row.id);
    expect(ids).toContain(mine);
    expect(ids).toContain(cowork);
    expect(body.sessions.find((row) => row.id === cowork)?.origin).toBe('cowork');
    expect(body.sessions.find((row) => row.id === mine)?.origin).toBe('cli');
    expect(body.sessions.some((row) => row.title === 'Session de Bob')).toBe(false);
    expect(JSON.stringify(body)).not.toContain(token('alice'));
  });

  it('returns session detail without secrets or tokens', async () => {
    const id = await seedSession({
      name: 'Secrète',
      ownerUserId: 'alice',
      secretLine: 'voici sk-abcdefghijklmnopqrstuvwxyz1234567890 merci',
    });
    const jwt = token('alice');
    const res = await fetch(`${baseUrl}/sessions/${id}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { messages: Array<{ role: string; content: string }> };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]?.content).toContain('[REDACTED:OPENAI_KEY]');
    expect(body.messages[0]?.content).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(JSON.stringify(body)).not.toContain(jwt);
  });

  it('continues the same session and refuses another profile', async () => {
    const id = await seedSession({ name: 'À poursuivre', ownerUserId: 'alice' });
    const continued = await fetch(`${baseUrl}/sessions/${id}/continue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token('alice')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'et ensuite ?' }),
    });
    expect(continued.status).toBe(200);
    const payload = await continued.json() as { id: string; reply: string; messageCount: number };
    expect(payload.id).toBe(id);
    expect(payload.reply).toBe('suite:et ensuite ?');
    expect(payload.messageCount).toBe(4);

    const reloaded = await store.loadSession(id);
    expect(reloaded?.messages.map((row) => row.content)).toEqual([
      'bonjour depuis la CLI',
      'réponse CLI',
      'et ensuite ?',
      'suite:et ensuite ?',
    ]);

    const denied = await fetch(`${baseUrl}/sessions/${id}`, {
      headers: { Authorization: `Bearer ${token('bob')}` },
    });
    expect(denied.status).toBe(404);

    const deniedContinue = await fetch(`${baseUrl}/sessions/${id}/continue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token('bob')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'intrus' }),
    });
    expect(deniedContinue.status).toBe(404);
    const afterDeny = await store.loadSession(id);
    expect(afterDeny?.messages).toHaveLength(4);
  });

  it('lists a Cowork SQLite session without a handoff export', async () => {
    const { loadBetterSqlite3Sync } = await import('../../src/database/optional-sqlite.js');
    const dbPath = path.join(sessionsDir, 'cowork.db');
    process.env.CODEBUDDY_COWORK_DB = dbPath;
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
      'gui-live',
      'Sans export',
      'cowork',
      null,
      Date.parse('2026-09-17T15:00:00.000Z'),
      Date.parse('2026-09-17T15:01:00.000Z'),
    );
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(
      'm1',
      'gui-live',
      'user',
      JSON.stringify([{ type: 'text', text: 'depuis Cowork' }]),
      Date.parse('2026-09-17T15:00:00.000Z'),
    );
    db.close();

    const res = await fetch(`${baseUrl}/sessions`, {
      headers: { Authorization: `Bearer ${token('alice')}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ id: string; origin: string; title: string }> };
    expect(body.sessions.find((row) => row.id === 'cowork-gui-live')).toMatchObject({
      origin: 'cowork',
      title: 'Sans export',
    });
  });

  it('requires a JWT even on loopback and rejects traversal ids', async () => {
    const unauth = await fetch(`${baseUrl}/sessions`);
    expect(unauth.status).toBe(401);

    const traversal = await fetch(`${baseUrl}/sessions/${encodeURIComponent('../secret')}`, {
      headers: { Authorization: `Bearer ${token('alice')}` },
    });
    expect(traversal.status).toBe(404);
  });
});
