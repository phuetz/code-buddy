import { createServer, type Server } from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocketServer } from 'ws';

import { FleetListener } from '../../src/fleet/fleet-listener.js';
import { createApiKey, deleteApiKey } from '../../src/server/auth/api-keys.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  PEER_REQUEST_LANE_TIMEOUT_MS,
  resolveWsHeartbeatIntervalMs,
  resolveWsIdleTimeoutMs,
  setupWebSocket,
  shouldTerminateIdleWs,
} from '../../src/server/websocket/handler.js';

/**
 * Live GK17: a /fleet listen client that only receives events, then a slow
 * local peer.chat, was terminated at WS_IDLE_TIMEOUT (60s) because lastActivity
 * only moved on application frames — protocol pings were ignored.
 */
describe('WebSocket idle keepalive for fleet listeners', () => {
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let listener: FleetListener | null = null;
  let keyId: string | null = null;
  const previousIdle = process.env.CODEBUDDY_WS_IDLE_TIMEOUT_MS;
  const previousBeat = process.env.CODEBUDDY_WS_HEARTBEAT_INTERVAL_MS;

  afterEach(async () => {
    if (listener) {
      await listener.disconnect().catch(() => undefined);
    }
    if (wss) {
      await new Promise<void>((resolve) => wss?.close(() => resolve()));
    }
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (keyId) deleteApiKey(keyId, 'idle-keepalive-test');
    listener = null;
    wss = null;
    server = null;
    keyId = null;
    if (previousIdle === undefined) delete process.env.CODEBUDDY_WS_IDLE_TIMEOUT_MS;
    else process.env.CODEBUDDY_WS_IDLE_TIMEOUT_MS = previousIdle;
    if (previousBeat === undefined) delete process.env.CODEBUDDY_WS_HEARTBEAT_INTERVAL_MS;
    else process.env.CODEBUDDY_WS_HEARTBEAT_INTERVAL_MS = previousBeat;
  });

  it('keeps an authenticated receive-only fleet listener alive past idle timeout via ping/pong', async () => {
    process.env.CODEBUDDY_WS_IDLE_TIMEOUT_MS = '800';
    process.env.CODEBUDDY_WS_HEARTBEAT_INTERVAL_MS = '100';

    const created = createApiKey({
      name: 'idle-keepalive-test',
      userId: 'idle-keepalive-test',
      scopes: ['peer:invoke', 'fleet:listen'],
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
    await expect(listener.request('peer.ping', {}, { timeoutMs: 2000 })).resolves.toMatchObject({
      pong: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await expect(listener.request('peer.ping', {}, { timeoutMs: 2000 })).resolves.toMatchObject({
      pong: true,
    });
    expect(listener.isConnected()).toBe(true);
    expect(listener.isAuthenticated()).toBe(true);
  });

  it('does not idle-kill an in-flight peer.chat and honors default 60s timeout', () => {
    expect(resolveWsIdleTimeoutMs({})).toBe(60_000);
    expect(resolveWsHeartbeatIntervalMs({})).toBe(30_000);
    const now = 10_000;
    expect(
      shouldTerminateIdleWs(
        { lastActivity: 0, peerHandlersActive: 1, streaming: false },
        now,
        800,
      ),
    ).toBe(false);
    expect(
      shouldTerminateIdleWs(
        { lastActivity: 0, peerHandlersActive: 0, streaming: true },
        now,
        800,
      ),
    ).toBe(false);
    expect(
      shouldTerminateIdleWs(
        { lastActivity: 0, peerHandlersActive: 0, streaming: false, activeTurn: {} },
        now,
        800,
      ),
    ).toBe(false);
    expect(
      shouldTerminateIdleWs(
        { lastActivity: 0, peerHandlersActive: 0, streaming: false },
        now,
        800,
      ),
    ).toBe(true);
    expect(PEER_REQUEST_LANE_TIMEOUT_MS).toBeGreaterThan(120_000);
  });
});
