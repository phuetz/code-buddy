import { createServer, type Server } from 'http';
import { once } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';

import { TIMEOUT_CONFIG } from '../../src/config/constants.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  _resetConnectionsForTests,
  getConnectionCount,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';

describe('WebSocket fleet transport lifecycle', () => {
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let client: WebSocket | null = null;

  async function startClient(autoPong: boolean): Promise<WebSocket> {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
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

    client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { autoPong });
    const opened = once(client, 'open');
    const greeted = once(client, 'message');
    await opened;
    await greeted;
    expect(getConnectionCount()).toBe(1);
    return client;
  }

  afterEach(async () => {
    if (client && client.readyState !== WebSocket.CLOSED) {
      client.terminate();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (wss) {
      await new Promise<void>((resolve) => wss?.close(() => resolve()));
    }
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
    }
    client = null;
    wss = null;
    server = null;
    _resetConnectionsForTests();
    vi.useRealTimers();
  });

  it('keeps a silent listener alive when protocol pongs arrive', async () => {
    const socket = await startClient(true);

    for (let sweep = 0; sweep < 3; sweep++) {
      await vi.advanceTimersByTimeAsync(TIMEOUT_CONFIG.WS_HEARTBEAT_INTERVAL);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(getConnectionCount()).toBe(1);
  });

  it('terminates a genuinely idle listener that does not pong', async () => {
    const socket = await startClient(false);
    const closed = once(socket, 'close');

    for (let sweep = 0; sweep < 3; sweep++) {
      await vi.advanceTimersByTimeAsync(TIMEOUT_CONFIG.WS_HEARTBEAT_INTERVAL);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await closed;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(getConnectionCount()).toBe(0);
  });
});
