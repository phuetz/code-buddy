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
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { NostrChannel } from '../../src/channels/nostr/index.js';
import type { InboundMessage } from '../../src/channels/core.js';
import { ReconnectionManager } from '../../src/channels/reconnection-manager.js';

describe('NostrChannel real WebSocket transport (NIP-01)', () => {
  let server: WebSocketServer;
  let port: number;
  let channel: NostrChannel | null = null;
  let serverSockets: WsServerSocket[] = [];
  let reqFramesSeen: unknown[][] = [];
  /** Events the relay actually accepted after a real signature check. */
  let publishedEvents: Record<string, unknown>[] = [];

  beforeEach(async () => {
    serverSockets = [];
    reqFramesSeen = [];
    publishedEvents = [];
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
          // (Note: the subscription EVENT frame is 3-element: ["EVENT", subId, e].)
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
        } else if (frame[0] === 'EVENT') {
          // Client publish is the 2-element form: ["EVENT", event].
          const e = frame[1] as {
            id: string;
            pubkey: string;
            created_at: number;
            kind: number;
            tags: string[][];
            content: string;
            sig: string;
          };

          // (a) Recompute the id from the canonical NIP-01 serialization.
          const serialized = JSON.stringify([
            0,
            e.pubkey,
            e.created_at,
            e.kind,
            e.tags,
            e.content,
          ]);
          const recomputedId = bytesToHex(sha256(new TextEncoder().encode(serialized)));

          // (b) Verify the BIP-340 Schnorr signature against id + pubkey.
          const idMatches = recomputedId === e.id;
          const sigValid = idMatches && schnorr.verify(e.sig, e.id, e.pubkey);

          if (idMatches && sigValid) {
            publishedEvents.push(e);
            ws.send(JSON.stringify(['OK', e.id, true, '']));
          } else {
            ws.send(
              JSON.stringify([
                'OK',
                e.id,
                false,
                idMatches ? 'invalid: bad signature' : 'invalid: id mismatch',
              ]),
            );
          }
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

  it('send() signs a real BIP-340 event the relay cryptographically verifies, then resolves on OK', async () => {
    // Generate a REAL test-only secp256k1 key (not a placeholder string). The
    // relay below recomputes the id AND verifies the Schnorr signature — this is
    // a genuine sign -> verify round-trip, not a mock of our own signing.
    const sk = bytesToHex(schnorr.utils.randomPrivateKey());
    const expectedPubkey = bytesToHex(schnorr.getPublicKey(sk));

    channel = new NostrChannel({
      type: 'nostr',
      enabled: true,
      relays: [`ws://127.0.0.1:${port}`],
      privateKey: sk,
      publishTimeoutMs: 2000,
    });
    await channel.connect();

    // Wait until the client socket is open (the relay has seen our REQ frame),
    // so the optimistic connect's background socket is ready to publish on.
    await waitFor(() => reqFramesSeen.some((f) => f[0] === 'REQ'), 2000);

    const result = await channel.send({ channelId: 'whatever', content: 'outbound note' });

    // (b) send() returns a successful DeliveryResult, keyed by the event id.
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.messageId).toMatch(/^[0-9a-f]{64}$/);

    // (a) The relay accepted exactly one event AFTER verifying the signature and
    // recomputing the id — so what landed is a valid, fully-signed Nostr event.
    expect(publishedEvents).toHaveLength(1);
    const e = publishedEvents[0]!;
    expect(e.pubkey).toBe(expectedPubkey);
    expect(e.id).toBe(result.messageId);
    expect(e.content).toBe('outbound note');
    expect(e.kind).toBe(1);
    // Re-verify independently here too (belt and suspenders on the round-trip).
    expect(schnorr.verify(e.sig as string, e.id as string, e.pubkey as string)).toBe(true);
  });

  it('send() signs under the nsec identity (bech32 decoded, NOT sha256-hashed into a wrong key)', async () => {
    // Reproducible test vector: this nsec encodes the 32-byte key 0x..01, whose
    // x-only Schnorr pubkey is the secp256k1 generator x-coordinate. If the
    // channel silently sha256-hashed the nsec string instead of decoding it, the
    // published pubkey would NOT match this expected value.
    const nsec = 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl';
    const expectedHexKey = '0000000000000000000000000000000000000000000000000000000000000001';
    const expectedPubkey = bytesToHex(schnorr.getPublicKey(expectedHexKey));

    channel = new NostrChannel({
      type: 'nostr',
      enabled: true,
      relays: [`ws://127.0.0.1:${port}`],
      privateKey: nsec,
      publishTimeoutMs: 2000,
    });
    await channel.connect();
    await waitFor(() => reqFramesSeen.some((f) => f[0] === 'REQ'), 2000);

    const result = await channel.send({ channelId: 'whatever', content: 'from-nsec' });

    expect(result.success).toBe(true);
    expect(publishedEvents).toHaveLength(1);
    // The relay verified the signature; the identity is the nsec's TRUE key.
    expect(publishedEvents[0]!.pubkey).toBe(expectedPubkey);
  });

  it('send() keeps the honest error when no secret key is configured (no random-key signing)', async () => {
    channel = new NostrChannel({
      type: 'nostr',
      enabled: true,
      relays: [`ws://127.0.0.1:${port}`],
      // no privateKey configured
    });
    await channel.connect();

    const result = await channel.send({ channelId: 'abc', content: 'outbound note' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/secret key|key configured/i);
    // A real 32-byte sha256 event id is still produced (64 hex chars).
    expect(result.messageId).toMatch(/^[0-9a-f]{64}$/);
    // And nothing was published to the relay.
    expect(publishedEvents).toHaveLength(0);
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
