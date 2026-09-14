import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { signRoomEvent, type RoomEvent } from '../../../src/fleet/rooms/room-event.js';
import { parseRoomFilters, type RoomFilter } from '../../../src/fleet/rooms/room-filter.js';
import { RoomLockError } from '../../../src/fleet/rooms/room-lock.js';
import { RoomStore, RoomStoreError, type RoomStoreOptions } from '../../../src/fleet/rooms/room-store.js';

const SK1 = '0000000000000000000000000000000000000000000000000000000000000001';

let counter = 0;
function message(content = `m${++counter}`, room = 'general'): RoomEvent {
  return signRoomEvent({ created_at: 1_700_000_000 + counter, kind: 9, tags: [['h', room]], content }, SK1);
}

function filters(value: unknown): RoomFilter[] {
  const parsed = parseRoomFilters(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.filters;
}

describe('RoomStore', () => {
  const dirs: string[] = [];
  const stores: RoomStore[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-store-'));
    dirs.push(dir);
    return dir;
  };
  const open = (directory: string, options: Omit<RoomStoreOptions, 'directory'> = {}) => {
    const store = new RoomStore({ directory, ...options });
    stores.push(store);
    return store;
  };
  const closeStore = (store: RoomStore) => {
    store.close();
    stores.splice(stores.indexOf(store), 1);
  };
  const ledger = (dir: string) => path.join(dir, 'ledger.jsonl');

  it('stores idempotently with strictly increasing seq and reloads after restart', () => {
    const dir = tempDir();
    const store = open(dir);
    const first = message('one');
    expect(store.append(first).status).toBe('stored');
    expect(store.append(message('two')).record.seq).toBe(2);
    const again = store.append(first);
    expect(again).toMatchObject({ status: 'duplicate', record: { seq: 1 } });
    const storeId = store.storeId;
    closeStore(store);

    const reopened = open(dir);
    expect(reopened.storeId).toBe(storeId);
    expect(reopened.latestSeq).toBe(2);
    expect(reopened.append(first).status).toBe('duplicate');
    expect(reopened.append(message('three')).record.seq).toBe(3);
    expect(reopened.query(filters([{ '#h': ['general'] }])).records.map((r) => r.event.content)).toEqual(['one', 'two', 'three']);
    expect(fs.statSync(ledger(dir)).mode & 0o777).toEqual(process.platform === 'win32' ? expect.any(Number) : 0o600);
  });

  it('rejects a structurally valid event whose id or signature is not authentic', () => {
    const dir = tempDir();
    const store = open(dir);
    const genuine = message('authentic');
    const forged = { ...genuine, sig: `${genuine.sig[0] === '0' ? '1' : '0'}${genuine.sig.slice(1)}` };

    expect(() => store.append(forged)).toThrowError(
      expect.objectContaining({ code: 'INVALID' }),
    );
    expect(store.latestSeq).toBe(0);
    expect(fs.statSync(ledger(dir)).size).toBe(0);
  });

  it('replays after a cursor with truncation and returns newest-per-filter history', () => {
    const store = open(tempDir());
    for (let i = 0; i < 5; i++) store.append(message(`n${i}`));
    store.append(message('elsewhere', 'ops'));
    const replay = store.query(filters([{ '#h': ['general'] }]), { afterSeq: 2, maxRecords: 2 });
    expect(replay.records.map((r) => r.seq)).toEqual([3, 4]);
    expect(replay.truncated).toBe(true);
    const history = store.query(filters([{ '#h': ['general'], limit: 2 }]));
    expect(history.records.map((r) => r.event.content)).toEqual(['n3', 'n4']);
    expect(() => store.query(filters([{ '#h': ['general'] }]), { afterSeq: Number.NaN })).toThrow(RangeError);
  });

  it('holds an exclusive directory lock and releases it on close', () => {
    const dir = tempDir();
    const store = open(dir);
    expect(() => new RoomStore({ directory: dir })).toThrow(RoomLockError);
    closeStore(store);
    expect(open(dir).latestSeq).toBe(0);
  });

  it('reclaims only a lock whose pid is proven dead on this host', () => {
    const dir = tempDir();
    const lockPath = path.join(dir, 'writer.lock');
    const writeLock = (pid: number, hostname = os.hostname()) =>
      fs.writeFileSync(lockPath, JSON.stringify({ version: 1, pid, hostname, token: 'x', acquiredAt: '' }));

    writeLock(process.ppid);
    expect(() => new RoomStore({ directory: dir })).toThrow(/already owned/);
    writeLock(123, 'another-host');
    expect(() => new RoomStore({ directory: dir })).toThrow(/already owned/);
    fs.writeFileSync(lockPath, '{');
    expect(() => new RoomStore({ directory: dir })).toThrow(/unreadable/);

    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    writeLock(dead);
    const store = open(dir);
    expect(store.latestSeq).toBe(0);
    expect(fs.readdirSync(dir).some((name) => name.startsWith('writer.lock.stale-'))).toBe(true);
  });

  it('quarantines a complete but unterminated last line before reusing seq', () => {
    const dir = tempDir();
    const store = open(dir);
    store.append(message('kept'));
    const lost = message('unterminated');
    closeStore(store);
    // Simulate a crash where the record reached disk but not its newline.
    fs.appendFileSync(ledger(dir), JSON.stringify({ v: 1, seq: 2, receivedAt: 1, event: lost }));

    const reopened = open(dir);
    expect(reopened.latestSeq).toBe(1);
    expect(reopened.get(lost.id)).toBeUndefined();
    expect(fs.readdirSync(dir).filter((name) => name.startsWith('ledger.jsonl.tail-'))).toHaveLength(1);
    expect(reopened.append(message('next')).record.seq).toBe(2);
    closeStore(reopened);

    const again = open(dir);
    const seqs = again.query(filters([{ '#h': ['general'] }])).records.map((r) => r.seq);
    expect(seqs).toEqual([1, 2]);
    expect(again.get(lost.id)).toBeUndefined();
    // The unacknowledged message can be re-sent and is stored exactly once.
    expect(again.append(lost).record.seq).toBe(3);
  });

  it('quarantines a torn partial line', () => {
    const dir = tempDir();
    const store = open(dir);
    store.append(message('kept'));
    closeStore(store);
    fs.appendFileSync(ledger(dir), '{"v":1,"seq":2,"recei');
    const reopened = open(dir);
    expect(reopened.latestSeq).toBe(1);
    expect(fs.readFileSync(ledger(dir), 'utf8').endsWith('\n')).toBe(true);
  });

  it('stops writing when another process touched the ledger', () => {
    const dir = tempDir();
    const store = open(dir);
    store.append(message('mine'));
    fs.appendFileSync(ledger(dir), `${JSON.stringify({ v: 1, seq: 2, receivedAt: 1, event: message('foreign') })}\n`);
    expect(() => store.append(message('after'))).toThrow(RoomStoreError);
    expect(() => store.append(message('still'))).toThrow(/stopped after a failure/);
  });

  it('fails closed when a complete record does not increase seq', () => {
    const dir = tempDir();
    const store = open(dir);
    store.append(message('a'));
    closeStore(store);
    fs.appendFileSync(ledger(dir), `${JSON.stringify({ v: 1, seq: 1, receivedAt: 1, event: message('dup-seq') })}\n`);
    expect(() => open(dir)).toThrowError(expect.objectContaining({ code: 'CORRUPT' }));
  });

  it('fails closed when a complete record has an invalid signature', () => {
    const dir = tempDir();
    const store = open(dir);
    const genuine = message('genuine');
    store.append(genuine);
    closeStore(store);
    const forged = message('forged');
    const other = message('donor');
    // Valid id, signature copied from another event: structurally perfect, not authentic.
    fs.appendFileSync(ledger(dir), `${JSON.stringify({ v: 1, seq: 2, receivedAt: 1, event: { ...forged, sig: other.sig } })}\n`);
    expect(() => open(dir)).toThrowError(expect.objectContaining({ code: 'CORRUPT' }));
  });

  it('persists eviction watermarks before rewriting the ledger', () => {
    const dir = tempDir();
    const store = open(dir, { maxEventsPerRoom: 2, compactAfterEvictions: 100 });
    for (let i = 0; i < 4; i++) store.append(message(`w${i}`));
    expect(store.hasGapAfter(['general'], 0)).toBe(true);
    const beforeCompaction = fs.readFileSync(ledger(dir));
    store.compact();
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    expect(meta.evicted).toEqual({ general: 2 });
    closeStore(store);

    // Crash between the meta write and the ledger rewrite: old ledger, new meta.
    fs.writeFileSync(ledger(dir), beforeCompaction);
    const recovered = open(dir, { maxEventsPerRoom: 4 });
    expect(recovered.query(filters([{ '#h': ['general'] }])).records.map((r) => r.seq)).toEqual([3, 4]);
    expect(recovered.hasGapAfter(['general'], 0)).toBe(true);
    expect(recovered.hasGapAfter(['general'], 2)).toBe(false);
    expect(recovered.append(message('w4')).record.seq).toBe(5);
  });

  it('limits duplicate detection to retained records', () => {
    const store = open(tempDir(), { maxEventsPerRoom: 1, compactAfterEvictions: 100 });
    const first = message('first-retained-once');
    expect(store.append(first)).toMatchObject({ status: 'stored', record: { seq: 1 } });
    expect(store.append(message('evicts-first'))).toMatchObject({ status: 'stored', record: { seq: 2 } });
    expect(store.get(first.id)).toBeUndefined();
    expect(store.append(first)).toMatchObject({ status: 'stored', record: { seq: 3 } });
  });

  it('acknowledges a durable append when post-write compaction fails, then stops writing', () => {
    const store = open(tempDir(), { maxEventsPerRoom: 1, compactAfterEvictions: 1 });
    store.append(message('before-maintenance'));
    const compact = vi.spyOn(store, 'compact').mockImplementation(() => {
      throw new Error('injected maintenance failure');
    });

    expect(store.append(message('durable-before-maintenance'))).toMatchObject({
      status: 'stored',
      record: { seq: 2 },
    });
    expect(compact).toHaveBeenCalledOnce();
    expect(() => store.append(message('must-stop'))).toThrow(/stopped after a failure/);
  });

  it('refuses to allocate a sequence beyond MAX_SAFE_INTEGER', () => {
    const dir = tempDir();
    const initial = open(dir);
    closeStore(initial);
    const metaPath = path.join(dir, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.evicted = { general: Number.MAX_SAFE_INTEGER };
    fs.writeFileSync(metaPath, `${JSON.stringify(meta)}\n`, { mode: 0o600 });

    const store = open(dir);
    expect(store.latestSeq).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => store.append(message('overflow'))).toThrowError(
      expect.objectContaining({ code: 'FULL' }),
    );
    expect(fs.statSync(ledger(dir)).size).toBe(0);
  });

  it('keeps stored records deeply immutable and independent from the input', () => {
    const dir = tempDir();
    const store = open(dir);
    const input = message('original');
    const { record } = store.append(input);
    input.tags[0]![1] = 'ops';
    input.tags.push(['p', 'f'.repeat(64)]);
    input.content = 'changed';
    expect(Object.isFrozen(record)).toBe(true);
    expect(() => { (record.event as { content: string }).content = 'x'; }).toThrow(TypeError);
    expect(() => { (record.event.tags as string[][]).push(['x']); }).toThrow(TypeError);
    expect(() => { (record.event.tags[0] as string[])[1] = 'x'; }).toThrow(TypeError);
    const queried = store.query(filters([{ '#h': ['general'] }])).records[0]!;
    expect(queried.event.content).toBe('original');
    expect(queried.event.tags).toEqual([['h', 'general']]);
    store.compact();
    closeStore(store);
    const reopened = open(dir);
    expect(reopened.query(filters([{ '#h': ['general'] }])).records[0]!.event.tags).toEqual([['h', 'general']]);
  });

  it('enforces ledger size and room bounds, and validates numeric options', () => {
    const dir = tempDir();
    const store = open(dir);
    store.append(message('x'.repeat(2_000)));
    closeStore(store);
    expect(() => new RoomStore({ directory: dir, maxLedgerBytes: 100 })).toThrow(/above maxLedgerBytes/);
    const small = open(dir, { maxLedgerBytes: 4_000, maxRooms: 1 });
    expect(() => small.append(message('y'.repeat(3_000)))).toThrow(/full/);
    expect(() => small.append(message('z', 'ops'))).toThrow(/maxRooms/);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5]) {
      expect(() => new RoomStore({ directory: tempDir(), maxEventsPerRoom: bad })).toThrow(RangeError);
    }
  });

  it('moves a ledger without valid meta aside and starts a new generation', () => {
    const dir = tempDir();
    const store = open(dir);
    store.append(message('old'));
    const oldId = store.storeId;
    closeStore(store);
    fs.writeFileSync(path.join(dir, 'meta.json'), '{"version":2}');
    const reopened = open(dir);
    expect(reopened.storeId).not.toBe(oldId);
    expect(reopened.latestSeq).toBe(0);
    expect(fs.readdirSync(dir).some((name) => name.startsWith('ledger.jsonl.orphan-'))).toBe(true);
  });

  it('starts a new generation when valid metadata survives but its ledger is missing', () => {
    const dir = tempDir();
    const store = open(dir, { maxEventsPerRoom: 1, compactAfterEvictions: 100 });
    store.append(message('durable-before-loss'));
    store.append(message('persists-an-eviction-watermark'));
    store.compact();
    expect(store.hasGapAfter(['general'], 0)).toBe(true);
    const previousStoreId = store.storeId;
    closeStore(store);
    fs.unlinkSync(ledger(dir));

    const recovered = open(dir);
    expect(recovered.storeId).not.toBe(previousStoreId);
    expect(recovered.latestSeq).toBe(0);
    expect(recovered.hasGapAfter(['general'], 0)).toBe(false);
    expect(recovered.append(message('new-generation')).record.seq).toBe(1);
  });
});
