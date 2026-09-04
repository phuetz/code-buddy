/**
 * Strategy gate — ordered, blocking, fail-closed:
 *   G1 SCHEMA    strict Zod parse (unknown key, out-of-envelope value ⇒ reject)
 *   G2 SAFETY    directives go through the skill firewall (prompt override,
 *                exfiltration) + a forbidden-verb list (disable/bypass a guard)
 *   G3 LINEAGE   the candidate must descend from the given parent, one version up
 *   G4 INERT     a candidate byte-identical to its parent changes nothing ⇒ reject
 *   G5 EMPIRICAL paired observations (replay or live) → Bayesian sign test
 *                (`pairedBayesianDecision`) + a cost guard; no observation ⇒ reject
 *                (`no-evidence`): a strategy is never kept on schema alone.
 * Installation (store.save + activate) happens only on accept + keepOnAccept.
 *
 * @module agent/self-improvement/strategy-gate
 */

import { pairedBayesianDecision } from './paired-gate.js';
import { safetyGateSkill } from './skill-mutator.js';
import type { StrategyStore } from './strategy-store.js';
import {
  strategySpecSchema,
  type StrategyEvaluation,
  type StrategyGateOutcome,
  type StrategyProposal,
  type StrategyScope,
  type StrategySpec,
} from './strategy-types.js';

/** Port: produce paired observations for a candidate vs its parent. */
export interface StrategyEvaluator {
  evaluate(candidate: StrategySpec, parent: StrategySpec): Promise<StrategyEvaluation>;
}

export interface ValidateStrategyOptions {
  keepOnAccept: boolean;
  /** Posterior threshold for the sign test (default 0.95, as the paired gate). */
  threshold?: number;
  /** Max allowed mean cost ratio candidate/parent on decisive pairs (default 1.5). */
  maxCostRatio?: number;
  /** Minimum decisive pairs before an accept is even considered (default 3). */
  minDecisive?: number;
  /** Scope the candidate must target (the engine's scope); defaults to the parent's. */
  scope?: StrategyScope;
}

/**
 * A directive that tries to switch off a guard. The schema already has no field
 * for that; this catches an attempt smuggled into prose ("skip the sandbox").
 */
export const FORBIDDEN_DIRECTIVE_RE =
  /\b(?:disable|bypass|skip|ignore|turn\s+off|désactiv\w*|contourn\w*|ignor\w*|saute\w*)\b.{0,60}\b(?:sandbox|confirmation|permission|firewall|pare-feu|guard|garde-fou|validator|validateur|middleware|safety|sécurité|approval|approbation)/is;

export function staticStrategyProblems(candidate: StrategySpec): string[] {
  const problems: string[] = [];
  for (const directive of candidate.directives) {
    if (FORBIDDEN_DIRECTIVE_RE.test(directive)) {
      problems.push(`directive tries to switch off a guard: ${JSON.stringify(directive.slice(0, 80))}`);
    }
  }
  if (candidate.directives.length > 0) {
    const firewall = safetyGateSkill(candidate.directives.join('\n'));
    if (!firewall.ok) problems.push(...firewall.reasons.map((r) => `firewall: ${r}`));
  }
  return problems;
}

function specEquals(a: StrategySpec, b: StrategySpec): boolean {
  const strip = (s: StrategySpec) => {
    const { id: _id, version: _v, parentId: _p, provenance: _pr, ...rest } = s;
    return JSON.stringify(rest);
  };
  return strip(a) === strip(b);
}

export async function validateStrategyProposal(
  proposal: StrategyProposal,
  parent: StrategySpec,
  evaluator: StrategyEvaluator | null,
  store: StrategyStore,
  options: ValidateStrategyOptions,
): Promise<StrategyGateOutcome> {
  const base = { proposalId: proposal.id, parentId: parent.id };
  const reject = (rejectionReason: StrategyGateOutcome['rejectionReason'], reasons: string[]): StrategyGateOutcome => ({
    ...base,
    accepted: false,
    rejectionReason,
    reasons,
  });

  // G1 — strict schema.
  const parsed = strategySpecSchema.safeParse(proposal.candidate);
  if (!parsed.success) {
    return reject(
      'schema',
      parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    );
  }
  const candidate = parsed.data;

  // G2 — safety of directives.
  const safety = staticStrategyProblems(candidate);
  if (safety.length > 0) return reject('safety', safety);

  // G3 — lineage: descends from the parent, exactly one version up, same scope, fresh id.
  const lineage: string[] = [];
  if (candidate.parentId !== parent.id) lineage.push(`parentId ${candidate.parentId ?? '<none>'} ≠ ${parent.id}`);
  if (candidate.version !== parent.version + 1) lineage.push(`version ${candidate.version} ≠ ${parent.version + 1}`);
  const expectedScope = options.scope ?? parent.scope;
  if (candidate.scope !== expectedScope && !(parent.id === 'baseline' && !options.scope)) {
    lineage.push(`scope ${candidate.scope} ≠ ${expectedScope}`);
  }
  if (candidate.id === parent.id || store.has(candidate.id)) lineage.push(`id ${candidate.id} already exists`);
  if (lineage.length > 0) return reject('lineage', lineage);

  // G4 — inert candidate.
  if (specEquals(candidate, parent)) return reject('inert', ['candidate is identical to its parent — nothing to measure']);

  // G5 — empirical.
  if (!evaluator) return reject('no-evidence', ['no evaluator configured — a strategy is never kept on schema alone']);
  const evaluation = await evaluator.evaluate(candidate, parent);
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let costNum = 0;
  let costDen = 0;
  for (const o of evaluation.observations) {
    if (o.candidateOk && !o.parentOk) wins++;
    else if (!o.candidateOk && o.parentOk) losses++;
    else ties++;
    if (typeof o.parentCostUsd === 'number' && typeof o.candidateCostUsd === 'number' && o.parentCostUsd > 0) {
      costNum += o.candidateCostUsd;
      costDen += o.parentCostUsd;
    }
  }
  const threshold = options.threshold ?? 0.95;
  const decision = pairedBayesianDecision(wins, losses, threshold);
  const paired = { wins, losses, ties, pImprove: decision.pImprove, evidence: evaluation.evidence };
  const costRatio = costDen > 0 ? costNum / costDen : 1;
  const minDecisive = options.minDecisive ?? 3;

  if (evaluation.observations.length === 0) {
    return { ...reject('no-evidence', ['evaluator produced no paired observation']), paired };
  }
  if (decision.decision === 'reject' || (losses > 0 && wins === 0)) {
    return { ...reject('regression', [`candidate loses ${losses} paired task(s), wins ${wins}`]), paired, costRatio };
  }
  if (decision.decision !== 'accept' || decision.decisive < minDecisive) {
    return {
      ...reject('undecided', [
        `sign test undecided: wins=${wins} losses=${losses} P(improve)=${decision.pImprove.toFixed(3)} (need ≥ ${threshold} on ≥ ${minDecisive} decisive pairs)`,
      ]),
      paired,
      costRatio,
    };
  }
  const maxCostRatio = options.maxCostRatio ?? 1.5;
  if (costRatio > maxCostRatio) {
    return { ...reject('cost', [`mean cost ratio ${costRatio.toFixed(2)} exceeds ${maxCostRatio}`]), paired, costRatio };
  }

  // Accepted.
  let appliedRef: string | undefined;
  if (options.keepOnAccept) {
    store.save(candidate);
    store.activate(candidate.scope, candidate.id);
    appliedRef = candidate.id;
  }
  return {
    ...base,
    accepted: true,
    reasons: [
      `${evaluation.evidence} evidence: wins=${wins} losses=${losses} ties=${ties} P(improve)=${decision.pImprove.toFixed(3)}, cost ratio ${costRatio.toFixed(2)}`,
      options.keepOnAccept ? 'installed + activated (auto-apply)' : 'accepted (propose-only) — not installed',
    ],
    paired,
    costRatio,
    ...(appliedRef ? { appliedRef } : {}),
  };
}
