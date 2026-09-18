import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';

const addedHistoryEntries: Array<{ role: string; content: string }> = [];
let exportStateCalled = false;
let importStateCalled = false;

vi.mock('../../src/server/agent-adapter.js', () => ({
  createServerAgent: vi.fn(async () => ({
    processUserMessage: vi.fn(async () => []),
    processUserMessageStream: vi.fn(async function* (input: string) {
      yield { type: 'content', content: `Réponse agent à: ${input}` };
    }),
    getChatHistory: () => addedHistoryEntries,
    getCurrentModel: () => 'mock-model',
    setModel: vi.fn(),
    setRecoverySessionId: vi.fn(),
    abortCurrentOperation: vi.fn(),
    executeToolByName: vi.fn(),
    systemPromptReady: Promise.resolve(),
    exportConversationState: vi.fn(() => {
      exportStateCalled = true;
      return { messages: [{ old: 'state' }], chatHistory: [] };
    }),
    importConversationState: vi.fn(() => {
      importStateCalled = true;
    }),
    addToHistory: vi.fn((entry: { role: string; content: string }) => {
      addedHistoryEntries.push(entry);
    }),
  })),
  listServerModels: vi.fn(() => []),
  runAgentCompletion: vi.fn(),
  streamAgentDeltas: vi.fn(async function* (
    agent: {
      processUserMessageStream(input: string): AsyncIterable<{ type: string; content?: string }>;
    },
    input: string,
  ) {
    for await (const chunk of agent.processUserMessageStream(input)) {
      if (chunk.type === 'content' && chunk.content) yield chunk.content;
    }
  }),
}));

import { SessionStore } from '../../src/persistence/session-store.js';
import { createUserToken } from '../../src/server/auth/jwt.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  closeAllConnections,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';

const SECRET = 'mobile-ws-resume-test-secret-32b';

type Frame = {
  type: string;
  id?: string;
  payload?: Record<string, unknown>;
  error?: { code?: string; message?: string };
};

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function collect(ws: WebSocket): Frame[] {
  const events: Frame[] = [];
  ws.on('message', (data) => {
    events.push(JSON.parse(data.toString()) as Frame);
  });
  return events;
}

describe('Mobile WebSocket resume session handling', () => {
  let server: HttpServer;
  let wss: WebSocketServer;
  let wsBase: string;
  let sessionsDir: string;
  let store: SessionStore;

  const previousSecret = process.env.JWT_SECRET;
  const previousSessionsDir = process.env.CODEBUDDY_SESSIONS_DIR;
  const previousRecentsIndex = process.env.CODEBUDDY_RECENTS_INDEX;
  const previousCoworkDb = process.env.CODEBUDDY_COWORK_DB;

  beforeEach(async () => {
    addedHistoryEntries.length = 0;
    exportStateCalled = false;
    importStateCalled = false;

    sessionsDir = mkdtempSync(path.join(os.tmpdir(), 'cb-ws-resume-'));
    mkdirSync(sessionsDir, { recursive: true });
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
    process.env.CODEBUDDY_RECENTS_INDEX = path.join(sessionsDir, 'recents-index.json');
    process.env.CODEBUDDY_COWORK_DB = path.join(sessionsDir, 'missing-cowork.db');
    process.env.JWT_SECRET = SECRET;

    store = new SessionStore({ useSQLite: false });

    server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });

    wss = await setupWebSocket(server, {
      ...DEFAULT_SERVER_CONFIG,
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      jwtSecret: SECRET,
      websocketEnabled: true,
      cors: false,
      logging: false,
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    wsBase = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    closeAllConnections();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));

    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousSessionsDir === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = previousSessionsDir;
    if (previousRecentsIndex === undefined) delete process.env.CODEBUDDY_RECENTS_INDEX;
    else process.env.CODEBUDDY_RECENTS_INDEX = previousRecentsIndex;
    if (previousCoworkDb === undefined) delete process.env.CODEBUDDY_COWORK_DB;
    else process.env.CODEBUDDY_COWORK_DB = previousCoworkDb;

    rmSync(sessionsDir, { recursive: true, force: true });
  });

  async function authedClient(userId: string): Promise<{ ws: WebSocket; events: Frame[] }> {
    const ws = await connect(`${wsBase}/ws`);
    const events = collect(ws);
    ws.send(JSON.stringify({
      type: 'authenticate',
      payload: { token: createUserToken(userId, ['chat'], SECRET) },
    }));
    await waitUntil(() => events.some((event) => event.type === 'authenticated'));
    return { ws, events };
  }

  it('loads session, hydrates agent with seed history, and persists the turn with streaming', async () => {
    // 1. Initial seed session belonging to alice
    const session = await store.createSession('Session CLI Alice');
    session.metadata = {
      ownerUserId: 'alice',
      handoffSource: 'cli',
    };
    session.messages = [
      { type: 'user', content: 'Message initial utilisateur', timestamp: '2026-09-17T10:00:00.000Z' },
      { type: 'assistant', content: 'Réponse initiale assistant', timestamp: '2026-09-17T10:00:01.000Z' },
    ];
    await store.saveSession(session);
    const targetSessionId = session.id;

    // 2. Connect alice via WebSocket
    const { ws, events } = await authedClient('alice');

    // 3. Send chat message referencing sessionId with streaming
    ws.send(JSON.stringify({
      type: 'chat',
      payload: {
        message: 'Suite du travail en mobile',
        sessionId: targetSessionId,
        stream: true,
        assistant: 'agent',
      },
    }));

    await waitUntil(() => events.some((event) => event.type === 'stream_end'));

    // 4. Verification: agent hydration
    expect(exportStateCalled).toBe(true);
    expect(importStateCalled).toBe(true);
    expect(addedHistoryEntries).toHaveLength(2);
    expect(addedHistoryEntries[0]).toEqual({
      role: 'user',
      content: 'Message initial utilisateur',
    });
    expect(addedHistoryEntries[1]).toEqual({
      role: 'assistant',
      content: 'Réponse initiale assistant',
    });

    // 5. Verification: turn persisted to SessionStore
    await waitUntil(async () => {
      const s = await store.loadSession(targetSessionId);
      return s?.messages.length === 4;
    });
    const reloaded = await store.loadSession(targetSessionId);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.messages).toHaveLength(4);
    expect(reloaded!.messages[2]).toMatchObject({
      type: 'user',
      content: 'Suite du travail en mobile',
    });
    expect(reloaded!.messages[3]).toMatchObject({
      type: 'assistant',
      content: 'Réponse agent à: Suite du travail en mobile',
    });
    expect(reloaded!.metadata).toMatchObject({
      lastSurface: 'mobile',
      ownerUserId: 'alice',
    });

    // 6. Send a second turn on the same connection: agent must NOT re-seed history
    addedHistoryEntries.length = 0;
    ws.send(JSON.stringify({
      type: 'chat',
      payload: {
        message: 'Deuxième tour mobile',
        sessionId: targetSessionId,
        stream: false,
        assistant: 'agent',
      },
    }));

    await waitUntil(() => events.some((event) => event.type === 'chat_response'));

    // The agent history was NOT re-seeded because state.resumeSessionId already matched
    expect(addedHistoryEntries).toHaveLength(0);

    // Wait until persistMobileResumeTurn completes
    await waitUntil(async () => {
      const reloaded2 = await store.loadSession(targetSessionId);
      return reloaded2?.messages.length === 6;
    });

    const reloaded2 = await store.loadSession(targetSessionId);
    expect(reloaded2!.messages[4]?.content).toBe('Deuxième tour mobile');
    expect(reloaded2!.messages[5]?.content).toBe('Réponse agent à: Deuxième tour mobile');

    ws.close();
  });

  it('rejects resume when session belongs to a different owner', async () => {
    // Session owned by alice
    const session = await store.createSession('Session Secrète Alice');
    session.metadata = {
      ownerUserId: 'alice',
    };
    session.messages = [
      { type: 'user', content: 'Secret confidentiel', timestamp: '2026-09-17T10:00:00.000Z' },
    ];
    await store.saveSession(session);
    const targetSessionId = session.id;

    // Bob tries to resume Alice's session
    const { ws, events } = await authedClient('bob');

    ws.send(JSON.stringify({
      type: 'chat',
      payload: {
        message: 'Puis-je voir la session ?',
        sessionId: targetSessionId,
        stream: true,
        assistant: 'agent',
      },
    }));

    await waitUntil(() => events.some((event) => event.type === 'error'));

    const errorEvent = events.find((event) => event.type === 'error');
    expect(errorEvent?.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Session not found',
    });

    // Session remains unchanged (Bob could not append)
    const reloaded = await store.loadSession(targetSessionId);
    expect(reloaded!.messages).toHaveLength(1);

    ws.close();
  });

  it('rejects resume for non-existent session', async () => {
    const { ws, events } = await authedClient('alice');

    ws.send(JSON.stringify({
      type: 'chat',
      payload: {
        message: 'Reprise inconnue',
        sessionId: 'session_introuvable_xyz',
        stream: true,
        assistant: 'agent',
      },
    }));

    await waitUntil(() => events.some((event) => event.type === 'error'));

    const errorEvent = events.find((event) => event.type === 'error');
    expect(errorEvent?.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Session not found',
    });

    ws.close();
  });
});
