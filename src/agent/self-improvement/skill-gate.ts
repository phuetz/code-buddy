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
  const visible = scenario.visibleIncludes ?? scenario.expectIncludes;
  const heldOut = scenario.heldOutIncludes ?? [];
  return [...visible, ...heldOut].every((s) => lower.includes(s.toLowerCase()));
}

export function validateSkillProposal(
  proposal: SkillProposal,
  scenario: SkillBenchmarkScenario,
  mutator: SkillMutatorPort,
  options: ValidateSkillOptions,
): SkillGateOutcome {
  const base = { proposalId: proposal.id, scenarioId: scenario.id };
  const content = proposal.spec.content ?? '';

  // SG1: valid markdown content, non-empty instructions, structure / triggers
  const trimmed = content.trim();
  if (trimmed.length < 20 || !proposal.spec.name) {
    return {
      ...base,
      accepted: false,
      rejectionReason: 'static-scan',
      reasons: ['SG1: skill content is empty or too short, or missing name'],
    };
  }

  // SG2: static scan + skill firewall (prompt-injection / exfiltration / safety)
  const safety = safetyGateSkill(content);
  if (!safety.ok) {
    return {
      ...base,
      accepted: false,
      rejectionReason: safety.rejectionReason ?? 'static-scan',
      reasons: safety.reasons.map((r) => `SG2: ${r}`),
    };
  }

  // SG3: visible cases coverage
  const lower = content.toLowerCase();
  const visible = scenario.visibleIncludes ?? scenario.expectIncludes;
  const missingVisible = visible.filter((s) => !lower.includes(s.toLowerCase()));
  if (missingVisible.length > 0) {
    return {
      ...base,
      accepted: false,
      rejectionReason: 'coverage-fail',
      reasons: [`SG3: visible coverage failed, missing: ${JSON.stringify(missingVisible)}`],
    };
  }

  // SG4: held-out secrets coverage (anti-gaming)
  const heldOut = scenario.heldOutIncludes ?? [];
  const missingHeldOut = heldOut.filter((s) => !lower.includes(s.toLowerCase()));
  if (missingHeldOut.length > 0) {
    return {
      ...base,
      accepted: false,
      rejectionReason: 'coverage-fail',
      reasons: [`SG4: held-out secret coverage failed, missing: ${JSON.stringify(missingHeldOut)}`],
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
