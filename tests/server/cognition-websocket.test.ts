import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';
import {
  CognitiveHub,
  createInternalCognitivePrincipal,
} from '../../src/cognition/cognitive-hub.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  closeAllConnections,
  registerWebSocketExtension,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';
import { wireCognitionBridge } from '../../src/server/websocket/cognition-bridge.js';

interface ReceivedEvent {
  type: string;
  requestId?: string;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for cognitive WebSocket event');
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function hypothesisDraft(correlationId: string): Record<string, unknown> {
  return {
    kind: 'hypothesis',
    correlationId,
    salience: 0.8,
    confidence: 0.7,
    privacy: 'local-only',
    payload: { summary: `Hypothesis for ${correlationId}` },
  };
}

describe('cognitive WebSocket bridge', () => {
  let server: HttpServer;
  let wss: WebSocketServer;
  let hub: CognitiveHub;
  let ws: WebSocket | undefined;
  let events: ReceivedEvent[];
  let unwire: () => void;
  let wsUrl: string;

  beforeEach(async () => {
    hub = new CognitiveHub();
    unwire = wireCognitionBridge(hub);
    server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
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
    events = [];
  });

  afterEach(async () => {
    ws?.terminate();
    for (const client of wss.clients) client.terminate();
    closeAllConnections();
    unwire();
    hub.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connect(): Promise<void> {
    ws = await new Promise<WebSocket>((resolve, reject) => {
      const client = new WebSocket(wsUrl);
      client.on('message', (data) => {
        events.push(JSON.parse(data.toString()) as ReceivedEvent);
      });
      client.once('open', () => resolve(client));
      client.once('error', reject);
    });
  }

  function send(type: string, payload: unknown, requestId = randomUUID()): string {
    ws?.send(JSON.stringify({ type, requestId, payload }));
    return requestId;
  }

  async function waitFor(type: string, requestId?: string): Promise<ReceivedEvent> {
    await waitUntil(() => events.some(
      (event) => event.type === type && (!requestId || event.requestId === requestId),
    ));
    const event = events.find(
      (candidate) => candidate.type === type && (!requestId || candidate.requestId === requestId),
    );
    if (!event) throw new Error(`missing ${type}`);
    return event;
  }

  it('publishes canonical events and rejects payload-supplied identity fields', async () => {
    await connect();
    const correlationId = 'ws-canonical-identity';
    const publishId = send('cognition.publish', {
      version: 1,
      clientEventId: randomUUID(),
      draft: hypothesisDraft(correlationId),
    });
    const published = await waitFor('cognition.published', publishId);
    const item = published.payload?.item as Record<string, unknown>;

    expect(item.producerId).toMatch(/^cognitive:connection:ws_/);
    expect((item.provenance as Record<string, unknown>).source).toBe(
      'cognitive-bus:websocket:connection',
    );

    const invalidId = send('cognition.publish', {
      version: 1,
      clientEventId: randomUUID(),
      draft: { ...hypothesisDraft('ws-forged-identity'), producerId: 'attacker' },
    });
    const rejected = await waitFor('cognition.error', invalidId);
    expect(rejected.error?.code).toBe('COGNITION_INVALID_REQUEST');
  });

  it('keeps its subscription queue bounded and reports a revision gap on overflow', async () => {
    unwire();
    unwire = wireCognitionBridge(hub, { subscriptionCapacity: 1 });
    await connect();
    const subscribeId = send('cognition.subscribe', { version: 1, afterRevision: 0 });
    await waitFor('cognition.subscribed', subscribeId);

    const internal = createInternalCognitivePrincipal('websocket-test');
    hub.publish(internal, {
      version: 1,
      clientEventId: randomUUID(),
      draft: hypothesisDraft('ws-overflow-gap-1'),
    });
    hub.publish(internal, {
      version: 1,
      clientEventId: randomUUID(),
      draft: hypothesisDraft('ws-overflow-gap-2'),
    });
    const gap = await waitFor('cognition.gap');

    expect(gap.payload).toMatchObject({
      version: 1,
      reason: 'queue-overflow',
      afterRevision: 0,
      throughRevision: 2,
    });
    expect(events.some((event) => event.type === 'cognition.event')).toBe(false);
  });

  it('lets cognition.cancel bypass a blocked per-socket lane', async () => {
    let markStarted: (() => void) | undefined;
    let unblock: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const unregisterBlock = registerWebSocketExtension({
      type: 'test.block',
      async handle(): Promise<void> {
        markStarted?.();
        await blocked;
      },
    });
    try {
      await connect();
      const correlationId = 'ws-cancel-bypass';
      const publishId = send('cognition.publish', {
        version: 1,
        clientEventId: randomUUID(),
        draft: hypothesisDraft(correlationId),
      });
      await waitFor('cognition.published', publishId);

      send('test.block', {});
      await started;
      const cancelId = send('cognition.cancel', { version: 1, correlationId });
      const cancelled = await waitFor('cognition.cancelled', cancelId);
      expect(cancelled.payload?.cancelled).toBe(true);
    } finally {
      unblock?.();
      unregisterBlock();
    }
  });

  it('releases outstanding context leases when the connection closes', async () => {
    const releaseSpy = vi.spyOn(hub, 'releaseContext');
    await connect();
    const publishId = send('cognition.publish', {
      version: 1,
      clientEventId: randomUUID(),
      draft: hypothesisDraft('ws-lease-cleanup'),
    });
    await waitFor('cognition.published', publishId);

    const acquireId = send('cognition.context.acquire', {
      version: 1,
      query: 'Hypothesis lease cleanup',
    });
    const acquired = await waitFor('cognition.context.acquired', acquireId);
    expect(acquired.payload?.leaseId).toEqual(expect.any(String));

    ws?.close();
    await waitUntil(() => releaseSpy.mock.calls.length === 1);
    expect(releaseSpy.mock.calls[0]?.[1]).toMatchObject({
      version: 1,
      leaseId: acquired.payload?.leaseId,
    });
  });
});
