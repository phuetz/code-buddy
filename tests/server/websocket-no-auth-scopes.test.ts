import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';

import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import { broadcast, setupWebSocket } from '../../src/server/websocket/handler.js';

interface CapturedClient {
  socket: WebSocket;
  messages: Array<{ type?: string; payload?: Record<string, unknown> }>;
}

describe('WebSocket no-auth scopes', () => {
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (wss) await new Promise<void>((resolve) => wss?.close(() => resolve()));
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
    }
    wss = null;
    server = null;
  });

  async function connect(forwarded = false): Promise<CapturedClient> {
    const address = server?.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP server address');
    }
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
      ...(forwarded ? { headers: { 'x-forwarded-for': '203.0.113.8' } } : {}),
    });
    clients.push(socket);
    const messages: CapturedClient['messages'] = [];
    socket.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as CapturedClient['messages'][number]);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    return { socket, messages };
  }

  it('grants Fleet scopes only to direct loopback clients and broadcasts accordingly', async () => {
    server = createServer();
    wss = await setupWebSocket(server, {
      ...DEFAULT_SERVER_CONFIG,
      authEnabled: false,
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));

    const direct = await connect();
    const proxied = await connect(true);
    const directScopes = direct.messages[0]?.payload?.scopes;
    const proxiedScopes = proxied.messages[0]?.payload?.scopes;

    expect(directScopes).toEqual(expect.arrayContaining([
      'tools',
      'tools:execute',
      'fleet:listen',
      'peer:invoke',
    ]));
    expect(proxiedScopes).not.toEqual(expect.arrayContaining([
      'tools:execute',
      'fleet:listen',
      'peer:invoke',
    ]));

    broadcast({ type: 'fleet:peer:heartbeat', payload: { alive: true } }, 'fleet:listen');
    await vi.waitFor(() => expect(direct.messages).toHaveLength(2));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(direct.messages[1]).toMatchObject({
      type: 'fleet:peer:heartbeat',
      payload: { alive: true },
    });
    expect(proxied.messages).toHaveLength(1);
  });
});
