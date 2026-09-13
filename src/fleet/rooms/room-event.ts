/**
 * Fleet rooms — signed message events.
 *
 * A room message is a Nostr NIP-01 event: `id` is the sha256 of the canonical
 * serialization, `sig` a BIP-340 Schnorr signature by `pubkey`. Authorship and
 * integrity therefore survive any transport, restart or copy of the ledger,
 * which a hub-stamped principal alone cannot prove.
 *
 * Shapes adapted (re-implemented in TypeScript, no code copied) from block/buzz
 * @ 4cd82f513214aad11c2b742ce7cc7c681e8e32a0, Apache-2.0:
 * - event id + signature checks: `crates/buzz-core/src/verification.rs`;
 * - stream-message tag layout (`h` room, `p` mentions, `e` thread markers,
 *   64 KiB content, 50 mentions): `crates/buzz-sdk/src/builders.rs::build_message`;
 * - NIP-10 root/reply resolution: `crates/buzz-core/src/nip10.rs`;
 * - mention normalisation: `crates/buzz-sdk/src/mentions.rs::normalize_mention_pubkeys`;
 * - NIP-42 proof of key possession (`challenge` + `relay` tags):
 *   `crates/buzz-auth` / `ARCHITECTURE.md` §3.
 *
 * @module fleet/rooms/room-event
 */

import { createHash, randomBytes } from 'crypto';
import { schnorr } from '@noble/curves/secp256k1';

/** Buzz `KIND_STREAM_MESSAGE` — the only stored kind in this first lot. */
export const ROOM_MESSAGE_KIND = 9;
/** NIP-42 authentication event. Proves key possession; never stored. */
export const ROOM_AUTH_KIND = 22242;
/** Same content ceiling as Buzz stream messages (UTF-8 bytes). */
export const MAX_ROOM_CONTENT_BYTES = 64 * 1024;
/** Same mention ceiling as Buzz (`MENTION_CAP`). */
export const MAX_ROOM_MENTIONS = 50;
/** 50 mentions + room + two thread markers fit with room to spare. */
export const MAX_ROOM_TAGS = 64;
/** Sum of the UTF-8 bytes of every tag part. */
export const MAX_ROOM_TAG_BYTES = 16 * 1024;
/** Whole event as JSON on the wire, escaping included. */
export const MAX_ROOM_EVENT_BYTES = 512 * 1024;
const MAX_TAG_PARTS = 8;
const MAX_TAG_PART_CHARS = 256;
/** Lowercase slug: rooms are named by the hub operator. */
export const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const EVENT_FIELDS = new Set(['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig']);

export interface RoomEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** Deeply read-only view handed out by the store and the hub. */
export interface ReadonlyRoomEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
  readonly sig: string;
}

export interface UnsignedRoomEvent {
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface ThreadMarkers {
  root?: string;
  reply?: string;
}

export interface ThreadReference {
  /** Id of the thread root message. */
  root: string;
  /** Id of the message being answered; equals `root` for a direct reply. */
  parent: string;
}

export type RoomEventCheck =
  | { ok: true; event: RoomEvent }
  | { ok: false; reason: string };

export class RoomEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomEventError';
  }
}

export function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX_64.test(value);
}

export function isValidRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_ID_PATTERN.test(value);
}

/** NIP-01 canonical serialization `[0, pubkey, created_at, kind, tags, content]`. */
export function serializeRoomEvent(
  event: Pick<ReadonlyRoomEvent, 'pubkey' | 'created_at' | 'kind' | 'tags' | 'content'>,
): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export function computeRoomEventId(
  event: Pick<ReadonlyRoomEvent, 'pubkey' | 'created_at' | 'kind' | 'tags' | 'content'>,
): string {
  return createHash('sha256').update(serializeRoomEvent(event), 'utf8').digest('hex');
}

function secretKeyBytes(secretKeyHex: string): Uint8Array {
  if (!isHex64(secretKeyHex)) {
    throw new RoomEventError('secret key must be 64 lowercase hex characters');
  }
  return Uint8Array.from(Buffer.from(secretKeyHex, 'hex'));
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/** x-only BIP-340 public key (lowercase hex) for a 32-byte secret key. */
export function deriveRoomPublicKey(secretKeyHex: string): string {
  const bytes = secretKeyBytes(secretKeyHex);
  try {
    return toHex(schnorr.getPublicKey(bytes));
  } catch {
    throw new RoomEventError('secret key is not a valid secp256k1 scalar');
  }
}

export function generateRoomSecretKey(): string {
  for (;;) {
    const candidate = randomBytes(32).toString('hex');
    try {
      deriveRoomPublicKey(candidate);
      return candidate;
    } catch {
      // Out-of-range scalar (probability ~2^-128): draw again.
    }
  }
}

export function signRoomEvent(template: UnsignedRoomEvent, secretKeyHex: string): RoomEvent {
  const pubkey = deriveRoomPublicKey(secretKeyHex);
  const draft = {
    pubkey,
    created_at: template.created_at,
    kind: template.kind,
    tags: template.tags.map((tag) => [...tag]),
    content: template.content,
  };
  const shape = checkRoomEventShape({ ...draft, id: '0'.repeat(64), sig: '0'.repeat(128) });
  if (!shape.ok) throw new RoomEventError(shape.reason);
  const id = computeRoomEventId(draft);
  const sig = toHex(schnorr.sign(Uint8Array.from(Buffer.from(id, 'hex')), secretKeyBytes(secretKeyHex)));
  return { id, ...draft, sig };
}

/**
 * Structural validation of an untrusted event, including every byte bound.
 * Does not check id or signature; see {@link verifyRoomEvent}. The returned
 * event is a fresh copy sharing nothing with the input.
 */
export function checkRoomEventShape(value: unknown): RoomEventCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'event must be an object' };
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!EVENT_FIELDS.has(key)) return { ok: false, reason: 'unknown event field' };
  }
  if (!isHex64(raw.id)) return { ok: false, reason: 'id must be 64 lowercase hex characters' };
  if (!isHex64(raw.pubkey)) return { ok: false, reason: 'pubkey must be 64 lowercase hex characters' };
  if (typeof raw.sig !== 'string' || !HEX_128.test(raw.sig)) {
    return { ok: false, reason: 'sig must be 128 lowercase hex characters' };
  }
  if (!Number.isSafeInteger(raw.created_at) || (raw.created_at as number) < 0) {
    return { ok: false, reason: 'created_at must be a non-negative integer' };
  }
  if (!Number.isInteger(raw.kind) || (raw.kind as number) < 0 || (raw.kind as number) > 65_535) {
    return { ok: false, reason: 'kind must be an integer between 0 and 65535' };
  }
  if (typeof raw.content !== 'string') return { ok: false, reason: 'content must be a string' };
  // Cheap character bound first so an oversized string is never re-encoded.
  if (raw.content.length > MAX_ROOM_CONTENT_BYTES ||
      Buffer.byteLength(raw.content, 'utf8') > MAX_ROOM_CONTENT_BYTES) {
    return { ok: false, reason: `content exceeds ${MAX_ROOM_CONTENT_BYTES} bytes` };
  }
  if (LONE_SURROGATE.test(raw.content)) return { ok: false, reason: 'content is not valid UTF-8' };
  if (!Array.isArray(raw.tags) || raw.tags.length > MAX_ROOM_TAGS) {
    return { ok: false, reason: `tags must be an array of at most ${MAX_ROOM_TAGS} tags` };
  }
  const tags: string[][] = [];
  let tagBytes = 0;
  for (const tag of raw.tags) {
    if (!Array.isArray(tag) || tag.length === 0 || tag.length > MAX_TAG_PARTS) {
      return { ok: false, reason: `each tag must hold 1 to ${MAX_TAG_PARTS} strings` };
    }
    const copy: string[] = [];
    for (const part of tag) {
      if (typeof part !== 'string' || part.length > MAX_TAG_PART_CHARS || LONE_SURROGATE.test(part)) {
        return { ok: false, reason: 'tag parts must be valid strings of at most 256 characters' };
      }
      tagBytes += Buffer.byteLength(part, 'utf8');
      copy.push(part);
    }
    if (tagBytes > MAX_ROOM_TAG_BYTES) {
      return { ok: false, reason: `tags exceed ${MAX_ROOM_TAG_BYTES} bytes` };
    }
    tags.push(copy);
  }
  const event: RoomEvent = {
    id: raw.id,
    pubkey: raw.pubkey,
    created_at: raw.created_at as number,
    kind: raw.kind as number,
    tags,
    content: raw.content,
    sig: raw.sig,
  };
  if (Buffer.byteLength(JSON.stringify(event), 'utf8') > MAX_ROOM_EVENT_BYTES) {
    return { ok: false, reason: `event exceeds ${MAX_ROOM_EVENT_BYTES} bytes` };
  }
  return { ok: true, event };
}

/** Recompute the id and verify the Schnorr signature. */
export function verifyRoomEvent(event: ReadonlyRoomEvent): { ok: true } | { ok: false; reason: string } {
  if (computeRoomEventId(event) !== event.id) {
    return { ok: false, reason: 'event id does not match its content' };
  }
  try {
    const valid = schnorr.verify(
      Uint8Array.from(Buffer.from(event.sig, 'hex')),
      Uint8Array.from(Buffer.from(event.id, 'hex')),
      Uint8Array.from(Buffer.from(event.pubkey, 'hex')),
    );
    if (!valid) return { ok: false, reason: 'bad signature' };
  } catch {
    return { ok: false, reason: 'bad signature' };
  }
  return { ok: true };
}

/** Deep-freeze a validated event so shared references cannot be mutated. */
export function freezeRoomEvent(event: RoomEvent): ReadonlyRoomEvent {
  for (const tag of event.tags) Object.freeze(tag);
  Object.freeze(event.tags);
  return Object.freeze(event);
}

export function tagValues(event: Pick<ReadonlyRoomEvent, 'tags'>, name: string): string[] {
  const values: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string') values.push(tag[1]);
  }
  return values;
}

/**
 * The room of a message. Every tag named `h` counts — including a malformed
 * `['h']` — and there must be exactly one, shaped `['h', <room id>]`.
 */
export function roomOf(event: Pick<ReadonlyRoomEvent, 'tags'>): string | undefined {
  const roomTags = event.tags.filter((tag) => tag[0] === 'h');
  if (roomTags.length !== 1) return undefined;
  const only = roomTags[0];
  return only && only.length === 2 && isValidRoomId(only[1]) ? only[1] : undefined;
}

/** NIP-10 markers; a marker counts only with a valid 64-hex id, last one wins. */
export function parseThreadMarkers(tags: readonly (readonly string[])[]): ThreadMarkers {
  const markers: ThreadMarkers = {};
  for (const tag of tags) {
    if (tag.length >= 4 && tag[0] === 'e' && isHex64(tag[1])) {
      if (tag[3] === 'root') markers.root = tag[1];
      else if (tag[3] === 'reply') markers.reply = tag[1];
    }
  }
  return markers;
}

/**
 * `root`+`reply` → nested reply; `reply` alone → direct reply to the root;
 * `root` alone or nothing → top-level (a lone root never anchors a reply).
 */
export function resolveThread(markers: ThreadMarkers): ThreadReference | undefined {
  if (!markers.reply) return undefined;
  return { root: markers.root ?? markers.reply, parent: markers.reply };
}

/** Lowercase, drop duplicates and the sender's own key, keep first-seen order. */
export function normalizeMentions(pubkeys: readonly string[], sender?: string): string[] {
  const self = sender?.toLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const pubkey of pubkeys) {
    const lower = pubkey.toLowerCase();
    if (lower === self || seen.has(lower)) continue;
    seen.add(lower);
    result.push(lower);
  }
  return result;
}

export interface RoomMessageInput {
  room: string;
  content: string;
  mentions?: readonly string[];
  replyTo?: ThreadReference;
  /** Unix seconds; defaults to now. */
  createdAt?: number;
}

/** Build an unsigned kind-9 room message with Buzz's tag layout. */
export function buildRoomMessage(input: RoomMessageInput, senderPubkey?: string): UnsignedRoomEvent {
  if (!isValidRoomId(input.room)) {
    throw new RoomEventError('room must match ^[a-z0-9][a-z0-9_-]{0,63}$');
  }
  if (typeof input.content !== 'string' || Buffer.byteLength(input.content, 'utf8') > MAX_ROOM_CONTENT_BYTES) {
    throw new RoomEventError(`content must be a string of at most ${MAX_ROOM_CONTENT_BYTES} bytes`);
  }
  const tags: string[][] = [['h', input.room]];
  if (input.replyTo) {
    const { root, parent } = input.replyTo;
    if (!isHex64(root) || !isHex64(parent)) {
      throw new RoomEventError('thread ids must be 64 lowercase hex characters');
    }
    if (root === parent) tags.push(['e', root, '', 'reply']);
    else tags.push(['e', root, '', 'root'], ['e', parent, '', 'reply']);
  }
  const mentions = normalizeMentions(input.mentions ?? [], senderPubkey);
  if (mentions.length > MAX_ROOM_MENTIONS) {
    throw new RoomEventError(`at most ${MAX_ROOM_MENTIONS} mentions`);
  }
  for (const pubkey of mentions) {
    if (!isHex64(pubkey)) throw new RoomEventError('mentions must be 64-hex public keys');
    tags.push(['p', pubkey]);
  }
  const createdAt = input.createdAt ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new RoomEventError('createdAt must be a non-negative integer');
  }
  return { created_at: createdAt, kind: ROOM_MESSAGE_KIND, tags, content: input.content };
}

/**
 * Canonical hub audience for a WebSocket URL: `ws`/`wss` scheme, lowercase host,
 * explicit port, normalized path, no credentials/query/fragment. The client
 * derives it from the URL it dialed — never from anything the hub says — so a
 * proof signed for one hub cannot be replayed to another.
 */
export function canonicalRoomAudience(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RoomEventError('audience must be an absolute ws:// or wss:// URL');
  }
  const scheme = parsed.protocol === 'https:' ? 'wss:' : parsed.protocol === 'http:' ? 'ws:' : parsed.protocol;
  if (scheme !== 'ws:' && scheme !== 'wss:') {
    throw new RoomEventError('audience must be an absolute ws:// or wss:// URL');
  }
  if (parsed.username || parsed.password) {
    throw new RoomEventError('audience must not carry credentials');
  }
  const port = parsed.port || (scheme === 'wss:' ? '443' : '80');
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${scheme}//${parsed.hostname.toLowerCase()}:${port}${pathname}`;
}

/** NIP-42 style proof of key possession bound to one challenge AND one hub. */
export function buildRoomAuth(
  challenge: string,
  audience: string,
  createdAt = Math.floor(Date.now() / 1000),
): UnsignedRoomEvent {
  if (!/^[0-9a-f]{64}$/.test(challenge)) throw new RoomEventError('challenge must be 64 hex characters');
  return {
    created_at: createdAt,
    kind: ROOM_AUTH_KIND,
    tags: [['challenge', challenge], ['relay', canonicalRoomAudience(audience)]],
    content: '',
  };
}
