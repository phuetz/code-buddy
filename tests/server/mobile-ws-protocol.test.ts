import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';

vi.mock('../../src/server/agent-adapter.js', () => ({
  createServerAgent: vi.fn(async () => ({
    processUserMessage: vi.fn(async () => []),
    processUserMessageStream: vi.fn(async function* () {
      yield { type: 'content', content: 'hello ' };
      yield { type: 'content', content: 'agent' };
    }),
    getChatHistory: () => [],
    getCurrentModel: () => 'mock-model',
    setModel: vi.fn(),
    setRecoverySessionId: vi.fn(),
    abortCurrentOperation: vi.fn(),
    executeToolByName: vi.fn(),
    systemPromptReady: Promise.resolve(),
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

vi.mock('../../src/sensory/voice-loop.js', () => ({
  defaultReply: vi.fn(async (heard: string) => `lisa:${heard}`),
}));

import { createUserToken } from '../../src/server/auth/jwt.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  closeAllConnections,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';
import {
  _resetFleetRegistryForTests,
  getFleetRegistry,
} from '../../src/fleet/fleet-registry.js';

const SECRET = 'mobile-ws-protocol-test-secret-32b';

type Frame = {
  type: string;
  payload?: Record<string, unknown>;
  error?: { code?: string };
};

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
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

describe('Mobile WS protocol', () => {
  let server: HttpServer;
  let wss: WebSocketServer;
  let wsBase: string;
  const previousSecret = process.env.JWT_SECRET;

  beforeEach(async () => {
    process.env.JWT_SECRET = SECRET;
    _resetFleetRegistryForTests();
    getFleetRegistry().register({
      id: 'agy',
      url: 'ws://127.0.0.1:9/ws',
      startedAt: new Date(),
      eventCount: 0,
      autoReconnect: false,
      maxAttempts: 1,
      listener: {
        disconnect: async () => undefined,
        getReconnectAttempts: () => 0,
        isReconnecting: () => false,
        request: async (method, params) => {
          if (method === 'peer.describe') {
            return { hostname: 'agy-node', methods: ['peer.chat'] };
          }
          if (method === 'peer.chat') {
            return { text: `peer:${String((params as { prompt?: string })?.prompt ?? '')}` };
          }
          throw new Error(method);
        },
        getLastSeen: () => ({ at: Date.now(), reason: 'test', ageMs: 0 }),
        isStale: () => false,
        getPeerCompactionState: () => ({
          active: false,
          startedAt: null,
          ageMs: null,
          lastResult: null,
        }),
        getEventHistory: () => [],
      },
    });
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
    _resetFleetRegistryForTests();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  async function authed(): Promise<{ ws: WebSocket; events: Frame[] }> {
    const ws = await connect(`${wsBase}/ws`);
    const events = collect(ws);
    ws.send(JSON.stringify({
      type: 'authenticate',
      payload: { token: createUserToken('mobile-user', ['chat'], SECRET) },
    }));
    await waitUntil(() => events.some((event) => event.type === 'authenticated'));
    return { ws, events };
  }

  it('streams agent chat with the real event names', async () => {
    const { ws, events } = await authed();
    ws.send(JSON.stringify({
      type: 'chat',
      payload: { message: 'ping agent', stream: true, assistant: 'agent' },
    }));
    await waitUntil(() => events.some((event) => event.type === 'stream_end'));
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'authenticated',
      'stream_start',
      'stream_chunk',
      'stream_end',
    ]));
    const text = events
      .filter((event) => event.type === 'stream_chunk')
      .map((event) => event.payload?.delta)
      .join('');
    expect(text).toBe('hello agent');
    ws.close();
  });

  it('routes assistant=companion to defaultReply', async () => {
    const { ws, events } = await authed();
    ws.send(JSON.stringify({
      type: 'chat',
      payload: { message: 'salut', stream: true, assistant: 'companion' },
    }));
    await waitUntil(() => events.some((event) => event.type === 'stream_end'));
    const text = events
      .filter((event) => event.type === 'stream_chunk')
      .map((event) => event.payload?.delta)
      .join('');
    expect(text).toBe('lisa:salut');
    ws.close();
  });

  it('routes peer chat through the fleet registry peer.chat', async () => {
    const { ws, events } = await authed();
    ws.send(JSON.stringify({
      type: 'chat',
      payload: { message: 'hi', stream: false, assistant: 'peer', peerId: 'agy' },
    }));
    await waitUntil(() => events.some((event) => event.type === 'chat_response'));
    const response = events.find((event) => event.type === 'chat_response');
    expect(response?.payload?.content).toBe('peer:hi');
    ws.close();
  });

  it('answers ping with pong', async () => {
    const { ws, events } = await authed();
    ws.send(JSON.stringify({ type: 'ping' }));
    await waitUntil(() => events.some((event) => event.type === 'pong'));
    ws.close();
  });
});
