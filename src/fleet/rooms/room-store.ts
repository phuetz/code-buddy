/**
 * Fleet rooms — durable append-only message ledger.
 *
 * Buzz stores events in Postgres and replays by `created_at` (`since`), which
 * trusts every author's clock (`crates/buzz-acp/src/relay.rs::channel_since`).
 * A fleet mixes machines whose clocks drift, so the hub also stamps each
 * accepted event with a strictly increasing `seq`: reconnection resumes from
 * the last `seq` a member saw, and a message signed with a late clock cannot
 * fall behind the cursor. `storeId` names the ledger generation so a cursor
 * from a wiped ledger is never trusted (same role as the cognition bus epoch).
 *
 * Guarantees, each covered by tests:
 * - single writer: an exclusive directory lock ({@link RoomDirectoryLock}),
 *   re-checked with the ledger inode and size before every write or compaction;
 * - durability: an append is `fsync`ed before `append()` returns, so the hub
 *   only acknowledges what survives a crash;
 * - crash tail: bytes after the last newline (torn OR complete-but-unterminated)
 *   are copied to `ledger.jsonl.tail-*` and truncated BEFORE `seq` is reused;
 * - strict order and integrity: every complete record must be valid, authentic
 *   and strictly increasing or the store fails closed;
 * - compaction: eviction watermarks are persisted before the ledger rewrite,
 *   so a crash in between can only over-report a gap, never hide one;
 * - duplicate detection: ids are remembered for the retained window only;
 * - immutability: stored records are deep-frozen copies of the input.
 *
 * @module fleet/rooms/room-store
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { writeFileAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';
import { getCodeBuddyPath } from '../../utils/codebuddy-home.js';
import { logger } from '../../utils/logger.js';
import {
  checkRoomEventShape,
  freezeRoomEvent,
  isValidRoomId,
  ROOM_MESSAGE_KIND,
  roomOf,
  verifyRoomEvent,
  type ReadonlyRoomEvent,
} from './room-event.js';
import {
  DEFAULT_ROOM_HISTORY_LIMIT,
  MAX_ROOM_HISTORY_LIMIT,
  roomFilterMatches,
  roomFiltersMatch,
  roomsReferenced,
  type RoomFilter,
} from './room-filter.js';
import { RoomDirectoryLock } from './room-lock.js';

export const DEFAULT_MAX_EVENTS_PER_ROOM = 2_000;
export const DEFAULT_MAX_ROOMS = 1_024;
export const DEFAULT_MAX_LEDGER_BYTES = 128 * 1024 * 1024;
const DEFAULT_COMPACT_AFTER_EVICTIONS = 500;
const LEDGER_FILE = 'ledger.jsonl';
const META_FILE = 'meta.json';
const RECORD_FIELDS = new Set(['v', 'seq', 'receivedAt', 'event']);

export interface RoomRecord {
  readonly seq: number;
  readonly receivedAt: number;
  readonly event: ReadonlyRoomEvent;
}

export interface RoomStoreOptions {
  /** Defaults to `$CODEBUDDY_FLEET_ROOMS_DIR` or `<CODEBUDDY_HOME>/fleet/rooms`. */
  directory?: string;
  maxEventsPerRoom?: number;
  maxRooms?: number;
  /** Refuse to load, and to grow, a ledger beyond this size. */
  maxLedgerBytes?: number;
  compactAfterEvictions?: number;
}

export type RoomAppendResult =
  | { status: 'stored'; record: RoomRecord }
  | { status: 'duplicate'; record: RoomRecord };

export interface RoomQueryResult {
  records: RoomRecord[];
  /** Replay only: more matching records exist after the last one returned. */
  truncated: boolean;
}

export class RoomStoreError extends Error {
  constructor(message: string, readonly code: 'FULL' | 'CONFLICT' | 'CLOSED' | 'INVALID' | 'CORRUPT') {
    super(message);
    this.name = 'RoomStoreError';
  }
}

interface RoomMeta {
  version: 1;
  storeId: string;
  evicted: Record<string, number>;
}

function positiveInteger(name: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function isRoomMeta(value: unknown): value is RoomMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const meta = value as Partial<RoomMeta>;
  return meta.version === 1 &&
    typeof meta.storeId === 'string' && /^[0-9a-f-]{36}$/.test(meta.storeId) &&
    !!meta.evicted && typeof meta.evicted === 'object' && !Array.isArray(meta.evicted) &&
    Object.entries(meta.evicted).every(([room, seq]) => isValidRoomId(room) && Number.isSafeInteger(seq) && seq >= 0);
}

function freezeRecord(seq: number, receivedAt: number, event: ReadonlyRoomEvent): RoomRecord {
  return Object.freeze({ seq, receivedAt, event });
}

export function defaultRoomStoreDirectory(): string {
  return process.env.CODEBUDDY_FLEET_ROOMS_DIR || getCodeBuddyPath('fleet', 'rooms');
}

export class RoomStore {
  readonly directory: string;
  readonly storeId: string;
  private readonly ledgerPath: string;
  private readonly metaPath: string;
  private readonly maxEventsPerRoom: number;
  private readonly maxRooms: number;
  private readonly maxLedgerBytes: number;
  private readonly compactAfterEvictions: number;
  private readonly lock: RoomDirectoryLock;
  private readonly byRoom = new Map<string, RoomRecord[]>();
  private readonly byId = new Map<string, RoomRecord>();
  private readonly evicted: Record<string, number> = {};
  private fd: number | undefined;
  private expectedSize = 0;
  private lastSeq = 0;
  private evictionsSinceCompaction = 0;
  private closed = false;
  private failure: Error | undefined;

  constructor(options: RoomStoreOptions = {}) {
    this.maxEventsPerRoom = positiveInteger('maxEventsPerRoom', options.maxEventsPerRoom, DEFAULT_MAX_EVENTS_PER_ROOM);
    this.maxRooms = positiveInteger('maxRooms', options.maxRooms, DEFAULT_MAX_ROOMS);
    this.maxLedgerBytes = positiveInteger('maxLedgerBytes', options.maxLedgerBytes, DEFAULT_MAX_LEDGER_BYTES);
    this.compactAfterEvictions = positiveInteger(
      'compactAfterEvictions', options.compactAfterEvictions, DEFAULT_COMPACT_AFTER_EVICTIONS,
    );
    this.directory = options.directory ?? defaultRoomStoreDirectory();
    this.ledgerPath = path.join(this.directory, LEDGER_FILE);
    this.metaPath = path.join(this.directory, META_FILE);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });

    this.lock = RoomDirectoryLock.acquire(this.directory);
    try {
      const meta = this.readMeta();
      this.storeId = meta.storeId;
      for (const [room, seq] of Object.entries(meta.evicted)) this.evicted[room] = seq;
      this.lastSeq = Math.max(0, ...Object.values(this.evicted));
      if (!fs.existsSync(this.ledgerPath)) {
        // Creating through the atomic helper fsyncs both the empty file and its
        // directory entry. A plain open('a') can disappear after a power loss.
        writeFileAtomicSync(this.ledgerPath, '', { mode: 0o600 });
      }
      this.load();
      this.fd = fs.openSync(this.ledgerPath, 'a', 0o600);
      this.expectedSize = fs.fstatSync(this.fd).size;
    } catch (error) {
      if (this.fd !== undefined) fs.closeSync(this.fd);
      this.lock.release();
      throw error;
    }
  }

  get latestSeq(): number {
    return this.lastSeq;
  }

  private readMeta(): RoomMeta {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.metaPath, 'utf8'));
      if (isRoomMeta(parsed)) {
        if (fs.existsSync(this.ledgerPath)) return parsed;
        logger.warn('[fleet-rooms] ledger missing for valid meta.json; starting a new ledger generation');
      } else {
        logger.warn('[fleet-rooms] invalid meta.json; starting a new ledger generation');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('[fleet-rooms] unreadable meta.json; starting a new ledger generation');
      }
    }
    const meta: RoomMeta = { version: 1, storeId: randomUUID(), evicted: {} };
    // Records written under an unknown generation are kept aside, never
    // served under the new storeId and never deleted.
    if (fs.existsSync(this.ledgerPath)) {
      const orphan = `${this.ledgerPath}.orphan-${Date.now()}`;
      fs.renameSync(this.ledgerPath, orphan);
      logger.warn('[fleet-rooms] ledger without valid meta moved aside', { orphan });
    }
    writeJsonAtomicSync(this.metaPath, meta);
    return meta;
  }

  private load(): void {
    let size: number;
    try {
      size = fs.statSync(this.ledgerPath).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (size > this.maxLedgerBytes) {
      throw new RoomStoreError(
        `room ledger is ${size} bytes, above maxLedgerBytes ${this.maxLedgerBytes}; refusing to load it`,
        'FULL',
      );
    }
    if (size === 0) return;
    const buffer = fs.readFileSync(this.ledgerPath);
    const keep = buffer.lastIndexOf(0x0a) + 1;
    if (keep < buffer.length) this.quarantineTail(buffer.subarray(keep), keep);

    const lines = buffer.subarray(0, keep).toString('utf8').split('\n');
    lines.pop();
    let previousSeq = 0;
    for (const [index, line] of lines.entries()) {
      let record: RoomRecord;
      try {
        record = this.parseRecord(line);
      } catch (error) {
        if (error instanceof RoomStoreError && error.code === 'CORRUPT') {
          throw new RoomStoreError(`room ledger line ${index + 1} is corrupt: ${error.message}`, 'CORRUPT');
        }
        throw error;
      }
      if (record.seq <= previousSeq) {
        throw new RoomStoreError(`room ledger line ${index + 1} does not have an increasing seq`, 'CORRUPT');
      }
      previousSeq = record.seq;
      const room = roomOf(record.event) as string;
      // The watermark is committed before compaction replaces the ledger. If a
      // crash leaves the old ledger behind, never resurrect records it retired.
      if (record.seq <= (this.evicted[room] ?? 0)) continue;
      if (this.byId.has(record.event.id)) {
        throw new RoomStoreError(`room ledger line ${index + 1} duplicates a retained event id`, 'CORRUPT');
      }
      this.insert(record);
    }
    this.lastSeq = Math.max(this.lastSeq, previousSeq);
  }

  /** Move the bytes after the last newline aside and cut them from the ledger. */
  private quarantineTail(tail: Buffer, keep: number): void {
    const tailPath = `${this.ledgerPath}.tail-${Date.now()}-${process.pid}`;
    fs.writeFileSync(tailPath, tail, { mode: 0o600, flag: 'wx' });
    const fd = fs.openSync(this.ledgerPath, 'r+');
    try {
      fs.ftruncateSync(fd, keep);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    logger.warn('[fleet-rooms] unterminated ledger tail quarantined', { tailPath, bytes: tail.length });
  }

  private parseRecord(line: string): RoomRecord {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new RoomStoreError('record is not valid JSON', 'CORRUPT');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new RoomStoreError('record must be an object', 'CORRUPT');
    }
    const value = parsed as Record<string, unknown>;
    if (Object.keys(value).some((key) => !RECORD_FIELDS.has(key))) {
      throw new RoomStoreError('record has an unknown field', 'CORRUPT');
    }
    if (value.v !== 1 || !Number.isSafeInteger(value.seq) || (value.seq as number) <= 0 ||
        !Number.isSafeInteger(value.receivedAt) || (value.receivedAt as number) < 0) {
      throw new RoomStoreError('record envelope is invalid', 'CORRUPT');
    }
    const shape = checkRoomEventShape(value.event);
    if (!shape.ok || shape.event.kind !== ROOM_MESSAGE_KIND || !roomOf(shape.event)) {
      throw new RoomStoreError('record event shape is invalid', 'CORRUPT');
    }
    const verified = verifyRoomEvent(shape.event);
    if (!verified.ok) {
      throw new RoomStoreError(`record event is not authentic: ${verified.reason}`, 'CORRUPT');
    }
    return freezeRecord(value.seq as number, value.receivedAt as number, freezeRoomEvent(shape.event));
  }

  private insert(record: RoomRecord): void {
    const room = roomOf(record.event) as string;
    let records = this.byRoom.get(room);
    if (!records) {
      if (this.byRoom.size >= this.maxRooms) {
        throw new RoomStoreError(`room ledger already holds maxRooms ${this.maxRooms}`, 'FULL');
      }
      records = [];
      this.byRoom.set(room, records);
    }
    records.push(record);
    this.byId.set(record.event.id, record);
    this.lastSeq = Math.max(this.lastSeq, record.seq);
    while (records.length > this.maxEventsPerRoom) {
      const oldest = records.shift();
      if (!oldest) break;
      this.byId.delete(oldest.event.id);
      this.evicted[room] = Math.max(this.evicted[room] ?? 0, oldest.seq);
      this.evictionsSinceCompaction++;
    }
  }

  private assertWritable(): void {
    if (this.closed) throw new RoomStoreError('room store is closed', 'CLOSED');
    if (this.failure) throw new RoomStoreError(`room store stopped after a failure: ${this.failure.message}`, 'CONFLICT');
  }

  /** Stop at the first sign that another process touched the ledger. */
  private assertExclusive(): void {
    const fail = (reason: string): never => {
      this.failure = new Error(reason);
      throw new RoomStoreError(reason, 'CONFLICT');
    };
    if (!this.lock.isHeld()) fail('room ledger lock is no longer held by this process');
    let onDisk: fs.Stats;
    try {
      onDisk = fs.statSync(this.ledgerPath);
    } catch {
      return fail('room ledger disappeared');
    }
    const mine = fs.fstatSync(this.fd as number);
    if (onDisk.ino !== mine.ino || onDisk.dev !== mine.dev || mine.size !== this.expectedSize) {
      fail('room ledger was modified by another writer');
    }
  }

  get(id: string): RoomRecord | undefined {
    return this.byId.get(id);
  }

  /**
   * Durably persist an authentic room message. Idempotency is guaranteed for
   * ids still in the retained window; an evicted id may be stored again. The
   * input is copied and the returned record is deep-frozen.
   */
  append(input: unknown, receivedAt = Date.now()): RoomAppendResult {
    this.assertWritable();
    const shape = checkRoomEventShape(input);
    if (!shape.ok) throw new RoomStoreError(shape.reason, 'INVALID');
    const room = roomOf(shape.event);
    if (shape.event.kind !== ROOM_MESSAGE_KIND || !room) {
      throw new RoomStoreError('only room messages with exactly one valid h tag can be stored', 'INVALID');
    }
    const verified = verifyRoomEvent(shape.event);
    if (!verified.ok) {
      throw new RoomStoreError(`room event is not authentic: ${verified.reason}`, 'INVALID');
    }
    if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) {
      throw new RoomStoreError('receivedAt must be a non-negative integer', 'INVALID');
    }
    const existing = this.byId.get(shape.event.id);
    if (existing) return { status: 'duplicate', record: existing };
    if (!this.byRoom.has(room) && this.byRoom.size >= this.maxRooms) {
      throw new RoomStoreError(`room ledger already holds maxRooms ${this.maxRooms}`, 'FULL');
    }
    if (this.lastSeq >= Number.MAX_SAFE_INTEGER) {
      throw new RoomStoreError('room ledger sequence space is exhausted', 'FULL');
    }
    const event = freezeRoomEvent(shape.event);
    const seq = this.lastSeq + 1;
    const bytes = Buffer.from(`${JSON.stringify({ v: 1, seq, receivedAt, event })}\n`, 'utf8');
    if (this.expectedSize + bytes.length > this.maxLedgerBytes) {
      this.compact();
      if (this.expectedSize + bytes.length > this.maxLedgerBytes) {
        throw new RoomStoreError('room ledger is full', 'FULL');
      }
    }
    this.assertExclusive();
    try {
      let offset = 0;
      while (offset < bytes.length) {
        offset += fs.writeSync(this.fd as number, bytes, offset, bytes.length - offset);
      }
      fs.fsyncSync(this.fd as number);
    } catch (error) {
      // The ledger may end with a partial line: stop writing; the next open
      // quarantines that tail before any seq is reused.
      this.failure = error instanceof Error ? error : new Error(String(error));
      throw new RoomStoreError(`room ledger write failed: ${this.failure.message}`, 'CONFLICT');
    }
    this.expectedSize += bytes.length;
    const record = freezeRecord(seq, receivedAt, event);
    this.insert(record);
    if (this.evictionsSinceCompaction >= this.compactAfterEvictions) {
      try {
        this.compact();
      } catch (error) {
        // The append itself was fsynced before maintenance began. Acknowledge
        // that durable record, but stop later writes because compaction may
        // have replaced or closed the active ledger.
        this.failure = error instanceof Error ? error : new Error(String(error));
        logger.error('[fleet-rooms] post-append compaction failed; store is now read-only', {
          error: this.failure.message,
          seq: record.seq,
        });
      }
    }
    return { status: 'stored', record };
  }

  /** Rewrite the ledger with retained records; watermarks are persisted first. */
  compact(): void {
    this.assertWritable();
    this.assertExclusive();
    const retained = [...this.byRoom.values()].flat().sort((a, b) => a.seq - b.seq);
    writeJsonAtomicSync(this.metaPath, { version: 1, storeId: this.storeId, evicted: { ...this.evicted } });
    const body = retained
      .map((record) => JSON.stringify({ v: 1, seq: record.seq, receivedAt: record.receivedAt, event: record.event }))
      .join('\n');
    fs.closeSync(this.fd as number);
    this.fd = undefined;
    try {
      writeFileAtomicSync(this.ledgerPath, retained.length > 0 ? `${body}\n` : '');
    } finally {
      this.fd = fs.openSync(this.ledgerPath, 'a', 0o600);
      this.expectedSize = fs.fstatSync(this.fd).size;
    }
    this.evictionsSinceCompaction = 0;
  }

  /**
   * True when records of these rooms with `seq > afterSeq` were evicted, i.e.
   * a replay from `afterSeq` cannot be complete.
   */
  hasGapAfter(rooms: readonly string[], afterSeq: number): boolean {
    return rooms.some((room) => (this.evicted[room] ?? 0) > afterSeq);
  }

  /**
   * Replay (`afterSeq` set): every match after the cursor, oldest first, capped.
   * History (no cursor): the newest `limit` matches of each filter, NIP-01
   * style, returned oldest first.
   */
  query(filters: readonly RoomFilter[], options: { afterSeq?: number; maxRecords?: number } = {}): RoomQueryResult {
    const candidates = roomsReferenced(filters).flatMap((room) => this.byRoom.get(room) ?? []);
    if (options.afterSeq !== undefined) {
      if (!Number.isSafeInteger(options.afterSeq) || options.afterSeq < 0) {
        throw new RangeError('afterSeq must be a non-negative safe integer');
      }
      const cap = Math.min(
        MAX_ROOM_HISTORY_LIMIT,
        positiveInteger('maxRecords', options.maxRecords, MAX_ROOM_HISTORY_LIMIT),
      );
      const cursor = options.afterSeq;
      const matches = candidates
        .filter((record) => record.seq > cursor && roomFiltersMatch(filters, record.event))
        .sort((a, b) => a.seq - b.seq);
      return { records: matches.slice(0, cap), truncated: matches.length > cap };
    }
    const selected = new Map<number, RoomRecord>();
    for (const filter of filters) {
      const limit = filter.limit ?? DEFAULT_ROOM_HISTORY_LIMIT;
      if (limit === 0) continue;
      const newestFirst = candidates
        .filter((record) => roomFilterMatches(filter, record.event))
        .sort((a, b) => b.event.created_at - a.event.created_at || b.seq - a.seq);
      for (const record of newestFirst.slice(0, limit)) selected.set(record.seq, record);
    }
    return { records: [...selected.values()].sort((a, b) => a.seq - b.seq), truncated: false };
  }

  /** Close the append descriptor and release the directory lock. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.fd !== undefined) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // already closed
      }
      this.fd = undefined;
    }
    this.lock.release();
  }
}
