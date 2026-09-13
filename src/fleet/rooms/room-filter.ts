/**
 * Fleet rooms — NIP-01 subscription filters.
 *
 * Semantics adapted from block/buzz @ 4cd82f51 (Apache-2.0),
 * `crates/buzz-core/src/filter.rs::filters_match`: filters are OR-ed, fields
 * inside one filter are AND-ed, `ids` match by prefix, and an explicitly empty
 * list matches nothing (NIP-01 edge case documented in Buzz `ARCHITECTURE.md` §5).
 *
 * Deliberate differences from a public relay:
 * - every filter MUST name its rooms with `#h` — there is no global
 *   subscription, so access control is decided before anything is read
 *   (Buzz excludes global subscriptions from channel fan-out for the same reason);
 * - unknown keys are rejected instead of ignored, so a typo cannot silently
 *   widen or empty a subscription;
 * - every list and the history `limit` are bounded.
 *
 * @module fleet/rooms/room-filter
 */

import { ROOM_ID_PATTERN, type ReadonlyRoomEvent } from './room-event.js';

/** Buzz `MAX_HISTORICAL_LIMIT`. */
export const MAX_ROOM_HISTORY_LIMIT = 500;
export const DEFAULT_ROOM_HISTORY_LIMIT = 100;
export const MAX_ROOM_FILTERS = 8;
export const MAX_ROOMS_PER_FILTER = 32;
const MAX_VALUES_PER_LIST = 100;
const MAX_KINDS = 20;

const HEX_PREFIX = /^[0-9a-f]{1,64}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const FILTER_KEYS = new Set(['ids', 'authors', 'kinds', 'since', 'until', 'limit', '#h', '#p', '#e']);

export interface RoomFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  '#h': string[];
  '#p'?: string[];
  '#e'?: string[];
}

export type RoomFilterParse =
  | { ok: true; filters: RoomFilter[] }
  | { ok: false; reason: string };

function parseStringList(
  value: unknown,
  key: string,
  pattern: RegExp,
  maxLength: number,
): string[] | string {
  if (!Array.isArray(value) || value.length > maxLength) {
    return `${key} must be an array of at most ${maxLength} values`;
  }
  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !pattern.test(item)) return `${key} contains an invalid value`;
    list.push(item);
  }
  return list;
}

function parseTimestamp(value: unknown, key: string): number | string {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return `${key} must be a non-negative integer`;
  }
  return value as number;
}

function parseOne(value: unknown): RoomFilter | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'filter must be an object';
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!FILTER_KEYS.has(key)) return `unknown filter key: ${key.slice(0, 32)}`;
  }
  if (raw['#h'] === undefined) return 'every filter must name its rooms with #h';
  const rooms = parseStringList(raw['#h'], '#h', ROOM_ID_PATTERN, MAX_ROOMS_PER_FILTER);
  if (typeof rooms === 'string') return rooms;
  if (rooms.length === 0) return '#h must name at least one room';
  const filter: RoomFilter = { '#h': [...new Set(rooms)] };

  if (raw.ids !== undefined) {
    const ids = parseStringList(raw.ids, 'ids', HEX_PREFIX, MAX_VALUES_PER_LIST);
    if (typeof ids === 'string') return ids;
    filter.ids = ids;
  }
  if (raw.authors !== undefined) {
    const authors = parseStringList(raw.authors, 'authors', HEX_64, MAX_VALUES_PER_LIST);
    if (typeof authors === 'string') return authors;
    filter.authors = authors;
  }
  for (const key of ['#p', '#e'] as const) {
    if (raw[key] !== undefined) {
      const values = parseStringList(raw[key], key, HEX_64, MAX_VALUES_PER_LIST);
      if (typeof values === 'string') return values;
      filter[key] = values;
    }
  }
  if (raw.kinds !== undefined) {
    if (!Array.isArray(raw.kinds) || raw.kinds.length > MAX_KINDS) {
      return `kinds must be an array of at most ${MAX_KINDS} integers`;
    }
    if (!raw.kinds.every((kind) => Number.isInteger(kind) && kind >= 0 && kind <= 65_535)) {
      return 'kinds contains an invalid value';
    }
    filter.kinds = [...raw.kinds] as number[];
  }
  for (const key of ['since', 'until'] as const) {
    if (raw[key] !== undefined) {
      const timestamp = parseTimestamp(raw[key], key);
      if (typeof timestamp === 'string') return timestamp;
      filter[key] = timestamp;
    }
  }
  if (raw.limit !== undefined) {
    const limit = parseTimestamp(raw.limit, 'limit');
    if (typeof limit === 'string') return limit;
    filter.limit = Math.min(limit, MAX_ROOM_HISTORY_LIMIT);
  }
  return filter;
}

/** Validate untrusted subscription filters. */
export function parseRoomFilters(value: unknown): RoomFilterParse {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROOM_FILTERS) {
    return { ok: false, reason: `filters must be an array of 1 to ${MAX_ROOM_FILTERS} filters` };
  }
  const filters: RoomFilter[] = [];
  for (const item of value) {
    const parsed = parseOne(item);
    if (typeof parsed === 'string') return { ok: false, reason: parsed };
    filters.push(parsed);
  }
  return { ok: true, filters };
}

function hasTagValue(event: ReadonlyRoomEvent, name: string, wanted: readonly string[]): boolean {
  return event.tags.some((tag) => tag[0] === name && typeof tag[1] === 'string' && wanted.includes(tag[1]));
}

export function roomFilterMatches(filter: RoomFilter, event: ReadonlyRoomEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  if (filter.ids && !filter.ids.some((prefix) => event.id.startsWith(prefix))) return false;
  if (!hasTagValue(event, 'h', filter['#h'])) return false;
  if (filter['#p'] && !hasTagValue(event, 'p', filter['#p'])) return false;
  if (filter['#e'] && !hasTagValue(event, 'e', filter['#e'])) return false;
  return true;
}

export function roomFiltersMatch(filters: readonly RoomFilter[], event: ReadonlyRoomEvent): boolean {
  return filters.some((filter) => roomFilterMatches(filter, event));
}

/** Every room a subscription could read; the ACL is checked against this set. */
export function roomsReferenced(filters: readonly RoomFilter[]): string[] {
  return [...new Set(filters.flatMap((filter) => filter['#h']))];
}
