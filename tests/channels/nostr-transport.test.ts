/**
 * Nostr real-WebSocket transport proof.
 *
 * Stands up a loopback `ws` relay on an ephemeral port and points the real
 * NostrChannel transport at it (NIP-01). Proves:
 *   1. the channel reports `connected` after `connect()`,
 *   2. a relay `["EVENT", subId, {...}]` frame surfaces as a `'message'` event
 *      with the event content ('hello-nostr') and sender = event.pubkey,
 *   3. when the relay closes the socket, the shared ReconnectionManager's
 *      `scheduleReconnect` is invoked (auto-reconnect wiring).
 *
 * No public relay / account is needed — everything is loopback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import { WebSocketServer, type WebSocket as WsServerSocket } from 'ws';
import { NostrChannel } from '../../src/channels/nostr/index.js';
import type { InboundMessage } from '../../src/channels/core.js';
import { ReconnectionManager } from '../../src/channels/reconnection-manager.js';

describe('NostrChannel real WebSocket transport (NIP-01)', () => {
  let server: WebSocketServer;
  let port: number;
  let channel: NostrChannel | null = null;
  let serverSockets: WsServerSocket[] = [];
  let reqFramesSeen: unknown[][] = [];

  beforeEach(async () => {
    serverSockets = [];
    reqFramesSeen = [];
    server = await new Promise<WebSocketServer>((resolve) => {
      const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }, () => resolve(wss));
    });
    port = (server.address() as AddressInfo).port;

    server.on('connection', (ws) => {
      serverSockets.push(ws);
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as unknown[];
        reqFramesSeen.push(frame);
        if (frame[0] === 'REQ') {
          const subId = frame[1] as string;
          // Reply with a stored event then EOSE, exactly like a real relay.
          ws.send(
            JSON.stringify([
              'EVENT',
              subId,
              {
                id: 'eventid-deadbeef',
                pubkey: 'abc',
                kind: 1,
                content: 'hello-nostr',
                created_at: 123,
                tags: [],
                sig: 'sig-placeholder',
              },
            ]),
          );
          ws.send(JSON.stringify(['EOSE', subId]));
        }
      });
    });
  });

  afterEach(async () => {
    if (channel) {
      await channel.disconnect().catch(() => {});
      channel = null;
    }
    for (const ws of serverSockets) {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  it('connects, subscribes (REQ kind:1), and receives an inbound EVENT as a message', async () => {
    channel = new NostrChannel({
      type: 'nostr',
      enabled: true,
      relays: [`ws://127.0.0.1:${port}`],
      privateKey: 'nostr-test-secret',
    });

    const messages: InboundMessage[] = [];
    let connectedEmitted = false;
    channel.on('connected', () => {
      connectedEmitted = true;
    });
    channel.on('message', (msg: InboundMessage) => {
      messages.push(msg);
    });

    await channel.connect();

    // (1) Optimistic connect: status + event are immediate.
    expect(channel.getStatus().connected).toBe(true);
    expect(connectedEmitted).toBe(true);

    // (2) Wait for the loopback round-trip: REQ -> EVENT -> 'message'.
    await waitFor(() => messages.length > 0, 2000);

    expect(messages).toHaveLength(1);
    const msg = messages[0]!;
    expect(msg.content).toBe('hello-nostr');
    expect(msg.sender.id).toBe('abc'); // sender = event.pubkey
    expect(msg.channel.type).toBe('nostr');

    // The subscription frame we sent was a NIP-01 REQ filtering kind 1.
    const reqFrame = reqFramesSeen.find((f) => f[0] === 'REQ');
    expect(reqFrame).toBeDefined();
    expect(reqFrame![0]).toBe('REQ');
    const filter = reqFrame![2] as { kinds?: number[] };
    expect(filter.kinds).toEqual([1]);
  });

  it('schedules a reconnect when the relay drops the socket (not during disconnect)', async () => {
    // Spy + neutralize scheduleReconnect so the real backoff timer never fires
    // (no second connection / dangling handles) — we only assert it was called.
    const scheduleSpy = vi
      .spyOn(ReconnectionManager.prototype, 'scheduleReconnect')
      .mockImplementation(() => {});

    channel = new NostrChannel({
      type: 'nostr',
      enabled: true,
      relays: [`ws://127.0.0.1:${port}`],
      privateKey: 'nostr-test-secret',
      reconnectDelayMs: 10,
    });

    let connected = false;
    channel.on('connected', () => {
      connected = true;
    });

    await channel.connect();
    expect(connected).toBe(true);

    // Wait until the relay has actually accepted the client socket.
    await waitFor(() => serverSockets.length > 0, 2000);

    expect(scheduleSpy).not.toHaveBeenCalled();

    // Relay closes the client socket -> client 'close' fires -> reconnect scheduled.
    serverSockets[0]!.close();

    await waitFor(() => scheduleSpy.mock.calls.length > 0, 2000);
    expect(scheduleSpy).toHaveBeenCalled();
  });

  it('does NOT schedule a reconnect when we intentionally disconnect', async () => {
    const scheduleSpy = vi
      .spyOn(ReconnectionManager.prototype, 'scheduleReconnect')
      .mockImplementation(() => {});

    channel = new NostrChannel({
      type: 'nostr',
      enabled: true,
      relays: [`ws://127.0.0.1:${port}`],
      privateKey: 'nostr-test-secret',
    });

    await channel.connect();
    await waitFor(() => serverSockets.length > 0, 2000);

    await channel.disconnect();
    channel = null;

    // Give any spurious close-handler a tick to (not) fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it('send() builds a real unsigned event but honestly reports the missing signer', async () => {
    channel = new NostrChannel({
      type: 'nostr',
      enabled: true,
      relays: [`ws://127.0.0.1:${port}`],
      privateKey: 'nostr-test-secret',
    });
    await channel.connect();

    const result = await channel.send({ channelId: 'abc', content: 'outbound note' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/signer|secret key/i);
    // A real 32-byte sha256 event id is still produced (64 hex chars).
    expect(result.messageId).toMatch(/^[0-9a-f]{64}$/);
  });
});

/** Poll `predicate` until true or timeout. */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
