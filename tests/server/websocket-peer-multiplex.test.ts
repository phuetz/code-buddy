import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketServer } from 'ws';

import { FleetListener } from '../../src/fleet/fleet-listener.js';
import { createApiKey, deleteApiKey } from '../../src/server/auth/api-keys.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import { setupWebSocket } from '../../src/server/websocket/handler.js';
import {
  registerPeerMethod,
  unregisterPeerMethod,
} from '../../src/server/websocket/peer-rpc.js';

describe('WebSocket peer RPC multiplexing', () => {
  const userId = 'peer-multiplex-test';
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let listener: FleetListener | null = null;
  let keyId: string | null = null;

  afterEach(async () => {
    unregisterPeerMethod('test.concurrent');
    if (listener) await listener.disconnect().catch(() => undefined);
    if (wss) await new Promise<void>((resolve) => wss?.close(() => resolve()));
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
    }
    if (keyId) deleteApiKey(keyId, userId);
    listener = null;
    wss = null;
    server = null;
    keyId = null;
  });

  it('runs two correlated peer requests concurrently on one connection', async () => {
    const created = createApiKey({
      name: userId,
      userId,
      scopes: ['peer:invoke'],
    });
    keyId = created.apiKey.id;
    server = createServer();
    wss = await setupWebSocket(server, {
      ...DEFAULT_SERVER_CONFIG,
      authEnabled: true,
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP server address');
    }
    listener = new FleetListener({
      url: `ws://127.0.0.1:${address.port}/ws`,
      apiKey: created.key,
    });
    await listener.connect();

    let started = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    registerPeerMethod('test.concurrent', async (params) => {
      started += 1;
      await gate;
      return { value: params.value };
    });

    const first = listener.request('test.concurrent', { value: 'first' });
    const second = listener.request('test.concurrent', { value: 'second' });
    try {
      await vi.waitFor(() => expect(started).toBe(2), { timeout: 1_000 });
    } finally {
      release?.();
    }

    await expect(Promise.all([first, second])).resolves.toEqual([
      { value: 'first' },
      { value: 'second' },
    ]);
  });
});
