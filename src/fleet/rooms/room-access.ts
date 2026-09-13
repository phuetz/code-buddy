/**
 * Fleet rooms — membership and access policy.
 *
 * Buzz makes channel membership "the only gate", enforced by the relay before
 * any read or write (`ARCHITECTURE.md` §7, `crates/buzz-relay/src/handlers/req.rs`).
 * Here the hub operator declares members (public keys) and rooms in one file:
 *
 * ```json
 * {
 *   "version": 1,
 *   "members": { "<pubkey hex>": { "name": "ministar", "principals": ["key:abc"] } },
 *   "rooms": { "general": { "members": ["<pubkey hex>"], "readers": ["<pubkey hex>"] } }
 * }
 * ```
 *
 * - `rooms.<id>.members` may read and write; `readers` may only read.
 * - `principals` binds a key to WebSocket identities: when the field is ABSENT
 *   the key is accepted on any authenticated connection; when it is a list the
 *   connection principal must be in it; an EMPTY list refuses every connection.
 *
 * Fail-closed: a missing, unreadable or invalid file yields no member and no
 * room. Refresh window: the file's `mtimeMs`/`ctimeMs`/size/inode are checked at
 * most once per `reloadIntervalMs` (default 1000 ms), so a revocation applies
 * to the first check after that window — including deliveries to subscriptions
 * that are already open.
 *
 * @module fleet/rooms/room-access
 */

import fs from 'fs';
import { z } from 'zod';

import { getCodeBuddyPath } from '../../utils/codebuddy-home.js';
import { logger } from '../../utils/logger.js';
import { ROOM_ID_PATTERN } from './room-event.js';

export const MAX_ROOM_ACCESS_MEMBERS = 1_024;
export const MAX_ROOM_ACCESS_ROOMS = 1_024;
const MAX_CONFIG_BYTES = 1024 * 1024;

const pubkeySchema = z.string().regex(/^[0-9a-f]{64}$/);

const configSchema = z.object({
  version: z.literal(1),
  members: z.record(pubkeySchema, z.object({
    name: z.string().min(1).max(64),
    principals: z.array(z.string().min(1).max(256)).max(32).optional(),
  }).strict()),
  rooms: z.record(z.string().regex(ROOM_ID_PATTERN), z.object({
    description: z.string().max(512).optional(),
    members: z.array(pubkeySchema).max(MAX_ROOM_ACCESS_MEMBERS).default([]),
    readers: z.array(pubkeySchema).max(MAX_ROOM_ACCESS_MEMBERS).default([]),
  }).strict()),
}).strict();

export type RoomAccessConfigInput = z.input<typeof configSchema>;

export interface RoomMember {
  readonly pubkey: string;
  readonly name: string;
  /** `undefined`: no binding. `[]`: refuse all connections. */
  readonly principals?: readonly string[];
}

export type RoomAccessLevel = 'write' | 'read';

interface CompiledRoom {
  description?: string;
  writers: ReadonlySet<string>;
  readers: ReadonlySet<string>;
}

interface CompiledConfig {
  members: ReadonlyMap<string, RoomMember>;
  rooms: ReadonlyMap<string, CompiledRoom>;
}

const EMPTY_CONFIG: CompiledConfig = { members: new Map(), rooms: new Map() };

export function defaultRoomAccessPath(): string {
  return process.env.CODEBUDDY_FLEET_ROOMS_CONFIG || getCodeBuddyPath('fleet', 'rooms.json');
}

/** Validate and compile a configuration object; throws a readable error. */
export function compileRoomAccessConfig(input: unknown): CompiledConfig {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`invalid rooms config at ${issue?.path.join('.') || '<root>'}: ${issue?.message ?? 'unknown'}`);
  }
  const memberEntries = Object.entries(parsed.data.members);
  const roomEntries = Object.entries(parsed.data.rooms);
  if (memberEntries.length > MAX_ROOM_ACCESS_MEMBERS) {
    throw new Error(`invalid rooms config: more than ${MAX_ROOM_ACCESS_MEMBERS} members`);
  }
  if (roomEntries.length > MAX_ROOM_ACCESS_ROOMS) {
    throw new Error(`invalid rooms config: more than ${MAX_ROOM_ACCESS_ROOMS} rooms`);
  }
  const members = new Map<string, RoomMember>();
  for (const [pubkey, member] of memberEntries) {
    members.set(pubkey, Object.freeze({
      pubkey,
      name: member.name,
      ...(member.principals ? { principals: Object.freeze([...member.principals]) } : {}),
    }));
  }
  const rooms = new Map<string, CompiledRoom>();
  for (const [room, spec] of roomEntries) {
    for (const pubkey of [...spec.members, ...spec.readers]) {
      if (!members.has(pubkey)) {
        throw new Error(`invalid rooms config: room ${room} lists an undeclared member ${pubkey.slice(0, 12)}…`);
      }
    }
    rooms.set(room, {
      ...(spec.description ? { description: spec.description } : {}),
      writers: new Set(spec.members),
      readers: new Set([...spec.members, ...spec.readers]),
    });
  }
  return { members, rooms };
}

export interface RoomAccessPolicyOptions {
  /** Read this JSON file (default `$CODEBUDDY_FLEET_ROOMS_CONFIG` or `<CODEBUDDY_HOME>/fleet/rooms.json`). */
  path?: string;
  /** Use an in-memory configuration instead of a file (tests, embedding). */
  config?: RoomAccessConfigInput;
  /** Minimum delay between two file checks, in ms (finite, >= 0). */
  reloadIntervalMs?: number;
}

export class RoomAccessPolicy {
  private readonly path?: string;
  private readonly reloadIntervalMs: number;
  private compiled: CompiledConfig = EMPTY_CONFIG;
  private loadedStamp?: string;
  private lastCheckMs = -Infinity;
  private lastProblem?: string;

  constructor(options: RoomAccessPolicyOptions = {}) {
    const interval = options.reloadIntervalMs ?? 1_000;
    if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 0) {
      throw new RangeError('reloadIntervalMs must be a finite number >= 0');
    }
    this.reloadIntervalMs = interval;
    if (options.config) {
      this.compiled = compileRoomAccessConfig(options.config);
    } else {
      this.path = options.path ?? defaultRoomAccessPath();
      this.refresh(true);
    }
  }

  private report(problem: string | undefined): void {
    if (problem && problem !== this.lastProblem) {
      logger.warn(`[fleet-rooms] access policy denies everything: ${problem}`);
    }
    this.lastProblem = problem;
  }

  private deny(problem: string): void {
    this.compiled = EMPTY_CONFIG;
    this.report(problem);
  }

  private refresh(force = false): void {
    if (!this.path) return;
    const now = Date.now();
    if (!force && now - this.lastCheckMs < this.reloadIntervalMs) return;
    this.lastCheckMs = now;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.path);
    } catch {
      this.loadedStamp = undefined;
      this.deny(`no rooms config at ${this.path}`);
      return;
    }
    const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
    if (stamp === this.loadedStamp) return;
    this.loadedStamp = stamp;
    if (stat.size > MAX_CONFIG_BYTES) {
      this.deny(`rooms config larger than ${MAX_CONFIG_BYTES} bytes`);
      return;
    }
    try {
      this.compiled = compileRoomAccessConfig(JSON.parse(fs.readFileSync(this.path, 'utf8')));
      this.report(undefined);
    } catch (error) {
      this.deny(error instanceof Error ? error.message : String(error));
    }
  }

  /** Frozen member record, or undefined. */
  member(pubkey: string): RoomMember | undefined {
    this.refresh();
    return this.compiled.members.get(pubkey);
  }

  /** May this key act on a connection authenticated as `principalId`? */
  admit(pubkey: string, principalId: string): { ok: true; member: RoomMember } | { ok: false; reason: string } {
    const member = this.member(pubkey);
    if (!member) return { ok: false, reason: 'restricted: key is not a declared room member' };
    if (member.principals !== undefined && !member.principals.includes(principalId)) {
      return { ok: false, reason: 'restricted: key is not bound to this connection identity' };
    }
    return { ok: true, member };
  }

  access(pubkey: string, room: string): RoomAccessLevel | undefined {
    this.refresh();
    const spec = this.compiled.rooms.get(room);
    if (!spec || !this.compiled.members.has(pubkey)) return undefined;
    if (spec.writers.has(pubkey)) return 'write';
    return spec.readers.has(pubkey) ? 'read' : undefined;
  }

  canRead(pubkey: string, room: string): boolean {
    return this.access(pubkey, room) !== undefined;
  }

  canWrite(pubkey: string, room: string): boolean {
    return this.access(pubkey, room) === 'write';
  }

  roomsFor(pubkey: string): Array<{ room: string; access: RoomAccessLevel; description?: string }> {
    this.refresh();
    const result: Array<{ room: string; access: RoomAccessLevel; description?: string }> = [];
    for (const [room, spec] of this.compiled.rooms) {
      const access = this.access(pubkey, room);
      if (access) result.push({ room, access, ...(spec.description ? { description: spec.description } : {}) });
    }
    return result.sort((a, b) => a.room.localeCompare(b.room));
  }
}
