/**
 * Fleet rooms — transport-agnostic hub.
 *
 * Adapted from block/buzz @ 4cd82f51 (Apache-2.0):
 * - publish pipeline order and machine-readable `OK` prefixes
 *   (`auth-required:`, `invalid:`, `restricted:`, `rate-limited:`, `duplicate:`,
 *   `error:`) from `crates/buzz-relay/src/handlers/event.rs` + `ARCHITECTURE.md` §4;
 * - REQ handling (access checked before anything is read or registered, stored
 *   events then `EOSE` then live fan-out, bounded subscriptions and history)
 *   from `crates/buzz-relay/src/handlers/req.rs` + `ARCHITECTURE.md` §5;
 * - NIP-42 challenge/response from `ARCHITECTURE.md` §3 and `crates/buzz-auth`.
 *
 * Messages are DATA. The hub stores and forwards signed events; nothing here
 * turns a message into a prompt, a tool call or an agent turn, so a peer cannot
 * start work on another member and no reply loop can form through the hub.
 *
 * @module fleet/rooms/room-hub
 */

import { randomBytes } from 'crypto';

import { logger } from '../../utils/logger.js';
import {
  canonicalRoomAudience,
  checkRoomEventShape,
  MAX_ROOM_MENTIONS,
  ROOM_AUTH_KIND,
  ROOM_MESSAGE_KIND,
  roomOf,
  tagValues,
  verifyRoomEvent,
  type ReadonlyRoomEvent,
} from './room-event.js';
import type { RoomAccessLevel, RoomAccessPolicy } from './room-access.js';
import { parseRoomFilters, roomFiltersMatch, roomsReferenced, type RoomFilter } from './room-filter.js';
import { RoomStoreError, type RoomRecord, type RoomStore } from './room-store.js';

const SUB_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export interface RoomHubOptions {
  store: RoomStore;
  access: RoomAccessPolicy;
  /** Canonical audiences accepted in auth proofs (see `canonicalRoomAudience`). */
  audiences: readonly string[];
  maxSubscriptionsPerSession?: number;
  /** Accepted publications per member key per minute. */
  publishPerMinute?: number;
  maxFutureSkewSec?: number;
  maxPastSkewSec?: number;
  authSkewSec?: number;
  challengeTtlMs?: number;
  maxAuthAttempts?: number;
  /** Clock in ms (tests). */
  now?: () => number;
}

export interface RoomTransport {
  readonly connectionId: string;
  /** Server-derived WebSocket principal (`key:…`, `user:…`). */
  readonly principalId: string;
  send(frame: RoomStreamFrame): boolean;
  isBackpressured(): boolean;
}

export type RoomStreamFrame =
  | { type: 'fleet.rooms.event'; payload: { subId: string; seq: number; event: ReadonlyRoomEvent } }
  | {
    type: 'fleet.rooms.eose';
    payload: {
      subId: string;
      storeId: string;
      throughSeq: number;
      /** false: the replay was truncated; resubscribe after `throughSeq`. */
      live: boolean;
      truncated: boolean;
      /** Records after the cursor were evicted; the replay is incomplete. */
      gap: boolean;
      /** The cursor named another ledger generation and was ignored. */
      epochChanged: boolean;
    };
  }
  | {
    type: 'fleet.rooms.closed';
    payload: { subId: string; message: string; storeId: string; throughSeq: number | null };
  };

export type RoomAuthResult =
  | { ok: true; pubkey: string; name: string; rooms: Array<{ room: string; access: RoomAccessLevel; description?: string }> }
  | { ok: false; message: string };

export interface RoomPublishResult {
  id: string;
  accepted: boolean;
  message: string;
  seq?: number;
  storeId: string;
}

interface LiveSubscription {
  subId: string;
  filters: RoomFilter[];
  rooms: string[];
  throughSeq: number;
}

function finitePositive(name: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number > 0`);
  }
  return value;
}

export class RoomSession {
  pubkey: string | undefined;
  private challenge: { value: string; expiresAt: number } | undefined;
  private authAttempts = 0;
  private readonly subscriptions = new Map<string, LiveSubscription>();
  private disposed = false;

  constructor(private readonly hub: RoomHub, readonly transport: RoomTransport) {}

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Issue a fresh single-use challenge (replaces any previous one). */
  hello(): { challenge: string; expiresAt: string } {
    const value = randomBytes(32).toString('hex');
    const expiresAt = this.hub.now() + this.hub.challengeTtlMs;
    this.challenge = { value, expiresAt };
    return { challenge: value, expiresAt: new Date(expiresAt).toISOString() };
  }

  authenticate(input: unknown): RoomAuthResult {
    if (this.disposed) return { ok: false, message: 'error: session closed' };
    this.authAttempts++;
    const challenge = this.challenge;
    this.challenge = undefined;
    if (this.authAttempts > this.hub.maxAuthAttempts) {
      return { ok: false, message: 'restricted: too many authentication attempts on this connection' };
    }
    if (!challenge || this.hub.now() > challenge.expiresAt) {
      return { ok: false, message: 'auth-required: request a fresh challenge with fleet.rooms.hello' };
    }
    const shape = checkRoomEventShape(input);
    if (!shape.ok) return { ok: false, message: `invalid: ${shape.reason}` };
    const event = shape.event;
    if (event.kind !== ROOM_AUTH_KIND) return { ok: false, message: 'invalid: auth proof must be kind 22242' };
    const challengeTags = event.tags.filter((tag) => tag[0] === 'challenge');
    if (challengeTags.length !== 1 || challengeTags[0]?.length !== 2 || challengeTags[0][1] !== challenge.value) {
      return { ok: false, message: 'invalid: auth proof does not answer this challenge' };
    }
    const relayTags = event.tags.filter((tag) => tag[0] === 'relay');
    let audience: string | undefined;
    try {
      audience = relayTags.length === 1 && relayTags[0]?.length === 2
        ? canonicalRoomAudience(relayTags[0][1] as string)
        : undefined;
    } catch {
      audience = undefined;
    }
    if (!audience || !this.hub.audiences.includes(audience)) {
      return { ok: false, message: 'restricted: auth proof is addressed to another hub' };
    }
    const nowSec = Math.floor(this.hub.now() / 1000);
    if (Math.abs(event.created_at - nowSec) > this.hub.authSkewSec) {
      return { ok: false, message: 'invalid: auth proof timestamp outside the allowed window' };
    }
    const verified = verifyRoomEvent(event);
    if (!verified.ok) return { ok: false, message: `invalid: ${verified.reason}` };
    const admission = this.hub.access.admit(event.pubkey, this.transport.principalId);
    if (!admission.ok) return { ok: false, message: admission.reason };
    if (this.pubkey !== event.pubkey) this.closeAll('restricted: room identity changed');
    this.pubkey = event.pubkey;
    this.authAttempts = 0;
    return {
      ok: true,
      pubkey: event.pubkey,
      name: admission.member.name,
      rooms: this.hub.access.roomsFor(event.pubkey),
    };
  }

  publish(input: unknown): RoomPublishResult {
    const storeId = this.hub.store.storeId;
    const claimedId = input && typeof input === 'object' && typeof (input as { id?: unknown }).id === 'string'
      ? ((input as { id: string }).id.match(/^[0-9a-f]{64}$/)?.[0] ?? '')
      : '';
    const reject = (message: string): RoomPublishResult => ({ id: claimedId, accepted: false, message, storeId });
    if (this.disposed) return reject('error: session closed');
    if (!this.pubkey) return reject('auth-required: authenticate with fleet.rooms.auth first');
    const admission = this.hub.access.admit(this.pubkey, this.transport.principalId);
    if (!admission.ok) return reject(admission.reason);

    const shape = checkRoomEventShape(input);
    if (!shape.ok) return reject(`invalid: ${shape.reason}`);
    const event = shape.event;
    if (event.pubkey !== this.pubkey) return reject('invalid: event pubkey does not match authenticated identity');
    if (event.kind === ROOM_AUTH_KIND) return reject('invalid: AUTH events cannot be published');
    if (event.kind !== ROOM_MESSAGE_KIND) return reject('invalid: only kind 9 room messages are accepted');
    const room = roomOf(event);
    if (!room) return reject('invalid: message must carry exactly one valid h tag');
    if (tagValues(event, 'p').length > MAX_ROOM_MENTIONS) {
      return reject(`invalid: at most ${MAX_ROOM_MENTIONS} mentions`);
    }
    const verified = verifyRoomEvent(event);
    if (!verified.ok) return reject(`invalid: ${verified.reason}`);
    if (!this.hub.access.canWrite(this.pubkey, room)) {
      return reject(`restricted: no write access to room ${room}`);
    }
    const existing = this.hub.store.get(event.id);
    if (existing) {
      return { id: event.id, accepted: true, message: 'duplicate: already stored', seq: existing.seq, storeId };
    }
    const nowSec = Math.floor(this.hub.now() / 1000);
    if (event.created_at > nowSec + this.hub.maxFutureSkewSec) {
      return reject('invalid: created_at is too far in the future');
    }
    if (event.created_at < nowSec - this.hub.maxPastSkewSec) {
      return reject('invalid: created_at is too old');
    }
    if (!this.hub.takePublishToken(this.pubkey)) {
      return reject('rate-limited: too many messages, slow down');
    }
    let stored: RoomRecord;
    try {
      const result = this.hub.store.append(event, this.hub.now());
      stored = result.record;
      if (result.status === 'duplicate') {
        return { id: event.id, accepted: true, message: 'duplicate: already stored', seq: stored.seq, storeId };
      }
    } catch (error) {
      if (error instanceof RoomStoreError && error.code === 'FULL') return reject('error: room storage full');
      logger.error('[fleet-rooms] append failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return reject('error: room storage unavailable');
    }
    this.hub.deliver(stored);
    return { id: event.id, accepted: true, message: '', seq: stored.seq, storeId };
  }

  subscribe(request: unknown): { ok: true } | { ok: false; message: string } {
    const storeId = this.hub.store.storeId;
    const raw = request && typeof request === 'object' ? request as Record<string, unknown> : {};
    const subId = raw.subId;
    if (typeof subId !== 'string' || !SUB_ID_PATTERN.test(subId)) {
      return { ok: false, message: 'invalid: subId must match ^[A-Za-z0-9._:-]{1,64}$' };
    }
    const closed = (message: string, throughSeq: number | null = null) => {
      this.transport.send({ type: 'fleet.rooms.closed', payload: { subId, message, storeId, throughSeq } });
      return { ok: true as const };
    };
    // NIP-01: a REQ reusing an id replaces the previous subscription.
    this.subscriptions.delete(subId);
    if (this.disposed) return closed('error: session closed');
    if (!this.pubkey) return closed('auth-required: authenticate with fleet.rooms.auth first');
    const admission = this.hub.access.admit(this.pubkey, this.transport.principalId);
    if (!admission.ok) return closed(admission.reason);
    const parsed = parseRoomFilters(raw.filters);
    if (!parsed.ok) return closed(`invalid: ${parsed.reason}`);
    const rooms = roomsReferenced(parsed.filters);
    const denied = rooms.find((room) => !this.hub.access.canRead(this.pubkey as string, room));
    if (denied) return closed(`restricted: no read access to room ${denied}`);
    if (this.subscriptions.size >= this.hub.maxSubscriptionsPerSession) {
      return closed('error: too many subscriptions');
    }

    let afterSeq: number | undefined;
    let epochChanged = false;
    if (raw.afterSeq !== undefined) {
      if (!Number.isSafeInteger(raw.afterSeq) || (raw.afterSeq as number) < 0 || typeof raw.storeId !== 'string') {
        return closed('invalid: afterSeq must be a non-negative integer sent with its storeId');
      }
      if (raw.storeId === storeId) afterSeq = raw.afterSeq as number;
      else epochChanged = true;
    }

    const latestSeq = this.hub.store.latestSeq;
    const { records, truncated } = this.hub.store.query(parsed.filters, afterSeq === undefined ? {} : { afterSeq });
    const gap = afterSeq !== undefined && this.hub.store.hasGapAfter(rooms, afterSeq);
    let lastSent: number | null = afterSeq ?? null;
    for (const record of records) {
      if (this.transport.isBackpressured()) {
        return closed('error: backpressure, resubscribe after throughSeq', lastSent);
      }
      if (!this.transport.send({ type: 'fleet.rooms.event', payload: { subId, seq: record.seq, event: record.event } })) {
        this.dispose();
        return { ok: true };
      }
      lastSent = record.seq;
    }
    const throughSeq = truncated ? (lastSent ?? 0) : latestSeq;
    this.transport.send({
      type: 'fleet.rooms.eose',
      payload: { subId, storeId, throughSeq, live: !truncated, truncated, gap, epochChanged },
    });
    // Synchronous from the query to here: no append can interleave, so live
    // delivery starts exactly after `throughSeq`.
    if (!truncated) this.subscriptions.set(subId, { subId, filters: parsed.filters, rooms, throughSeq });
    return { ok: true };
  }

  unsubscribe(subId: unknown): { subId: string; closed: boolean } {
    const id = typeof subId === 'string' ? subId : '';
    return { subId: id, closed: this.subscriptions.delete(id) };
  }

  /** Hub fan-out for one stored record. */
  deliver(record: RoomRecord): void {
    if (this.disposed || !this.pubkey) return;
    for (const sub of [...this.subscriptions.values()]) {
      if (record.seq <= sub.throughSeq || !roomFiltersMatch(sub.filters, record.event)) continue;
      const admission = this.hub.access.admit(this.pubkey, this.transport.principalId);
      if (!admission.ok || sub.rooms.some((room) => !this.hub.access.canRead(this.pubkey as string, room))) {
        this.closeSubscription(sub, 'restricted: membership revoked');
        continue;
      }
      if (this.transport.isBackpressured()) {
        this.closeSubscription(sub, 'error: backpressure, resubscribe after throughSeq');
        continue;
      }
      if (!this.transport.send({ type: 'fleet.rooms.event', payload: { subId: sub.subId, seq: record.seq, event: record.event } })) {
        this.dispose();
        return;
      }
      sub.throughSeq = record.seq;
    }
  }

  private closeSubscription(sub: LiveSubscription, message: string): void {
    this.subscriptions.delete(sub.subId);
    this.transport.send({
      type: 'fleet.rooms.closed',
      payload: { subId: sub.subId, message, storeId: this.hub.store.storeId, throughSeq: sub.throughSeq },
    });
  }

  private closeAll(message: string): void {
    for (const sub of [...this.subscriptions.values()]) this.closeSubscription(sub, message);
  }

  get subscriptionCount(): number {
    return this.subscriptions.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscriptions.clear();
    this.challenge = undefined;
    this.pubkey = undefined;
    this.hub.forget(this);
  }
}

export class RoomHub {
  readonly store: RoomStore;
  readonly access: RoomAccessPolicy;
  readonly audiences: readonly string[];
  readonly maxSubscriptionsPerSession: number;
  readonly publishPerMinute: number;
  readonly maxFutureSkewSec: number;
  readonly maxPastSkewSec: number;
  readonly authSkewSec: number;
  readonly challengeTtlMs: number;
  readonly maxAuthAttempts: number;
  readonly now: () => number;
  private readonly sessions = new Set<RoomSession>();
  private readonly publishWindows = new Map<string, { start: number; count: number }>();

  constructor(options: RoomHubOptions) {
    this.store = options.store;
    this.access = options.access;
    const audiences = options.audiences.map((audience) => canonicalRoomAudience(audience));
    if (audiences.length === 0) throw new RangeError('at least one hub audience is required');
    this.audiences = Object.freeze([...new Set(audiences)]);
    this.maxSubscriptionsPerSession = Math.floor(finitePositive('maxSubscriptionsPerSession', options.maxSubscriptionsPerSession, 16));
    this.publishPerMinute = Math.floor(finitePositive('publishPerMinute', options.publishPerMinute, 60));
    this.maxFutureSkewSec = finitePositive('maxFutureSkewSec', options.maxFutureSkewSec, 300);
    this.maxPastSkewSec = finitePositive('maxPastSkewSec', options.maxPastSkewSec, 86_400);
    this.authSkewSec = finitePositive('authSkewSec', options.authSkewSec, 60);
    this.challengeTtlMs = finitePositive('challengeTtlMs', options.challengeTtlMs, 120_000);
    this.maxAuthAttempts = Math.floor(finitePositive('maxAuthAttempts', options.maxAuthAttempts, 5));
    this.now = options.now ?? Date.now;
  }

  open(transport: RoomTransport): RoomSession {
    const session = new RoomSession(this, transport);
    this.sessions.add(session);
    return session;
  }

  /** @internal */
  forget(session: RoomSession): void {
    this.sessions.delete(session);
  }

  /** @internal Fixed one-minute window per member key. */
  takePublishToken(pubkey: string): boolean {
    const now = this.now();
    const window = this.publishWindows.get(pubkey);
    if (!window || now - window.start >= 60_000) {
      this.publishWindows.set(pubkey, { start: now, count: 1 });
      return true;
    }
    if (window.count >= this.publishPerMinute) return false;
    window.count++;
    return true;
  }

  /** @internal */
  deliver(record: RoomRecord): void {
    for (const session of [...this.sessions]) session.deliver(record);
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Dispose every session. The store stays owned by the caller. */
  close(): void {
    for (const session of [...this.sessions]) session.dispose();
    this.publishWindows.clear();
  }
}
