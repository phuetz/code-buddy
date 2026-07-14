import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketServer } from 'ws';
import {
  CognitiveBusClient,
  CognitiveBusClientError,
} from '../../src/cognition/cognitive-bus-client.js';
import {
  CognitiveHub,
  createInternalCognitivePrincipal,
  type CognitiveSubscriptionEvent,
} from '../../src/cognition/cognitive-hub.js';
import type { CognitiveDraft } from '../../src/cognition/cognitive-wire-contract.js';
import { createCognitionRoutes } from '../../src/server/routes/cognition.js';
import { wireCognitionBridge } from '../../src/server/websocket/cognition-bridge.js';
import { closeAllConnections, setupWebSocket } from '../../src/server/websocket/handler.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for cognitive client state');
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function hypothesis(correlationId: string, summary = correlationId): CognitiveDraft {
  return {
    kind: 'hypothesis',
    correlationId,
    salience: 0.8,
    confidence: 0.7,
    privacy: 'local-only',
    payload: { summary },
  };
}

describe('CognitiveBusClient', () => {
  let server: HttpServer;
  let wss: WebSocketServer;
  let hub: CognitiveHub;
  let client: CognitiveBusClient | undefined;
  let unwire: () => void;
  let wsUrl: string;
  let httpBaseUrl: string;

  beforeEach(async () => {
    hub = new CognitiveHub();
    unwire = wireCognitionBridge(hub);
    const app = express();
    app.use((req, _res, next) => {
      req.auth = {
        userId: 'cognitive-client-test',
        scopes: [
          'cognition:raw',
          'cognition:read',
          'cognition:read-local',
          'cognition:write',
          'cognition:write-local',
          'cognition:sense',
        ],
        type: 'user',
      };
      next();
    });
    app.use('/api/cognition', createCognitionRoutes(hub));
    server = createServer(app);
    wss = await setupWebSocket(server, {
      ...DEFAULT_SERVER_CONFIG,
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: true,
      cors: false,
      corsOrigins: '*',
      logging: false,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${address.port}/ws`;
    httpBaseUrl = `http://127.0.0.1:${address.port}/api/cognition`;
  });

  afterEach(async () => {
    await client?.disconnect();
    for (const socket of wss.clients) socket.terminate();
    closeAllConnections();
    unwire();
    hub.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function createClient(
    options: Partial<ConstructorParameters<typeof CognitiveBusClient>[0]> = {}
  ) {
    client = new CognitiveBusClient({
      wsUrl,
      httpBaseUrl,
      reconnectInitialMs: 50,
      reconnectMaxMs: 100,
      ...options,
    });
    return client;
  }

  it('subscribes, recovers a snapshot, and publishes canonical events', async () => {
    const internal = createInternalCognitivePrincipal('client-preexisting');
    hub.publish(internal, {
      version: 1,
      clientEventId: randomUUID(),
      draft: hypothesis('client-preexisting', 'preexisting context'),
    });
    const events: CognitiveSubscriptionEvent[] = [];
    const bus = createClient();
    bus.subscribe((event) => events.push(event));

    await bus.connect();
    expect(events.map((event) => event.item.correlationId)).toContain('client-preexisting');

    const ack = await bus.publish(hypothesis('client-live', 'live context'));
    await waitUntil(() => events.some((event) => event.item.id === ack.item.id));

    expect(ack.item.producerId).toMatch(/^cognitive:connection:ws_/);
    expect(ack.item.provenance.source).toBe('cognitive-bus:websocket:connection');
    expect(bus.currentRevision).toBeGreaterThanOrEqual(2);
  });

  it('recovers every event after a bounded server subscription gap', async () => {
    unwire();
    unwire = wireCognitionBridge(hub, { subscriptionCapacity: 1 });
    const events: CognitiveSubscriptionEvent[] = [];
    const bus = createClient({ snapshotPageSize: 1 });
    bus.subscribe((event) => events.push(event));
    await bus.connect();

    const internal = createInternalCognitivePrincipal('client-gap');
    for (const suffix of ['one', 'two', 'three']) {
      hub.publish(internal, {
        version: 1,
        clientEventId: randomUUID(),
        draft: hypothesis(`client-gap-${suffix}`),
      });
    }

    await waitUntil(
      () =>
        events.filter((event) => event.item.correlationId.startsWith('client-gap-')).length === 3
    );
    expect(new Set(events.map((event) => event.item.id)).size).toBe(events.length);
    expect(bus.currentRevision).toBe(3);
  });

  it('replays the disconnected window before resuming live delivery', async () => {
    const events: CognitiveSubscriptionEvent[] = [];
    const bus = createClient();
    bus.subscribe((event) => events.push(event));
    await bus.connect();

    const disconnected = new Promise<void>((resolve) => bus.once('disconnected', () => resolve()));
    for (const socket of wss.clients) socket.terminate();
    await disconnected;

    const internal = createInternalCognitivePrincipal('client-reconnect');
    hub.publish(internal, {
      version: 1,
      clientEventId: randomUUID(),
      draft: hypothesis('client-disconnected-window'),
    });

    await waitUntil(() => bus.isReady);
    await waitUntil(() =>
      events.some((event) => event.item.correlationId === 'client-disconnected-window')
    );
    expect(bus.currentRevision).toBe(1);
  });

  it('invalidates a context lease when its owning socket disconnects', async () => {
    const bus = createClient();
    await bus.connect();
    await bus.publish(hypothesis('client-lease', 'lease context'));
    const lease = await bus.acquireContext({ query: 'lease context' });
    expect(lease.leaseId).toEqual(expect.any(String));

    const disconnected = new Promise<void>((resolve) => bus.once('disconnected', () => resolve()));
    for (const socket of wss.clients) socket.terminate();
    await disconnected;

    await expect(lease.commit()).rejects.toMatchObject<CognitiveBusClientError>({
      code: 'COGNITION_LEASE_LOST',
    });
  });

  it('settles a lease exactly once when commit and release race', async () => {
    const bus = createClient();
    await bus.connect();
    await bus.publish(hypothesis('client-settlement-race', 'settlement context'));
    const lease = await bus.acquireContext({ query: 'settlement context' });
    expect(lease.leaseId).toEqual(expect.any(String));
    const commit = vi.spyOn(hub, 'commitContext');
    const release = vi.spyOn(hub, 'releaseContext');

    await expect(Promise.all([lease.commit(), lease.release()])).resolves.toEqual([
      undefined,
      undefined,
    ]);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it('refuses plaintext cognitive transport to a non-loopback host', () => {
    expect(
      () =>
        new CognitiveBusClient({
          wsUrl: 'ws://darkstar.example:3000/ws',
        })
    ).toThrowError(expect.objectContaining({ code: 'COGNITION_INSECURE_TRANSPORT' }));
  });
});
