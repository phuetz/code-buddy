/**
 * Contracts for the bounded cognitive workspace and its independent specialists.
 * The workspace represents operational beliefs and proposals; it is not a claim
 * of subjective consciousness.
 */

export type WorkspaceKind =
  | 'percept'
  | 'utterance'
  | 'fact'
  | 'hypothesis'
  | 'goal'
  | 'plan'
  | 'proposal'
  | 'alert'
  | 'action'
  | 'result';

/** Strongest privacy wins when an item is derived from other workspace items. */
export type WorkspacePrivacy = 'cloud-ok' | 'trusted-lan' | 'local-only';

export interface WorkspaceProvenance {
  source: string;
  derivedFrom?: string[];
}

export interface WorkspaceItem<T = unknown> {
  id: string;
  kind: WorkspaceKind;
  producerId: string;
  correlationId: string;
  createdAt: number;
  expiresAt: number;
  salience: number;
  confidence: number;
  privacy: WorkspacePrivacy;
  provenance: WorkspaceProvenance;
  payload: T;
  revision: number;
  depth: number;
}

export interface WorkspaceDraft<T = unknown> {
  kind: WorkspaceKind;
  producerId: string;
  correlationId: string;
  salience: number;
  confidence: number;
  privacy: WorkspacePrivacy;
  provenance: WorkspaceProvenance;
  payload: T;
  createdAt?: number;
  expiresAt?: number;
  ttlMs?: number;
  depth?: number;
}

export interface WorkspaceQuery {
  kinds?: WorkspaceKind[];
  correlationId?: string;
  privacy?: WorkspacePrivacy[];
  producerIds?: string[];
  minSalience?: number;
  limit?: number;
  now?: number;
}

export interface WorkspaceMetrics {
  size: number;
  published: number;
  rejected: number;
  evicted: number;
  expired: number;
}

export type MailboxOverflow = 'drop-oldest' | 'drop-lowest-salience' | 'coalesce-latest';

export interface SpecialistContext {
  trigger: WorkspaceItem;
  workspace: readonly WorkspaceItem[];
  signal: AbortSignal;
}

export interface SpecialistDefinition {
  id: string;
  role: string;
  subscriptions: WorkspaceKind[];
  providerGroup?: string;
  mailboxCapacity?: number;
  overflow?: MailboxOverflow;
  maxConcurrency?: number;
  deadlineMs?: number;
  activate(context: SpecialistContext): Promise<WorkspaceDraft[] | void>;
}

export interface SpecialistMetrics {
  id: string;
  queued: number;
  active: number;
  processed: number;
  dropped: number;
  coalesced: number;
  failed: number;
  deadlineMisses: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}
