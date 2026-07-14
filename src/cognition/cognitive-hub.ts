import { createHash, randomUUID } from 'node:crypto';
import { CognitiveMesh } from './cognitive-mesh.js';
import {
  cognitiveCancelRequestSchema,
  cognitiveContextAcquireRequestSchema,
  cognitiveLeaseRequestSchema,
  cognitivePublishRequestSchema,
  cognitiveSnapshotRequestSchema,
  cognitiveSubscriptionRequestSchema,
  COGNITIVE_WIRE_VERSION,
  type CognitiveCancelRequest,
  type CognitiveContextAcquireRequest,
  type CognitiveLeaseRequest,
  type CognitivePublishRequest,
  type CognitiveSnapshotRequest,
  type CognitiveSubscriptionRequest,
} from './cognitive-wire-contract.js';
import {
  CognitiveContextProjector,
  type CognitiveContextLease,
  type CognitiveContextProjection,
} from './context-renderer.js';
import { GlobalWorkspace } from './global-workspace.js';
import type { WorkspaceItem, WorkspaceKind, WorkspacePrivacy } from './types.js';

const PRIVACY_RANK: Record<WorkspacePrivacy, number> = {
  'cloud-ok': 0,
  'trusted-lan': 1,
  'local-only': 2,
};

export type CognitiveHubErrorCode =
  | 'COGNITION_FORBIDDEN'
  | 'COGNITION_INVALID_REQUEST'
  | 'CORRELATION_CANCELLED'
  | 'CORRELATION_FORBIDDEN'
  | 'CORRELATION_NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'LEASE_FORBIDDEN'
  | 'LEASE_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'WORKSPACE_REJECTED';

export class CognitiveHubError extends Error {
  constructor(
    readonly code: CognitiveHubErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CognitiveHubError';
  }
}

export interface CognitivePrincipal {
  /** Stable authenticated identity. Never sourced from the request payload. */
  id: string;
  /** Human-readable adapter name used only for server-derived provenance. */
  source: string;
  scopes: readonly string[];
  loopback: boolean;
  /** True only for an actually encrypted socket, never a forwarded header. */
  secure?: boolean;
  internal?: boolean;
}

export interface CognitivePublishAck {
  version: typeof COGNITIVE_WIRE_VERSION;
  serverEpoch: string;
  revision: number;
  replayed: boolean;
  item: WorkspaceItem;
}

export interface CognitiveSnapshot {
  version: typeof COGNITIVE_WIRE_VERSION;
  serverEpoch: string;
  revision: number;
  items: readonly WorkspaceItem[];
}

export interface CognitiveContextAck extends CognitiveContextProjection {
  version: typeof COGNITIVE_WIRE_VERSION;
  serverEpoch: string;
  leaseId: string | null;
}

export interface CognitiveSubscriptionEvent {
  version: typeof COGNITIVE_WIRE_VERSION;
  serverEpoch: string;
  revision: number;
  item: WorkspaceItem;
}

interface IdempotencyEntry {
  ownerId: string;
  fingerprint: string;
  item: WorkspaceItem;
}

interface OwnedLease {
  ownerId: string;
  lease: CognitiveContextLease;
}

interface CorrelationOwner {
  ownerId: string;
  lastSeenAt: number;
}

export interface CognitiveHubOptions {
  workspace?: GlobalWorkspace;
  mesh?: CognitiveMesh;
  projector?: CognitiveContextProjector;
  idempotencyCapacity?: number;
  correlationCapacity?: number;
  leaseCapacity?: number;
}

function hasScope(principal: CognitivePrincipal, scope: string): boolean {
  return Boolean(
    principal.internal ||
      principal.scopes.includes('admin') ||
      principal.scopes.includes('cognition:admin') ||
      principal.scopes.includes(scope),
  );
}

function safeIdentity(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.:@-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return normalized || 'anonymous';
}

function fingerprint(value: unknown): string {
  const stableJson = (candidate: unknown): string => {
    if (candidate === null || typeof candidate !== 'object') {
      return JSON.stringify(candidate) ?? 'null';
    }
    if (Array.isArray(candidate)) return `[${candidate.map(stableJson).join(',')}]`;
    const record = candidate as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  };
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function parseOrThrow<T>(result: { success: true; data: T } | { success: false; error: Error }): T {
  if (result.success) return result.data;
  throw new CognitiveHubError('COGNITION_INVALID_REQUEST', result.error.message);
}

/**
 * Process-local authority for the live cognitive workspace.
 *
 * All network clients submit drafts. This hub owns canonical identity,
 * ordering, provenance, correlation ownership, leases and privacy filtering.
 */
export class CognitiveHub {
  readonly workspace: GlobalWorkspace;
  readonly mesh: CognitiveMesh;
  readonly serverEpoch = randomUUID();

  private readonly projector: CognitiveContextProjector;
  private readonly idempotencyCapacity: number;
  private readonly correlationCapacity: number;
  private readonly leaseCapacity: number;
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly correlationOwners = new Map<string, CorrelationOwner>();
  private readonly cancelledCorrelations = new Map<string, number>();
  private readonly leases = new Map<string, OwnedLease>();

  constructor(options: CognitiveHubOptions = {}) {
    this.workspace = options.workspace ?? options.mesh?.workspace ?? new GlobalWorkspace();
    if (options.mesh && options.mesh.workspace !== this.workspace) {
      throw new Error('CognitiveHub mesh and workspace must share the same authority');
    }
    this.mesh = options.mesh ?? new CognitiveMesh(this.workspace);
    this.projector = options.projector ?? new CognitiveContextProjector(this.workspace);
    this.idempotencyCapacity = Math.max(1, Math.floor(options.idempotencyCapacity ?? 2_048));
    this.correlationCapacity = Math.max(1, Math.floor(options.correlationCapacity ?? 4_096));
    this.leaseCapacity = Math.max(1, Math.floor(options.leaseCapacity ?? 2_048));
  }

  publish(principal: CognitivePrincipal, input: unknown): CognitivePublishAck {
    this.requireScope(principal, 'cognition:write');
    const request = parseOrThrow(cognitivePublishRequestSchema.safeParse(input));
    const idempotencyKey = `${principal.id}:${request.clientEventId}`;
    const requestFingerprint = fingerprint(request.draft);
    const previous = this.idempotency.get(idempotencyKey);
    if (previous) {
      if (previous.ownerId !== principal.id || previous.fingerprint !== requestFingerprint) {
        throw new CognitiveHubError(
          'IDEMPOTENCY_CONFLICT',
          'clientEventId was already used for a different cognitive draft',
        );
      }
      this.touchIdempotency(idempotencyKey, previous);
      return this.publishAck(previous.item, true);
    }

    this.assertWritePrivacy(principal, request.draft.privacy);
    if (request.draft.kind === 'percept') this.requireScope(principal, 'cognition:sense');
    if (this.cancelledCorrelations.has(request.draft.correlationId)) {
      throw new CognitiveHubError('CORRELATION_CANCELLED', 'correlation has been cancelled');
    }

    const parents = (request.draft.parentItemIds ?? []).map((id) => {
      const parent = this.workspace.get(id);
      if (!parent) throw new CognitiveHubError('PARENT_NOT_FOUND', `parent item not found: ${id}`);
      return parent;
    });
    const existingOwner = this.correlationOwners.get(request.draft.correlationId);
    if (
      existingOwner &&
      existingOwner.ownerId !== principal.id &&
      !hasScope(principal, 'cognition:write-foreign')
    ) {
      throw new CognitiveHubError(
        'CORRELATION_FORBIDDEN',
        'correlation belongs to another cognitive principal',
      );
    }

    const claimedCorrelation = !existingOwner;
    if (claimedCorrelation) this.claimCorrelation(request.draft.correlationId, principal.id);
    else existingOwner.lastSeenAt = Date.now();
    const item = this.mesh.publish({
      kind: request.draft.kind,
      producerId: `cognitive:${safeIdentity(principal.id)}`,
      correlationId: request.draft.correlationId,
      salience: request.draft.salience,
      confidence: request.draft.confidence,
      privacy: request.draft.privacy,
      provenance: {
        source: `cognitive-bus:${safeIdentity(principal.source)}`,
        ...(parents.length > 0 ? { derivedFrom: parents.map((parent) => parent.id) } : {}),
      },
      payload: request.draft.payload,
      ttlMs: request.draft.ttlMs,
      depth: parents.length > 0 ? Math.max(...parents.map((parent) => parent.depth)) + 1 : 0,
      dedupeKey: request.draft.dedupeKey,
    });
    if (!item) {
      if (claimedCorrelation) this.correlationOwners.delete(request.draft.correlationId);
      if (this.cancelledCorrelations.has(request.draft.correlationId)) {
        throw new CognitiveHubError('CORRELATION_CANCELLED', 'correlation has been cancelled');
      }
      throw new CognitiveHubError('WORKSPACE_REJECTED', 'workspace rejected the cognitive draft');
    }

    const entry: IdempotencyEntry = {
      ownerId: principal.id,
      fingerprint: requestFingerprint,
      item,
    };
    this.touchIdempotency(idempotencyKey, entry);
    return this.publishAck(item, false);
  }

  cancel(principal: CognitivePrincipal, input: unknown): { cancelled: boolean } {
    this.requireScope(principal, 'cognition:write');
    const request = parseOrThrow(cognitiveCancelRequestSchema.safeParse(input));
    const owner = this.correlationOwners.get(request.correlationId);
    if (!owner) {
      throw new CognitiveHubError('CORRELATION_NOT_FOUND', 'correlation is not owned by this hub');
    }
    if (owner.ownerId !== principal.id && !hasScope(principal, 'cognition:write-foreign')) {
      throw new CognitiveHubError('CORRELATION_FORBIDDEN', 'correlation belongs to another principal');
    }
    if (this.cancelledCorrelations.has(request.correlationId)) return { cancelled: false };
    this.cancelledCorrelations.set(request.correlationId, Date.now());
    while (this.cancelledCorrelations.size > 1_024) {
      const oldest = this.cancelledCorrelations.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cancelledCorrelations.delete(oldest);
    }
    this.mesh.cancelCorrelation(request.correlationId);
    return { cancelled: true };
  }

  acquireContext(principal: CognitivePrincipal, input: unknown): CognitiveContextAck {
    this.requireScope(principal, 'cognition:read');
    const request = parseOrThrow(cognitiveContextAcquireRequestSchema.safeParse(input));
    const principalClearance = this.readClearance(principal);
    const requestedClearance = request.maxPrivacy ?? principalClearance;
    const privacyClearance = PRIVACY_RANK[requestedClearance] <= PRIVACY_RANK[principalClearance]
      ? requestedClearance
      : principalClearance;
    const lease = this.projector.begin({
      consumerId: `cognitive-bus:${principal.id}`,
      privacyClearance,
      query: request.query,
      excludeCorrelationId: request.excludeCorrelationId,
      maxItems: request.maxItems,
      maxChars: request.maxChars,
      minSalience: request.minSalience,
      minConfidence: request.minConfidence,
    });
    if (lease.leaseId) {
      if (this.leases.size >= this.leaseCapacity) {
        lease.release();
        throw new CognitiveHubError('WORKSPACE_REJECTED', 'too many active context leases');
      }
      this.leases.set(lease.leaseId, { ownerId: principal.id, lease });
    }
    return {
      version: COGNITIVE_WIRE_VERSION,
      serverEpoch: this.serverEpoch,
      leaseId: lease.leaseId,
      turnContext: lease.turnContext,
      evidence: lease.evidence,
      itemIds: lease.itemIds,
    };
  }

  commitContext(principal: CognitivePrincipal, input: unknown): void {
    this.settleLease(principal, input, 'commit');
  }

  releaseContext(principal: CognitivePrincipal, input: unknown): void {
    this.settleLease(principal, input, 'release');
  }

  snapshot(principal: CognitivePrincipal, input: unknown = { version: 1 }): CognitiveSnapshot {
    this.requireScope(principal, 'cognition:raw');
    const request = parseOrThrow(cognitiveSnapshotRequestSchema.safeParse(input));
    const clearance = this.readClearance(principal);
    const kinds = request.kinds ? new Set<WorkspaceKind>(request.kinds) : undefined;
    const limit = request.limit ?? 128;
    const items = this.workspace
      .snapshot({ limit: 10_000 })
      .filter((item) => item.revision > (request.afterRevision ?? 0))
      .filter((item) => !kinds || kinds.has(item.kind))
      .filter((item) => this.canReadItem(principal, clearance, item))
      .sort((a, b) => a.revision - b.revision)
      .slice(0, limit);
    return {
      version: COGNITIVE_WIRE_VERSION,
      serverEpoch: this.serverEpoch,
      revision: this.workspace.currentRevision(),
      items,
    };
  }

  subscribe(
    principal: CognitivePrincipal,
    input: unknown,
    listener: (event: CognitiveSubscriptionEvent) => void,
  ): () => void {
    this.requireScope(principal, 'cognition:raw');
    const request = parseOrThrow(cognitiveSubscriptionRequestSchema.safeParse(input));
    const clearance = this.readClearance(principal);
    const kinds = request.kinds ? new Set<WorkspaceKind>(request.kinds) : undefined;
    return this.workspace.subscribe((item) => {
      if (item.revision <= (request.afterRevision ?? 0)) return;
      if (kinds && !kinds.has(item.kind)) return;
      if (!this.canReadItem(principal, clearance, item)) return;
      listener({
        version: COGNITIVE_WIRE_VERSION,
        serverEpoch: this.serverEpoch,
        revision: item.revision,
        item,
      });
    });
  }

  close(): void {
    for (const { lease } of this.leases.values()) lease.release();
    this.leases.clear();
    this.mesh.stop();
  }

  private settleLease(
    principal: CognitivePrincipal,
    input: unknown,
    operation: 'commit' | 'release',
  ): void {
    this.requireScope(principal, 'cognition:read');
    const request = parseOrThrow(cognitiveLeaseRequestSchema.safeParse(input));
    const owned = this.leases.get(request.leaseId);
    if (!owned) throw new CognitiveHubError('LEASE_NOT_FOUND', 'cognitive context lease not found');
    if (owned.ownerId !== principal.id && !hasScope(principal, 'cognition:admin')) {
      throw new CognitiveHubError('LEASE_FORBIDDEN', 'cognitive context lease belongs to another principal');
    }
    this.leases.delete(request.leaseId);
    owned.lease[operation]();
  }

  private readClearance(principal: CognitivePrincipal): WorkspacePrivacy {
    if (
      (principal.internal || hasScope(principal, 'cognition:read-local')) &&
      principal.loopback
    ) return 'local-only';
    if (
      hasScope(principal, 'cognition:read-lan') &&
      (principal.loopback || principal.secure === true)
    ) return 'trusted-lan';
    return 'cloud-ok';
  }

  private assertWritePrivacy(principal: CognitivePrincipal, privacy: WorkspacePrivacy): void {
    let clearance: WorkspacePrivacy = 'cloud-ok';
    if (
      (principal.internal || hasScope(principal, 'cognition:write-local')) &&
      principal.loopback
    ) clearance = 'local-only';
    else if (
      hasScope(principal, 'cognition:write-lan') &&
      (principal.loopback || principal.secure === true)
    ) clearance = 'trusted-lan';
    if (PRIVACY_RANK[privacy] > PRIVACY_RANK[clearance]) {
      throw new CognitiveHubError(
        'COGNITION_FORBIDDEN',
        `principal cannot publish ${privacy} cognitive data`,
      );
    }
  }

  private canReadItem(
    principal: CognitivePrincipal,
    clearance: WorkspacePrivacy,
    item: WorkspaceItem,
  ): boolean {
    if (PRIVACY_RANK[item.privacy] > PRIVACY_RANK[clearance]) return false;
    return item.kind !== 'action' || hasScope(principal, 'cognition:admin');
  }

  private requireScope(principal: CognitivePrincipal, scope: string): void {
    if (!principal.id || !hasScope(principal, scope)) {
      throw new CognitiveHubError('COGNITION_FORBIDDEN', `missing required scope: ${scope}`);
    }
  }

  private touchIdempotency(key: string, entry: IdempotencyEntry): void {
    this.idempotency.delete(key);
    this.idempotency.set(key, entry);
    while (this.idempotency.size > this.idempotencyCapacity) {
      const oldest = this.idempotency.keys().next().value as string | undefined;
      if (!oldest) break;
      this.idempotency.delete(oldest);
    }
  }

  private claimCorrelation(correlationId: string, ownerId: string): void {
    if (this.correlationOwners.size >= this.correlationCapacity) {
      const active = new Set(
        this.workspace.snapshot({ limit: 10_000 }).map((item) => item.correlationId),
      );
      const cutoff = Date.now() - 86_400_000;
      for (const [id, owner] of this.correlationOwners) {
        if (owner.lastSeenAt >= cutoff || active.has(id)) continue;
        this.correlationOwners.delete(id);
      }
    }
    if (this.correlationOwners.size >= this.correlationCapacity) {
      throw new CognitiveHubError('WORKSPACE_REJECTED', 'too many active correlations');
    }
    this.correlationOwners.set(correlationId, { ownerId, lastSeenAt: Date.now() });
  }

  private publishAck(item: WorkspaceItem, replayed: boolean): CognitivePublishAck {
    return {
      version: COGNITIVE_WIRE_VERSION,
      serverEpoch: this.serverEpoch,
      revision: item.revision,
      replayed,
      item,
    };
  }
}

export function createInternalCognitivePrincipal(source: string): CognitivePrincipal {
  return {
    id: `internal:${safeIdentity(source)}`,
    source,
    scopes: [],
    loopback: true,
    internal: true,
  };
}

export type {
  CognitiveCancelRequest,
  CognitiveContextAcquireRequest,
  CognitiveLeaseRequest,
  CognitivePublishRequest,
  CognitiveSnapshotRequest,
  CognitiveSubscriptionRequest,
};
