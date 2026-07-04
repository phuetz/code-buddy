/**
 * AI-Scientist-lite — Phase 3: the bounded, human-bracketed Best-First Tree
 * Search (BFTS) discovery loop.
 *
 * Phases 0/1/2 give ONE human-gated, sandboxed experiment pass. Phase 3 turns
 * that single pass into a real multi-generation *discovery* loop — the capstone
 * inspired by AI-Scientist-v2's experiment manager — WITHOUT surrendering
 * control:
 *
 *   ┌─ GATE #1 (human) ── approve the research plan + BUDGET ────────────────┐
 *   │  (fail closed — declined ⇒ the autonomous loop NEVER starts, nothing   │
 *   │   is ever executed)                                                    │
 *   ├─ bounded BFTS (NO per-generation human gate — this is the autonomy) ───┤
 *   │  loop while budget left AND not converged:                             │
 *   │    select best node to expand (best-first)                            │
 *   │      → mutate a child hypothesis (inspired by parent + archive)        │
 *   │      → execute in the Phase-2 SANDBOX (isolate/docker/e2b)             │
 *   │      → score (Phase-1 fitness) → decideKeep → record with `parentId`   │
 *   │  HARD CAPS stop it: maxGenerations · maxExperiments · maxWallClockMs · │
 *   │  maxCost. It can NEVER run forever.                                    │
 *   ├─ GATE #2 (human) ── approve the BEST result before publication ────────┤
 *   │  (fail closed — declined ⇒ NOTHING is published to the CKG)            │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * Security is the whole point (this loop EXECUTES generated code, repeatedly and
 * autonomously between the two gates), so the design is defensive BY
 * CONSTRUCTION:
 *
 *   1. AUTONOMY IS BOUNDED BY HARD CAPS. Every cap is a hard ceiling; the loop
 *      STOPS the instant any is reached. There is no code path that loops without
 *      decrementing a bounded budget. Defaults are conservative (5 generations,
 *      10 experiments). The caller cannot exceed the internal hard ceilings
 *      (generations/experiments/parallelism are clamped).
 *   2. BRACKETED BY TWO HUMAN GATES. Between them the loop is autonomous but it
 *      can NEVER publish. Both gates fail closed via `resolveGate`.
 *   3. SANDBOXED EXECUTION, non-bypassable. Every variant runs through the
 *      injected `executeCode` boundary (the Phase-2 sandbox router) with
 *      `envMode:'isolate'` set HERE — the caller cannot opt out of isolation.
 *   4. NEVER-THROWS. A failing generation degrades to a floored (failed) node —
 *      optionally RE-RUN once (the same code unchanged — a plain re-attempt, NOT
 *      an LLM debug/repair; it only helps a flaky/non-deterministic failure) under
 *      a bounded, INJECTED probability — and the loop keeps going, returning a
 *      partial result. It never crashes.
 *   5. DECOUPLED (like Phase 1). Scoring targets the EXPERIMENT'S metric in the
 *      EXPERIMENT folder (the sandbox run dir), NEVER Code Buddy's own `src/`.
 *
 * Every side-effecting edge — ideation, mutation, authoring, execution, scoring,
 * report, review, the two gates, publication, and even the clock / id / RNG — is
 * an INJECTABLE boundary ({@link ExperimentLoopDeps}) resolved by the CLI to the
 * real bricks and faked in tests (zero LLM / execution / network / wall-clock in
 * CI). There is NO agent tool: the loop is CLI-only, so the agent can never
 * launch an autonomous experiment loop of its own accord.
 *
 * @module agent/science/experiment-loop
 */

import { logger } from '../../utils/logger.js';
import type {
  ExecuteCodeInput,
  ExecuteCodeResult,
  ExecuteCodeRunnerOptions,
} from '../../tools/execute-code-runner.js';
import { resolveGate } from './human-gate.js';
import type { GateDecision } from './human-gate.js';
import type {
  ExperimentAnalysis,
  ExperimentCode,
  ExperimentDeps,
  ExperimentStageLog,
  ExperimentStageName,
  NoveltyVerdict,
  ReportContext,
  ReviewVerdict,
  ScienceIdea,
  ScienceReport,
} from './experiment-orchestrator.js';
import { ensureEvidenceSection, renderExecutionEvidence } from './experiment-orchestrator.js';
import {
  cachedExecutionRunner,
  experimentFitnessComponent,
  type MetricParser,
} from './experiment-fitness.js';
import { decideKeep, scoreExperiment, type DecideKeepOptions, type KeepDecision } from './experiment-decision.js';
import {
  ExperimentVariantStore,
  type ExperimentExecutionSummary,
  type ExperimentVariantMetric,
  type ExperimentVariantRecord,
} from './experiment-variant-store.js';
import type { FitnessContext, FitnessReport } from '../self-improvement/evolution/variant-fitness.js';

// ============================================================================
// Injectable boundaries — the loop reuses ALL of Phase 0's `ExperimentDeps`
// (ideate / assessNovelty / confirmExperiment=GATE#1 / authorExperiment /
// executeCode / analyze / report / review / confirmPublication=GATE#2 / publish)
// and adds only what a multi-generation search needs on top.
// ============================================================================

/** Context handed to the mutation boundary when expanding a parent node. */
export interface MutationContext {
  goal: string;
  /** The parent variant being expanded (best-first selected). */
  parent: ExperimentVariantRecord;
  /** The parent's idea (hypothesis text carried in-memory across generations). */
  parentIdea: ScienceIdea;
  /** The best-so-far variants, to inspire a diverse mutation (archive/MAP-Elites). */
  archive: ExperimentVariantRecord[];
  /** 0-based generation index of the child being produced. */
  generation: number;
}

export interface ExperimentLoopDeps extends ExperimentDeps {
  /**
   * MUTATE a parent variant into a CHILD hypothesis, inspired by the parent +
   * the archive of best-so-far variants. This is the BFTS "expand a node" step.
   * MAY throw — the loop guards it (a failed mutation simply skips that child).
   */
  mutate: (ctx: MutationContext) => Promise<ScienceIdea>;
  /** Metric extraction boundary used to SCORE every generation (stdout/result.json). */
  parseMetric: MetricParser;
  /** Append-only variant store (records the tree; NEVER publishes). */
  store: ExperimentVariantStore;
  /** Injected id generator (no `Math.random()` in the hot path). */
  createId: () => string;
  /** Injected ISO-8601 timestamp for records (no `Date.now()` in the hot path). */
  now: () => string;
  /** Injected monotonic wall-clock in ms, for the wall-clock hard cap. */
  clock: () => number;
  /** Injected RNG in [0,1) gating the bounded probabilistic re-attempt of a failed node. */
  random: () => number;
}

// ============================================================================
// Budget — hard caps + soft convergence knobs. All defaulted and clamped.
// ============================================================================

export interface ExperimentBudget {
  /** HARD CAP: max generations (loop iterations). Default 5, clamped to [1,100]. */
  maxGenerations?: number;
  /** HARD CAP: max experiments EXECUTED total. Default 10, clamped to [1,500]. */
  maxExperiments?: number;
  /** HARD CAP: wall-clock budget in ms. Default 30 min. */
  maxWallClockMs?: number;
  /** HARD CAP: cost budget (arbitrary units). Default +Infinity (off). */
  maxCost?: number;
  /** Cost charged per executed experiment (drives the cost cap). Default 0. */
  costPerExperiment?: number;
  /** Parallel workers per generation. Default 1, clamped to [1,8]. */
  parallelism?: number;
  /** Convergence: stop early after this many generations with no improvement. Default 3. */
  patience?: number;
  /** Minimum best-score gain that counts as an improvement (convergence eps). Default 1e-9. */
  minImprovement?: number;
  /**
   * Probability of RE-RUNNING a FAILED node once. NOTE: this re-executes the SAME
   * code unchanged — it is a plain re-attempt, NOT an LLM debug/repair, so it only
   * recovers a flaky/non-deterministic failure, never a deterministic bug. Each
   * re-run still counts against maxExperiments. Default 0 (off); there is no CLI
   * flag today, so the loop never re-runs unless a caller sets it programmatically.
   */
  debugProbability?: number;
  /** Max extra re-attempts per failed node (sequential only). Default 1, clamped to [0,3]. */
  maxDebugRetries?: number;
  /** Root dir for the sandbox run dir (default `process.cwd()`). */
  rootDir?: string;
  /** Per-experiment execution timeout (ms). */
  experimentTimeoutMs?: number;
  /** Keep/reject thresholds passed to `decideKeep`. */
  decideOptions?: DecideKeepOptions;
  /** Per-generation progress callback (never allowed to break the loop). */
  onGeneration?: (log: GenerationLog) => void;
  /** Outer-stage progress callback (never allowed to break the loop). */
  onStage?: (log: ExperimentStageLog) => void;
}

/** Internal ceilings a caller can never exceed (belt-and-braces on the caps). */
const HARD_CEILING = { maxGenerations: 100, maxExperiments: 500, parallelism: 8, maxDebugRetries: 3 } as const;
const DEFAULTS = {
  maxGenerations: 5,
  maxExperiments: 10,
  maxWallClockMs: 30 * 60 * 1000,
  maxCost: Number.POSITIVE_INFINITY,
  costPerExperiment: 0,
  parallelism: 1,
  patience: 3,
  minImprovement: 1e-9,
  debugProbability: 0,
  maxDebugRetries: 1,
} as const;

interface ResolvedBudget {
  maxGenerations: number;
  maxExperiments: number;
  maxWallClockMs: number;
  maxCost: number;
  costPerExperiment: number;
  parallelism: number;
  patience: number;
  minImprovement: number;
  debugProbability: number;
  maxDebugRetries: number;
  rootDir: string;
  experimentTimeoutMs: number | undefined;
  decideOptions: DecideKeepOptions | undefined;
}

function clampInt(value: number | undefined, min: number, max: number, dflt: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : dflt;
  return Math.min(max, Math.max(min, n));
}

function clampNum(value: number | undefined, min: number, max: number, dflt: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : dflt;
  return Math.min(max, Math.max(min, n));
}

function resolveBudget(b: ExperimentBudget): ResolvedBudget {
  return {
    maxGenerations: clampInt(b.maxGenerations, 1, HARD_CEILING.maxGenerations, DEFAULTS.maxGenerations),
    maxExperiments: clampInt(b.maxExperiments, 1, HARD_CEILING.maxExperiments, DEFAULTS.maxExperiments),
    // A non-finite max would be an unbounded wall-clock — clamp to a sane 24h ceiling.
    maxWallClockMs: clampNum(b.maxWallClockMs, 1, 24 * 60 * 60 * 1000, DEFAULTS.maxWallClockMs),
    // maxCost MAY be +Infinity (off); only reject NaN/negative.
    maxCost:
      typeof b.maxCost === 'number' && !Number.isNaN(b.maxCost) && b.maxCost >= 0 ? b.maxCost : DEFAULTS.maxCost,
    costPerExperiment: clampNum(b.costPerExperiment, 0, Number.MAX_SAFE_INTEGER, DEFAULTS.costPerExperiment),
    parallelism: clampInt(b.parallelism, 1, HARD_CEILING.parallelism, DEFAULTS.parallelism),
    patience: clampInt(b.patience, 1, HARD_CEILING.maxGenerations, DEFAULTS.patience),
    minImprovement: clampNum(b.minImprovement, 0, 1, DEFAULTS.minImprovement),
    debugProbability: clampNum(b.debugProbability, 0, 1, DEFAULTS.debugProbability),
    maxDebugRetries: clampInt(b.maxDebugRetries, 0, HARD_CEILING.maxDebugRetries, DEFAULTS.maxDebugRetries),
    rootDir: typeof b.rootDir === 'string' && b.rootDir.trim() ? b.rootDir : process.cwd(),
    experimentTimeoutMs:
      typeof b.experimentTimeoutMs === 'number' && Number.isFinite(b.experimentTimeoutMs)
        ? b.experimentTimeoutMs
        : undefined,
    decideOptions: b.decideOptions,
  };
}

// ============================================================================
// Result / status
// ============================================================================

export type ExperimentLoopStatus =
  /** GATE #1 declined ⇒ the loop NEVER ran (no code executed). */
  | 'declined-at-plan-gate'
  /** Ideation/setup failed before the loop could start. */
  | 'failed'
  /** The loop ran but produced no eligible best ⇒ nothing to publish. */
  | 'no-viable-variant'
  /** A best was found; GATE #2 declined ⇒ nothing published. */
  | 'declined-at-publish-gate'
  /** A best was found, approved, and published to the collective knowledge graph. */
  | 'published';

/** Why the bounded loop stopped (honest telemetry). */
export type LoopStopReason =
  | 'plan-declined'
  | 'max-generations'
  | 'max-experiments'
  | 'max-wallclock'
  | 'max-cost'
  | 'converged'
  | 'exhausted';

export interface GenerationLog {
  generation: number;
  /** The parent variant expanded this generation (null for the seed generation). */
  parentId: string | null;
  /** Variant ids produced this generation. */
  variantIds: string[];
  /** Experiments actually EXECUTED this generation (author-failed candidates don't count). */
  experimentsRun: number;
  /** Best eligible score after this generation. */
  bestScore: number;
}

export interface LoopBudgetAccounting {
  maxGenerations: number;
  maxExperiments: number;
  maxWallClockMs: number;
  maxCost: number;
  parallelism: number;
  patience: number;
  generationsRun: number;
  experimentsRun: number;
  wallClockMs: number;
  costSpent: number;
}

export interface ExperimentLoopResult {
  goal: string;
  rootIdea: ScienceIdea | null;
  novelty: NoveltyVerdict | null;
  planGate: GateDecision | null;
  /** Every variant recorded this run (the tree; lineage via `parentId`). */
  tree: ExperimentVariantRecord[];
  /** The winning variant (best-first over the run's eligible variants), or null. */
  best: ExperimentVariantRecord | null;
  /** The final report synthesized from the best (null if no best / declined). */
  report: ScienceReport | null;
  review: ReviewVerdict | null;
  publishGate: GateDecision | null;
  published: boolean;
  status: ExperimentLoopStatus;
  generations: GenerationLog[];
  stopReason: LoopStopReason;
  budget: LoopBudgetAccounting;
  stages: ExperimentStageLog[];
  error?: string;
}

// ============================================================================
// In-memory node — the live data (full execution/idea) for a recorded variant,
// so the final report can be synthesized from the winner without re-executing.
// ============================================================================

interface LoopNode {
  record: ExperimentVariantRecord;
  idea: ScienceIdea;
  code: ExperimentCode;
  execution: ExecuteCodeResult | null;
  fitness: FitnessReport;
}

/** The sandbox mode the loop ALWAYS enforces — not caller-overridable. */
const SANDBOX_ENV_MODE: NonNullable<ExecuteCodeRunnerOptions['envMode']> = 'isolate';

// ============================================================================
// The loop
// ============================================================================

/**
 * Run a bounded, human-bracketed BFTS discovery loop. NEVER throws: every stage
 * is guarded and any failure degrades to a terminal {@link ExperimentLoopStatus}
 * with a partial result.
 *
 * The two human gates FAIL CLOSED — without an explicit `approved === true` the
 * autonomous loop never starts (GATE #1) and nothing is published (GATE #2).
 */
export async function runExperimentLoop(
  goal: string,
  deps: ExperimentLoopDeps,
  budget: ExperimentBudget = {},
): Promise<ExperimentLoopResult> {
  const b = resolveBudget(budget);

  // Live accounting (mutated as the loop spends budget).
  let generation = 0;
  let experiments = 0;
  let cost = 0;
  let wallClockMs = 0;

  const result: ExperimentLoopResult = {
    goal,
    rootIdea: null,
    novelty: null,
    planGate: null,
    tree: [],
    best: null,
    report: null,
    review: null,
    publishGate: null,
    published: false,
    status: 'failed',
    generations: [],
    stopReason: 'plan-declined',
    budget: accounting(b, 0, 0, 0, 0),
    stages: [],
  };

  const stage = (s: ExperimentStageName, ok: boolean, detail: string): void => {
    const log: ExperimentStageLog = { stage: s, ok, detail };
    result.stages.push(log);
    try {
      budget.onStage?.(log);
    } catch {
      /* progress must never break the loop */
    }
  };

  // In-memory run state — records for selection + full nodes for the report.
  const runRecords: ExperimentVariantRecord[] = [];
  const nodes = new Map<string, LoopNode>();

  try {
    const trimmedGoal = typeof goal === 'string' ? goal.trim() : '';
    if (!trimmedGoal) {
      result.error = 'goal is required';
      result.status = 'failed';
      stage('ideate', false, result.error);
      result.budget = accounting(b, generation, experiments, wallClockMs, cost);
      return result;
    }

    // ── Root idea (an LLM call — NO code execution yet, so it precedes GATE #1) ─
    try {
      result.rootIdea = await deps.ideate(trimmedGoal);
    } catch (err) {
      result.error = `ideation failed: ${errMsg(err)}`;
      result.status = 'failed';
      stage('ideate', false, result.error);
      result.budget = accounting(b, generation, experiments, wallClockMs, cost);
      return result;
    }
    if (!result.rootIdea || !result.rootIdea.hypothesis.trim()) {
      result.error = 'ideation produced no hypothesis';
      result.status = 'failed';
      stage('ideate', false, result.error);
      result.budget = accounting(b, generation, experiments, wallClockMs, cost);
      return result;
    }
    stage('ideate', true, `[${result.rootIdea.source}] ${result.rootIdea.hypothesis}`);

    // ── Novelty (degrades, never blocks) — informs the plan gate ───────────────
    try {
      result.novelty = await deps.assessNovelty(result.rootIdea, trimmedGoal);
    } catch (err) {
      result.novelty = degradedNovelty(`novelty assessment failed: ${errMsg(err)}`);
    }
    if (!result.novelty) result.novelty = degradedNovelty('novelty assessment returned nothing');
    stage('novelty', true, `${result.novelty.noveltyAssessment} — ${result.novelty.summary}`);

    // ── GATE #1: approve the plan + BUDGET before the autonomous loop starts ───
    result.planGate = await resolveGate(deps.confirmExperiment, {
      gate: 'plan',
      title: 'Approve the research plan + budget before the autonomous experiment loop runs',
      body: buildLoopPlanGateBody(trimmedGoal, result.rootIdea, result.novelty, b),
    });
    stage(
      'plan-gate',
      result.planGate.approved,
      result.planGate.approved ? 'approved' : `declined${result.planGate.reason ? `: ${result.planGate.reason}` : ''}`,
    );
    if (!result.planGate.approved) {
      // CRITICAL: the loop is NEVER started without an explicit approval ⇒ no
      // generated code is ever executed.
      result.status = 'declined-at-plan-gate';
      result.stopReason = 'plan-declined';
      result.budget = accounting(b, generation, experiments, wallClockMs, cost);
      return result;
    }

    // ── Bounded BFTS loop — autonomous between the gates, budget-capped ─────────
    const startMs = deps.clock();
    let bestScoreSoFar = Number.NEGATIVE_INFINITY;
    let stagnation = 0;
    result.stopReason = 'exhausted';

    // Execute ONE candidate: author → sandboxed exec → score → decide → record.
    // Never throws — a failure floors the node so the loop keeps going. The bounded
    // re-attempt (same code re-run, not a debug/repair) is enabled only in the
    // sequential path (allowRetry), where the hard-cap re-check is race-free.
    const runCandidate = async (
      idea: ScienceIdea,
      parent: ExperimentVariantRecord | null,
      parentFitness: FitnessReport | null,
      allowRetry: boolean,
    ): Promise<LoopNode> => {
      let code: ExperimentCode | null = null;
      try {
        code = await deps.authorExperiment(idea, trimmedGoal);
      } catch (err) {
        return flooredNode(deps, idea, parent, `authoring failed: ${errMsg(err)}`);
      }
      if (!code || !code.code.trim()) {
        return flooredNode(deps, idea, parent, 'authoring produced no experiment code');
      }

      const execInput: ExecuteCodeInput = {
        code: code.code,
        language: code.language,
        ...(b.experimentTimeoutMs !== undefined ? { timeoutMs: b.experimentTimeoutMs } : {}),
      };
      // SECURITY: the loop OWNS isolation + the root dir. Not caller-overridable.
      const execOptions: ExecuteCodeRunnerOptions = { envMode: SANDBOX_ENV_MODE, rootDir: b.rootDir };

      let execution: ExecuteCodeResult | null = null;
      const maxAttempts = 1 + (allowRetry ? b.maxDebugRetries : 0);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // A retry must re-check the hard cap (race-free in the sequential path).
        if (attempt > 0 && experiments >= b.maxExperiments) break;
        experiments += 1;
        cost += b.costPerExperiment;
        try {
          execution = await deps.executeCode(execInput, execOptions);
        } catch (err) {
          execution = null;
          logger.debug(`[science] experiment execution threw (floored): ${errMsg(err)}`);
        }
        if (execution && execution.ok) break;
        // Decide whether to spend one more (bounded) re-attempt of the SAME code.
        const canRetry =
          allowRetry &&
          attempt + 1 < maxAttempts &&
          experiments < b.maxExperiments &&
          deps.random() < b.debugProbability;
        if (!canRetry) break;
      }

      if (!execution) {
        return flooredNode(deps, { ...idea }, parent, 'execution failed (no result)', code);
      }

      // Score via the Phase-1 fitness brick over the EXPERIMENT folder (isolate).
      const component = experimentFitnessComponent({
        code: code.code,
        language: code.language,
        executeCode: cachedExecutionRunner(execution),
        parseMetric: deps.parseMetric,
      });
      const ctx: FitnessContext = { checkoutDir: execution.runDir };
      let fitness: FitnessReport;
      try {
        fitness = await scoreExperiment(ctx, [component], parentFitness ?? undefined);
      } catch (err) {
        fitness = floorReport(`scoring failed (floored): ${errMsg(err)}`);
      }

      const decision = decideKeep(fitness, parentFitness ?? undefined, b.decideOptions);
      const record = buildRecord(deps, idea, code, execution, fitness, decision, parent);
      deps.store.record(record);
      return { record, idea, code, execution, fitness };
    };

    while (true) {
      // ── HARD CAPS — checked BEFORE every generation. The loop can NEVER run
      //    past a cap: the instant one is reached, it stops. ────────────────────
      wallClockMs = Math.max(0, deps.clock() - startMs);
      if (generation >= b.maxGenerations) {
        result.stopReason = 'max-generations';
        break;
      }
      if (experiments >= b.maxExperiments) {
        result.stopReason = 'max-experiments';
        break;
      }
      if (wallClockMs >= b.maxWallClockMs) {
        result.stopReason = 'max-wallclock';
        break;
      }
      if (cost >= b.maxCost) {
        result.stopReason = 'max-cost';
        break;
      }

      // ── Select what to expand (best-first) and mutate children ──────────────
      const specs: Array<{ idea: ScienceIdea; parent: ExperimentVariantRecord | null; parentFitness: FitnessReport | null }> = [];
      let genParentId: string | null = null;
      if (generation === 0) {
        // Seed generation — run the root hypothesis itself.
        specs.push({ idea: result.rootIdea, parent: null, parentFitness: null });
      } else {
        const frontier = pickTop(runRecords, b.parallelism);
        if (frontier.length === 0) {
          // No eligible parent yet (all prior attempts failed) — fresh stepping
          // stone via re-ideation, guarded.
          const fresh = await ideateSafe(deps, trimmedGoal);
          if (fresh) specs.push({ idea: fresh, parent: null, parentFitness: null });
        } else {
          genParentId = frontier[0]?.id ?? null;
          const archive = pickTop(runRecords, 5);
          for (const parent of frontier) {
            const pnode = nodes.get(parent.id);
            const parentIdea = pnode?.idea ?? { hypothesis: parent.hypothesis, source: 'reasoning' as const };
            const child = await mutateSafe(deps, { goal: trimmedGoal, parent, parentIdea, archive, generation });
            if (child) specs.push({ idea: child, parent, parentFitness: pnode?.fitness ?? null });
          }
        }
      }

      if (specs.length === 0) {
        // Nothing expandable (e.g. mutation kept failing) — stop cleanly.
        result.stopReason = 'converged';
        break;
      }

      // Respect the experiment cap: run at most `remaining` candidates.
      const remaining = b.maxExperiments - experiments;
      if (remaining <= 0) {
        result.stopReason = 'max-experiments';
        break;
      }
      const batch = specs.slice(0, remaining);

      const produced: LoopNode[] = [];
      if (b.parallelism > 1) {
        // Parallel workers — exactly one execution each (no retry), so the total
        // executions this generation ≤ batch.length ≤ remaining. Provably capped.
        const settled = await Promise.all(
          batch.map((s) => runCandidate(s.idea, s.parent, s.parentFitness, false)),
        );
        produced.push(...settled);
      } else {
        for (const s of batch) {
          if (experiments >= b.maxExperiments) break;
          // F4: re-check the time/cost caps BETWEEN experiments so a sequential
          // batch stops at the cap instant, not only at the next generation head.
          wallClockMs = Math.max(0, deps.clock() - startMs);
          if (wallClockMs >= b.maxWallClockMs || cost >= b.maxCost) break;
          produced.push(await runCandidate(s.idea, s.parent, s.parentFitness, true));
        }
      }

      const variantIds: string[] = [];
      let generationExperiments = 0;
      for (const node of produced) {
        runRecords.push(node.record);
        nodes.set(node.record.id, node);
        variantIds.push(node.record.id);
        if (node.execution) generationExperiments += 1;
      }
      result.tree = [...runRecords];

      const currentBest = pickBest(runRecords);
      const currentBestScore = currentBest?.score ?? Number.NEGATIVE_INFINITY;

      const genLog: GenerationLog = {
        generation,
        parentId: genParentId,
        variantIds,
        experimentsRun: generationExperiments,
        bestScore: Number.isFinite(currentBestScore) ? currentBestScore : 0,
      };
      result.generations.push(genLog);
      try {
        budget.onGeneration?.(genLog);
      } catch {
        /* progress must never break the loop */
      }

      // ── Convergence (soft) — stop early after `patience` stagnant generations ─
      if (currentBestScore - bestScoreSoFar > b.minImprovement) {
        bestScoreSoFar = currentBestScore;
        stagnation = 0;
      } else {
        stagnation += 1;
      }

      generation += 1;
      wallClockMs = Math.max(0, deps.clock() - startMs);

      // F4: enforce the time/cost caps at the generation boundary too — a batch
      // (parallel or sequential) that just spent the budget must STOP here with
      // the honest reason, BEFORE convergence can mask it and without overshooting
      // into another generation's batch.
      if (wallClockMs >= b.maxWallClockMs) {
        result.stopReason = 'max-wallclock';
        break;
      }
      if (cost >= b.maxCost) {
        result.stopReason = 'max-cost';
        break;
      }

      if (stagnation >= b.patience) {
        result.stopReason = 'converged';
        break;
      }
    }

    result.budget = accounting(b, generation, experiments, wallClockMs, cost);

    // ── Select the winner (best-first over this run's eligible variants) ───────
    const best = pickBest(runRecords);
    result.best = best;
    if (!best) {
      // The loop ran but nothing eligible was produced — nothing to publish.
      // (publish is NEVER reached.)
      result.status = 'no-viable-variant';
      stage('report', false, 'no viable variant produced by the loop');
      return result;
    }

    // ── Synthesize + review the report for the WINNER (single-shot, like Phase 0) ─
    const bestNode = nodes.get(best.id);
    let analysis: ExperimentAnalysis;
    if (bestNode?.execution) {
      try {
        analysis = await deps.analyze(bestNode.execution, bestNode.idea);
      } catch (err) {
        analysis = degradedAnalysis(bestNode.execution, `analysis failed: ${errMsg(err)}`);
      }
    } else {
      analysis = { summary: 'winner analysis unavailable (no captured execution)', findings: [] };
    }
    stage('analyze', true, analysis.summary);

    const reportCtx: ReportContext = {
      goal: trimmedGoal,
      idea: bestNode?.idea ?? { hypothesis: best.hypothesis, source: 'reasoning' },
      novelty: result.novelty,
      experimentCode: bestNode?.code ?? { code: best.code, language: best.language },
      execution: bestNode?.execution ?? syntheticExecution(best),
      analysis,
    };
    try {
      result.report = await deps.report(reportCtx);
    } catch (err) {
      result.report = degradedReport(reportCtx, `report synthesis failed: ${errMsg(err)}`);
    }
    if (!result.report || !result.report.report.trim()) {
      result.report = degradedReport(reportCtx, 'report synthesis returned nothing');
    }
    // SELF-CONTAINMENT INVARIANT (verifiability): the winner report handed to
    // the reviewer + GATE #2 MUST embed the winner's real execution output.
    result.report = {
      ...result.report,
      report: ensureEvidenceSection(result.report.report, reportCtx.execution),
    };
    stage('report', true, `${result.report.report.length} chars`);

    try {
      result.review = await deps.review(result.report, reportCtx.idea);
    } catch (err) {
      result.review = { verdict: 'NEEDS REVIEW', evidence: `review failed: ${errMsg(err)}` };
    }
    if (!result.review) result.review = { verdict: 'NEEDS REVIEW', evidence: 'review returned nothing' };
    stage('review', result.review.verdict === 'CONFIRMED', result.review.verdict);

    // ── GATE #2: approve the BEST result before publication (FAIL CLOSED) ──────
    result.publishGate = await resolveGate(deps.confirmPublication, {
      gate: 'publish',
      title: 'Approve the best experiment result before publishing to the collective knowledge graph',
      body: buildLoopPublishGateBody(best, result.report, result.review, result.budget),
    });
    stage(
      'publish-gate',
      result.publishGate.approved,
      result.publishGate.approved
        ? 'approved'
        : `declined${result.publishGate.reason ? `: ${result.publishGate.reason}` : ''}`,
    );
    if (!result.publishGate.approved) {
      // CRITICAL: nothing is EVER published without an explicit approval.
      result.status = 'declined-at-publish-gate';
      return result;
    }

    // ── Publish the winner (CKG ingest) — only after BOTH gates approved ───────
    try {
      await deps.publish(result.report, reportCtx.idea);
      result.published = true;
      result.status = 'published';
      stage('publish', true, 'best variant report ingested into the collective knowledge graph');
    } catch (err) {
      result.published = false;
      result.status = 'declined-at-publish-gate';
      result.error = `publication failed: ${errMsg(err)}`;
      stage('publish', false, result.error);
    }
    return result;
  } catch (err) {
    // Final safety net — runExperimentLoop NEVER throws.
    result.status = 'failed';
    result.error = `unexpected loop error: ${errMsg(err)}`;
    result.budget = accounting(b, generation, experiments, wallClockMs, cost);
    try {
      logger.warn(`[science] ${result.error}`);
    } catch {
      /* logging must never break the loop */
    }
    return result;
  }
}

// ============================================================================
// Best-first selection — mirrors `ExperimentVariantStore.best()` but run-scoped
// (over this run's in-memory records) so a stale cross-run variant is never
// selected or published.
// ============================================================================

function eligible(records: ExperimentVariantRecord[]): ExperimentVariantRecord[] {
  return records.filter((v) => v.passedAll && v.regressions.length === 0);
}

/** The single best eligible variant (highest score; ties → most recent). */
function pickBest(records: ExperimentVariantRecord[]): ExperimentVariantRecord | null {
  const pool = eligible(records);
  if (pool.length === 0) return null;
  return pool.reduce((best, v) => {
    if (v.score > best.score) return v;
    if (v.score === best.score && v.createdAt > best.createdAt) return v;
    return best;
  });
}

/** The top-k eligible variants (best-first frontier), highest score first. */
function pickTop(records: ExperimentVariantRecord[], k: number): ExperimentVariantRecord[] {
  if (k <= 0) return [];
  return [...eligible(records)]
    .sort((a, b) => b.score - a.score || (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, k);
}

// ============================================================================
// Record + floored-node construction
// ============================================================================

function buildRecord(
  deps: ExperimentLoopDeps,
  idea: ScienceIdea,
  code: ExperimentCode,
  execution: ExecuteCodeResult,
  fitness: FitnessReport,
  decision: KeepDecision,
  parent: ExperimentVariantRecord | null,
): ExperimentVariantRecord {
  const mc = fitness.components[0];
  const metric: ExperimentVariantMetric = {
    name: mc?.name ?? 'experiment-metric',
    value: typeof mc?.metrics?.value === 'number' ? mc.metrics.value : null,
    score: mc?.score ?? 0,
    detail: mc?.detail ?? 'no metric',
  };
  const executionResult: ExperimentExecutionSummary = {
    ok: execution.ok,
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    runId: execution.runId,
    runDir: execution.runDir,
    durationMs: execution.durationMs,
  };
  return {
    id: deps.createId(),
    hypothesis: idea.hypothesis,
    code: code.code,
    language: code.language,
    executionResult,
    metric,
    score: fitness.score,
    passedAll: fitness.passedAll,
    regressions: decision.regressions,
    ...(parent ? { parentId: parent.id } : {}),
    // The loop has NO per-generation keep-gate — the human keep decision is the
    // publication gate over the winner, so loop variants are never marked kept.
    kept: false,
    createdAt: deps.now(),
    detail: decision.reason,
  };
}

/**
 * A floored (failed) node: recorded so the tree honestly reflects the attempt,
 * with score 0 / passedAll false so best-first selection ignores it. Never
 * eligible; the loop continues.
 */
function flooredNode(
  deps: ExperimentLoopDeps,
  idea: ScienceIdea,
  parent: ExperimentVariantRecord | null,
  reason: string,
  code?: ExperimentCode,
): LoopNode {
  const fitness = floorReport(reason);
  const record: ExperimentVariantRecord = {
    id: deps.createId(),
    hypothesis: idea.hypothesis,
    code: code?.code ?? '',
    language: code?.language ?? 'python',
    executionResult: { ok: false, exitCode: null, timedOut: false, runId: '', runDir: '', durationMs: 0 },
    metric: { name: 'experiment-metric', value: null, score: 0, detail: reason },
    score: 0,
    passedAll: false,
    regressions: [],
    ...(parent ? { parentId: parent.id } : {}),
    kept: false,
    createdAt: deps.now(),
    detail: reason,
  };
  deps.store.record(record);
  return { record, idea, code: code ?? { code: '', language: 'python' }, execution: null, fitness };
}

// ============================================================================
// Guarded boundary wrappers
// ============================================================================

async function ideateSafe(deps: ExperimentLoopDeps, goal: string): Promise<ScienceIdea | null> {
  try {
    const idea = await deps.ideate(goal);
    return idea && idea.hypothesis.trim() ? idea : null;
  } catch (err) {
    logger.debug(`[science] re-ideation failed: ${errMsg(err)}`);
    return null;
  }
}

async function mutateSafe(deps: ExperimentLoopDeps, ctx: MutationContext): Promise<ScienceIdea | null> {
  try {
    const idea = await deps.mutate(ctx);
    return idea && idea.hypothesis.trim() ? idea : null;
  } catch (err) {
    logger.debug(`[science] mutation failed: ${errMsg(err)}`);
    return null;
  }
}

// ============================================================================
// Deterministic fallbacks (keep the loop never-throwing + honest)
// ============================================================================

function floorReport(reason: string): FitnessReport {
  return {
    score: 0,
    passedAll: false,
    components: [{ name: 'experiment-metric', weight: 1, score: 0, passed: false, detail: reason }],
    regressions: [],
  };
}

function degradedNovelty(reason: string): NoveltyVerdict {
  return { noveltyAssessment: 'unknown', evidence: [reason], summary: 'novelty could not be assessed' };
}

function degradedAnalysis(execution: ExecuteCodeResult, reason: string): ExperimentAnalysis {
  const stdout = (execution.stdout || '').trim();
  const findings: string[] = [];
  if (stdout) findings.push(`stdout (${stdout.length} chars) captured`);
  if (execution.stderr?.trim()) findings.push('stderr present');
  findings.push(`exit ${execution.exitCode ?? 'unknown'}${execution.timedOut ? ' (timed out)' : ''}`);
  return { summary: reason, findings };
}

function degradedReport(ctx: ReportContext, reason: string): ScienceReport {
  const body = [
    `# Experiment Report (loop winner): ${ctx.goal}`,
    '',
    '## TL;DR',
    '',
    `Rapport déterministe (synthèse LLM indisponible : ${reason}).`,
    '',
    '## Hypothèse gagnante',
    '',
    ctx.idea.hypothesis,
    '',
    // Real winner execution output, code-rendered + bounded (verifiable).
    renderExecutionEvidence(ctx.execution),
    '',
    '## Analyse',
    '',
    ctx.analysis.summary,
    ...ctx.analysis.findings.map((f) => `- ${f}`),
  ].join('\n');
  return { report: body };
}

/** Minimal synthetic execution result when the winner's live node is missing. */
function syntheticExecution(best: ExperimentVariantRecord): ExecuteCodeResult {
  return {
    kind: 'execute_code_result',
    ok: best.executionResult.ok,
    runId: best.executionResult.runId,
    language: best.language,
    startedAt: best.createdAt,
    completedAt: best.createdAt,
    durationMs: best.executionResult.durationMs,
    commandPreview: '',
    runDir: best.executionResult.runDir,
    scriptPath: '',
    stdoutPath: '',
    stderrPath: '',
    resultPath: '',
    exitCode: best.executionResult.exitCode,
    signal: null,
    timedOut: best.executionResult.timedOut,
    stdout: '',
    stderr: '',
    files: [],
  };
}

// ============================================================================
// Gate prompt bodies
// ============================================================================

function buildLoopPlanGateBody(goal: string, idea: ScienceIdea, novelty: NoveltyVerdict, b: ResolvedBudget): string {
  return [
    `Objectif : ${goal}`,
    '',
    `Hypothèse initiale [${idea.source}] : ${idea.hypothesis}`,
    ...(idea.rationale ? ['', `Plan : ${idea.rationale}`] : []),
    '',
    `Nouveauté : ${novelty.noveltyAssessment} — ${novelty.summary}`,
    '',
    'Budget (plafonds DURS — la boucle S\'ARRÊTE dès qu\'un est atteint) :',
    `  - générations max      : ${b.maxGenerations}`,
    `  - expériences max       : ${b.maxExperiments}`,
    `  - temps mur max         : ${Math.round(b.maxWallClockMs / 1000)}s`,
    `  - coût max              : ${b.maxCost === Number.POSITIVE_INFINITY ? 'illimité' : b.maxCost}`,
    `  - workers parallèles    : ${b.parallelism}`,
    `  - patience (convergence): ${b.patience} génération(s) sans gain`,
    '',
    '⚠️  Approuver lance une BOUCLE AUTONOME qui exécute du code GÉNÉRÉ dans un bac à sable isolé,',
    '    sur plusieurs générations, SANS nouvelle question par génération. Le réseau n\'est PAS coupé',
    '    en mode isolate — utilisez --sandbox docker pour couper le réseau sortant. Une seconde gate',
    '    vous demandera d\'approuver le MEILLEUR résultat avant toute publication.',
  ].join('\n');
}

function buildLoopPublishGateBody(
  best: ExperimentVariantRecord,
  report: ScienceReport,
  review: ReviewVerdict,
  acc: LoopBudgetAccounting,
): string {
  return [
    `Meilleur variant : score ${best.score.toFixed(3)} (${best.metric.name}=${best.metric.value ?? 'n/a'})`,
    `Hypothèse : ${best.hypothesis}`,
    `Boucle : ${acc.generationsRun} génération(s), ${acc.experimentsRun} expérience(s), ${Math.round(acc.wallClockMs / 1000)}s`,
    '',
    `Revue indépendante : ${review.verdict}`,
    `  ${truncate(review.evidence, 400)}`,
    '',
    'Rapport (extrait) :',
    truncate(report.report, 1200),
    '',
    '⚠️  Approuver INGÈRE le rapport du MEILLEUR variant dans le graphe de connaissances collectif.',
  ].join('\n');
}

// ============================================================================
// Small helpers
// ============================================================================

function accounting(
  b: ResolvedBudget,
  generationsRun: number,
  experimentsRun: number,
  wallClockMs: number,
  costSpent: number,
): LoopBudgetAccounting {
  return {
    maxGenerations: b.maxGenerations,
    maxExperiments: b.maxExperiments,
    maxWallClockMs: b.maxWallClockMs,
    maxCost: b.maxCost,
    parallelism: b.parallelism,
    patience: b.patience,
    generationsRun,
    experimentsRun,
    wallClockMs,
    costSpent,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(text: string, max: number): string {
  const t = typeof text === 'string' ? text : String(text);
  return t.length <= max ? t : `${t.slice(0, max)}… [tronqué]`;
}
