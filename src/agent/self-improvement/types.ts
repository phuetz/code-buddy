/**
 * Recursive self-improvement engine — shared types.
 *
 * Design (compact, clean, measurable — per the project's guiding principle):
 * an empirically-gated, archive-based improvement loop inspired by the Darwin
 * Gödel Machine (empirical validation of self-modifications) and Voyager
 * (an ever-growing, self-verified skill/lesson library), built ON TOP of
 * Code Buddy's existing learning infrastructure (RunStore, retrospectives,
 * lessons, skills, golden/policy evals) rather than duplicating it.
 *
 * The engine improves only the REVERSIBLE learnable layer (lessons, and later
 * skills/patterns) — never agent source code. Every change is snapshot-gated,
 * empirically validated against a DETERMINISTIC capability benchmark, and
 * rolled back on regression. Code-level self-modification (the DGM's "rewrite
 * own code") is intentionally out of scope for V1.
 *
 * @module agent/self-improvement/types
 */

export const SELF_IMPROVEMENT_SCHEMA_VERSION = 1;

/**
 * A unit of feedback to learn from. The same shape covers code-run friction
 * today and, in the robot future, sensor/world-model prediction error — that
 * is the modality-agnostic seam (see ExperienceSource).
 */
export interface Experience {
  /** Stable id (e.g. `run:<runId>:<frictionKey>` or `sensor:<...>`). */
  id: string;
  /** Where it came from. */
  source: 'run' | 'sensor' | 'manual';
  /** Short machine label for the situation (used to target a benchmark scenario). */
  kind: string;
  /** Human-readable description of the friction/opportunity. */
  detail: string;
  /** Free-text context the proposer can mine (e.g. tool sequence, error text). */
  context: string;
  /** Optional severity 0..1 used by the curriculum to prioritise. */
  severity?: number;
}

/** A candidate improvement to the reversible learnable layer. V1: lessons. */
export interface ImprovementProposal {
  id: string;
  kind: 'lesson';
  /** Benchmark scenario this proposal intends to fix (for measurement). */
  targetScenarioId: string;
  /** The experience that motivated it, if any (lineage/audit). */
  experienceId?: string;
  lesson: {
    category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';
    content: string;
    context?: string;
  };
}

/**
 * A deterministic, offline check: for `query`, the agent's learnable state
 * should surface guidance matching `expectIncludes`. Curated SEPARATELY from
 * the proposer (the engine must never author the evals that bless its own
 * changes — that would let it game itself).
 */
export interface BenchmarkScenario {
  id: string;
  /** The situation, as the agent would search for guidance. */
  query: string;
  /** Lowercased substrings; a lesson matching ANY counts the scenario as covered. */
  expectIncludes: string[];
  /** Human label. */
  description: string;
}

export interface BenchmarkScenarioResult {
  scenarioId: string;
  covered: boolean;
  /** Ids of lessons that satisfied the expectation (audit). */
  matchedLessonIds: string[];
}

export interface BenchmarkScore {
  total: number;
  covered: number;
  /** covered / total in [0,1]. */
  ratio: number;
  results: BenchmarkScenarioResult[];
}

/** Why a proposal was rejected, for audit. */
export type GateRejectionReason =
  | 'structural-invalid'
  | 'policy-violation'
  | 'no-improvement'
  | 'regression';

export interface GateOutcome {
  accepted: boolean;
  proposalId: string;
  scoreBefore: number;
  scoreAfter: number;
  /** scoreAfter - scoreBefore. */
  delta: number;
  /** Scenario ids that got WORSE (covered → uncovered) — any => reject + rollback. */
  regressions: string[];
  rejectionReason?: GateRejectionReason;
  /** True when a snapshot was applied then reverted (rollback proven). */
  rolledBack: boolean;
  notes: string[];
}

/** One accepted improvement, kept as an evolutionary stepping stone (DGM). */
export interface ArchiveEntry {
  proposalId: string;
  kind: ImprovementProposal['kind'];
  targetScenarioId: string;
  experienceId?: string;
  delta: number;
  scoreAfter: number;
  /** Id of the applied lesson (so it can be traced/rolled back later). */
  appliedRef?: string;
  createdAt: string;
  /** Sentinel for auditability, mirrors the learning-loop convention. */
  reviewedBy: string;
}

export interface SelfImprovementCycleResult {
  schemaVersion: typeof SELF_IMPROVEMENT_SCHEMA_VERSION;
  kind: 'self_improvement_cycle';
  startedAt: string;
  /** The scenario the curriculum selected to work on (lowest coverage first). */
  selectedScenarioId: string | null;
  proposalId: string | null;
  gate: GateOutcome | null;
  scoreBefore: BenchmarkScore;
  scoreAfter: BenchmarkScore;
  /** True only when an empirically-validated improvement was kept. */
  applied: boolean;
  /** 'propose-only' (default) or 'auto-apply' (CODEBUDDY_SELF_IMPROVE=true). */
  autonomy: 'propose-only' | 'auto-apply';
  notes: string[];
}
