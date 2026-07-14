import type {
  WorkspaceDraft,
  WorkspaceItem,
  WorkspaceMetrics,
  WorkspacePrivacy,
  WorkspaceQuery,
} from './types.js';

const PRIVACY_RANK: Record<WorkspacePrivacy, number> = {
  'cloud-ok': 0,
  'trusted-lan': 1,
  'local-only': 2,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function strongestPrivacy(values: WorkspacePrivacy[]): WorkspacePrivacy {
  return values.reduce<WorkspacePrivacy>(
    (strongest, value) => (PRIVACY_RANK[value] > PRIVACY_RANK[strongest] ? value : strongest),
    'cloud-ok',
  );
}

function cloneAndFreeze<T>(value: T): T {
  const clone = structuredClone(value);
  const seen = new WeakSet<object>();
  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) return;
    seen.add(candidate);
    // Freezing a non-empty TypedArray throws in Node. Media stays outside the
    // workspace anyway, but tolerate metadata views supplied by adapters.
    if (ArrayBuffer.isView(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

export interface GlobalWorkspaceOptions {
  capacity?: number;
  defaultTtlMs?: number;
  now?: () => number;
}

/**
 * In-memory, immutable and bounded cognitive blackboard.
 *
 * EventBus may notify consumers that something changed, but this class remains
 * the source of truth so slow listeners cannot corrupt ordering or retention.
 */
export class GlobalWorkspace {
  private readonly items = new Map<string, WorkspaceItem>();
  private readonly capacity: number;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  private sequence = 0;
  private revision = 0;
  private counters = { published: 0, rejected: 0, evicted: 0, expired: 0 };

  constructor(options: GlobalWorkspaceOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 512));
    this.defaultTtlMs = Math.max(1, Math.floor(options.defaultTtlMs ?? 30_000));
    this.now = options.now ?? Date.now;
  }

  publish<T>(draft: WorkspaceDraft<T>): WorkspaceItem<T> | null {
    const now = this.now();
    this.pruneExpired(now);
    const createdAt = draft.createdAt ?? now;
    const expiresAt = draft.expiresAt ?? createdAt + (draft.ttlMs ?? this.defaultTtlMs);
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= now) {
      this.counters.rejected++;
      return null;
    }

    const parents = (draft.provenance.derivedFrom ?? [])
      .map((id) => this.items.get(id))
      .filter((item): item is WorkspaceItem => Boolean(item));
    const privacy = strongestPrivacy([draft.privacy, ...parents.map((item) => item.privacy)]);
    const salience = clamp01(draft.salience);

    if (this.items.size >= this.capacity) {
      const victim = [...this.items.values()].sort(
        (a, b) => a.salience - b.salience || a.createdAt - b.createdAt,
      )[0];
      if (!victim || victim.salience > salience) {
        this.counters.rejected++;
        return null;
      }
      this.items.delete(victim.id);
      this.counters.evicted++;
    }

    const id = `workspace_${createdAt}_${++this.sequence}`;
    const item = cloneAndFreeze<WorkspaceItem<T>>({
      id,
      kind: draft.kind,
      producerId: draft.producerId,
      correlationId: draft.correlationId,
      createdAt,
      expiresAt,
      salience,
      confidence: clamp01(draft.confidence),
      privacy,
      provenance: draft.provenance,
      payload: draft.payload,
      revision: ++this.revision,
      depth: Math.max(0, Math.floor(draft.depth ?? 0)),
    });
    this.items.set(id, item);
    this.counters.published++;
    return cloneAndFreeze(item);
  }

  get(id: string): WorkspaceItem | undefined {
    this.pruneExpired(this.now());
    const item = this.items.get(id);
    return item ? cloneAndFreeze(item) : undefined;
  }

  snapshot(query: WorkspaceQuery = {}): readonly WorkspaceItem[] {
    const now = query.now ?? this.now();
    this.pruneExpired(now);
    const kinds = query.kinds ? new Set(query.kinds) : undefined;
    const privacy = query.privacy ? new Set(query.privacy) : undefined;
    const producers = query.producerIds ? new Set(query.producerIds) : undefined;
    const limit = Math.max(0, Math.floor(query.limit ?? this.capacity));
    return [...this.items.values()]
      .filter((item) => !kinds || kinds.has(item.kind))
      .filter((item) => !privacy || privacy.has(item.privacy))
      .filter((item) => !producers || producers.has(item.producerId))
      .filter((item) => !query.correlationId || item.correlationId === query.correlationId)
      .filter((item) => item.salience >= (query.minSalience ?? 0))
      .sort((a, b) => b.salience - a.salience || b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((item) => cloneAndFreeze(item));
  }

  pruneExpired(now = this.now()): number {
    let removed = 0;
    for (const [id, item] of this.items) {
      if (item.expiresAt > now) continue;
      this.items.delete(id);
      removed++;
    }
    this.counters.expired += removed;
    return removed;
  }

  metrics(): WorkspaceMetrics {
    this.pruneExpired(this.now());
    return { size: this.items.size, ...this.counters };
  }
}
