/**
 * Strategy layer types — the FOURTH learnable surface of the self-improvement
 * engine (after lessons, tools and skills): HOW the agent executes.
 *
 * A strategy is a small, bounded execution policy: round/cost ceilings, the
 * reasoning level, verification requirements and a handful of short method
 * directives. It is a JSON file under `.codebuddy/strategies/`, NEVER code, and
 * the schema below is STRICT — an unknown key is a rejection, so a mutation can
 * only move inside the envelope the schema declares. No field exists that could
 * disable a safety middleware, the sandbox, the confirmation service or the
 * skill firewall: that invariant holds by construction, not by a runtime check.
 *
 * @module agent/self-improvement/strategy-types
 */

import { z } from 'zod';

export const STRATEGY_SCHEMA_VERSION = 1;

export const STRATEGY_SCOPES = ['default', 'headless', 'code-edit', 'audit', 'research'] as const;
export type StrategyScope = (typeof STRATEGY_SCOPES)[number];

export const REASONING_LEVELS = ['off', 'low', 'medium', 'high'] as const;
export type StrategyReasoningLevel = (typeof REASONING_LEVELS)[number];

/** Hard envelope — the machine can move inside it, never outside. */
export const STRATEGY_LIMITS = {
  maxToolRounds: { min: 1, max: 400 },
  maxCostUsd: { min: 0, max: 100 },
  contextCompactPct: { min: 40, max: 95 },
  maxDirectives: 5,
  maxDirectiveChars: 400,
} as const;

const idRe = /^[a-z0-9][a-z0-9-]{2,63}$/;

export const strategyLimitsSchema = z
  .object({
    maxToolRounds: z
      .number()
      .int()
      .min(STRATEGY_LIMITS.maxToolRounds.min)
      .max(STRATEGY_LIMITS.maxToolRounds.max),
    maxCostUsd: z.number().min(STRATEGY_LIMITS.maxCostUsd.min).max(STRATEGY_LIMITS.maxCostUsd.max),
    contextCompactPct: z
      .number()
      .int()
      .min(STRATEGY_LIMITS.contextCompactPct.min)
      .max(STRATEGY_LIMITS.contextCompactPct.max)
      .optional(),
  })
  .strict();

export const strategyVerificationSchema = z
  .object({
    /** Before finishing, run the tests of every file touched and report the count. */
    testsForTouchedFiles: z.boolean(),
    /** Commit after each completed step so a rollback never erases proven work. */
    commitPerStep: z.boolean(),
  })
  .strict();

export const strategyProvenanceSchema = z
  .object({
    source: z.enum(['baseline', 'heuristic', 'llm', 'manual']),
    experienceIds: z.array(z.string().max(200)).max(50),
    createdAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
    /** Mutation operator that produced this candidate (audit trail). */
    operator: z.string().max(80).optional(),
  })
  .strict();

export const strategySpecSchema = z
  .object({
    schemaVersion: z.literal(STRATEGY_SCHEMA_VERSION),
    id: z.string().regex(idRe, 'id must be a lowercase slug'),
    version: z.number().int().min(1),
    parentId: z.string().regex(idRe).optional(),
    scope: z.enum(STRATEGY_SCOPES),
    /** Short method directives appended to the system prompt (firewall-scanned). */
    directives: z
      .array(z.string().min(8).max(STRATEGY_LIMITS.maxDirectiveChars))
      .max(STRATEGY_LIMITS.maxDirectives),
    limits: strategyLimitsSchema,
    reasoning: z.enum(REASONING_LEVELS),
    verification: strategyVerificationSchema,
    provenance: strategyProvenanceSchema,
  })
  .strict();

export type StrategySpec = z.infer<typeof strategySpecSchema>;
export type StrategyLimits = z.infer<typeof strategyLimitsSchema>;

/** The immutable root every lineage descends from — Code Buddy's historical defaults. */
export const BASELINE_STRATEGY: StrategySpec = Object.freeze({
  schemaVersion: STRATEGY_SCHEMA_VERSION,
  id: 'baseline',
  version: 1,
  scope: 'default',
  directives: [],
  limits: { maxToolRounds: 50, maxCostUsd: 10 },
  reasoning: 'medium',
  verification: { testsForTouchedFiles: false, commitPerStep: false },
  provenance: { source: 'baseline', experienceIds: [], createdAt: '2026-09-04T00:00:00.000Z' },
}) as StrategySpec;

/** A candidate produced by a proposer, before the gate. */
export interface StrategyProposal {
  id: string;
  kind: 'strategy';
  /** Id of the strategy this candidate mutates (lineage). */
  parentId: string;
  /** The candidate as proposed — may be INVALID; the gate decides. */
  candidate: unknown;
  /** Experiences that motivated it (audit). */
  experienceIds: string[];
  /** Human-readable rationale from the proposer. */
  rationale: string;
}

export type StrategyGateRejection =
  | 'schema'
  | 'safety'
  | 'inert'
  | 'lineage'
  | 'no-evidence'
  | 'regression'
  | 'cost'
  | 'undecided';

/** One paired observation: the same task under the parent and under the candidate. */
export interface StrategyPairedObservation {
  taskId: string;
  parentOk: boolean;
  candidateOk: boolean;
  parentCostUsd?: number;
  candidateCostUsd?: number;
  /** Why the replay/live run scored it this way (audit). */
  note?: string;
}

export interface StrategyEvaluation {
  /** `replay` = deterministic counterfactual on past runs; `live` = real paired runs. */
  evidence: 'replay' | 'live';
  observations: StrategyPairedObservation[];
}

export interface StrategyGateOutcome {
  proposalId: string;
  parentId: string;
  accepted: boolean;
  rejectionReason?: StrategyGateRejection;
  reasons: string[];
  /** Sign-test summary when the empirical stage ran. */
  paired?: { wins: number; losses: number; ties: number; pImprove: number; evidence: 'replay' | 'live' };
  /** Mean cost ratio candidate/parent on decisive pairs (1 = same). */
  costRatio?: number;
  /** Id of the strategy installed (auto-apply only). */
  appliedRef?: string;
}
