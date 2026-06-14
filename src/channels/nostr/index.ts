/**
 * Nostr Channel Adapter
 *
 * Connects to Nostr relays for decentralized messaging.
 * Supports NIP-04 encrypted direct messages.
 */

import { createECDH, createHash, randomBytes } from 'crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { logger } from '../../utils/logger.js';
import {
  BaseChannel,
  ChannelConfig,
  DeliveryResult,
  InboundMessage,
  OutboundMessage,
} from '../core.js';
import { ReconnectionManager } from '../reconnection-manager.js';

export interface NostrConfig {
  privateKey?: string;
  relays: string[];
}

export interface NostrChannelConfig extends ChannelConfig {
  privateKey?: string;
  relays: string[];
  /** Single relay convenience alias (merged with `relays`). */
  relay?: string;
  /** Optional NIP-01 filters merged into the subscription REQ. */
  filters?: Record<string, unknown>;
  /** Max reconnection attempts per relay (default 10). */
  maxRetries?: number;
  /** Initial reconnect backoff in ms (default 1000). */
  reconnectDelayMs?: number;
}

/**
 * A minimal subset of the WHATWG/`ws` WebSocket surface the relay client uses.
 * Lets us accept the Node global `WebSocket` without pulling in DOM lib types.
 */
interface RelaySocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

/** Factory so tests / runtimes can inject a socket constructor. */
export type RelaySocketFactory = (url: string) => RelaySocket;

export class NostrAdapter {
  private static readonly BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  private static readonly BECH32_GENERATOR = [
    0x3b6a57b2,
    0x26508e6d,
    0x1ea119fa,
    0x3d4233dd,
    0x2a1462b3,
  ];

  private config: NostrConfig;
  private running = false;
  private connectedRelays: string[] = [];

  constructor(config: NostrConfig) {
    this.config = { ...config, relays: [...config.relays] };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('NostrAdapter is already running');
    }
    logger.debug('NostrAdapter: connecting to relays', { relays: this.config.relays });
    this.connectedRelays = [...this.config.relays];
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('NostrAdapter is not running');
    }
    logger.debug('NostrAdapter: disconnecting from relays');
    this.connectedRelays = [];
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendDirectMessage(pubkey: string, content: string): Promise<{ success: boolean; eventId: string }> {
    if (!this.running) {
      throw new Error('NostrAdapter is not running');
    }
    logger.debug('NostrAdapter: sending NIP-04 DM', { pubkey, contentLength: content.length });
    return { success: true, eventId: `nostr_${Date.now()}` };
  }

  getPublicKey(): string {
    const privateKey = this.resolvePrivateKeyBytes();
    const ecdh = createECDH('secp256k1');
    ecdh.setPrivateKey(privateKey);

    // Nostr public key is x-only 32-byte key.
    const compressedPubKey = ecdh.getPublicKey(undefined, 'compressed');
    const xOnlyPubKey = compressedPubKey.subarray(1, 33);
    return this.encodeBech32('npub', xOnlyPubKey);
  }

  getRelays(): string[] {
    return [...this.connectedRelays];
  }

  addRelay(url: string): void {
    if (!this.connectedRelays.includes(url)) {
      this.connectedRelays.push(url);
      this.config.relays = [...this.connectedRelays];
      logger.debug('NostrAdapter: added relay', { url });
    }
  }

  removeRelay(url: string): void {
    const index = this.connectedRelays.indexOf(url);
    if (index !== -1) {
      this.connectedRelays.splice(index, 1);
      this.config.relays = [...this.connectedRelays];
      logger.debug('NostrAdapter: removed relay', { url });
    }
  }

  getConfig(): NostrConfig {
    return { ...this.config, relays: [...this.config.relays] };
  }

  private resolvePrivateKeyBytes(): Buffer {
    const raw = this.config.privateKey;
    if (!raw) {
      return randomBytes(32);
    }

    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, 'hex');
    }

    const decoded = this.decodeBech32(raw);
    if (decoded && decoded.hrp === 'nsec') {
      const bytes = this.convertBits(decoded.data, 5, 8, false);
      if (bytes && bytes.length === 32) {
        return Buffer.from(bytes);
      }
    }

    // Accept arbitrary secrets by deriving a deterministic 32-byte private key.
    return createHash('sha256').update(raw).digest();
  }

  private encodeBech32(hrp: string, bytes: Uint8Array): string {
    const data = this.convertBits(Array.from(bytes), 8, 5, true);
    if (!data) {
      throw new Error('Failed to encode bech32 data');
    }
    const checksum = this.createBech32Checksum(hrp, data);
    const combined = [...data, ...checksum]
      .map((value) => NostrAdapter.BECH32_CHARSET[value])
      .join('');
    return `${hrp}1${combined}`;
  }

  private decodeBech32(bech32: string): { hrp: string; data: number[] } | null {
    const value = bech32.trim();
    if (!value) return null;

    const lower = value.toLowerCase();
    const upper = value.toUpperCase();
    if (value !== lower && value !== upper) return null;

    const separator = lower.lastIndexOf('1');
    if (separator < 1 || separator + 7 > lower.length) return null;

    const hrp = lower.slice(0, separator);
    const payload = lower.slice(separator + 1);
    const data: number[] = [];
    for (const ch of payload) {
      const idx = NostrAdapter.BECH32_CHARSET.indexOf(ch);
      if (idx === -1) return null;
      data.push(idx);
    }

    if (!this.verifyBech32Checksum(hrp, data)) {
      return null;
    }

    return { hrp, data: data.slice(0, -6) };
  }

  private convertBits(
    data: number[],
    fromBits: number,
    toBits: number,
    pad: boolean
  ): number[] | null {
    let acc = 0;
    let bits = 0;
    const maxV = (1 << toBits) - 1;
    const result: number[] = [];

    for (const value of data) {
      if (value < 0 || value >> fromBits !== 0) {
        return null;
      }
      acc = (acc << fromBits) | value;
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        result.push((acc >> bits) & maxV);
      }
    }

    if (pad) {
      if (bits > 0) {
        result.push((acc << (toBits - bits)) & maxV);
      }
    } else {
      if (bits >= fromBits) return null;
      if (((acc << (toBits - bits)) & maxV) !== 0) return null;
    }

    return result;
  }

  private createBech32Checksum(hrp: string, data: number[]): number[] {
    const values = [...this.expandBech32Hrp(hrp), ...data, 0, 0, 0, 0, 0, 0];
    const mod = this.bech32Polymod(values) ^ 1;
    const checksum: number[] = [];
    for (let i = 0; i < 6; i++) {
      checksum.push((mod >> (5 * (5 - i))) & 31);
    }
    return checksum;
  }

  private verifyBech32Checksum(hrp: string, data: number[]): boolean {
    return this.bech32Polymod([...this.expandBech32Hrp(hrp), ...data]) === 1;
  }

  private expandBech32Hrp(hrp: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < hrp.length; i++) {
      out.push(hrp.charCodeAt(i) >> 5);
    }
    out.push(0);
    for (let i = 0; i < hrp.length; i++) {
      out.push(hrp.charCodeAt(i) & 31);
    }
    return out;
  }

  private bech32Polymod(values: number[]): number {
    let chk = 1;
    for (const value of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ value;
      for (let i = 0; i < 5; i++) {
        if ((top >> i) & 1) {
          const gen = NostrAdapter.BECH32_GENERATOR[i];
          if (gen === undefined) continue;
          chk ^= gen;
        }
      }
    }
    return chk;
  }
}

/** Per-relay socket bookkeeping. */
interface RelayConnection {
  url: string;
  socket: RelaySocket | null;
  reconnection: ReconnectionManager;
}

/**
 * Real Nostr relay channel (NIP-01).
 *
 * Opens persistent WebSocket connections to each configured relay, subscribes
 * to kind-1 (text note) events via a `REQ` frame, and surfaces inbound events
 * as `'message'` events on the channel. Dropped sockets are recovered with the
 * shared {@link ReconnectionManager} (exponential backoff + jitter), the same
 * idiom used by the discord/slack/imessage adapters.
 *
 * Connection semantics are *optimistic*: `connect()` marks the channel
 * connected and returns immediately, opening sockets in the background. This
 * mirrors how a real Nostr client behaves (any one of N relays may be down)
 * and lets the channel come up even when a relay is unreachable.
 *
 * `NostrAdapter` (above) is retained unchanged as the key / bech32 / relay-list
 * utility — its `start()`/`sendDirectMessage()` are legacy in-process stubs
 * kept only for the existing unit tests. The real transport lives here.
 */
export class NostrChannel extends BaseChannel {
  private adapter: NostrAdapter;
  private relays: RelayConnection[] = [];
  private readonly subId: string;
  private readonly filters: Record<string, unknown>;
  private readonly maxRetries: number;
  private readonly reconnectDelayMs: number;
  /** Set while an intentional disconnect is in progress so `close` skips reconnect. */
  private shuttingDown = false;
  /** Injectable socket factory (defaults to the Node global `WebSocket`). */
  private readonly socketFactory: RelaySocketFactory;

  constructor(config: NostrChannelConfig, socketFactory?: RelaySocketFactory) {
    super('nostr', {
      type: 'nostr',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });

    const relayUrls = [
      ...(Array.isArray(config.relays) ? config.relays : []),
      ...(config.relay ? [config.relay] : []),
    ].filter((u): u is string => typeof u === 'string' && u.length > 0);

    this.adapter = new NostrAdapter({
      privateKey: config.privateKey,
      relays: relayUrls,
    });
    this.filters = config.filters ?? {};
    this.maxRetries = config.maxRetries ?? 10;
    this.reconnectDelayMs = config.reconnectDelayMs ?? 1000;
    this.subId = `cb-${randomBytes(6).toString('hex')}`;

    this.socketFactory =
      socketFactory ??
      ((url: string) => new (globalThis as unknown as { WebSocket: new (u: string) => RelaySocket }).WebSocket(url));

    this.relays = relayUrls.map((url) => ({
      url,
      socket: null,
      reconnection: new ReconnectionManager(`nostr:${url}`, {
        maxRetries: this.maxRetries,
        initialDelayMs: this.reconnectDelayMs,
        maxDelayMs: 60000,
      }),
    }));
  }

  /**
   * Optimistically connect: mark the channel up, emit `'connected'`, then open
   * every relay socket in the background. Resolves immediately — it never waits
   * on a socket `'open'`, so an unreachable relay can't block startup.
   */
  async connect(): Promise<void> {
    this.shuttingDown = false;
    this.status.connected = true;
    this.status.authenticated = true;
    this.status.lastActivity = new Date();
    this.emit('connected', this.type);

    for (const relay of this.relays) {
      this.openRelay(relay);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.status.connected) return;
    this.shuttingDown = true;

    for (const relay of this.relays) {
      relay.reconnection.cancel();
      this.closeSocket(relay);
    }

    this.status.connected = false;
    this.status.authenticated = false;
    this.status.lastActivity = new Date();
    this.emit('disconnected', this.type);
  }

  /**
   * Build a Nostr kind-1 event for the outbound message and attempt to send it.
   *
   * HONEST LIMITATION: a publishable Nostr event needs a secp256k1 BIP-340
   * Schnorr signature, and this repo ships no Schnorr signer (`@noble/curves` /
   * `secp256k1` are absent and Node's `crypto` has no BIP-340 path). We build
   * the *real* unsigned event (correct `pubkey` + sha256 `id`) but do NOT fake a
   * signature, so this returns a clear error. Inbound subscription / receive is
   * fully functional. Live publishing remains gated on a configured signer.
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const event = this.buildUnsignedEvent(message.content);
      this.status.lastActivity = new Date();
      logger.debug('NostrChannel: built unsigned event (send requires signer)', {
        id: event.id,
        pubkey: event.pubkey,
      });
      return {
        success: false,
        messageId: event.id,
        error: 'Nostr send requires a configured secret key / signer (Schnorr signing unavailable)',
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }

  // ============================================================================
  // Relay socket lifecycle
  // ============================================================================

  private openRelay(relay: RelayConnection): void {
    let socket: RelaySocket;
    try {
      socket = this.socketFactory(relay.url);
    } catch (error) {
      logger.warn('NostrChannel: failed to construct relay socket', {
        url: relay.url,
        error: error instanceof Error ? error.message : String(error),
      });
      this.scheduleRelayReconnect(relay);
      return;
    }
    relay.socket = socket;

    socket.addEventListener('open', () => {
      logger.debug('NostrChannel: relay open', { url: relay.url });
      relay.reconnection.onConnected();
      this.status.connected = true;
      this.status.lastActivity = new Date();
      this.sendSubscription(socket);
    });

    socket.addEventListener('message', (event: unknown) => {
      const data = (event as { data?: unknown }).data;
      this.handleRelayData(relay, data);
    });

    socket.addEventListener('error', (event: unknown) => {
      const err = this.errorFromEvent(event);
      logger.debug('NostrChannel: relay socket error', { url: relay.url, error: err.message });
      // BaseChannel is an EventEmitter — only emit 'error' when someone listens,
      // otherwise EventEmitter throws and crashes the process.
      if (this.listenerCount('error') > 0) {
        this.emit('error', this.type, err);
      }
    });

    socket.addEventListener('close', () => {
      relay.socket = null;
      if (this.shuttingDown) return;
      logger.debug('NostrChannel: relay closed, scheduling reconnect', { url: relay.url });
      this.scheduleRelayReconnect(relay);
    });
  }

  private scheduleRelayReconnect(relay: RelayConnection): void {
    if (this.shuttingDown) return;
    relay.reconnection.scheduleReconnect(async () => {
      if (this.shuttingDown) return;
      this.openRelay(relay);
    });
  }

  private sendSubscription(socket: RelaySocket): void {
    const filter: Record<string, unknown> = { kinds: [1], ...this.filters };
    const req = JSON.stringify(['REQ', this.subId, filter]);
    try {
      socket.send(req);
    } catch (error) {
      logger.debug('NostrChannel: failed to send REQ', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleRelayData(relay: RelayConnection, data: unknown): void {
    let frame: unknown;
    try {
      const text = typeof data === 'string' ? data : String(data);
      frame = JSON.parse(text);
    } catch {
      logger.debug('NostrChannel: ignoring non-JSON relay frame', { url: relay.url });
      return;
    }

    if (!Array.isArray(frame) || frame.length === 0) return;
    const kind = frame[0];

    if (kind === 'EVENT') {
      // ["EVENT", <subId>, <event>]
      const event = frame[2] as Record<string, unknown> | undefined;
      if (event && typeof event === 'object') {
        this.emitInbound(event, relay.url);
      }
      return;
    }

    if (kind === 'EOSE') {
      // End of stored events — nothing to do.
      return;
    }

    if (kind === 'NOTICE') {
      logger.info('NostrChannel: relay NOTICE', { url: relay.url, message: String(frame[1] ?? '') });
      return;
    }

    if (kind === 'OK') {
      // Publish acknowledgement: ["OK", <eventId>, <ok>, <message>]
      logger.debug('NostrChannel: relay OK', { url: relay.url, accepted: frame[2], message: frame[3] });
      return;
    }
  }

  private emitInbound(event: Record<string, unknown>, relayUrl: string): void {
    const content = typeof event.content === 'string' ? event.content : '';
    const pubkey = typeof event.pubkey === 'string' ? event.pubkey : 'unknown';
    const id = typeof event.id === 'string' ? event.id : `nostr-${Date.now()}`;
    const createdAt = typeof event.created_at === 'number' ? event.created_at : Math.floor(Date.now() / 1000);

    const inbound: InboundMessage = {
      id,
      channel: {
        id: relayUrl,
        type: 'nostr',
        name: relayUrl,
        isDM: false,
      },
      sender: {
        id: pubkey,
        username: pubkey,
      },
      content,
      contentType: 'text',
      timestamp: new Date(createdAt * 1000),
      raw: event,
    };

    this.status.lastActivity = new Date();
    const parsed = this.parseCommand(inbound);
    this.emit('message', parsed);
    if (parsed.isCommand) {
      this.emit('command', parsed);
    }
  }

  /**
   * Build the canonical unsigned Nostr event for `content`. The `id` is the
   * sha256 of the NIP-01 serialization `[0, pubkey, created_at, kind, tags,
   * content]`. No signature is produced (no Schnorr signer available).
   */
  private buildUnsignedEvent(content: string): {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  } {
    const pubkey = this.getPublicKeyHex();
    const created_at = Math.floor(Date.now() / 1000);
    const kind = 1;
    const tags: string[][] = [];
    const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
    const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
    return { id, pubkey, created_at, kind, tags, content };
  }

  /** x-only 32-byte public key as lowercase hex (Nostr event `pubkey` field). */
  private getPublicKeyHex(): string {
    const privateKey = this.resolvePrivateKeyBytes();
    const ecdh = createECDH('secp256k1');
    ecdh.setPrivateKey(privateKey);
    const compressed = ecdh.getPublicKey(undefined, 'compressed');
    return compressed.subarray(1, 33).toString('hex');
  }

  private resolvePrivateKeyBytes(): Buffer {
    const raw = this.adapter.getConfig().privateKey;
    if (!raw) return randomBytes(32);
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    // Derive a deterministic key from arbitrary secrets (matches NostrAdapter).
    return createHash('sha256').update(raw).digest();
  }

  private closeSocket(relay: RelayConnection): void {
    const socket = relay.socket;
    relay.socket = null;
    if (!socket) return;
    try {
      // Prefer terminate(): the socket may still be CONNECTING against a dead
      // relay, where close() would hang waiting for a handshake that won't come.
      if (typeof socket.terminate === 'function') {
        socket.terminate();
      } else {
        socket.close();
      }
    } catch (error) {
      logger.debug('NostrChannel: error closing relay socket', {
        url: relay.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private errorFromEvent(event: unknown): Error {
    if (event instanceof Error) return event;
    const maybe = event as { error?: unknown; message?: unknown };
    if (maybe?.error instanceof Error) return maybe.error;
    if (typeof maybe?.message === 'string') return new Error(maybe.message);
    return new Error('Nostr relay socket error');
  }

  /** Expose the configured relay URLs (post construction). */
  getRelayUrls(): string[] {
    return this.relays.map((r) => r.url);
  }
}

export default NostrAdapter;
