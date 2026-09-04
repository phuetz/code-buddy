/**
 * Types for the SKILL self-improvement path. A skill is procedural guidance
 * (a SKILL.md injected into context), not a deterministic function — so it is
 * gated by SAFETY (the skill firewall: prompt-injection / exfiltration surface)
 * plus COVERAGE (does it actually surface the expected guidance?), rather than
 * the behavioural held-out gate used for executable tools. Honest by design:
 * there is nothing to "run", so there is no behavioural held-out for pure
 * guidance — the held-out gate stays the tool path's concern.
 *
 * @module agent/self-improvement/skill-types
 */

export interface SkillSpec {
  /** Authored skill name (slugged, namespaced authored-*). */
  name: string;
  description: string;
  /** The full SKILL.md body. */
  content: string;
}

/** Coverage scenario: the authored skill should surface `expectIncludes` for `query`. */
export interface SkillBenchmarkScenario {
  id: string;
  query: string;
  expectIncludes: string[];
  description: string;
  /** Visible coverage terms presented to the proposer and checked by SG3 (defaults to expectIncludes). */
  visibleIncludes?: string[];
  /** Held-out secret coverage terms checked only by SG4 (anti-gaming, hidden from proposer). */
  heldOutIncludes?: string[];
}

export interface SkillProposal {
  id: string;
  targetScenarioId: string;
  experienceId?: string;
  spec: SkillSpec;
}

export type SkillGateRejection = 'static-scan' | 'firewall' | 'coverage-fail';

export interface SkillGateOutcome {
  accepted: boolean;
  proposalId: string;
  scenarioId: string;
  rejectionReason?: SkillGateRejection;
  reasons: string[];
  /** Name of the skill left installed (only when accepted AND kept). */
  appliedRef?: string;
}
