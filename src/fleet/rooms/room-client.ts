/**
 * Fleet rooms — member client.
 *
 * Reconnection follows the Buzz ACP harness (`crates/buzz-acp/src/relay.rs`):
 * resubscribe after reconnect from a per-subscription cursor and drop events
 * already seen with a two-generation id set (`TwoGenDedup`, 12 000 ids). The
 * cursor is the hub `seq` (plus its `storeId`) instead of `created_at`, so
 * member clock drift cannot open a hole.
 *
 * Everything received is untrusted data: signatures and room tags are checked
 * again locally (the hub could be compromised), and `text` is the content
 * passed through the fleet peer-text sanitizer. This client never runs a tool,
 * a prompt or a command because of a message.
 *
 * @module fleet/rooms/room-client
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';

import { sanitizePeerText } from '../peer-text-sanitizer.js';
import {
  buildRoomAuth,
  buildRoomMessage,
  canonicalRoomAudience,
  checkRoomEventShape,
  deriveRoomPublicKey,
  freezeRoomEvent,
  parseThreadMarkers,
  resolveThread,
  roomOf,
  signRoomEvent,
  tagValues,
  verifyRoomEvent,
  type ReadonlyRoomEvent,
  type RoomEvent,
  type RoomMessageInput,
  type ThreadReference,
} from './room-event.js';
import { parseRoomFilters, roomFiltersMatch, type RoomFilter } from './room-filter.js';

const SEEN_ID_LIMIT = 12_000;
const DEFAULT_FETCH_MAX_MESSAGES = 500;
const MAX_FETCH_MESSAGES = 1_000;
const DEFAULT_FETCH_MAX_BYTES = 4 * 1024 * 1024;
const MAX_FETCH_BYTES = 4 * 1024 * 1024;
const STORE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface FleetRoomClientOptions {
  /** Hub WebSocket URL, e.g. `ws://127.0.0.1:3000/ws`. */
  url: string;
  apiKey?: string;
  jwt?: string;
  /** Member secret key (64 hex). Never logged or sent. */
  secretKey: string;
  /** Audience override for a hub reached through a proxy; defaults to `url`. */
  audience?: string;
  requestTimeoutMs?: number;
  autoReconnect?: boolean;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  /** Consecutive failed reconnection attempts before giving up. */
  reconnectMaxAttempts?: number;
}

export interface RoomCursor {
  storeId: string;
  throughSeq: number;
}

export interface RoomFetchOptions {
  /** Maximum messages retained by this one-shot read (default 500, maximum 1000). */
  maxMessages?: number;
  /** Maximum approximate encoded result size (default and maximum 4 MiB). */
  maxBytes?: number;
}

export interface ReceivedRoomMessage {
  seq: number;
  room: string;
  author: string;
  event: ReadonlyRoomEvent;
  mentions: string[];
  thread?: ThreadReference;
  /** Content after the peer-text sanitizer; display it, never execute it. */
  text: string;
}

export interface RoomEoseInfo {
  storeId: string;
  throughSeq: number;
  gap: boolean;
  epochChanged: boolean;
  /** More replay records exist after `throughSeq`. */
  truncated: boolean;
}

export interface RoomSubscriptionHandlers {
  onMessage(message: ReceivedRoomMessage): void;
  /** Stored events delivered; later messages are live. */
  onEose?(info: RoomEoseInfo): void;
  /** Terminal close (`restricted:`, `invalid:` …); the subscription is gone. */
  onClosed?(message: string): void;
}

export interface RoomSubscriptionHandle {
  readonly subId: string;
  cursor(): RoomCursor | undefined;
  close(): Promise<void>;
}

export class RoomClientError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'RoomClientError';
  }
}

interface PendingRequest {
  expect: string;
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ClientSubscription {
  subId: string;
  filters: RoomFilter[];
  handlers: RoomSubscriptionHandlers;
  cursor?: RoomCursor;
  /** Cursor sent with the replay currently in flight; events arrive before EOSE. */
  replayCursor?: RoomCursor;
  replaying: boolean;
  autoPage: boolean;
  replayGap: boolean;
  replayEpochChanged: boolean;
  maxSeenSeq?: number;
  closed: boolean;
  backpressureRetries: number;
  retryTimers: Set<NodeJS.Timeout>;
}

class TwoGenerationSet {
  private current = new Set<string>();
  private previous = new Set<string>();
  constructor(private readonly limit: number) {}
  /** Returns true when the id was not seen before. */
  add(id: string): boolean {
    if (this.current.has(id) || this.previous.has(id)) return false;
    this.current.add(id);
    if (this.current.size >= this.limit / 2) {
      this.previous = this.current;
      this.current = new Set();
    }
    return true;
  }
}

function positive(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) throw new RangeError(`${name} must be a finite number > 0`);
  return resolved;
}

function boundedPositiveInteger(name: string, value: number | undefined, fallback: number, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new RangeError(`${name} must be a positive safe integer <= ${maximum}`);
  }
  return resolved;
}

function isStoreId(value: unknown): value is string {
  return typeof value === 'string' && STORE_ID_PATTERN.test(value);
}

interface RoomConnectionInfo {
  pubkey: string;
  name: string;
  rooms: unknown[];
}

export class FleetRoomClient extends EventEmitter {
  readonly pubkey: string;
  readonly audience: string;
  private readonly options: FleetRoomClientOptions;
  private readonly requestTimeoutMs: number;
  private readonly reconnectInitialDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly reconnectMaxAttempts: number;
  private ws: WebSocket | null = null;
  private ready = false;
  private closing = false;
  private everConnected = false;
  private requestCounter = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, ClientSubscription>();
  private readonly seen = new TwoGenerationSet(SEEN_ID_LIMIT);
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readyWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private opening: Promise<RoomConnectionInfo> | null = null;
  private connectionInfo: RoomConnectionInfo | null = null;

  constructor(options: FleetRoomClientOptions) {
    super();
    this.options = options;
    this.pubkey = deriveRoomPublicKey(options.secretKey);
    this.audience = canonicalRoomAudience(options.audience ?? options.url);
    this.requestTimeoutMs = positive('requestTimeoutMs', options.requestTimeoutMs, 10_000);
    this.reconnectInitialDelayMs = positive('reconnectInitialDelayMs', options.reconnectInitialDelayMs, 250);
    this.reconnectMaxDelayMs = positive('reconnectMaxDelayMs', options.reconnectMaxDelayMs, 30_000);
    this.reconnectMaxAttempts = positive('reconnectMaxAttempts', options.reconnectMaxAttempts, 20);
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Connect, authenticate the WebSocket, then prove the member key. */
  connect(): Promise<RoomConnectionInfo> {
    this.closing = false;
    if (this.ready && this.connectionInfo) return Promise.resolve(this.connectionInfo);
    return this.startOpen();
  }

  private startOpen(): Promise<RoomConnectionInfo> {
    if (this.opening) return this.opening;
    const opening = this.open();
    this.opening = opening;
    void opening.finally(() => {
      if (this.opening === opening) this.opening = null;
    }).catch(() => undefined);
    return opening;
  }

  private open(): Promise<RoomConnectionInfo> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let transportAuthRequested = false;
      let roomProofStarted = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
        try {
          ws.terminate();
        } catch {
          // ignore
        }
      };
      const ws = new WebSocket(this.options.url);
      this.ws = ws;
      const timer = setTimeout(() => fail(new RoomClientError('connection timed out', 'TIMEOUT')), this.requestTimeoutMs);

      const startRoomProof = () => {
        if (roomProofStarted || this.ws !== ws) return;
        roomProofStarted = true;
        void this.proveIdentity(ws).then((info) => {
          clearTimeout(timer);
          if (!settled) { settled = true; resolve(info); }
        }, (error: Error) => { clearTimeout(timer); fail(error); });
      };

      ws.on('message', (data) => {
        if (this.ws !== ws) return;
        let message: { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } };
        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (message.type === 'connected') {
          if (this.options.apiKey || this.options.jwt) {
            if (transportAuthRequested) return;
            transportAuthRequested = true;
            this.sendRaw({
              type: 'authenticate',
              payload: this.options.apiKey ? { apiKey: this.options.apiKey } : { token: this.options.jwt },
            });
          } else {
            startRoomProof();
          }
          return;
        }
        if (message.type === 'authenticated') {
          startRoomProof();
          return;
        }
        if (message.type === 'error' && !message.requestId && !this.ready) {
          clearTimeout(timer);
          fail(new RoomClientError(message.error?.message ?? 'server error', message.error?.code ?? 'SERVER_ERROR'));
          return;
        }
        this.handleMessage(message);
      });
      ws.on('error', (error) => {
        clearTimeout(timer);
        fail(error instanceof Error ? error : new Error(String(error)));
      });
      ws.on('close', () => {
        clearTimeout(timer);
        if (this.ws === ws) this.onSocketClosed();
        fail(new RoomClientError('connection closed before authentication', 'DISCONNECTED'));
      });
    });
  }

  private async proveIdentity(ws: WebSocket): Promise<RoomConnectionInfo> {
    const hello = await this.request('fleet.rooms.hello', {}, 'fleet.rooms.challenge');
    const challenge = typeof hello.challenge === 'string' ? hello.challenge : '';
    // The audience comes from the URL this client dialed, never from the hub.
    const proof = signRoomEvent(buildRoomAuth(challenge, this.audience), this.options.secretKey);
    const result = await this.request('fleet.rooms.auth', { event: proof }, 'fleet.rooms.auth');
    if (result.ok !== true) {
      throw new RoomClientError(String(result.message ?? 'room authentication refused'), 'ROOM_AUTH_REFUSED');
    }
    if (this.ws !== ws) throw new RoomClientError('connection replaced during authentication', 'DISCONNECTED');
    const info = {
      pubkey: String(result.pubkey),
      name: String(result.name),
      rooms: Array.isArray(result.rooms) ? result.rooms : [],
    };
    if (info.pubkey !== this.pubkey) {
      throw new RoomClientError('room hub returned another member identity', 'ROOM_AUTH_REFUSED');
    }
    this.ready = true;
    this.everConnected = true;
    this.connectionInfo = info;
    this.reconnectAttempts = 0;
    for (const waiter of this.readyWaiters.splice(0)) waiter.resolve();
    for (const sub of this.subscriptions.values()) {
      if (!sub.closed) this.sendSubscribe(sub);
    }
    this.emit('ready');
    return info;
  }

  private sendRaw(message: Record<string, unknown>): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  private request(type: string, payload: Record<string, unknown>, expect: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = `room-${Date.now().toString(36)}-${(++this.requestCounter).toString(36)}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RoomClientError(`${type} timed out`, 'TIMEOUT'));
      }, this.requestTimeoutMs);
      this.pending.set(id, { expect, resolve, reject, timer });
      if (!this.sendRaw({ type, id, payload })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new RoomClientError('not connected', 'DISCONNECTED'));
      }
    });
  }

  private handleMessage(message: { type?: string; requestId?: string; payload?: unknown }): void {
    const payload = message.payload && typeof message.payload === 'object'
      ? message.payload as Record<string, unknown>
      : {};
    if (message.requestId && this.pending.has(message.requestId)) {
      const pending = this.pending.get(message.requestId) as PendingRequest;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.type === pending.expect) pending.resolve(payload);
      else pending.reject(new RoomClientError(String(payload.message ?? `unexpected ${message.type}`), String(payload.code ?? 'ERROR')));
      return;
    }
    const subId = typeof payload.subId === 'string' ? payload.subId : undefined;
    const sub = subId ? this.subscriptions.get(subId) : undefined;
    if (!sub || sub.closed) return;
    if (message.type === 'fleet.rooms.event') this.onEvent(sub, payload);
    else if (message.type === 'fleet.rooms.eose') this.onEose(sub, payload);
    else if (message.type === 'fleet.rooms.closed') this.onClosed(sub, payload);
  }

  private onEvent(sub: ClientSubscription, payload: Record<string, unknown>): void {
    const seq = payload.seq;
    if (!Number.isSafeInteger(seq) || (seq as number) <= 0) return;
    const shape = checkRoomEventShape(payload.event);
    const room = shape.ok ? roomOf(shape.event) : undefined;
    if (!shape.ok || !room || !verifyRoomEvent(shape.event).ok || !roomFiltersMatch(sub.filters, shape.event)) {
      this.emit('invalid-event', { subId: sub.subId, seq });
      return;
    }
    sub.maxSeenSeq = Math.max(sub.maxSeenSeq ?? 0, seq as number);
    // While replaying, the old cursor is provisional until EOSE tells us which
    // ledger generation produced these records.
    if (sub.cursor && !sub.replaying) {
      sub.cursor = { ...sub.cursor, throughSeq: Math.max(sub.cursor.throughSeq, seq as number) };
    }
    if (!this.seen.add(`${sub.subId.length}:${sub.subId}:${shape.event.id}`)) return;
    const event = freezeRoomEvent(shape.event as RoomEvent);
    const thread = resolveThread(parseThreadMarkers(event.tags));
    try {
      sub.handlers.onMessage({
        seq: seq as number,
        room,
        author: event.pubkey,
        event,
        mentions: tagValues(event, 'p'),
        ...(thread ? { thread } : {}),
        text: sanitizePeerText(event.content),
      });
    } catch (error) {
      this.emit('handler-error', error);
    }
  }

  private onEose(sub: ClientSubscription, payload: Record<string, unknown>): void {
    const valid = isStoreId(payload.storeId) &&
      Number.isSafeInteger(payload.throughSeq) && (payload.throughSeq as number) >= 0 &&
      typeof payload.live === 'boolean' && typeof payload.truncated === 'boolean' &&
      payload.truncated === !payload.live && typeof payload.gap === 'boolean' &&
      typeof payload.epochChanged === 'boolean';
    if (!valid) {
      this.closeSubscriptionLocally(sub, 'invalid: malformed end-of-stored-events frame');
      return;
    }
    const storeId = payload.storeId as string;
    const throughSeq = payload.throughSeq as number;
    const replayCursor = sub.replayCursor;
    const epochChanged = payload.epochChanged === true ||
      (replayCursor !== undefined && replayCursor.storeId !== storeId);
    if ((sub.maxSeenSeq ?? 0) > throughSeq) {
      this.closeSubscriptionLocally(sub, 'invalid: EOSE cursor precedes a delivered event');
      return;
    }
    const replayFloor = replayCursor?.storeId === storeId ? replayCursor.throughSeq : 0;
    if (payload.live === false && throughSeq <= replayFloor) {
      this.closeSubscriptionLocally(sub, 'invalid: truncated replay made no cursor progress');
      return;
    }
    const previousThroughSeq = !epochChanged && replayCursor?.storeId === storeId
      ? replayCursor.throughSeq
      : 0;
    sub.cursor = { storeId, throughSeq: Math.max(previousThroughSeq, throughSeq, sub.maxSeenSeq ?? 0) };
    sub.replaying = false;
    sub.replayCursor = undefined;
    sub.maxSeenSeq = sub.cursor.throughSeq;
    sub.backpressureRetries = 0;
    sub.replayGap ||= payload.gap as boolean;
    sub.replayEpochChanged ||= epochChanged;
    if (payload.live === false && sub.autoPage) {
      // Truncated replay: page forward from the cursor.
      this.sendSubscribe(sub, true);
      return;
    }
    this.callHandler(() => sub.handlers.onEose?.({
      storeId,
      throughSeq: sub.cursor?.throughSeq ?? throughSeq,
      gap: sub.replayGap,
      epochChanged: sub.replayEpochChanged,
      truncated: payload.truncated as boolean,
    }));
    sub.replayGap = false;
    sub.replayEpochChanged = false;
  }

  private onClosed(sub: ClientSubscription, payload: Record<string, unknown>): void {
    const message = typeof payload.message === 'string' ? payload.message : 'closed';
    if (message.startsWith('error: backpressure') && sub.backpressureRetries < 5) {
      sub.backpressureRetries++;
      if (isStoreId(payload.storeId) && Number.isSafeInteger(payload.throughSeq) &&
          (payload.throughSeq as number) >= 0) {
        const sameGeneration = sub.cursor?.storeId === payload.storeId;
        sub.cursor = {
          storeId: payload.storeId,
          throughSeq: sameGeneration
            ? Math.max(payload.throughSeq as number, sub.maxSeenSeq ?? 0)
            : payload.throughSeq as number,
        };
      }
      const retry = setTimeout(() => {
        sub.retryTimers.delete(retry);
        if (!sub.closed && this.ready) this.sendSubscribe(sub);
      }, 50 * sub.backpressureRetries);
      sub.retryTimers.add(retry);
      retry.unref?.();
      return;
    }
    this.closeSubscriptionLocally(sub, message);
  }

  private closeSubscriptionLocally(sub: ClientSubscription, message: string): void {
    if (sub.closed) return;
    sub.closed = true;
    for (const timer of sub.retryTimers) clearTimeout(timer);
    sub.retryTimers.clear();
    this.subscriptions.delete(sub.subId);
    this.callHandler(() => sub.handlers.onClosed?.(message));
  }

  private callHandler(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.emit('handler-error', error);
    }
  }

  private sendSubscribe(sub: ClientSubscription, continuingPage = false): void {
    if (!continuingPage) {
      sub.replayGap = false;
      sub.replayEpochChanged = false;
    }
    const cursor = sub.cursor;
    sub.replayCursor = cursor ? { ...cursor } : undefined;
    sub.replaying = true;
    sub.maxSeenSeq = undefined;
    this.sendRaw({
      type: 'fleet.rooms.subscribe',
      payload: {
        subId: sub.subId,
        filters: sub.filters,
        ...(cursor ? { afterSeq: cursor.throughSeq, storeId: cursor.storeId } : {}),
      },
    });
  }

  private waitUntilReady(timeoutMs: number): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.closing) return Promise.reject(new RoomClientError('client closed', 'CLOSED'));
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (error: Error) => { clearTimeout(timer); reject(error); },
      };
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((entry) => entry !== waiter);
        reject(new RoomClientError('not reconnected in time', 'DISCONNECTED'));
      }, timeoutMs);
      this.readyWaiters.push(waiter);
    });
  }

  /**
   * Sign and publish. Resolves once the hub has durably stored the message
   * (or already had it). A connection lost before the acknowledgement is
   * retried once with the SAME signed event, which the hub deduplicates.
   */
  async publish(input: RoomMessageInput): Promise<{ id: string; seq: number; duplicate: boolean; storeId: string }> {
    const event = signRoomEvent(buildRoomMessage(input, this.pubkey), this.options.secretKey);
    return this.publishSigned(event);
  }

  async publishSigned(event: RoomEvent): Promise<{ id: string; seq: number; duplicate: boolean; storeId: string }> {
    for (let attempt = 0; ; attempt++) {
      try {
        if (!this.ready) await this.waitUntilReady(this.requestTimeoutMs);
        const ack = await this.request('fleet.rooms.publish', { event }, 'fleet.rooms.ok');
        if (ack.accepted !== true || ack.id !== event.id ||
            !Number.isSafeInteger(ack.seq) || (ack.seq as number) <= 0 || !isStoreId(ack.storeId)) {
          throw new RoomClientError(String(ack.message || 'publication refused'), 'REJECTED');
        }
        const message = String(ack.message ?? '');
        return {
          id: event.id,
          seq: ack.seq as number,
          duplicate: message.startsWith('duplicate:'),
          storeId: ack.storeId as string,
        };
      } catch (error) {
        const retryable = error instanceof RoomClientError && error.code === 'DISCONNECTED';
        if (!retryable || attempt >= 1 || this.options.autoReconnect === false) throw error;
      }
    }
  }

  /** Open a subscription; it survives reconnections until closed. */
  subscribe(subId: string, filters: RoomFilter[], handlers: RoomSubscriptionHandlers, cursor?: RoomCursor): RoomSubscriptionHandle {
    return this.openSubscription(subId, filters, handlers, cursor, true);
  }

  private openSubscription(
    subId: string,
    filters: RoomFilter[],
    handlers: RoomSubscriptionHandlers,
    cursor: RoomCursor | undefined,
    autoPage: boolean,
  ): RoomSubscriptionHandle {
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(subId)) {
      throw new RoomClientError('subId must match ^[A-Za-z0-9._:-]{1,64}$', 'INVALID_SUB');
    }
    if (this.subscriptions.has(subId)) throw new RoomClientError(`subscription ${subId} already open`, 'DUPLICATE_SUB');
    const parsed = parseRoomFilters(filters);
    if (!parsed.ok) throw new RoomClientError(`invalid filters: ${parsed.reason}`, 'INVALID_FILTER');
    if (cursor && (!isStoreId(cursor.storeId) || !Number.isSafeInteger(cursor.throughSeq) || cursor.throughSeq < 0)) {
      throw new RoomClientError('cursor must contain a valid storeId and non-negative throughSeq', 'INVALID_CURSOR');
    }
    const sub: ClientSubscription = {
      subId,
      filters: parsed.filters,
      handlers,
      ...(cursor ? { cursor: { ...cursor } } : {}),
      replaying: false,
      autoPage,
      replayGap: false,
      replayEpochChanged: false,
      closed: false,
      backpressureRetries: 0,
      retryTimers: new Set(),
    };
    this.subscriptions.set(subId, sub);
    if (this.ready) this.sendSubscribe(sub);
    return {
      subId,
      cursor: () => (sub.cursor ? { ...sub.cursor } : undefined),
      close: async () => {
        if (sub.closed) return;
        sub.closed = true;
        for (const timer of sub.retryTimers) clearTimeout(timer);
        sub.retryTimers.clear();
        this.subscriptions.delete(subId);
        if (this.ready) {
          await this.request('fleet.rooms.close', { subId }, 'fleet.rooms.unsubscribed').catch(() => undefined);
        }
      },
    };
  }

  /**
   * One-shot read: stored messages matching `filters` (or after `cursor`),
   * returned with the cursor to resume from next time.
   */
  async fetch(
    filters: RoomFilter[],
    cursor?: RoomCursor,
    options: RoomFetchOptions = {},
  ): Promise<{
    messages: ReceivedRoomMessage[];
    cursor: RoomCursor;
    gap: boolean;
    epochChanged: boolean;
    truncated: boolean;
  }> {
    const maxMessages = boundedPositiveInteger(
      'maxMessages', options.maxMessages, DEFAULT_FETCH_MAX_MESSAGES, MAX_FETCH_MESSAGES,
    );
    const maxBytes = boundedPositiveInteger(
      'maxBytes', options.maxBytes, DEFAULT_FETCH_MAX_BYTES, MAX_FETCH_BYTES,
    );
    const subId = `fetch-${Date.now().toString(36)}-${(++this.requestCounter).toString(36)}`;
    const messages: ReceivedRoomMessage[] = [];
    let retainedBytes = 0;
    let pageTruncated = false;
    let lastRetainedSeq: number | undefined;
    return new Promise((resolve, reject) => {
      let settled = false;
      let handle: RoomSubscriptionHandle | undefined;
      const fail = (error: RoomClientError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void handle?.close();
        reject(error);
      };
      const timer = setTimeout(() => {
        fail(new RoomClientError('fetch timed out', 'TIMEOUT'));
      }, this.requestTimeoutMs * 3);
      try {
        handle = this.openSubscription(subId, filters, {
          onMessage: (message) => {
            if (pageTruncated) return;
            const messageBytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
            if (messages.length >= maxMessages || retainedBytes + messageBytes > maxBytes) {
              if (messages.length === 0) {
                fail(new RoomClientError('one room message exceeds the configured fetch byte limit', 'LIMIT_EXCEEDED'));
                return;
              }
              pageTruncated = true;
              return;
            }
            retainedBytes += messageBytes;
            messages.push(message);
            lastRetainedSeq = message.seq;
          },
          onEose: (info) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            void handle?.close();
            const throughSeq = pageTruncated && lastRetainedSeq !== undefined
              ? lastRetainedSeq
              : info.throughSeq;
            resolve({
              messages,
              cursor: { storeId: info.storeId, throughSeq },
              gap: info.gap,
              epochChanged: info.epochChanged,
              truncated: pageTruncated || info.truncated,
            });
          },
          onClosed: (message) => {
            fail(new RoomClientError(message, 'CLOSED'));
          },
        }, cursor, false);
      } catch (error) {
        fail(error instanceof RoomClientError
          ? error
          : new RoomClientError(error instanceof Error ? error.message : String(error), 'INVALID_SUB'));
      }
    });
  }

  private onSocketClosed(): void {
    const wasReady = this.ready;
    this.ready = false;
    this.ws = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RoomClientError('connection closed', 'DISCONNECTED'));
      this.pending.delete(id);
    }
    if (wasReady) this.emit('disconnected');
    if (this.closing || this.options.autoReconnect === false || !this.everConnected) {
      for (const waiter of this.readyWaiters.splice(0)) {
        waiter.reject(new RoomClientError('connection closed', 'DISCONNECTED'));
      }
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closing) return;
    if (this.reconnectAttempts >= this.reconnectMaxAttempts) {
      for (const waiter of this.readyWaiters.splice(0)) {
        waiter.reject(new RoomClientError('reconnection attempts exhausted', 'DISCONNECTED'));
      }
      this.emit('reconnect-exhausted');
      return;
    }
    const base = Math.min(this.reconnectMaxDelayMs, this.reconnectInitialDelayMs * 2 ** this.reconnectAttempts);
    const delay = Math.floor(base / 2 + Math.random() * (base / 2));
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closing) return;
      this.startOpen().catch((error: Error) => {
        this.emit('reconnect-error', error);
        if (error instanceof RoomClientError && error.code === 'ROOM_AUTH_REFUSED') {
          this.closing = true;
          for (const waiter of this.readyWaiters.splice(0)) waiter.reject(error);
        }
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const waiter of this.readyWaiters.splice(0)) waiter.reject(new RoomClientError('client closed', 'CLOSED'));
    for (const sub of [...this.subscriptions.values()]) this.closeSubscriptionLocally(sub, 'client closed');
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RoomClientError('client closed', 'CLOSED'));
      this.pending.delete(id);
    }
    const ws = this.ws;
    if (!ws || ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      try {
        ws.close();
      } catch {
        resolve();
      }
      setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        resolve();
      }, 1_000).unref?.();
    });
  }
}
