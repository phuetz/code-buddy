/**
 * Shared, serializable contract for human-approved Project evolution.
 *
 * The renderer never receives raw session transcripts through this API. Only
 * bounded, secret-filtered evidence excerpts and the proposed before/after
 * values cross the preload boundary.
 */

export type ProjectEvolutionProposalType = 'master_instruction' | 'knowledge_file';
export type ProjectEvolutionProposalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'rolled_back';

export interface ProjectEvolutionEvidence {
  excerpt: string;
  role?: 'user' | 'assistant' | 'summary';
  messageId?: string;
  timestamp?: number;
}

export type ProjectEvolutionAuditAction =
  | 'created'
  | 'stale_detected'
  | 'approved'
  | 'rejected'
  | 'rolled_back';

export interface ProjectEvolutionAuditEntry {
  action: ProjectEvolutionAuditAction;
  at: number;
  detail?: string;
}

export interface ProjectEvolutionProposal {
  id: string;
  projectId: string;
  type: ProjectEvolutionProposalType;
  status: ProjectEvolutionProposalStatus;
  title: string;
  reason: string;
  evidence: ProjectEvolutionEvidence[];
  sourceKind: 'session' | 'summary';
  sourceSessionId?: string;
  targetPath?: string;
  /** SHA-256 identity of the resolved workspace root reviewed at creation. */
  workspaceFingerprint?: string;
  beforeContent: string;
  afterContent: string;
  baseFingerprint: string;
  appliedFingerprint?: string;
  knowledgeFileWasSelected?: boolean;
  staleReason?: string;
  rejectionReason?: string;
  audit: ProjectEvolutionAuditEntry[];
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
  appliedAt?: number;
  rolledBackAt?: number;
}

export type ProjectEvolutionSource =
  | { kind: 'session'; sessionId: string }
  | { kind: 'summary'; text: string };

export type ProjectEvolutionTarget =
  | { type: 'master_instruction' }
  | { type: 'knowledge_file'; path: string };

export interface ProjectEvolutionCreateInput {
  projectId: string;
  source: ProjectEvolutionSource;
  target: ProjectEvolutionTarget;
}

export interface ProjectEvolutionRejectInput {
  proposalId: string;
  reason?: string;
}

export interface ProjectEvolutionMutationResult {
  ok: boolean;
  proposal: ProjectEvolutionProposal | null;
  error?: string;
}

export interface ProjectEvolutionListResult {
  proposals: ProjectEvolutionProposal[];
}

export interface ProjectEvolutionApi {
  list(projectId: string): Promise<ProjectEvolutionListResult>;
  create(input: ProjectEvolutionCreateInput): Promise<ProjectEvolutionProposal>;
  approve(proposalId: string): Promise<ProjectEvolutionMutationResult>;
  reject(input: ProjectEvolutionRejectInput): Promise<ProjectEvolutionMutationResult>;
  rollback(proposalId: string): Promise<ProjectEvolutionMutationResult>;
}
