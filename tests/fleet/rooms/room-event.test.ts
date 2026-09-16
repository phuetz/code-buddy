import { describe, expect, it } from 'vitest';

import {
  buildRoomAuth,
  buildRoomMessage,
  canonicalRoomAudience,
  checkRoomEventShape,
  computeRoomEventId,
  deriveRoomPublicKey,
  generateRoomSecretKey,
  MAX_ROOM_CONTENT_BYTES,
  normalizeMentions,
  parseThreadMarkers,
  resolveThread,
  roomOf,
  signRoomEvent,
  verifyRoomEvent,
  type RoomEvent,
} from '../../../src/fleet/rooms/room-event.js';

const SK1 = '0000000000000000000000000000000000000000000000000000000000000001';
const PK1 = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const PK2 = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function signed(overrides: Partial<{ tags: string[][]; content: string }> = {}): RoomEvent {
  return signRoomEvent({
    created_at: 1_700_000_000,
    kind: 9,
    tags: overrides.tags ?? [['h', 'general']],
    content: overrides.content ?? 'bonjour',
  }, SK1);
}

describe('room events', () => {
  it('computes the NIP-01 id of an independently serialized vector', () => {
    // Expected value computed outside this code base:
    // printf '%s' '[0,"79be…98",1700000000,9,[["h","general"],["p","c604…e5"]],"Bonjour \"flotte\"\nligne 2\t✓"]' | sha256sum
    const id = computeRoomEventId({
      pubkey: PK1,
      created_at: 1_700_000_000,
      kind: 9,
      tags: [['h', 'general'], ['p', PK2]],
      content: 'Bonjour "flotte"\nligne 2\t✓',
    });
    expect(id).toBe('7506f410fd83c48466061fa57392a0080efccf2a7f607e7ff57c15eb2cad8005');
  });

  it('derives BIP-340 public keys and round-trips signatures', () => {
    expect(deriveRoomPublicKey(SK1)).toBe(PK1);
    const event = signed();
    expect(event.pubkey).toBe(PK1);
    expect(verifyRoomEvent(event)).toEqual({ ok: true });
    const fresh = generateRoomSecretKey();
    const other = signRoomEvent({ created_at: 1, kind: 9, tags: [['h', 'x']], content: '' }, fresh);
    expect(other.pubkey).toBe(deriveRoomPublicKey(fresh));
    expect(verifyRoomEvent(other)).toEqual({ ok: true });
  });

  it('rejects tampered content, tags and signatures', () => {
    const event = signed();
    expect(verifyRoomEvent({ ...event, content: 'bonsoir' }).ok).toBe(false);
    expect(verifyRoomEvent({ ...event, tags: [['h', 'other']] }).ok).toBe(false);
    const flipped = `${event.sig.slice(0, -1)}${event.sig.endsWith('0') ? '1' : '0'}`;
    expect(verifyRoomEvent({ ...event, sig: flipped })).toEqual({ ok: false, reason: 'bad signature' });
    expect(verifyRoomEvent({ ...event, pubkey: PK2 }).ok).toBe(false);
  });

  it('counts every h tag, malformed ones included, and requires exactly one', () => {
    expect(roomOf({ tags: [['h', 'general']] })).toBe('general');
    expect(roomOf({ tags: [['h', 'general'], ['h']] })).toBeUndefined();
    expect(roomOf({ tags: [['h'], ['h', 'general']] })).toBeUndefined();
    expect(roomOf({ tags: [['h', 'general'], ['h', 'other']] })).toBeUndefined();
    expect(roomOf({ tags: [['h', 'general', 'extra']] })).toBeUndefined();
    expect(roomOf({ tags: [['h', 'General']] })).toBeUndefined();
    expect(roomOf({ tags: [] })).toBeUndefined();
  });

  it('bounds content, tags and the whole event in bytes', () => {
    const base = { ...signed() };
    expect(checkRoomEventShape({ ...base, content: 'é'.repeat(MAX_ROOM_CONTENT_BYTES / 2 + 1) }).ok).toBe(false);
    const wideTags = Array.from({ length: 63 }, () => ['x', 'y'.repeat(256), 'z'.repeat(256)]);
    const wide = checkRoomEventShape({ ...base, tags: [['h', 'general'], ...wideTags] });
    expect(wide).toEqual({ ok: false, reason: 'tags exceed 16384 bytes' });
    expect(checkRoomEventShape({ ...base, tags: Array.from({ length: 65 }, () => ['p', PK2]) }).ok).toBe(false);
    expect(checkRoomEventShape({ ...base, tags: [['h', 'y'.repeat(257)]] }).ok).toBe(false);
    expect(checkRoomEventShape({ ...base, content: '\uD800' }).ok).toBe(false);
    expect(checkRoomEventShape({ ...base, extra: true }).ok).toBe(false);
    expect(checkRoomEventShape({ ...base, created_at: Number.NaN }).ok).toBe(false);
    expect(checkRoomEventShape({ ...base, created_at: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it('returns a copy that does not share arrays with the input', () => {
    const input = signed();
    const checked = checkRoomEventShape(input);
    if (!checked.ok) throw new Error(checked.reason);
    input.tags[0]![1] = 'mutated';
    expect(checked.event.tags[0]).toEqual(['h', 'general']);
  });

  it('parses NIP-10 thread markers like buzz-core nip10.rs', () => {
    expect(parseThreadMarkers([])).toEqual({});
    expect(parseThreadMarkers([['e', A, '', 'root'], ['e', B, '', 'reply']])).toEqual({ root: A, reply: B });
    expect(parseThreadMarkers([['e', A]])).toEqual({});
    expect(parseThreadMarkers([['e', 'bad', '', 'reply'], ['e', 'bad', '', 'root']])).toEqual({});
    expect(resolveThread({ root: A, reply: B })).toEqual({ root: A, parent: B });
    expect(resolveThread({ reply: A })).toEqual({ root: A, parent: A });
    expect(resolveThread({ root: A })).toBeUndefined();
  });

  it('builds messages with Buzz tag layout and normalized mentions', () => {
    const direct = buildRoomMessage({ room: 'general', content: 'x', replyTo: { root: A, parent: A }, mentions: [PK2.toUpperCase(), PK2, PK1] }, PK1);
    expect(direct.tags).toEqual([['h', 'general'], ['e', A, '', 'reply'], ['p', PK2]]);
    const nested = buildRoomMessage({ room: 'general', content: 'x', replyTo: { root: A, parent: B } });
    expect(nested.tags).toEqual([['h', 'general'], ['e', A, '', 'root'], ['e', B, '', 'reply']]);
    expect(normalizeMentions([PK1, PK1.toUpperCase(), PK2], PK2)).toEqual([PK1]);
    expect(() => buildRoomMessage({ room: 'General', content: 'x' })).toThrow();
    expect(() => buildRoomMessage({ room: 'general', content: 'x', mentions: Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(64, '0')) })).toThrow();
  });

  it('binds auth proofs to a canonical audience', () => {
    expect(canonicalRoomAudience('WS://Hub.Example:3000/ws/')).toBe('ws://hub.example:3000/ws');
    expect(canonicalRoomAudience('wss://hub.example/ws?x=1#y')).toBe('wss://hub.example:443/ws');
    expect(canonicalRoomAudience('http://[::1]:3000/ws')).toBe('ws://[::1]:3000/ws');
    expect(() => canonicalRoomAudience('ftp://hub/ws')).toThrow();
    expect(() => canonicalRoomAudience('ws://user:pass@hub/ws')).toThrow();
    const auth = buildRoomAuth('c'.repeat(64), 'ws://127.0.0.1:3000/ws', 10);
    expect(auth).toEqual({
      created_at: 10,
      kind: 22242,
      tags: [['challenge', 'c'.repeat(64)], ['relay', 'ws://127.0.0.1:3000/ws']],
      content: '',
    });
  });
});
