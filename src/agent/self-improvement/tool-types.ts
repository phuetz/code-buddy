/**
 * Types for the TOOL self-improvement path (sibling to the lesson path). A tool
 * "covers" a scenario only BEHAVIORALLY: it must run on fixed inputs and produce
 * asserted outputs (a presence predicate would be trivially gamed).
 *
 * @module agent/self-improvement/tool-types
 */

import type { AuthoredToolSpec } from './authored-tool-runtime.js';

/** One behavioural assertion: run the tool on `input`, output must contain ALL of `expectIncludes`. */
export interface ToolCase {
  input: Record<string, unknown>;
  expectIncludes: string[];
}

/**
 * A behavioural benchmark for an authored tool. `visibleCases` describe the
 * capability (and may be shown to the proposer); `heldOutCases` use fresh inputs
 * and are NEVER shown to the proposer — a tool that hardcodes the visible
 * outputs passes visible but fails held-out (the anti-reward-hacking defence).
 */
export interface ToolBenchmarkScenario {
  id: string;
  /** Human capability description (safe to show the proposer). */
  capability: string;
  description: string;
  visibleCases: ToolCase[];
  heldOutCases: ToolCase[];
}

/** A candidate authored tool, motivated by a scenario. The spec must be produced WITHOUT seeing heldOutCases. */
export interface ToolProposal {
  id: string;
  targetScenarioId: string;
  experienceId?: string;
  spec: AuthoredToolSpec;
}

export type ToolGateRejection =
  | 'static-scan'
  | 'name-invalid'
  | 'visible-fail'
  | 'heldout-fail';

export interface ToolGateOutcome {
  accepted: boolean;
  proposalId: string;
  scenarioId: string;
  visiblePassed: number;
  visibleTotal: number;
  heldOutPassed: number;
  heldOutTotal: number;
  rejectionReason?: ToolGateRejection;
  reasons: string[];
  /** Name of the tool left registered (only when accepted AND kept). */
  appliedRef?: string;
}
