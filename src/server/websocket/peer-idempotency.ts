import { createHash } from 'node:crypto';
import type { PeerRequestFrame, PeerResponseFrame } from './peer-rpc.js';
import type { PeerMethodContext } from './peer-method-registry.js';

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 1000;
interface Entry {
  fingerprint: string;
  response: Promise<PeerResponseFrame>;
  chunks: string[];
  expiresAt: number;
}
const entries = new Map<string, Entry>();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** In-process retry protection, including requests still running after disconnect. */
export async function executeIdempotentPeerRequest(
  frame: PeerRequestFrame,
  ctx: PeerMethodContext,
  invoke: (emitChunk: PeerMethodContext['emitChunk']) => Promise<PeerResponseFrame>,
): Promise<PeerResponseFrame> {
  const key = frame.idempotencyKey ?? frame.params?.idempotencyKey;
  if (key === undefined) return invoke(ctx.emitChunk);
  if (typeof key !== 'string' || !key.trim() || key.length > 256) {
    throw Object.assign(new Error('idempotencyKey must be a non-empty string of at most 256 characters'), { code: 'INVALID_REQUEST' });
  }
  const now = Date.now();
  for (const [id, entry] of entries) if (entry.expiresAt <= now) entries.delete(id);
  const identity = ctx.principalId ?? `connection:${ctx.connectionId}`;
  const cacheKey = JSON.stringify([identity, key]);
  const fingerprint = createHash('sha256').update(canonical([frame.method, frame.params ?? {}, [...ctx.scopes].sort()])).digest('hex');
  const existing = entries.get(cacheKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw Object.assign(new Error('idempotencyKey was already used for different parameters or method'), { code: 'IDEMPOTENCY_CONFLICT' });
    }
    const response = await existing.response;
    for (const delta of existing.chunks) ctx.emitChunk?.(delta);
    return { ...response, id: frame.id };
  }
  // Never evict an in-flight request or a promised retry window to admit a flood.
  if (entries.size >= MAX_ENTRIES) {
    throw Object.assign(new Error('peer retry cache is full; retry later'), { code: 'IDEMPOTENCY_CAPACITY' });
  }
  const entry: Entry = { fingerprint, response: Promise.resolve({ id: frame.id, ok: false }), chunks: [], expiresAt: Infinity };
  entries.set(cacheKey, entry);
  entry.response = Promise.resolve().then(() => invoke(delta => {
    entry.chunks.push(delta);
    ctx.emitChunk?.(delta);
  })).finally(() => { entry.expiresAt = Date.now() + TTL_MS; });
  return entry.response;
}
