import type { IntentGraph } from '../../../src/goals/intent-graph.js';
import type { IntentProgressSummary } from '../../../src/goals/criterion-progress.js';
import type { CounterfactualBranch } from '../../../src/goals/counterfactual-forge.js';
import type { ProofIntegrityReport, ProofRecord } from '../../../src/goals/proof-ledger.js';
import type { ProvenOutcomeRecord } from '../../../src/goals/proven-outcome-memory.js';
import type {
  MissionConstitution,
  MissionConstitutionInput,
} from '../../../src/goals/mission-constitution.js';
import type {
  MissionBidEvaluation,
  SubmitMissionBidInput,
} from '../../../src/goals/mission-exchange.js';
import type {
  ReversibilityChecks,
  ShadowRehearsal,
} from '../../../src/goals/shadow-twin.js';
import type {
  OutcomeCapsuleParameter,
  OutcomeCapsuleRecord,
} from '../../../src/goals/outcome-capsule.js';

export interface OsIntentProofInput {
  sessionId?: string;
  proofLimit?: number;
}

export interface OsForgeCreateInput {
  sessionId?: string;
  label: string;
  hypothesis: string;
  strategy: string;
  parentBranchId?: string;
}

export interface OsForgeEvaluateInput {
  sessionId?: string;
  branchId: string;
  proofIds?: string[];
  quality?: number;
  latencyMs?: number;
  costUsd?: number;
  regressions?: string[];
}

export interface OsForgeSelectInput {
  sessionId?: string;
  branchId?: string;
}

export interface OsConstitutionUpdateInput extends MissionConstitutionInput {
  sessionId?: string;
}

export interface OsExchangeBidInput extends Omit<SubmitMissionBidInput, 'prediction' | 'origin'> {
  sessionId?: string;
  quality: number;
  latencyMs: number;
  costUsd: number;
}

export interface OsExchangeRehearseInput {
  sessionId?: string;
  bidId: string;
  quality: number;
  latencyMs: number;
  costUsd: number;
  reversibility: ReversibilityChecks;
  maxDrift?: number;
}

export interface OsExchangeAwardInput {
  sessionId?: string;
  bidId: string;
  humanApproved?: boolean;
}

export interface OsExchangeRejectInput {
  sessionId?: string;
  bidId: string;
}

export interface OsCapsuleCreateInput {
  sessionId?: string;
  outcomeId: string;
  title?: string;
  description?: string;
  parameters?: OutcomeCapsuleParameter[];
  requiredRuntimes?: number;
}

export interface OsCapsuleActivateInput {
  sessionId?: string;
  capsuleId: string;
  humanApproved?: boolean;
}

export interface OsCapsuleRevokeInput {
  sessionId?: string;
  capsuleId: string;
}

export interface OsIntentStateSummary {
  goalId: string;
  goal: string;
  status: 'active' | 'paused' | 'done' | 'cleared';
  turnsUsed: number;
  maxTurns: number;
  verifyGated: boolean;
  lastVerdict?: 'done' | 'continue' | 'skipped';
  lastReason?: string;
}

export interface OsIntentProofPayload {
  source: 'cowork-session' | 'latest' | 'none';
  state: OsIntentStateSummary | null;
  graph: IntentGraph | null;
  progress: IntentProgressSummary | null;
  proofs: ProofRecord[];
  integrity: ProofIntegrityReport;
  forgeBranches: CounterfactualBranch[];
  outcomes: ProvenOutcomeRecord[];
  constitution: MissionConstitution | null;
  exchangeBids: MissionBidEvaluation[];
  shadowRehearsals: ShadowRehearsal[];
  capsules: OutcomeCapsuleRecord[];
  ledgerPath?: string;
}

export interface OsIntentActionResult {
  ok: boolean;
  payload: OsIntentProofPayload;
  error?: string;
}
