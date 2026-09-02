import fs from 'fs';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/persistence/session-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/persistence/session-store.js')>();
  return {
    ...actual,
    SessionStore: class extends actual.SessionStore {
      constructor() {
        super({ useSQLite: false });
      }
    },
  };
});

describe('session HTTP writes survive a store restart', () => {
  let server: Server;
  let baseUrl: string;
  let sessionsDir: string;
  let previousSessionsDir: string | undefined;

  beforeAll(async () => {
    previousSessionsDir = process.env.CODEBUDDY_SESSIONS_DIR;
    sessionsDir = path.join(process.cwd(), '.test-r21', `sessions-${process.pid}`);
    fs.rmSync(sessionsDir, { recursive: true, force: true });
    fs.mkdirSync(sessionsDir, { recursive: true });
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;

    const { default: sessionsRoutes } = await import('../../src/server/routes/sessions.js');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { scopes: ['admin'], type: 'api_key' };
      next();
    });
    app.use('/api/sessions', sessionsRoutes);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (previousSessionsDir === undefined) {
      delete process.env.CODEBUDDY_SESSIONS_DIR;
    } else {
      process.env.CODEBUDDY_SESSIONS_DIR = previousSessionsDir;
    }
    fs.rmSync(sessionsDir, { recursive: true, force: true });
  });

  it('persiste création, mise à jour, message et fork', async () => {
    const createdResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'R21 initiale',
        description: 'description créée',
        metadata: { ticket: 'R21' },
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string };

    const updatedResponse = await fetch(`${baseUrl}/api/sessions/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'R21 renommée',
        description: 'description mise à jour',
        metadata: { ticket: 'R21', updated: true },
      }),
    });
    expect(updatedResponse.status).toBe(200);

    const messageResponse = await fetch(`${baseUrl}/api/sessions/${created.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: 'message persistant' }),
    });
    expect(messageResponse.status).toBe(201);

    const forkResponse = await fetch(`${baseUrl}/api/sessions/${created.id}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'R21 fork', description: 'fork persistant' }),
    });
    expect(forkResponse.status).toBe(201);
    const forked = await forkResponse.json() as { id: string };

    const { SessionStore } = await import('../../src/persistence/session-store.js');
    const restartedStore = new SessionStore();
    const reloadedOriginal = await restartedStore.loadSession(created.id);
    const reloadedFork = await restartedStore.loadSession(forked.id);

    expect(reloadedOriginal).toMatchObject({
      name: 'R21 renommée',
      description: 'description mise à jour',
      metadata: { ticket: 'R21', updated: true },
      messages: [expect.objectContaining({ type: 'user', content: 'message persistant' })],
    });
    expect(reloadedFork).toMatchObject({
      name: 'R21 fork',
      description: 'fork persistant',
      metadata: expect.objectContaining({ forkedFrom: created.id }),
    });
  });
});
