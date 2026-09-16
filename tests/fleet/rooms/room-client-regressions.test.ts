import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

import {
  FleetRoomClient,
  RoomClientError,
  type RoomCursor,
} from '../../../src/fleet/rooms/room-client.js';
import {
  buildRoomMessage,
  generateRoomSecretKey,
  signRoomEvent,
  type RoomEvent,
} from '../../../src/fleet/rooms/room-event.js';

const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';

interface ClientFrame {
  type: string;
  id?: string;
  payload?: Record<string, unknown>;
}

interface TestHub {
  url: string;
  frames: ClientFrame[];
  sockets: WebSocket[];
  onFrame?: (socket: WebSocket, frame: ClientFrame) => void;
  close(): Promise<void>;
}

const clients: FleetRoomClient[] = [];
const hubs: TestHub[] = [];

function send(socket: WebSocket, type: string, payload: Record<string, unknown>, requestId?: string): void {
  socket.send(JSON.stringify({ type, ...(requestId ? { requestId } : {}), payload }));
}

async function startHub(): Promise<TestHub> {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const hub: TestHub = {
    url: '',
    frames: [],
    sockets: [],
    close: async () => {
      for (const socket of hub.sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  wss.on('connection', (socket) => {
    hub.sockets.push(socket);
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as ClientFrame;
      hub.frames.push(frame);
      if (frame.type === 'fleet.rooms.hello') {
        send(socket, 'fleet.rooms.challenge', { challenge: 'a'.repeat(64) }, frame.id);
      } else if (frame.type === 'fleet.rooms.auth') {
        const event = frame.payload?.event as RoomEvent;
        send(socket, 'fleet.rooms.auth', {
          ok: true,
          pubkey: event.pubkey,
          name: 'test-member',
          rooms: [{ room: 'general', access: 'write' }],
        }, frame.id);
      } else if (frame.type === 'fleet.rooms.close') {
        send(socket, 'fleet.rooms.unsubscribed', {
          subId: frame.payload?.subId,
          closed: true,
        }, frame.id);
      }
      hub.onFrame?.(socket, frame);
    });
    send(socket, 'connected', {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  hub.url = `ws://127.0.0.1:${address.port}`;
  hubs.push(hub);
  return hub;
}

function createClient(hub: TestHub, secretKey = generateRoomSecretKey()): FleetRoomClient {
  const client = new FleetRoomClient({
    url: hub.url,
    secretKey,
    requestTimeoutMs: 500,
    reconnectInitialDelayMs: 10,
    reconnectMaxDelayMs: 20,
    reconnectMaxAttempts: 5,
  });
  clients.push(client);
  return client;
}

function event(secretKey: string, content: string, room = 'general'): RoomEvent {
  return signRoomEvent(buildRoomMessage({ room, content }, undefined), secretKey);
}

function streamEvent(socket: WebSocket, subId: string, seq: number, value: RoomEvent): void {
  send(socket, 'fleet.rooms.event', { subId, seq, event: value });
}

function eose(
  socket: WebSocket,
  subId: string,
  storeId: string,
  throughSeq: number,
  options: { live?: boolean; gap?: boolean; epochChanged?: boolean } = {},
): void {
  const live = options.live ?? true;
  send(socket, 'fleet.rooms.eose', {
    subId,
    storeId,
    throughSeq,
    live,
    truncated: !live,
    gap: options.gap ?? false,
    epochChanged: options.epochChanged ?? false,
  });
}

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(hubs.splice(0).map((hub) => hub.close()));
  vi.restoreAllMocks();
});

describe('FleetRoomClient regressions', () => {
  it('shares one connection attempt and ignores a duplicate connected frame', async () => {
    const hub = await startHub();
    const client = createClient(hub);
    const first = client.connect();
    const second = client.connect();

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ pubkey: client.pubkey });
    send(hub.sockets[0]!, 'connected', {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(hub.sockets).toHaveLength(1);
    expect(hub.frames.filter((frame) => frame.type === 'fleet.rooms.hello')).toHaveLength(1);
  });

  it('ignores stream messages left queued on a socket replaced during reconnection', async () => {
    const hub = await startHub();
    const author = generateRoomSecretKey();
    const client = createClient(hub);
    const received: string[] = [];
    await client.connect();
    client.subscribe('stale', [{ '#h': ['general'] }], {
      onMessage: (message) => received.push(message.text),
    });
    const oldSocket = hub.sockets[0]!;

    const replacement = (client as unknown as { open(): Promise<unknown> }).open();
    await replacement;
    await vi.waitFor(() => expect(hub.sockets).toHaveLength(2));
    const currentSocket = hub.sockets[1]!;
    streamEvent(oldSocket, 'stale', 1, event(author, 'stale'));
    streamEvent(currentSocket, 'stale', 2, event(author, 'current'));
    await vi.waitFor(() => expect(received).toEqual(['current']));
  });

  it('resets the replay high-water mark when the ledger generation changes', async () => {
    const hub = await startHub();
    const author = generateRoomSecretKey();
    const client = createClient(hub);
    let subscriptionRound = 0;
    const sentCursors: Array<RoomCursor | undefined> = [];
    hub.onFrame = (socket, frame) => {
      if (frame.type !== 'fleet.rooms.subscribe') return;
      subscriptionRound++;
      const payload = frame.payload ?? {};
      sentCursors.push(typeof payload.storeId === 'string'
        ? { storeId: payload.storeId, throughSeq: payload.afterSeq as number }
        : undefined);
      if (subscriptionRound === 1) {
        streamEvent(socket, 'timeline', 1_000, event(author, 'old'));
        eose(socket, 'timeline', STORE_A, 1_000);
        queueMicrotask(() => socket.close());
      } else if (subscriptionRound === 2) {
        streamEvent(socket, 'timeline', 1, event(author, 'new-1'));
        streamEvent(socket, 'timeline', 2, event(author, 'new-2'));
        eose(socket, 'timeline', STORE_B, 2, { epochChanged: true });
        queueMicrotask(() => socket.close());
      }
    };

    await client.connect();
    client.subscribe('timeline', [{ '#h': ['general'] }], { onMessage: () => undefined });
    await vi.waitFor(() => expect(subscriptionRound).toBeGreaterThanOrEqual(3), { timeout: 2_000 });

    expect(sentCursors[1]).toEqual({ storeId: STORE_A, throughSeq: 1_000 });
    expect(sentCursors[2]).toEqual({ storeId: STORE_B, throughSeq: 2 });
  });

  it('deep-copies filters and rejects a valid signed event outside the complete filter', async () => {
    const hub = await startHub();
    const allowed = generateRoomSecretKey();
    const denied = generateRoomSecretKey();
    const member = generateRoomSecretKey();
    const client = createClient(hub, member);
    const received: string[] = [];
    const invalid = vi.fn();
    client.on('invalid-event', invalid);
    await client.connect();
    const rooms = ['general'];
    const authors = [client.pubkey];
    client.subscribe('filtered', [{ '#h': rooms, authors }], {
      onMessage: (message) => received.push(message.text),
    });
    rooms[0] = 'mutated';
    authors[0] = allowed;

    const socket = hub.sockets[0]!;
    streamEvent(socket, 'filtered', 1, event(denied, 'wrong author'));
    streamEvent(socket, 'filtered', 2, event(member, 'accepted'));
    eose(socket, 'filtered', STORE_A, 2);
    await vi.waitFor(() => expect(received).toEqual(['accepted']));

    expect(invalid).toHaveBeenCalledTimes(1);
    const subscribe = hub.frames.find((frame) => frame.type === 'fleet.rooms.subscribe');
    expect(subscribe?.payload?.filters).toEqual([{ '#h': ['general'], authors: [client.pubkey] }]);
  });

  it.each([
    ['mismatched id', (_signed: RoomEvent) => ({ id: 'f'.repeat(64), accepted: true, seq: 1, storeId: STORE_A })],
    ['non-positive seq', (signed: RoomEvent) => ({ id: signed.id, accepted: true, seq: 0, storeId: STORE_A })],
    ['invalid store id', (signed: RoomEvent) => ({ id: signed.id, accepted: true, seq: 1, storeId: 'undefined' })],
  ])('rejects a malformed durable publish acknowledgement: %s', async (_name, response) => {
    const hub = await startHub();
    const client = createClient(hub);
    hub.onFrame = (socket, frame) => {
      if (frame.type !== 'fleet.rooms.publish') return;
      send(socket, 'fleet.rooms.ok', response(frame.payload?.event as RoomEvent), frame.id);
    };
    await client.connect();

    await expect(client.publish({ room: 'general', content: 'message' })).rejects.toMatchObject({
      code: 'REJECTED',
    });
  });

  it('returns a bounded fetch page with the cursor of the last retained message', async () => {
    const hub = await startHub();
    const author = generateRoomSecretKey();
    const client = createClient(hub);
    hub.onFrame = (socket, frame) => {
      if (frame.type !== 'fleet.rooms.subscribe') return;
      const subId = frame.payload?.subId as string;
      streamEvent(socket, subId, 1, event(author, 'one'));
      streamEvent(socket, subId, 2, event(author, 'two'));
      eose(socket, subId, STORE_A, 2);
    };
    await client.connect();

    await expect(client.fetch([{ '#h': ['general'] }], undefined, { maxMessages: 1 }))
      .resolves.toMatchObject({
        messages: [{ seq: 1, text: 'one' }],
        cursor: { storeId: STORE_A, throughSeq: 1 },
        truncated: true,
      });
    await vi.waitFor(() => expect(hub.frames.some((frame) => frame.type === 'fleet.rooms.close')).toBe(true));
  });

  it('bounds fetch results by encoded byte size', async () => {
    const hub = await startHub();
    const author = generateRoomSecretKey();
    const client = createClient(hub);
    hub.onFrame = (socket, frame) => {
      if (frame.type === 'fleet.rooms.subscribe') {
        const subId = frame.payload?.subId as string;
        streamEvent(socket, subId, 1, event(author, 'x'.repeat(256)));
        eose(socket, subId, STORE_A, 1);
      }
    };
    await client.connect();

    await expect(client.fetch([{ '#h': ['general'] }], undefined, { maxBytes: 128 }))
      .rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('terminates truncated replay that makes no cursor progress', async () => {
    const hub = await startHub();
    const client = createClient(hub);
    hub.onFrame = (socket, frame) => {
      if (frame.type === 'fleet.rooms.subscribe') {
        eose(socket, frame.payload?.subId as string, STORE_A, 7, { live: false });
      }
    };
    await client.connect();

    await expect(client.fetch(
      [{ '#h': ['general'] }],
      { storeId: STORE_A, throughSeq: 7 },
    )).rejects.toMatchObject({
      code: 'CLOSED',
      message: expect.stringContaining('no cursor progress'),
    });
    expect(hub.frames.filter((frame) => frame.type === 'fleet.rooms.subscribe')).toHaveLength(1);
  });

  it('returns one server replay page without auto-paging a one-shot fetch', async () => {
    const hub = await startHub();
    const author = generateRoomSecretKey();
    const client = createClient(hub);
    hub.onFrame = (socket, frame) => {
      if (frame.type !== 'fleet.rooms.subscribe') return;
      const subId = frame.payload?.subId as string;
      streamEvent(socket, subId, 8, event(author, 'page item'));
      eose(socket, subId, STORE_A, 8, { live: false });
    };
    await client.connect();

    await expect(client.fetch(
      [{ '#h': ['general'] }],
      { storeId: STORE_A, throughSeq: 7 },
    )).resolves.toMatchObject({
      messages: [{ seq: 8, text: 'page item' }],
      cursor: { storeId: STORE_A, throughSeq: 8 },
      truncated: true,
    });
    expect(hub.frames.filter((frame) => frame.type === 'fleet.rooms.subscribe')).toHaveLength(1);
  });

  it.each(['gap', 'epochChanged'] as const)(
    'retains %s reported by an intermediate page until auto-pagination completes',
    async (flag) => {
      const hub = await startHub();
      const author = generateRoomSecretKey();
      const client = createClient(hub);
      const completed = vi.fn();
      let page = 0;
      hub.onFrame = (socket, frame) => {
        if (frame.type !== 'fleet.rooms.subscribe') return;
        page++;
        if (page === 1) {
          streamEvent(socket, 'paged-tail', 1, event(author, 'first page'));
          eose(socket, 'paged-tail', STORE_A, 1, {
            live: false,
            [flag]: true,
          });
        } else {
          eose(socket, 'paged-tail', STORE_A, 1);
        }
      };
      await client.connect();
      client.subscribe('paged-tail', [{ '#h': ['general'] }], {
        onMessage: () => undefined,
        onEose: completed,
      });

      await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
      expect(completed).toHaveBeenCalledWith(expect.objectContaining({ [flag]: true }));
      expect(page).toBe(2);
    },
  );

  it('rejects a malformed EOSE instead of persisting an unusable cursor', async () => {
    const hub = await startHub();
    const client = createClient(hub);
    hub.onFrame = (socket, frame) => {
      if (frame.type === 'fleet.rooms.subscribe') {
        send(socket, 'fleet.rooms.eose', {
          subId: frame.payload?.subId,
          storeId: 'not-a-store-id',
          throughSeq: -1,
          live: true,
        });
      }
    };
    await client.connect();

    await expect(client.fetch([{ '#h': ['general'] }])).rejects.toMatchObject({
      code: 'CLOSED',
      message: expect.stringContaining('malformed'),
    });
  });

  it('contains exceptions from EOSE and terminal-close handlers', async () => {
    const hub = await startHub();
    const client = createClient(hub);
    const errors: unknown[] = [];
    client.on('handler-error', (error) => errors.push(error));
    await client.connect();
    client.subscribe('eose-handler', [{ '#h': ['general'] }], {
      onMessage: () => undefined,
      onEose: () => { throw new Error('EOSE handler failed'); },
    });
    client.subscribe('close-handler', [{ '#h': ['general'] }], {
      onMessage: () => undefined,
      onClosed: () => { throw new Error('close handler failed'); },
    });

    const socket = hub.sockets[0]!;
    eose(socket, 'eose-handler', STORE_A, 0);
    send(socket, 'fleet.rooms.closed', {
      subId: 'close-handler', message: 'restricted: revoked', storeId: STORE_A, throughSeq: 0,
    });
    await vi.waitFor(() => expect(errors).toHaveLength(2));

    expect(client.isReady).toBe(true);
    expect(errors.map((error) => (error as Error).message)).toEqual([
      'EOSE handler failed',
      'close handler failed',
    ]);
  });

  it('settles subscriptions and an in-flight fetch when the client closes', async () => {
    const hub = await startHub();
    const client = createClient(hub);
    const closed = vi.fn();
    await client.connect();
    client.subscribe('tail', [{ '#h': ['general'] }], {
      onMessage: () => undefined,
      onClosed: closed,
    });
    const fetching = client.fetch([{ '#h': ['general'] }]);
    const fetchClosed = expect(fetching).rejects.toMatchObject({ code: 'CLOSED', message: 'client closed' });

    await client.close();

    await fetchClosed;
    expect(closed).toHaveBeenCalledWith('client closed');
  });

  it('rejects invalid filters and cursors before sending a subscription', async () => {
    const hub = await startHub();
    const client = createClient(hub);
    await client.connect();

    expect(() => client.subscribe('bad-filter', [{ '#h': [] }], { onMessage: () => undefined }))
      .toThrow(RoomClientError);
    expect(() => client.subscribe(
      'bad-cursor',
      [{ '#h': ['general'] }],
      { onMessage: () => undefined },
      { storeId: 'not-a-uuid', throughSeq: 1 },
    )).toThrow(/valid storeId/);
    expect(hub.frames.some((frame) => frame.type === 'fleet.rooms.subscribe')).toBe(false);
  });
});
