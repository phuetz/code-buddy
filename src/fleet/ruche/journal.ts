import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalizeManifest, publicKeyId } from '../../skills/skill-signing.js';

export const RUCHE_ENV = 'CODEBUDDY_RUCHE';
export const GENESIS = '0'.repeat(64);
const DOMAIN = 'codebuddy.ruche.v1\0';
const HASH_RE = /^[a-f0-9]{64}$/;

export type RucheRole = 'agent' | 'arbitre' | 'humain';
export type RucheEventType =
  | 'message' | 'mention'
  | 'lease.request' | 'lease.grant' | 'lease.deny'
  | 'lease.renew.request' | 'lease.renew' | 'lease.release.request' | 'lease.release'
  | 'verdict' | 'approval.request' | 'approval.response' | 'approval.consume' | 'heartbeat';

export interface RucheIdentity {
  id: string;
  publicKey: string;
  privateKey: KeyObject | string;
}

export interface RucheTrust {
  publicKey: string;
  role: RucheRole;
}

export interface RucheEvent {
  v: 1;
  agentId: string;
  seq: number;
  prevHash: string;
  at: number;
  type: RucheEventType;
  payload: Record<string, unknown>;
  hash: string;
  signature: string;
}

type UnsignedEvent = Omit<RucheEvent, 'hash' | 'signature'>;

export function rucheEnabled(): boolean {
  return process.env[RUCHE_ENV] === 'true';
}

export function assertRucheEnabled(): void {
  if (!rucheEnabled()) throw new Error('RUCHE_DISABLED');
}

function canonicalHash(event: UnsignedEvent): string {
  return createHash('sha256').update(DOMAIN).update(canonicalizeManifest(event)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validPayload(type: RucheEventType, p: Record<string, unknown>): boolean {
  const str = (k: string, max = 4096): boolean => typeof p[k] === 'string' && (p[k] as string).length > 0 && (p[k] as string).length <= max;
  const hash = (k: string): boolean => typeof p[k] === 'string' && HASH_RE.test(p[k] as string);
  const time = (k: string): boolean => Number.isSafeInteger(p[k]) && (p[k] as number) > 0;
  const token = (): boolean => Number.isSafeInteger(p.token) && (p.token as number) > 0;
  switch (type) {
    case 'message': return str('text');
    case 'mention': return str('to', 128) && str('text');
    case 'lease.request': return str('work', 256) && time('ttlMs') && (p.ttlMs as number) <= 3_600_000;
    case 'lease.grant': return str('work', 256) && str('holder', 128) && hash('requestHash') && token() && time('expiresAt');
    case 'lease.deny': return str('work', 256) && str('holder', 128) && hash('requestHash') && str('reason', 128);
    case 'lease.renew.request': return str('work', 256) && token() && time('ttlMs') && (p.ttlMs as number) <= 3_600_000;
    case 'lease.renew': return str('work', 256) && str('holder', 128) && hash('requestHash') && token() && time('expiresAt');
    case 'lease.release.request': return str('work', 256) && token();
    case 'lease.release': return str('work', 256) && str('holder', 128) && hash('requestHash') && token();
    case 'verdict': return typeof p.revision === 'string' && /^[a-f0-9]{40}([a-f0-9]{24})?$/.test(p.revision) && str('command') && Number.isSafeInteger(p.exitCode) && hash('logHash') && hash('reportHash');
    case 'approval.request': return str('effectId', 128) && str('effect') && typeof p.revision === 'string' && /^[a-f0-9]{40}([a-f0-9]{24})?$/.test(p.revision) && time('expiresAt');
    case 'approval.response': return str('effectId', 128) && typeof p.revision === 'string' && /^[a-f0-9]{40}([a-f0-9]{24})?$/.test(p.revision) && typeof p.approved === 'boolean' && hash('requestHash');
    case 'approval.consume': return str('effectId', 128) && hash('requestHash') && hash('responseHash');
    case 'heartbeat': return str('lane', 128) && time('expiresAt');
  }
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

export class RucheJournal {
  private readonly chains = new Map<string, RucheEvent[]>();

  constructor(
    private readonly identity: RucheIdentity,
    private readonly trust: ReadonlyMap<string, RucheTrust>,
    private readonly now: () => number = Date.now,
  ) {
    if (identity.id !== publicKeyId(identity.publicKey)) throw new Error('RUCHE_IDENTITY_MISMATCH');
    if (trust.get(identity.id)?.publicKey !== identity.publicKey) throw new Error('RUCHE_UNTRUSTED_SELF');
  }

  head(agentId: string): RucheEvent | undefined {
    return this.chains.get(agentId)?.at(-1);
  }

  events(agentId?: string): RucheEvent[] {
    if (agentId) return [...(this.chains.get(agentId) ?? [])];
    return [...this.chains.values()].flat().sort((a, b) => a.agentId.localeCompare(b.agentId) || a.seq - b.seq);
  }

  append(type: RucheEventType, payload: Record<string, unknown>): RucheEvent {
    assertRucheEnabled();
    const head = this.head(this.identity.id);
    const unsigned: UnsignedEvent = {
      v: 1, agentId: this.identity.id, seq: (head?.seq ?? 0) + 1,
      prevHash: head?.hash ?? GENESIS, at: this.now(), type, payload,
    };
    if (!validPayload(type, payload)) throw new Error('RUCHE_INVALID_PAYLOAD');
    const hash = canonicalHash(unsigned);
    const signature = sign(null, Buffer.from(`${DOMAIN}${hash}`), this.identity.privateKey).toString('base64url');
    const event: RucheEvent = { ...unsigned, hash, signature };
    this.ingest(event);
    return event;
  }

  ingest(raw: unknown): RucheEvent {
    assertRucheEnabled();
    if (!isRecord(raw) || !exactKeys(raw, ['v', 'agentId', 'seq', 'prevHash', 'at', 'type', 'payload', 'hash', 'signature'])) {
      throw new Error('RUCHE_INVALID_EVENT');
    }
    const event = raw as unknown as RucheEvent;
    const trust = this.trust.get(event.agentId);
    if (!trust || publicKeyId(trust.publicKey) !== event.agentId) throw new Error('RUCHE_UNTRUSTED_AUTHOR');
    if (event.v !== 1 || !Number.isSafeInteger(event.seq) || event.seq < 1
      || !Number.isSafeInteger(event.at) || event.at < 1
      || !HASH_RE.test(event.prevHash) || !HASH_RE.test(event.hash)
      || typeof event.signature !== 'string' || !isRecord(event.payload)
      || !validPayload(event.type, event.payload)) throw new Error('RUCHE_INVALID_EVENT');
    if ((event.type === 'heartbeat' && ((event.payload.expiresAt as number) <= event.at
      || (event.payload.expiresAt as number) > event.at + 60_000))
      || (event.type === 'approval.request' && ((event.payload.expiresAt as number) <= event.at
        || (event.payload.expiresAt as number) > event.at + 300_000))) {
      throw new Error('RUCHE_INVALID_DEADLINE');
    }
    if (canonicalizeManifest(event).length > 16_384) throw new Error('RUCHE_EVENT_TOO_LARGE');
    if (['lease.grant', 'lease.deny', 'lease.renew', 'lease.release', 'approval.consume'].includes(event.type) && trust.role !== 'arbitre') {
      throw new Error('RUCHE_WRONG_ROLE');
    }
    if (event.type === 'approval.response' && trust.role !== 'humain') throw new Error('RUCHE_WRONG_ROLE');
    if (['message', 'mention', 'lease.request', 'lease.renew.request', 'lease.release.request', 'verdict', 'approval.request', 'heartbeat'].includes(event.type)
      && trust.role !== 'agent') throw new Error('RUCHE_WRONG_ROLE');
    const { hash: _hash, signature: _signature, ...unsigned } = event;
    if (canonicalHash(unsigned) !== event.hash) throw new Error('RUCHE_HASH_MISMATCH');
    try {
      if (!verify(null, Buffer.from(`${DOMAIN}${event.hash}`), trust.publicKey, Buffer.from(event.signature, 'base64url'))) {
        throw new Error('RUCHE_BAD_SIGNATURE');
      }
    } catch {
      throw new Error('RUCHE_BAD_SIGNATURE');
    }
    const head = this.head(event.agentId);
    if (event.seq !== (head?.seq ?? 0) + 1 || event.prevHash !== (head?.hash ?? GENESIS)) {
      throw new Error('RUCHE_REPLAY_OR_FORK');
    }
    const chain = this.chains.get(event.agentId) ?? [];
    chain.push(event);
    this.chains.set(event.agentId, chain);
    return event;
  }
}
