import { createServer, type Server } from 'http';
import { once } from 'events';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';

import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  _registerConnectionForTests,
  _resetConnectionsForTests,
  broadcast,
  resolveNoAuthScopes,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';

describe('WebSocket no-auth scopes', () => {
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let client: WebSocket | null = null;

  afterEach(async () => {
    if (client && client.readyState !== WebSocket.CLOSED) {
      client.terminate();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (wss) await new Promise<void>((resolve) => wss?.close(() => resolve()));
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
    }
    client = null;
    wss = null;
    server = null;
    _resetConnectionsForTests();
  });

  it('grants fleet and peer scopes to no-auth loopback clients and broadcasts events', async () => {
    server = createServer();
    wss = await setupWebSocket(server, {
      ...DEFAULT_SERVER_CONFIG,
      authEnabled: false,
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP server address');
    }

    client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    const greetingReceived = once(client, 'message');
    await once(client, 'open');
    const [greetingData] = await greetingReceived;
    const greeting = JSON.parse(greetingData.toString()) as {
      payload: { scopes: string[] };
    };
    expect(greeting.payload.scopes).toEqual(expect.arrayContaining([
      'tools',
      'tools:execute',
      'fleet:listen',
      'peer:invoke',
    ]));

    const eventReceived = once(client, 'message');
    broadcast({ type: 'fleet:peer:heartbeat', payload: { alive: true } }, 'fleet:listen');
    const [eventData] = await eventReceived;
    expect(JSON.parse(eventData.toString())).toMatchObject({
      type: 'fleet:peer:heartbeat',
      payload: { alive: true },
    });
  });

  it('does not grant or broadcast fleet events to simulated remote no-auth clients', () => {
    const scopes = resolveNoAuthScopes('192.168.1.50');
    expect(scopes).not.toContain('fleet:listen');
    expect(scopes).not.toContain('peer:invoke');
    expect(scopes).not.toContain('tools:execute');

    const sent: string[] = [];
    const remoteSocket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: (message: string) => sent.push(message),
    };
    const now = Date.now();
    _registerConnectionForTests(remoteSocket as unknown as WebSocket, {
      id: 'remote-no-auth',
      authenticated: true,
      scopes,
      lastActivity: now,
      streaming: false,
      authAttempts: 0,
      authWindowStart: now,
      messageCount: 0,
      messageWindowStart: now,
      toolCount: 0,
      toolWindowStart: now,
      peerRequestCount: 0,
      peerWindowStart: now,
      peerHandlersActive: 0,
      peerHandlerQueue: [],
      droppedBroadcasts: 0,
    });

    broadcast({ type: 'fleet:peer:heartbeat', payload: {} }, 'fleet:listen');
    expect(sent).toHaveLength(0);
  });
});
