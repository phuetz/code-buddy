/** Explicit resources; health is not proof that a model/capability works. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { writeJsonAtomic } from '../utils/atomic-write.js';

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/);
export const resourceSchema = z.object({
  id: identifier,
  kind: z.enum(['inference', 'comfyui', 'storage', 'rag', 'database', 'docker', 'code-explorer', 'camera', 'microphone']),
  hostId: identifier,
  declaredCapabilities: z.array(identifier).min(1).max(32),
  endpointRef: z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/),
  healthPath: z.enum(['/health', '/healthz', '/api/health', '/v1/models', '/api/tags', '/system_stats', '/_ping']),
  permissions: z.object({ probe: z.boolean(), use: z.boolean() }).strict(),
  ttlMs: z.number().int().min(1000).max(3600000).default(60000),
  timeoutMs: z.number().int().min(50).max(5000).default(1000),
}).strict();
export type Resource = z.infer<typeof resourceSchema>;
const observationSchema = z.object({
  state: z.enum(['online', 'offline', 'unknown']),
  checkedAt: z.number().nonnegative(),
  lastSeen: z.number().nonnegative().nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  endpointFingerprint: z.string(),
  reason: z.string(),
}).strict();
export type Observation = z.infer<typeof observationSchema>;
const entrySchema = z.object({ resource: resourceSchema, observation: observationSchema.nullable() }).strict();
const storeSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(100) }).strict();
type Store = z.infer<typeof storeSchema>;
export type ResourceStatus = z.infer<typeof entrySchema> & {
  state: 'online' | 'offline' | 'unknown' | 'stale';
  reason: string;
  /** No heuristic RAM or inferred utilisation. This tranche has no load collector. */
  load: null;
  usageConfirmed: false;
};
/** Declarations and observations only: never the resolved endpoint value or the internal fingerprint. */
export function publicResourceStatus(entry: ResourceStatus) {
  return { resource: entry.resource, state: entry.state, reason: entry.reason,
    checkedAt: entry.observation?.checkedAt ?? null, lastSeen: entry.observation?.lastSeen ?? null,
    latencyMs: entry.observation?.latencyMs ?? null, load: entry.load, usageConfirmed: entry.usageConfirmed };
}
export type PublicResourceStatus = ReturnType<typeof publicResourceStatus>;

/** The RagChat connector reads this reference only; a selection never redirects it. */
export const RAGCHAT_ENDPOINT_REF = 'RAGCHAT_BASE_URL';

export function selectionWarning(selected: Pick<ResourceStatus, 'resource'> | null): string | undefined {
  if (!selected || selected.resource.kind !== 'rag' || selected.resource.endpointRef === RAGCHAT_ENDPOINT_REF) return undefined;
  return `ragchat_search interroge toujours ${RAGCHAT_ENDPOINT_REF} ; cette ressource référence ${selected.resource.endpointRef} et la sélection ne redirige pas le connecteur.`;
}

const allowedPaths: Partial<Record<Resource['kind'], readonly string[]>> = {
  inference: ['/health', '/healthz', '/v1/models', '/api/tags'],
  comfyui: ['/system_stats'],
  rag: ['/health', '/healthz', '/api/health'],
  docker: ['/_ping'],
  'code-explorer': ['/health', '/healthz', '/api/health'],
};

function endpoint(resource: Resource): { url: URL; fingerprint: string } {
  const raw = process.env[resource.endpointRef];
  if (!raw) throw new Error('ENDPOINT_UNCONFIGURED');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('ENDPOINT_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('ENDPOINT_INVALID');
  }
  url.pathname = resource.healthPath;
  return { url, fingerprint: createHash('sha256').update(url.href).digest('hex') };
}

export class ResourceCatalog {
  constructor(
    readonly filename = path.join(os.homedir(), '.codebuddy', 'resources', 'catalog.json'),
    private readonly now: () => number = Date.now,
  ) {}

  private async read(): Promise<Store> {
    try {
      const stat = await fs.lstat(this.filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('INVALID_CATALOG_FILE');
      const parsed = storeSchema.safeParse(JSON.parse(await fs.readFile(this.filename, 'utf8')));
      if (!parsed.success || new Set(parsed.data.entries.map(e => e.resource.id)).size !== parsed.data.entries.length) {
        throw new Error('INVALID_CATALOG');
      }
      return parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] };
      throw new Error('INVALID_CATALOG: existing data was not replaced');
    }
  }

  private async update<T>(action: (store: Store) => Promise<T>): Promise<T> {
    const directory = path.dirname(this.filename);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('INVALID_CATALOG_DIRECTORY');
    await fs.chmod(directory, 0o700);
    const lock = `${this.filename}.lock`;
    try { await fs.mkdir(lock, { mode: 0o700 }); } catch { throw new Error('CATALOG_BUSY: another writer or unrecovered lock'); }
    try {
      const store = await this.read();
      const result = await action(store);
      await writeJsonAtomic(this.filename, store, { mode: 0o600 });
      return result;
    } finally { await fs.rmdir(lock); }
  }

  async add(input: unknown): Promise<Resource> {
    const parsed = resourceSchema.safeParse(input);
    if (!parsed.success) throw new Error('INVALID_RESOURCE: check schema; inline endpoints and extra fields are forbidden');
    return this.update(async store => {
      if (store.entries.some(e => e.resource.id === parsed.data.id)) throw new Error('RESOURCE_EXISTS');
      if (store.entries.length >= 100) throw new Error('CATALOG_FULL');
      store.entries.push({ resource: parsed.data, observation: null });
      return parsed.data;
    });
  }

  async remove(id: string): Promise<{ removed: string }> {
    return this.update(async store => {
      const index = store.entries.findIndex(e => e.resource.id === id);
      if (index < 0) throw new Error('RESOURCE_NOT_FOUND');
      store.entries.splice(index, 1);
      return { removed: id };
    });
  }

  private status(entry: Store['entries'][number]): ResourceStatus {
    const { resource, observation } = entry;
    let state: ResourceStatus['state'] = observation?.state ?? 'unknown';
    let reason = observation?.reason ?? 'NEVER_PROBED';
    if (observation && (this.now() - observation.checkedAt >= resource.ttlMs || observation.checkedAt > this.now())) {
      state = 'stale'; reason = 'OBSERVATION_EXPIRED';
    }
    try {
      if (observation && observation.endpointFingerprint !== endpoint(resource).fingerprint) {
        state = 'unknown'; reason = 'ENDPOINT_CHANGED';
      }
    } catch {
      state = 'unknown'; reason = 'ENDPOINT_UNCONFIGURED_OR_INVALID';
    }
    return { ...entry, state, reason, load: null, usageConfirmed: false };
  }

  async list(): Promise<ResourceStatus[]> { return (await this.read()).entries.map(e => this.status(e)); }

  async probe(id: string): Promise<ResourceStatus> {
    // Lock covers the bounded probe so a later probe cannot be overwritten by an older completion.
    return this.update(async store => {
      const entry = store.entries.find(e => e.resource.id === id);
      if (!entry) throw new Error('RESOURCE_NOT_FOUND');
      const r = entry.resource;
      if (!r.permissions.probe) throw new Error('PROBE_NOT_PERMITTED');
      if (!allowedPaths[r.kind]?.includes(r.healthPath)) throw new Error('NO_READ_ONLY_PROBE_FOR_KIND_PATH');
      const target = endpoint(r);
      const start = this.now();
      let state: Observation['state'] = 'offline';
      let reason = 'PROBE_FAILED';
      try {
        const response = await fetch(target.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(r.timeoutMs) });
        state = response.ok ? 'online' : 'offline';
        reason = response.ok ? 'HTTP_HEALTH_OK_NOT_USAGE_PROOF' : `HTTP_${response.status}`;
        // Never parse service content, model lists, database contents or device frames.
        await response.body?.cancel();
      } catch { state = 'offline'; reason = 'UNREACHABLE_OR_TIMEOUT'; }
      const checkedAt = this.now();
      entry.observation = { state, reason, checkedAt, lastSeen: state === 'online' ? checkedAt
        : entry.observation?.endpointFingerprint === target.fingerprint ? entry.observation.lastSeen : null,
        latencyMs: state === 'online' ? Math.max(0, checkedAt - start) : null, endpointFingerprint: target.fingerprint };
      return this.status(entry);
    });
  }

  async select(capability: string, kind?: Resource['kind']): Promise<{
    selected: ResourceStatus | null; excluded: Array<{ id: string; reason: string }>; reason: string;
  }> {
    if (!identifier.safeParse(capability).success) throw new Error('INVALID_CAPABILITY');
    const excluded: Array<{ id: string; reason: string }> = [];
    const candidates = (await this.list()).filter(e => {
      const reason = kind && e.resource.kind !== kind ? 'KIND_MISMATCH'
        : !e.resource.declaredCapabilities.includes(capability) ? 'CAPABILITY_NOT_DECLARED'
          : !e.resource.permissions.use ? 'USE_NOT_PERMITTED'
            : e.state !== 'online' ? e.reason : null;
      if (reason) excluded.push({ id: e.resource.id, reason });
      return !reason;
    });
    // Load unknown: do not fabricate free capacity. Stable deterministic latency/id choice only.
    candidates.sort((a, b) => (a.observation?.latencyMs ?? Infinity) - (b.observation?.latencyMs ?? Infinity)
      || a.resource.id.localeCompare(b.resource.id));
    return { selected: candidates[0] ?? null, excluded,
      reason: candidates.length ? 'FRESH_HEALTH_DECLARED_CAPABILITY_LOAD_UNKNOWN' : 'NO_ELIGIBLE_RESOURCE' };
  }
}
