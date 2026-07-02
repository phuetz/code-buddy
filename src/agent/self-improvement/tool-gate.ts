/**
 * Tool gate — the empirical, anti-gaming validator for an authored-tool proposal.
 * Ordered, blocking, fail-closed:
 *   G1 static scan (authored-artifact-gate, no execution)
 *   G3 VISIBLE behavioural cases must all pass (the tool actually works)
 *   G4 HELD-OUT behavioural cases must all pass (fresh inputs the proposer never
 *      saw — a tool that hardcodes the visible outputs fails here → rejected).
 * A scenario with no held-out cases is rejected (anti-gaming is then undefined).
 *
 * Scoring never registers the tool; registration happens only on accept+keep.
 *
 * @module agent/self-improvement/tool-gate
 */

import { inspectAuthoredCode } from './authored-artifact-gate.js';
import { AUTHORED_PREFIX } from './authored-tool-runtime.js';
import { scoreToolCases } from './sandbox-scorer.js';
import type { ToolMutatorPort } from './tool-skill-mutator.js';
import type { ToolBenchmarkScenario, ToolGateOutcome, ToolProposal } from './tool-types.js';

export interface ValidateToolOptions {
  /** auto-apply: keep (register) an accepted tool. propose-only: report only. */
  keepOnAccept: boolean;
}

export async function validateToolProposal(
  proposal: ToolProposal,
  scenario: ToolBenchmarkScenario,
  mutator: ToolMutatorPort,
  options: ValidateToolOptions,
): Promise<ToolGateOutcome> {
  const zero = {
    proposalId: proposal.id,
    scenarioId: scenario.id,
    visiblePassed: 0,
    visibleTotal: scenario.visibleCases.length,
    heldOutPassed: 0,
    heldOutTotal: scenario.heldOutCases.length,
  };

  // G1 — static scan (no execution).
  const scan = inspectAuthoredCode(proposal.spec.code, 'code');
  if (!scan.ok) {
    return { ...zero, accepted: false, rejectionReason: 'static-scan', reasons: scan.reasons };
  }

  // G1b — namespace: an authored tool must never be able to shadow a built-in.
  // Reject before spending any scoring on a mis-named proposal.
  if (!proposal.spec.name.startsWith(AUTHORED_PREFIX)) {
    return {
      ...zero,
      accepted: false,
      rejectionReason: 'name-invalid',
      reasons: [`tool name "${proposal.spec.name}" is not namespaced "${AUTHORED_PREFIX}*" — refusing to avoid shadowing a built-in`],
    };
  }

  // Fail-closed: a scenario with no held-out cases can't defend against gaming.
  if (scenario.heldOutCases.length === 0) {
    return {
      ...zero,
      accepted: false,
      rejectionReason: 'heldout-fail',
      reasons: ['scenario has no held-out cases — anti-gaming is undefined, refusing'],
    };
  }

  // G3 — visible behavioural cases (the tool must actually work).
  const visible = await scoreToolCases(proposal.spec, scenario.visibleCases);
  if (visible.passed < visible.total) {
    return {
      ...zero,
      accepted: false,
      visiblePassed: visible.passed,
      rejectionReason: 'visible-fail',
      reasons: visible.failures,
    };
  }

  // G4 — held-out cases on FRESH inputs (catches hardcoded-output gaming).
  const heldOut = await scoreToolCases(proposal.spec, scenario.heldOutCases);
  if (heldOut.passed < heldOut.total) {
    return {
      ...zero,
      accepted: false,
      visiblePassed: visible.passed,
      heldOutPassed: heldOut.passed,
      rejectionReason: 'heldout-fail',
      reasons: ['held-out cases failed — likely gamed/overfit visible outputs', ...heldOut.failures],
    };
  }

  // Accepted. Keep (auto-apply) or just report (propose-only).
  let appliedRef: string | undefined;
  if (options.keepOnAccept) {
    appliedRef = mutator.register(proposal.spec).name;
  }
  return {
    ...zero,
    accepted: true,
    visiblePassed: visible.passed,
    heldOutPassed: heldOut.passed,
    reasons: options.keepOnAccept
      ? ['accepted and kept (auto-apply): passed visible + held-out, statically clean']
      : ['accepted (propose-only): passed visible + held-out, not persisted'],
    ...(appliedRef ? { appliedRef } : {}),
  };
}
