import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';

const { wsAgents, createMockWsAgent } = vi.hoisted(() => {
  type MockMessage = { role: string; content: string };
  type MockState = {
    messages: MockMessage[];
    chatHistory: MockMessage[];
    sessionCost: number;
    routingSessionCost: number;
    workingDirectory: string;
    contextManagerState: { sessionId: string };
  };

  const wsAgents: Array<{
    addToHistory: ReturnType<typeof vi.fn>;
    getChatHistory: () => MockMessage[];
  }> = [];

  function createMockWsAgent() {
    const state: MockState = {
      messages: [],
      chatHistory: [],
      sessionCost: 0,
      routingSessionCost: 0,
      workingDirectory: '/ws-mock',
      contextManagerState: { sessionId: 'ws-mock' },
    };
    const agent = {
      processUserMessage: vi.fn(async () => []),
      processUserMessageStream: vi.fn(async function* () {
        yield { type: 'content', content: 'hello ' };
        yield { type: 'content', content: 'agent' };
      }),
      getChatHistory: () => structuredClone(state.chatHistory),
      getCurrentModel: () => 'mock-model',
      setModel: vi.fn(),
      setRecoverySessionId: vi.fn(),
      addToHistory: vi.fn((message: MockMessage) => {
        state.messages.push({ ...message });
        state.chatHistory.push({ ...message });
      }),
      exportConversationState: () => structuredClone(state),
      importConversationState: (next: MockState) => {
        state.messages = structuredClone(next.messages ?? []);
        state.chatHistory = structuredClone(next.chatHistory ?? []);
        state.sessionCost = next.sessionCost;
        state.routingSessionCost = next.routingSessionCost;
        state.workingDirectory = next.workingDirectory;
        state.contextManagerState = structuredClone(next.contextManagerState);
      },
      abortCurrentOperation: vi.fn(),
      executeToolByName: vi.fn(),
      systemPromptReady: Promise.resolve(),
    };
    wsAgents.push(agent);
    return agent;
  }

  return { wsAgents, createMockWsAgent };
});

vi.mock('../../src/server/agent-adapter.js', () => ({
  createServerAgent: vi.fn(async () => createMockWsAgent()),
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

import { createUserToken } from '../../src/server/auth/jwt.js';
import { SessionStore } from '../../src/persistence/session-store.js';
import { mobilePwaRouter } from '../../src/server/mobile/index.js';
import {
  resetSessionTurnQueueForTests,
  setResumeSessionStoreFactoryForTests,
  setResumeTurnRunnerForTests,
} from '../../src/server/mobile/resume-sessions.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  closeAllConnections,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';

const SECRET = 'shared-session-test-secret-32bytes!!';

type Frame = {
  type: string;
  payload?: Record<string, unknown>;
  error?: { code?: string };
};

async function waitUntil(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out');
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

describe('shared session — HTTP + two WebSocket clients', () => {
  const previousDir = process.env.CODEBUDDY_SESSIONS_DIR;
  const previousSecret = process.env.JWT_SECRET;
  const previousOwner = process.env.CODEBUDDY_OWNER_USER_ID;
  const previousHistory = process.env.CODEBUDDY_MOBILE_HISTORY;
  let sessionsDir: string;
  let store: SessionStore;
  let httpServer: HttpServer;
  let apiBase: string;
  let wsServer: HttpServer;
  let wss: WebSocketServer;
  let wsBase: string;

  beforeEach(async () => {
    sessionsDir = mkdtempSync(path.join(os.tmpdir(), 'cb-shared-sess-'));
    mkdirSync(sessionsDir, { recursive: true });
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
    process.env.JWT_SECRET = SECRET;
    process.env.CODEBUDDY_MOBILE_HISTORY = 'false';
    delete process.env.CODEBUDDY_OWNER_USER_ID;
    store = new SessionStore({ useSQLite: false });
    setResumeSessionStoreFactoryForTests(() => new SessionStore({ useSQLite: false }));
    setResumeTurnRunnerForTests(async ({ message }) => ({ reply: `suite:${message}` }));
    resetSessionTurnQueueForTests();
    wsAgents.length = 0;

    const app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    httpServer = await new Promise<HttpServer>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const httpAddr = httpServer.address();
    if (!httpAddr || typeof httpAddr === 'string') throw new Error('expected port');
    apiBase = `http://127.0.0.1:${httpAddr.port}/__codebuddy__/mobile`;

    wsServer = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    wss = await setupWebSocket(wsServer, {
      ...DEFAULT_SERVER_CONFIG,
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      jwtSecret: SECRET,
      websocketEnabled: true,
      cors: false,
      logging: false,
    });
    await new Promise<void>((resolve) => wsServer.listen(0, '127.0.0.1', resolve));
    wsBase = `ws://127.0.0.1:${(wsServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    closeAllConnections();
    setResumeTurnRunnerForTests(null);
    setResumeSessionStoreFactoryForTests(null);
    resetSessionTurnQueueForTests();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => wsServer.close(() => resolve()));
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    if (previousDir === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = previousDir;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousOwner === undefined) delete process.env.CODEBUDDY_OWNER_USER_ID;
    else process.env.CODEBUDDY_OWNER_USER_ID = previousOwner;
    if (previousHistory === undefined) delete process.env.CODEBUDDY_MOBILE_HISTORY;
    else process.env.CODEBUDDY_MOBILE_HISTORY = previousHistory;
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  function token(userId: string): string {
    return createUserToken(userId, ['chat'], SECRET);
  }

  async function seedOwned(): Promise<string> {
    const session = await store.createSession('Session partagée', 'test-model');
    session.messages = [
      { type: 'user', content: 'déjà là', timestamp: new Date().toISOString() },
      { type: 'assistant', content: 'ok', timestamp: new Date().toISOString() },
    ];
    session.metadata = { ownerUserId: 'alice', authorizedUserIds: ['bob'] };
    await store.saveSession(session);
    return session.id;
  }

  async function authed(userId: string): Promise<{ ws: WebSocket; events: Frame[] }> {
    const ws = await connect(`${wsBase}/ws`);
    const events = collect(ws);
    ws.send(JSON.stringify({
      type: 'authenticate',
      payload: { token: token(userId) },
    }));
    await waitUntil(() => events.some((event) => event.type === 'authenticated'));
    return { ws, events };
  }

  it('broadcasts ordered session_message frames to the other attached client', async () => {
    const sessionId = await seedOwned();
    const alice = await authed('alice');
    const bob = await authed('bob');

    alice.ws.send(JSON.stringify({
      type: 'session.attach',
      payload: { sessionId, surface: 'cli' },
    }));
    bob.ws.send(JSON.stringify({
      type: 'session.attach',
      payload: { sessionId, surface: 'mobile' },
    }));
    await waitUntil(() => alice.events.some((event) => event.type === 'session_attached'));
    await waitUntil(() => bob.events.some((event) => event.type === 'session_attached'));

    alice.ws.send(JSON.stringify({
      type: 'chat',
      payload: {
        message: 'depuis alice',
        stream: false,
        assistant: 'agent',
        sessionId,
        surface: 'cli',
      },
    }));
    await waitUntil(() => bob.events.some((event) =>
      event.type === 'session_message' && event.payload?.role === 'assistant'));

    const live = bob.events.filter((event) => event.type === 'session_message');
    expect(live.map((event) => event.payload?.role)).toEqual(['user', 'assistant']);
    expect(live[0]?.payload?.authorUserId).toBe('alice');
    expect(live[0]?.payload?.content).toBe('depuis alice');
    expect(live[1]?.payload?.authorUserId).toBe('assistant');
    expect(live[1]?.payload?.content).toBe('hello agent');
    expect(Number(live[0]?.payload?.seq)).toBeLessThan(Number(live[1]?.payload?.seq));
    expect(JSON.stringify(bob.events)).not.toContain(token('alice'));
    expect(JSON.stringify(bob.events)).not.toContain(token('bob'));

    alice.ws.close();
    bob.ws.close();
  });

  it('updates presence on attach and detach', async () => {
    const sessionId = await seedOwned();
    const alice = await authed('alice');
    const bob = await authed('bob');

    alice.ws.send(JSON.stringify({
      type: 'session.attach',
      payload: { sessionId, surface: 'cowork' },
    }));
    await waitUntil(() => alice.events.some((event) => event.type === 'session_attached'));

    bob.ws.send(JSON.stringify({
      type: 'session.attach',
      payload: { sessionId, surface: 'mobile' },
    }));
    await waitUntil(() => {
      const presence = alice.events.filter((event) => event.type === 'session_presence');
      const last = presence[presence.length - 1];
      const participants = last?.payload?.participants as Array<{ userId: string }> | undefined;
      return (participants?.length ?? 0) >= 2;
    });

    const presence = await fetch(`${apiBase}/sessions/${sessionId}/presence`, {
      headers: { Authorization: `Bearer ${token('alice')}` },
    });
    expect(presence.status).toBe(200);
    const listed = await presence.json() as {
      participants: Array<{ userId: string; surface: string }>;
    };
    const users = listed.participants.map((row) => row.userId).sort();
    expect(users).toEqual(['alice', 'bob']);
    expect(JSON.stringify(listed)).not.toContain(token('alice'));

    bob.ws.close();
    await waitUntil(() => {
      const frames = alice.events.filter((event) => event.type === 'session_presence');
      const last = frames[frames.length - 1];
      const participants = last?.payload?.participants as Array<{ userId: string }> | undefined;
      return participants?.length === 1 && participants[0]?.userId === 'alice';
    });

    alice.ws.close();
  });

  it('refuses an unauthorized profile with NOT_FOUND and leaves existing chat intact', async () => {
    const sessionId = await seedOwned();
    const carol = await authed('carol');
    carol.ws.send(JSON.stringify({
      type: 'session.attach',
      payload: { sessionId, surface: 'cli' },
    }));
    await waitUntil(() => carol.events.some((event) => event.type === 'error'));
    expect(carol.events.find((event) => event.type === 'error')?.error?.code).toBe('NOT_FOUND');

    const httpDenied = await fetch(`${apiBase}/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${token('carol')}` },
    });
    expect(httpDenied.status).toBe(404);

    const lonely = await authed('alice');
    lonely.ws.send(JSON.stringify({
      type: 'chat',
      payload: { message: 'ping agent', stream: true, assistant: 'agent' },
    }));
    await waitUntil(() => lonely.events.some((event) => event.type === 'stream_end'));
    const text = lonely.events
      .filter((event) => event.type === 'stream_chunk')
      .map((event) => event.payload?.delta)
      .join('');
    expect(text).toBe('hello agent');
    expect(lonely.events.some((event) => event.type === 'session_message')).toBe(false);

    carol.ws.close();
    lonely.ws.close();
  });

  it('serializes two concurrent continues without mixing authors', async () => {
    const sessionId = await seedOwned();
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let started = 0;
    setResumeTurnRunnerForTests(async ({ message, userId }) => {
      started += 1;
      if (started === 1) await gate;
      return { reply: `${userId}:${message}` };
    });

    const first = fetch(`${apiBase}/sessions/${sessionId}/continue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token('alice')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'alpha' }),
    });
    await waitUntil(() => started === 1);
    const second = fetch(`${apiBase}/sessions/${sessionId}/continue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token('bob')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'beta' }),
    });
    releaseFirst?.();
    const [resA, resB] = await Promise.all([first, second]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const reloaded = await store.loadSession(sessionId);
    const authored = (reloaded?.messages ?? []).filter((row) => row.type === 'user' && row.seq);
    expect(authored).toHaveLength(2);
    expect(authored[0]?.content).toBe('alpha');
    expect(authored[0]?.authorUserId).toBe('alice');
    expect(authored[1]?.content).toBe('beta');
    expect(authored[1]?.authorUserId).toBe('bob');
    expect(Number(authored[0]?.seq)).toBeLessThan(Number(authored[1]?.seq));
  });

  it('lets the owner grant a profile and never echoes the JWT', async () => {
    const sessionId = await seedOwned();
    const granted = await fetch(`${apiBase}/sessions/${sessionId}/grant`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token('alice')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: 'dana' }),
    });
    expect(granted.status).toBe(200);
    const body = await granted.json() as { authorizedUserIds: string[] };
    expect(body.authorizedUserIds).toContain('bob');
    expect(body.authorizedUserIds).toContain('dana');
    expect(JSON.stringify(body)).not.toContain(token('alice'));

    const dana = await fetch(`${apiBase}/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${token('dana')}` },
    });
    expect(dana.status).toBe(200);
  });

  it('uses the attached boundSessionId when chat omits sessionId', async () => {
    const sessionId = await seedOwned();
    const alice = await authed('alice');
    alice.ws.send(JSON.stringify({
      type: 'session.attach',
      payload: { sessionId, surface: 'cli' },
    }));
    await waitUntil(() => alice.events.some((event) => event.type === 'session_attached'));

    alice.ws.send(JSON.stringify({
      type: 'chat',
      payload: { message: 'sans sessionId', stream: false, assistant: 'agent' },
    }));
    await waitUntil(() => alice.events.some((event) =>
      event.type === 'session_message' && event.payload?.role === 'user'));

    const live = alice.events.filter((event) => event.type === 'session_message');
    expect(live[0]?.payload?.content).toBe('sans sessionId');
    expect(live[0]?.payload?.authorUserId).toBe('alice');
    const reloaded = await store.loadSession(sessionId);
    expect(reloaded?.messages.some((row) => row.content === 'sans sessionId')).toBe(true);
    alice.ws.close();
  });

  it('rehydrates a WS agent when another participant advanced seq', async () => {
    const sessionId = await seedOwned();
    const alice = await authed('alice');
    const bob = await authed('bob');
    alice.ws.send(JSON.stringify({
      type: 'session.attach',
      payload: { sessionId, surface: 'cli' },
    }));
    bob.ws.send(JSON.stringify({
      type: 'session.attach',
      payload: { sessionId, surface: 'mobile' },
    }));
    await waitUntil(() => alice.events.some((event) => event.type === 'session_attached'));
    await waitUntil(() => bob.events.some((event) => event.type === 'session_attached'));

    alice.ws.send(JSON.stringify({
      type: 'chat',
      payload: { message: 'depuis alice', stream: false, assistant: 'agent', sessionId },
    }));
    await waitUntil(() => bob.events.some((event) =>
      event.type === 'session_message' && event.payload?.role === 'assistant'));

    bob.ws.send(JSON.stringify({
      type: 'chat',
      payload: { message: 'depuis bob', stream: false, assistant: 'agent', sessionId },
    }));
    await waitUntil(() => alice.events.some((event) =>
      event.type === 'session_message'
      && event.payload?.role === 'user'
      && event.payload?.authorUserId === 'bob'));

    alice.ws.send(JSON.stringify({
      type: 'chat',
      payload: { message: 'alice encore', stream: false, assistant: 'agent' },
    }));
    await waitUntil(() => alice.events.filter((event) => event.type === 'chat_response').length >= 2);

    const aliceHistory = wsAgents[0]?.getChatHistory() ?? [];
    expect(aliceHistory.some((row) => row.content === 'depuis bob')).toBe(true);
    alice.ws.close();
    bob.ws.close();
  });

  it('serializes grant behind an in-flight continue so neither write is lost', async () => {
    const sessionId = await seedOwned();
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let started = 0;
    setResumeTurnRunnerForTests(async ({ message }) => {
      started += 1;
      if (started === 1) await gate;
      return { reply: `suite:${message}` };
    });

    const continueP = fetch(`${apiBase}/sessions/${sessionId}/continue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token('alice')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'pendant-grant' }),
    });
    await waitUntil(() => started === 1);
    const grantP = fetch(`${apiBase}/sessions/${sessionId}/grant`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token('alice')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: 'dana' }),
    });
    releaseFirst?.();
    const [continued, granted] = await Promise.all([continueP, grantP]);
    expect(continued.status).toBe(200);
    expect(granted.status).toBe(200);

    const reloaded = await store.loadSession(sessionId);
    expect(reloaded?.messages.some((row) => row.content === 'pendant-grant')).toBe(true);
    const authorized = reloaded?.metadata?.authorizedUserIds;
    expect(Array.isArray(authorized) && authorized.includes('dana')).toBe(true);

    const dana = await fetch(`${apiBase}/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${token('dana')}` },
    });
    expect(dana.status).toBe(200);
  });
});
