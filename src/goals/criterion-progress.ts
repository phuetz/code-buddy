import type { IntentGraph } from './intent-graph.js';
import type { ProofAssurance, ProofRecord } from './proof-ledger.js';

export type CriterionProgressStatus = 'unverified' | 'passed' | 'failed' | 'unknown';

export interface CriterionProgress {
  criterionId: string;
  title: string;
  sourceId?: string;
  status: CriterionProgressStatus;
  assurance: ProofAssurance;
  proofIds: string[];
  lastEvidence?: string;
  updatedAt?: string;
}

export interface IntentProgressSummary {
  total: number;
  passed: number;
  failed: number;
  unknown: number;
  unverified: number;
  coverage: number;
  criteria: CriterionProgress[];
}

function proofStatus(status: ProofRecord['status']): Exclude<CriterionProgressStatus, 'unverified'> {
  if (status === 'pass') return 'passed';
  if (status === 'fail') return 'failed';
  return 'unknown';
}

/** Deterministic criterion projection over the append-only Proof Ledger. */
export function deriveIntentProgress(
  graph: IntentGraph,
  proofs: ProofRecord[],
): IntentProgressSummary {
  const progress = new Map<string, CriterionProgress>();
  for (const node of graph.nodes) {
    if (node.kind !== 'criterion') continue;
    progress.set(node.id, {
      criterionId: node.id,
      title: node.title,
      ...(node.sourceId ? { sourceId: node.sourceId } : {}),
      status: 'unverified',
      assurance: 'none',
      proofIds: [],
    });
  }

  for (const proof of proofs) {
    const explicit = new Map((proof.criterionResults ?? []).map((result) => [result.criterionId, result]));
    const affected = new Set([...proof.criterionIds, ...explicit.keys()]);
    for (const criterionId of affected) {
      const current = progress.get(criterionId);
      if (!current) continue;
      const result = explicit.get(criterionId);
      const nextStatus = result?.status ?? proofStatus(proof.status);
      // An inconclusive retry cannot erase an earlier pass/fail. A later
      // conclusive oracle can still reveal a regression or prove a repair.
      if (nextStatus !== 'unknown' || current.status === 'unverified' || current.status === 'unknown') {
        current.status = nextStatus;
        current.assurance = proof.assurance;
        current.updatedAt = proof.createdAt;
        current.lastEvidence = result?.evidence || proof.summary;
      }
      if (!current.proofIds.includes(proof.id)) current.proofIds.push(proof.id);
    }
  }

  const criteria = [...progress.values()];
  const passed = criteria.filter((criterion) => criterion.status === 'passed').length;
  const failed = criteria.filter((criterion) => criterion.status === 'failed').length;
  const unknown = criteria.filter((criterion) => criterion.status === 'unknown').length;
  const unverified = criteria.length - passed - failed - unknown;
  return {
    total: criteria.length,
    passed,
    failed,
    unknown,
    unverified,
    coverage: criteria.length === 0 ? 0 : passed / criteria.length,
    criteria,
  };
}
