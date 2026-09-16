import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { RoomAccessPolicy } from '../../../src/fleet/rooms/room-access.js';
import { signRoomEvent } from '../../../src/fleet/rooms/room-event.js';
import {
  MAX_ROOM_HISTORY_LIMIT,
  parseRoomFilters,
  roomFiltersMatch,
  roomsReferenced,
} from '../../../src/fleet/rooms/room-filter.js';

const SK1 = '0000000000000000000000000000000000000000000000000000000000000001';
const PK1 = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const PK2 = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const PK3 = 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';

const event = signRoomEvent({
  created_at: 1_000,
  kind: 9,
  tags: [['h', 'general'], ['p', PK2], ['e', 'a'.repeat(64), '', 'reply']],
  content: 'hello',
}, SK1);

function parse(value: unknown) {
  const parsed = parseRoomFilters(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.filters;
}

describe('room filters', () => {
  it('ORs filters and ANDs fields like buzz-core filter.rs', () => {
    expect(roomFiltersMatch(parse([{ '#h': ['general'] }]), event)).toBe(true);
    expect(roomFiltersMatch(parse([{ '#h': ['general'], kinds: [7] }]), event)).toBe(false);
    expect(roomFiltersMatch(parse([{ '#h': ['general'], kinds: [7] }, { '#h': ['general'], authors: [PK1] }]), event)).toBe(true);
    expect(roomFiltersMatch(parse([{ '#h': ['general'], authors: [PK2] }]), event)).toBe(false);
    expect(roomFiltersMatch(parse([{ '#h': ['general'], since: 1_001 }]), event)).toBe(false);
    expect(roomFiltersMatch(parse([{ '#h': ['general'], until: 999 }]), event)).toBe(false);
    expect(roomFiltersMatch(parse([{ '#h': ['general'], ids: [event.id.slice(0, 6)] }]), event)).toBe(true);
    expect(roomFiltersMatch(parse([{ '#h': ['general'], '#p': [PK2] }]), event)).toBe(true);
    expect(roomFiltersMatch(parse([{ '#h': ['general'], '#p': [PK3] }]), event)).toBe(false);
    expect(roomFiltersMatch(parse([{ '#h': ['general'], '#e': ['a'.repeat(64)] }]), event)).toBe(true);
    expect(roomFiltersMatch(parse([{ '#h': ['other'] }]), event)).toBe(false);
  });

  it('treats explicitly empty lists as matching nothing', () => {
    expect(roomFiltersMatch(parse([{ '#h': ['general'], kinds: [] }]), event)).toBe(false);
    expect(roomFiltersMatch(parse([{ '#h': ['general'], authors: [] }]), event)).toBe(false);
  });

  it('requires #h, rejects unknown keys and non-finite numbers, clamps limit', () => {
    expect(parseRoomFilters([{ kinds: [9] }]).ok).toBe(false);
    expect(parseRoomFilters([{ '#h': [] }]).ok).toBe(false);
    expect(parseRoomFilters([{ '#h': ['general'], search: 'x' }]).ok).toBe(false);
    expect(parseRoomFilters([{ '#h': ['general'], since: Number.NaN }]).ok).toBe(false);
    expect(parseRoomFilters([{ '#h': ['general'], limit: Number.POSITIVE_INFINITY }]).ok).toBe(false);
    expect(parseRoomFilters([]).ok).toBe(false);
    expect(parseRoomFilters(Array.from({ length: 9 }, () => ({ '#h': ['general'] }))).ok).toBe(false);
    expect(parse([{ '#h': ['general'], limit: 10_000 }])[0]?.limit).toBe(MAX_ROOM_HISTORY_LIMIT);
    expect(roomsReferenced(parse([{ '#h': ['a', 'b'] }, { '#h': ['b', 'c'] }]))).toEqual(['a', 'b', 'c']);
  });
});

describe('room access policy', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const config = {
    version: 1 as const,
    members: {
      [PK1]: { name: 'alice' },
      [PK2]: { name: 'bob', principals: ['key:bob'] },
      [PK3]: { name: 'nobody', principals: [] },
    },
    rooms: {
      general: { members: [PK1, PK2], readers: [PK3] },
      ops: { members: [PK1] },
    },
  };

  it('distinguishes absent, listed and empty principal bindings', () => {
    const policy = new RoomAccessPolicy({ config });
    expect(policy.admit(PK1, 'key:anything').ok).toBe(true);
    expect(policy.admit(PK2, 'key:bob').ok).toBe(true);
    expect(policy.admit(PK2, 'key:mallory')).toEqual({ ok: false, reason: 'restricted: key is not bound to this connection identity' });
    expect(policy.admit(PK3, 'key:bob').ok).toBe(false);
    expect(policy.admit('d'.repeat(64), 'key:bob').ok).toBe(false);
  });

  it('separates writers from readers and freezes member records', () => {
    const policy = new RoomAccessPolicy({ config });
    expect(policy.canWrite(PK1, 'ops')).toBe(true);
    expect(policy.canRead(PK2, 'ops')).toBe(false);
    expect(policy.canRead(PK3, 'general')).toBe(true);
    expect(policy.canWrite(PK3, 'general')).toBe(false);
    expect(policy.roomsFor(PK1).map((entry) => entry.room)).toEqual(['general', 'ops']);
    const member = policy.member(PK2);
    expect(Object.isFrozen(member)).toBe(true);
    expect(() => { (member!.principals as string[]).push('key:mallory'); }).toThrow(TypeError);
    expect(policy.admit(PK2, 'key:mallory').ok).toBe(false);
  });

  it('rejects rooms naming undeclared members and non-finite reload intervals', () => {
    expect(() => new RoomAccessPolicy({ config: { ...config, rooms: { x: { members: ['e'.repeat(64)] } } } })).toThrow(/undeclared/);
    expect(() => new RoomAccessPolicy({ config, reloadIntervalMs: Number.NaN })).toThrow(RangeError);
    expect(() => new RoomAccessPolicy({ config, reloadIntervalMs: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('fails closed on missing or invalid files and applies revocations after reload', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-acl-'));
    dirs.push(dir);
    const file = path.join(dir, 'rooms.json');
    const policy = new RoomAccessPolicy({ path: file, reloadIntervalMs: 0 });
    expect(policy.canRead(PK1, 'general')).toBe(false);

    fs.writeFileSync(file, JSON.stringify(config));
    expect(policy.canWrite(PK1, 'general')).toBe(true);

    fs.writeFileSync(file, JSON.stringify({ ...config, rooms: { general: { members: [PK2] } } }));
    expect(policy.canRead(PK1, 'general')).toBe(false);

    fs.writeFileSync(file, '{ not json');
    expect(policy.canRead(PK2, 'general')).toBe(false);
    expect(policy.member(PK2)).toBeUndefined();
  });
});
