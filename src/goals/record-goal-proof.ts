import type { GoalJudgeResult } from './goal-judge.js';
import type { GoalState } from './goal-state.js';
import { ProofLedger } from './proof-ledger.js';

/** Persist a judge turn onto the append-only proof ledger. Never throws. */
export function recordGoalProof(input: {
  sessionKey: string;
  state: GoalState;
  outcome: GoalJudgeResult;
  workspaceRoot?: string;
}): void {
  try {
    const goalId = input.state.id?.trim() || input.sessionKey.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 64);
    const ledger = new ProofLedger(goalId, {
      artifactRoot: input.workspaceRoot ?? process.cwd(),
    });
    const passed = input.outcome.verdict === 'done';
    ledger.append({
      turn: input.state.turnsUsed,
      kind: 'decision',
      status: passed ? 'pass' : input.outcome.parseFailed ? 'unknown' : 'fail',
      assurance: 'judge',
      summary: input.outcome.reason,
      evidence: input.outcome.evidence,
      artifacts: input.outcome.artifacts,
      criterionResults: input.outcome.criteria?.map((row) => ({
        criterionId: row.id,
        status: row.status,
        evidence: row.evidence,
      })),
      sessionKey: input.sessionKey,
      source: 'goal-judge',
    });
  } catch {
    /* ledger is best-effort */
  }
}
