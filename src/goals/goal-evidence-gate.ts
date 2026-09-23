/**
 * Hermes Judgment-style gate: a goal is not done without concrete evidence.
 * Opt-in via GoalState.verifyGated or CODEBUDDY_GOAL_EVIDENCE=true.
 */

import type { GoalJudgeResult } from './goal-judge.js';

export interface GoalEvidenceFields {
  evidence?: string;
  artifacts?: string[];
  criteria?: Array<{ id: string; status: 'passed' | 'failed' | 'unknown'; evidence?: string }>;
}

function flagOn(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = (env[name] ?? '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'on';
}

export function isGoalEvidenceRequired(
  verifyGated?: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(verifyGated) || flagOn(env, 'CODEBUDDY_GOAL_EVIDENCE');
}

export function extractGoalEvidence(record: Record<string, unknown>): GoalEvidenceFields {
  const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : '';
  const artifacts = Array.isArray(record.artifacts)
    ? record.artifacts.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const criteriaRaw = Array.isArray(record.criteria) ? record.criteria : [];
  const criteria = criteriaRaw.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? row.criterionId ?? '').trim();
    const status = String(row.status ?? '').trim();
    if (!id || !['passed', 'failed', 'unknown'].includes(status)) return [];
    const rowEvidence = typeof row.evidence === 'string' ? row.evidence.trim() : '';
    return [
      {
        id,
        status: status as 'passed' | 'failed' | 'unknown',
        ...(rowEvidence ? { evidence: rowEvidence } : {}),
      },
    ];
  });
  return {
    ...(evidence ? { evidence } : {}),
    ...(artifacts.length ? { artifacts } : {}),
    ...(criteria.length ? { criteria } : {}),
  };
}

export function evidenceSatisfiesDone(fields: GoalEvidenceFields): boolean {
  if (fields.evidence && fields.evidence.length >= 8) return true;
  if ((fields.artifacts?.length ?? 0) > 0) return true;
  if ((fields.criteria ?? []).some((row) => row.status === 'passed' && row.evidence)) return true;
  return false;
}

/** Downgrade a done verdict when the evidence gate is on and nothing concrete was attached. */
export function applyEvidenceGate(
  result: GoalJudgeResult & GoalEvidenceFields,
  options: { verifyGated?: boolean; env?: NodeJS.ProcessEnv } = {},
): GoalJudgeResult & GoalEvidenceFields {
  if (result.verdict !== 'done') return result;
  if (!isGoalEvidenceRequired(options.verifyGated, options.env ?? process.env)) return result;
  if (evidenceSatisfiesDone(result)) return result;
  return {
    ...result,
    verdict: 'continue',
    reason: `evidence required before done: ${result.reason}`,
    parseFailed: false,
  };
}
