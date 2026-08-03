import { createServer, type Server } from 'http';
import { once } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';

import { TIMEOUT_CONFIG } from '../../src/config/constants.js';
import { FleetListener } from '../../src/fleet/fleet-listener.js';
import { createApiKey, deleteApiKey } from '../../src/server/auth/api-keys.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  _resetConnectionsForTests,
  getConnectionCount,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';
import {
  registerPeerMethod,
  unregisterPeerMethod,
} from '../../src/server/websocket/peer-rpc.js';

describe('WebSocket fleet transport lifecycle', () => {
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let client: WebSocket | null = null;
  let listener: FleetListener | null = null;
  let keyId: string | null = null;

  async function startClient(autoPong: boolean, authEnabled = false): Promise<WebSocket> {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    server = createServer();
    wss = await setupWebSocket(server, {
      ...DEFAULT_SERVER_CONFIG,
      authEnabled,
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
    unregisterPeerMethod('test.drop-pending');
    if (listener) await listener.disconnect().catch(() => undefined);
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
    listener = null;
    if (keyId) deleteApiKey(keyId, 'websocket-lifecycle-test');
    keyId = null;
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

  it('does not let a never-authenticated client hold its slot by answering pings', async () => {
    // The `ws` library answers server pings on its own (RFC 6455 autoPong).
    // Before the auth deadline, that automatic pong refreshed lastActivity, so
    // a client that never sent a single frame of its own — and never
    // authenticated — kept its connection slot indefinitely.
    const socket = await startClient(true, true);
    const closed = once(socket, 'close');

    for (let sweep = 0; sweep < 3; sweep++) {
      await vi.advanceTimersByTimeAsync(TIMEOUT_CONFIG.WS_HEARTBEAT_INTERVAL);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await closed;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(getConnectionCount()).toBe(0);
  });

  it('keeps a device waiting for operator approval alive past the unauthenticated deadline', async () => {
    // Trouvé par le contre-audit Agy sur mon propre correctif : un appareil qui
    // reçoit PAIRING_PENDING reste `authenticated: false` en attendant qu'un
    // humain lance `buddy gateway devices`. La seule échéance de 30 s coupait
    // donc sa socket avant que l'opérateur ait eu le temps d'approuver, ce qui
    // rendait l'appairage impossible en pratique.
    process.env['CODEBUDDY_GATEWAY_REQUIRE_PAIRING'] = 'true';
    try {
      const socket = await startClient(true, true);
      const reponse = once(socket, 'message');
      socket.send(JSON.stringify({ type: 'authenticate', payload: { deviceId: 'appareil-en-attente' } }));
      // Attend la réponse du serveur : c'est la preuve que l'état est posé.
      const [brut] = await reponse;
      expect(JSON.parse(String(brut)).error.code).toBe('PAIRING_PENDING');

      // Trois balayages, soit bien au-delà des 30 s de l'échéance courte.
      for (let sweep = 0; sweep < 3; sweep++) {
        await vi.advanceTimersByTimeAsync(TIMEOUT_CONFIG.WS_HEARTBEAT_INTERVAL);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      expect(socket.readyState).toBe(WebSocket.OPEN);
      expect(getConnectionCount()).toBe(1);

      // L'attente reste bornée : au-delà du délai d'appairage, la socket tombe.
      const closed = once(socket, 'close');
      await vi.advanceTimersByTimeAsync(TIMEOUT_CONFIG.WS_PAIRING_PENDING_TIMEOUT);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(TIMEOUT_CONFIG.WS_HEARTBEAT_INTERVAL);
      await closed;
      expect(getConnectionCount()).toBe(0);
    } finally {
      delete process.env['CODEBUDDY_GATEWAY_REQUIRE_PAIRING'];
    }
  });

  it('rejects a pending FleetListener request immediately when its socket drops', async () => {
    const created = createApiKey({
      name: 'websocket-lifecycle-test',
      userId: 'websocket-lifecycle-test',
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

    let markStarted: (() => void) | undefined;
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    registerPeerMethod('test.drop-pending', async () => {
      markStarted?.();
      await gate;
      return { tooLate: true };
    });

    const outcome = listener.request('test.drop-pending', {}, { timeoutMs: 1_000 }).then(
      () => ({ code: 'OK' }),
      (error: Error & { code?: string }) => ({ code: error.code ?? 'UNKNOWN' }),
    );
    await started;
    const droppedAt = Date.now();
    for (const socket of wss.clients) socket.terminate();

    try {
      await expect(outcome).resolves.toEqual({ code: 'DISCONNECTED' });
      expect(Date.now() - droppedAt).toBeLessThan(1_000);
    } finally {
      release?.();
      listener = null;
    }
  });
});
