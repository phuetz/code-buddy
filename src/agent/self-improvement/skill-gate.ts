/**
 * Skill gate — validates an authored skill proposal. Ordered, blocking, fail-closed:
 *   G1+G2 `safetyGateSkill` (static scan + full-document prompt-injection /
 *      exfiltration firewall — a skill is INJECTED into the agent's context)
 *   G3 COVERAGE — the skill must surface the scenario's expected guidance.
 * Installation happens only on accept+keep (auto-apply); scoring never installs.
 * Propose-only uses the same safety gate so a jailbreak cannot be "accepted"
 * then throw on create().
 *
 * @module agent/self-improvement/skill-gate
 */

import { safetyGateSkill, type SkillMutatorPort } from './skill-mutator.js';
import type { SkillBenchmarkScenario, SkillGateOutcome, SkillProposal } from './skill-types.js';

export interface ValidateSkillOptions {
  keepOnAccept: boolean;
}

/** Deterministic coverage check: the skill content surfaces all expected guidance. */
export function coversScenario(content: string, scenario: SkillBenchmarkScenario): boolean {
  const lower = content.toLowerCase();
  return scenario.expectIncludes.every((s) => lower.includes(s.toLowerCase()));
}

export function validateSkillProposal(
  proposal: SkillProposal,
  scenario: SkillBenchmarkScenario,
  mutator: SkillMutatorPort,
  options: ValidateSkillOptions,
): SkillGateOutcome {
  const base = { proposalId: proposal.id, scenarioId: scenario.id };
  const content = proposal.spec.content ?? '';

  // G1 static scan + G2 skill firewall (prompt-injection / exfiltration), including
  // full-document instruction threats that the line-oriented scanner used to miss
  // (HTML comments, split-line jailbreaks). Must reject BEFORE create() so
  // propose-only cannot accept a skill that auto-apply would throw on.
  const safety = safetyGateSkill(content);
  if (!safety.ok) {
    return {
      ...base,
      accepted: false,
      rejectionReason: safety.rejectionReason ?? 'static-scan',
      reasons: safety.reasons,
    };
  }

  // G3 — coverage: the skill must actually surface the expected guidance.
  const lower = content.toLowerCase();
  const missing = scenario.expectIncludes.filter((s) => !lower.includes(s.toLowerCase()));
  if (missing.length > 0) {
    return {
      ...base,
      accepted: false,
      rejectionReason: 'coverage-fail',
      reasons: [`skill does not surface expected guidance: ${JSON.stringify(missing)}`],
    };
  }

  // Accepted. Install (auto-apply) or just report (propose-only).
  let appliedRef: string | undefined;
  if (options.keepOnAccept) {
    appliedRef = mutator.create(proposal.spec).name;
  }
  return {
    ...base,
    accepted: true,
    reasons: options.keepOnAccept
      ? ['accepted and installed (auto-apply): firewall-clean + covers the scenario']
      : ['accepted (propose-only): firewall-clean + covers the scenario, not installed'],
    ...(appliedRef ? { appliedRef } : {}),
  };
}
