import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocketServer } from 'ws';

import { FleetListener } from '../../src/fleet/fleet-listener.js';
import { createApiKey, deleteApiKey } from '../../src/server/auth/api-keys.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import { setupWebSocket } from '../../src/server/websocket/handler.js';

describe('WebSocket peer request security', () => {
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let listener: FleetListener | null = null;
  let keyId: string | null = null;

  afterEach(async () => {
    if (listener) {
      await listener.disconnect().catch(() => undefined);
    }
    if (wss) {
      await new Promise<void>((resolve) => wss?.close(() => resolve()));
    }
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => error ? reject(error) : resolve());
      });
    }
    if (keyId) deleteApiKey(keyId, 'peer-rate-limit-test');
    listener = null;
    wss = null;
    server = null;
    keyId = null;
  });

  it('returns a correlated RATE_LIMITED response after 30 peer requests per minute', async () => {
    const created = createApiKey({
      name: 'peer-rate-limit-test',
      userId: 'peer-rate-limit-test',
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

    for (let request = 0; request < 30; request++) {
      await expect(listener.request('peer.ping')).resolves.toMatchObject({ pong: true });
    }

    await expect(listener.request('peer.ping')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringContaining('RATE_LIMITED'),
    });
    expect(listener.getPendingRequestCount()).toBe(0);
  });
});
