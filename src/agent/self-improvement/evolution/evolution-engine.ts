/**
 * Evolution engine (Phase D): the mutation→evaluate→record loop. One cycle:
 *   1. branch `codebuddy/evolve/<id>` off the baseline ref;
 *   2. MUTATE it — an injected mutator (default: a headless agent subprocess) edits code toward a
 *      weakness (a failing eval task / a self-model hotspot / a manual goal), in an isolated worktree;
 *   3. commit the change on the branch;
 *   4. SCORE it via scoreBranchInWorktree — which first rejects any protected-path tampering (Phase C)
 *      then computes fitness (Phase A) in an isolated worktree (Phase B);
 *   5. RECORD it in the CodeVariantStore + EvolutionaryArchive, ranked vs the baseline.
 *
 * The engine NEVER merges to main and NEVER auto-applies — it only produces evaluated candidate
 * branches for human review (Phase E). Losing branches are pruned unless keepLosers is set.
 *
 * @module agent/self-improvement/evolution/evolution-engine
 */

import { execFileSync, spawn } from 'child_process';
import { logger } from '../../../utils/logger.js';
import { scoreBranchInWorktree } from './worktree-scorer.js';
import { WorktreeSessionManager } from '../../../git/worktree-sessions.js';
import { CodeVariantStore, behaviorDescriptor, diverseElites, computeGeneration, type VariantRecord } from './code-variant-store.js';
import { makeLlmVariantPlanner, renderVariantPlan, type VariantPlan, type VariantPlanner } from './variant-planner.js';
import { changedPathsVsBase } from './protected-paths.js';
import type { FitnessComponent, FitnessReport } from './variant-fitness.js';
import { pickModelUCB, type BanditScoreboard } from './model-bandit.js';
import type { LlmCandidate } from '../../../fleet/model-selector.js';
import type { ModelScoreboard } from '../../../fleet/model-scoreboard.js';

export interface Weakness {
  id: string;
  /** Human-readable goal handed to the mutator ("fix eval task X", "reduce coupling in Y"). */
  goal: string;
  kind: 'eval-failure' | 'hotspot' | 'manual' | 'research';
}

/** A prior high-scoring variant shown to the mutator as context (AlphaEvolve "inspirations"). */
export interface Inspiration {
  id: string;
  goal: string;
  score: number;
  /** Truncated diff vs baseline — the actual code change to build on or diverge from. */
  diff: string;
}

export interface MutateArgs {
  branch: string;
  weakness: Weakness;
  /** Isolated worktree the mutator must edit (cwd). */
  worktreeDir: string;
  env: NodeJS.ProcessEnv;
  /** Prior elite variants for context (may be empty). */
  inspirations: Inspiration[];
  /** The deliberate plan for this variant (from the planner). Absent → mutator uses its ad-hoc prompt. */
  plan?: VariantPlan;
  /**
   * Model id chosen by the cost-aware UCB bandit (opt-in). Absent → the mutator uses its own static
   * model (byte-identical to the pre-bandit behavior). `agentMutator` prefers this over its closure.
   */
  model?: string;
}

/** Produces a code change in the worktree toward the weakness. Returns whether it changed anything. */
export type Mutator = (args: MutateArgs) => Promise<{ changed: boolean; detail?: string; plan?: string }>;

/**
 * Opt-in cost-aware UCB model selection for the mutator (Sakana ShinkaEvolve sample-efficiency).
 * All fields are injectable so the wiring is testable without a network; every field is optional and
 * the whole feature is OFF unless `useModelBandit` is set — the static-model path stays byte-identical.
 */
export interface ModelBanditWiring {
  /**
   * Turn the bandit ON. Default off → the mutator keeps its static model, the scoreboard is never
   * read, no bandit `recordOutcome` fires, and the `MutateArgs` are byte-identical to before.
   */
  useModelBandit?: boolean;
  /** Inject the selector (tests). Receives candidates + scoreboard, returns the chosen model id. Default: `pickModelUCB`. */
  modelSelector?: (candidates: readonly LlmCandidate[], scoreboard: BanditScoreboard) => string | undefined;
  /** Inject the candidate catalog (tests / avoid the network). Default: built from the active-LLM registry. */
  banditCandidates?: LlmCandidate[];
  /** Inject the scoreboard (tests). Default: the `getModelScoreboard()` singleton. */
  scoreboard?: ModelScoreboard;
}

export interface EvolutionCycleOptions extends ModelBanditWiring {
  baselineRef: string;
  weakness: Weakness;
  mutate: Mutator;
  /** Injected clock (default `Date.now`) for the bandit's outcome timestamp + mutation latency. */
  now?: () => number;
  basePath?: string;
  components?: FitnessComponent[];
  /** Baseline fitness to rank against (regressions + beats-baseline). */
  baseline?: FitnessReport;
  store?: CodeVariantStore;
  /** Deterministic id (tests); else derived. */
  variantId?: string;
  /** Env handed to the MUTATOR (real env — the agent needs a provider key). Scoring scrubs its own. */
  env?: NodeJS.ProcessEnv;
  /** Keep branches that don't beat the baseline (default false → prune). */
  keepLosers?: boolean;
  /** How many prior elite variants to show the mutator as inspirations (default 2; 0 disables). */
  inspirationCount?: number;
  /**
   * Compounding: branch the candidate off THIS ref (a prior elite's branch/sha) instead of the
   * baseline, so generations build on each other's code — not just via inspiration. Guarded: if the
   * ref is unreachable (elite pruned), falls back to `baselineRef`. Fitness is still measured vs the
   * true baseline (`baseline`), so the score reflects NET progress.
   */
  compoundFrom?: string;
  /** Plans the variant before mutating (default: LLM planner). null result → mutator's ad-hoc prompt. */
  planner?: VariantPlanner;
}

export interface EvolutionCycleResult {
  variantId: string;
  branch: string;
  mutated: boolean;
  report: FitnessReport;
  beatsBaseline: boolean;
  kept: boolean;
}

/** Pure decision: a candidate "wins" if it passed everything, regressed nothing, and beats baseline. */
export function beatsBaseline(report: FitnessReport, baseline?: FitnessReport): boolean {
  if (!report.passedAll || report.regressions.length > 0) return false;
  if (baseline) return report.score > baseline.score;
  return true;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** True if a ref/sha resolves to a reachable commit (used to guard compounding off a maybe-pruned elite). */
function isReachableRef(ref: string, cwd: string): boolean {
  try {
    git(['rev-parse', '--verify', '-q', `${ref}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

/** Pure: pick the branch base — the compounding elite when reachable, else the baseline. */
export function chooseBranchBase(
  baselineRef: string,
  compoundFrom: string | undefined,
  isReachable: (ref: string) => boolean,
): string {
  return compoundFrom && isReachable(compoundFrom) ? compoundFrom : baselineRef;
}

const MAX_INSPIRATION_DIFF = 4000;

/** Top-k passing, above-baseline variants (with truncated diffs) to seed the mutator's prompt. */
export function gatherInspirations(
  store: CodeVariantStore,
  baseRef: string,
  basePath: string,
  k: number,
  baselineScore?: number,
): Inspiration[] {
  if (k <= 0) return [];
  // MAP-Elites: one elite per behavior niche → diverse inspirations, not k clones of one lineage.
  const elites = diverseElites(store.list(), k, baselineScore);
  return elites.map((v) => {
    let diff = '';
    try {
      diff = git(['diff', `${baseRef}...${v.branch}`], basePath);
    } catch {
      /* branch may have been pruned/merged — goal + score still inspire */
    }
    if (diff.length > MAX_INSPIRATION_DIFF) diff = `${diff.slice(0, MAX_INSPIRATION_DIFF)}\n…(truncated)`;
    return { id: v.id, goal: v.detail ?? '', score: v.score, diff };
  });
}

/** The bandit's pick for one cycle: the model + its provider + the scoreboard to record the outcome to. */
export interface BanditChoice {
  model: string;
  provider: string;
  scoreboard: ModelScoreboard;
}

/**
 * Default bandit catalog: the cloud/subscription LLMs the user is authenticated to, with their
 * nominal input $/Mtok (the cost signal the bandit trades against quality). Reuses the public
 * `buildActiveLlmRegistry` — the SAME source the fleet model-selector uses — rather than duplicating
 * detection. Never-throws → an empty catalog on any failure, and the caller falls back to the static
 * model. Local models are included when the registry surfaces them (they cost $0 → no cost penalty).
 */
async function listBanditCandidates(env: NodeJS.ProcessEnv): Promise<LlmCandidate[]> {
  try {
    const { buildActiveLlmRegistry } = await import('../../../providers/active-llm-registry.js');
    const reg = await buildActiveLlmRegistry({ env });
    const out: LlmCandidate[] = [];
    const seen = new Set<string>();
    for (const c of reg.all) {
      if (!c.model) continue;
      const key = c.model.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        provider: c.provider,
        model: c.model,
        ...(c.apiKey ? { apiKey: c.apiKey } : {}),
        ...(c.baseURL ? { baseURL: c.baseURL } : {}),
        isLocal: c.isLocal,
        costInputUsdPerMtok: c.costInputUsdPerMtok,
        strengths: [], // the bandit ranks on scoreboard win-rate + cost, not capability strengths
      });
    }
    return out;
  } catch (err) {
    logger.debug?.(`[evolve] bandit candidate probe skipped: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Decide the mutator's model via the cost-aware UCB bandit. Returns `null` when the bandit is OFF
 * (the common case → static model, byte-identical path) OR when nothing could be chosen (empty
 * catalog / error). NEVER throws: a bandit failure must never fail an evolution cycle.
 */
export async function resolveBanditModel(
  opts: ModelBanditWiring,
  env: NodeJS.ProcessEnv,
): Promise<BanditChoice | null> {
  if (!opts.useModelBandit) return null;
  try {
    const scoreboard =
      opts.scoreboard ?? (await import('../../../fleet/model-scoreboard.js')).getModelScoreboard();
    const candidates = opts.banditCandidates ?? (await listBanditCandidates(env));
    if (candidates.length === 0) return null;
    const select =
      opts.modelSelector ?? ((cands, sb) => pickModelUCB(cands, sb, { taskType: 'evolve' }));
    const chosen = select(candidates, scoreboard);
    if (!chosen) return null;
    const cand = candidates.find((c) => c.model === chosen);
    return { model: chosen, provider: cand?.provider ?? 'unknown', scoreboard };
  } catch (err) {
    logger.warn(
      `[evolve] model bandit selection failed, using static model: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Close the bandit loop: feed this cycle's outcome back to the scoreboard so the NEXT selection's
 * `smoothedWinRate` reflects it (`taskType: 'evolve'`). NEVER throws. `costUsd` is not metered in the
 * evolution loop (no per-run token accounting) — the bandit's cost signal is the catalog $/Mtok read
 * at selection time — so the marginal $ recorded here is 0 unless the caller supplies one.
 */
export function recordBanditOutcome(
  choice: BanditChoice,
  outcome: { won: boolean; quality: number; latencyMs: number; costUsd?: number; at: string },
): void {
  try {
    choice.scoreboard.recordOutcome({
      at: outcome.at,
      taskType: 'evolve',
      model: choice.model,
      provider: choice.provider,
      won: outcome.won,
      quality: outcome.quality,
      costUsd: outcome.costUsd ?? 0,
      latencyMs: outcome.latencyMs,
    });
  } catch (err) {
    logger.warn(`[evolve] bandit recordOutcome failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Run one mutation→evaluate→record cycle. Never merges; prunes losing branches by default. */
export async function runEvolutionCycle(opts: EvolutionCycleOptions): Promise<EvolutionCycleResult> {
  const basePath = opts.basePath ?? process.cwd();
  const variantId = opts.variantId ?? `evo-${Date.now().toString(36)}`;
  const branch = `codebuddy/evolve/${variantId}`;
  const env = opts.env ?? process.env;
  const store = opts.store ?? new CodeVariantStore();
  const now = opts.now ?? Date.now;

  // Cost-aware UCB model selection (opt-in). Off → null: the mutator keeps its static model, the
  // scoreboard is untouched, and the mutate args below are byte-identical to the pre-bandit path.
  const banditChoice = await resolveBanditModel(opts, env);
  let mutationLatencyMs = 0;

  // AlphaEvolve-style inspirations: show the mutator prior elite variants (built before this branch).
  const inspirations = gatherInspirations(
    store,
    opts.baselineRef,
    basePath,
    opts.inspirationCount ?? 2,
    opts.baseline?.score,
  );

  // Deliberate planning: decide the approach (build-on / diverge / fresh) + concrete steps BEFORE
  // touching code. Never-throws → null falls back to the mutator's legacy ad-hoc prompt.
  const plan: VariantPlan | null = await (opts.planner ?? makeLlmVariantPlanner())({ weakness: opts.weakness, inspirations });

  // 1. branch off the baseline — OR off a prior elite when compounding (guarded: fall back to
  //    baseline if that elite ref is unreachable, e.g. it was pruned).
  const branchBase = chooseBranchBase(opts.baselineRef, opts.compoundFrom, (r) => isReachableRef(r, basePath));
  git(['branch', '-f', branch, branchBase], basePath);

  // 2-3. mutate in an isolated worktree, then commit the change on the branch.
  let mutated = false;
  let mutationPlan: string | undefined; // the instruction that produced this variant (for audit)
  const mgr = WorktreeSessionManager.getInstance();
  const session = mgr.createWorktreeSession(branch, basePath);
  try {
    const mutateStartedAt = banditChoice ? now() : 0;
    const res = await opts.mutate({
      branch,
      weakness: opts.weakness,
      worktreeDir: session.worktreePath,
      env,
      inspirations,
      ...(plan ? { plan } : {}),
      ...(banditChoice ? { model: banditChoice.model } : {}),
    });
    if (banditChoice) mutationLatencyMs = Math.max(0, now() - mutateStartedAt);
    // Store the deliberate plan when we have one (audit); else the mutator's own record.
    mutationPlan = plan ? renderVariantPlan(plan) : res.plan;
    git(['add', '-A'], session.worktreePath);
    const dirty = git(['status', '--porcelain'], session.worktreePath).trim().length > 0;
    if (dirty) {
      execFileSync(
        'git',
        ['-c', 'user.name=Code Buddy Evolve', '-c', 'user.email=evolve@codebuddy', '-c', 'commit.gpgsign=false',
         'commit', '-q', '-m', `evolve(${opts.weakness.id}): ${opts.weakness.goal}`],
        { cwd: session.worktreePath, stdio: ['ignore', 'ignore', 'ignore'] },
      );
      mutated = true;
    }
    if (!mutated) logger.info(`[evolve] mutator produced no change for ${branch}${res.detail ? ` (${res.detail})` : ''}`);
  } finally {
    try {
      mgr.cleanupWorktree(branch);
    } catch {
      /* ignore */
    }
  }

  // 4. score (Phase C reject + Phase A/B fitness in an isolated worktree).
  const scored = await scoreBranchInWorktree(branch, {
    basePath,
    baselineRef: opts.baselineRef,
    ...(opts.components ? { components: opts.components } : {}),
    ...(opts.baseline ? { baseline: opts.baseline } : {}),
  });
  const report = scored.report;
  const wins = mutated && beatsBaseline(report, opts.baseline);

  // Close the bandit loop: record this model's outcome so the next selection learns from it.
  if (banditChoice) {
    recordBanditOutcome(banditChoice, {
      won: wins,
      quality: report.score,
      latencyMs: mutationLatencyMs,
      at: new Date(now()).toISOString(),
    });
  }

  // 5. record + prune.
  const sha = (() => {
    try {
      return git(['rev-parse', branch], basePath).trim();
    } catch {
      return '';
    }
  })();
  // Genealogy: the elites that inspired this variant are its parents; generation = 1 + max(parent gen).
  const parents = inspirations.map((i) => i.id);
  const record: VariantRecord = {
    id: variantId,
    branch,
    sha,
    score: report.score,
    passedAll: report.passedAll,
    regressions: report.regressions,
    createdAt: new Date().toISOString(),
    detail: `${opts.weakness.kind}: ${opts.weakness.goal}`,
    ...(mutationPlan ? { plan: mutationPlan } : {}),
    behavior: behaviorDescriptor(changedPathsVsBase(branch, opts.baselineRef, basePath)),
    parents,
    generation: computeGeneration(parents, store.list()),
  };
  store.record(record);

  let kept = true;
  if (!wins && !opts.keepLosers) {
    try {
      git(['branch', '-D', branch], basePath);
      kept = false;
    } catch {
      /* keep on failure */
    }
  }

  return { variantId, branch, mutated, report, beatsBaseline: wins, kept };
}

/**
 * Default mutator: a headless Code Buddy agent run in the worktree, edited toward the goal.
 * Uses the REAL env (the mutator needs a provider key); scoring later runs with a scrubbed env.
 * Integration-grade (LLM calls) — the engine accepts any Mutator so tests inject a deterministic one.
 */
export function agentMutator(opts: { timeoutMs?: number; model?: string } = {}): Mutator {
  return async ({ weakness, worktreeDir, env, inspirations, plan, model }) => {
    const cli = process.argv[1];
    if (!cli) return { changed: false, detail: 'no CLI entrypoint' };
    // Guardrail is constant; the body is EITHER the deliberate plan (execute it) OR — when no plan
    // was produced (no provider) — the legacy ad-hoc goal+inspirations prompt.
    const guardrail = `You are improving Code Buddy's own source. Make the smallest correct code change. Do NOT modify tests, benchmarks, gates, or the eval harness.`;
    let prompt: string;
    if (plan) {
      prompt = `${guardrail}\n\nFollow this plan for "${weakness.goal}":\n${renderVariantPlan(plan)}`;
    } else {
      prompt = `${guardrail} Goal: ${weakness.goal}.`;
      if (inspirations.length > 0) {
        prompt +=
          '\n\nPrior high-scoring approaches (build on the best ideas OR try a genuinely different angle — do not just copy):\n' +
          inspirations
            .map((i) => `--- [fitness ${i.score.toFixed(3)}] ${i.goal}\n${i.diff || '(diff unavailable)'}`)
            .join('\n');
      }
    }
    const mutationPlan = prompt; // capture the exact instruction that drove this generation
    const args = [cli, '--prompt', prompt, '--directory', worktreeDir];
    // Prefer the bandit's per-cycle pick (MutateArgs.model) over the closure's static model; either
    // absent → no `--model` (byte-identical to the pre-bandit path).
    const chosenModel = model ?? opts.model;
    if (chosenModel) args.push('--model', chosenModel);
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, args, {
        cwd: worktreeDir,
        env: { ...env, CODEBUDDY_AUTO_CONFIRM: 'true' },
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      const timer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }, opts.timeoutMs ?? 10 * 60 * 1000);
      child.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return { changed: true, detail: 'agent run complete (changes detected by git)', plan: mutationPlan };
  };
}

export interface EvolutionRoundOptions extends Omit<EvolutionCycleOptions, 'variantId'> {
  /** Number of candidate variants to evaluate this round. */
  rounds: number;
  /** Max candidates evaluated concurrently (heavy build/test/LLM steps overlap; default 2). */
  concurrency?: number;
  /** Prefix for the candidate ids. */
  idPrefix?: string;
}

/**
 * Fan out N candidates for the same weakness and evaluate them concurrently (each in its own
 * worktree). The expensive steps (agent mutation + build/test) overlap; cheap git ops serialize.
 * Returns results ranked by fitness (best first). Diversity comes from LLM stochasticity + shared
 * inspirations — a step toward AlphaEvolve's population, without its full island model.
 */
export async function runEvolutionRound(opts: EvolutionRoundOptions): Promise<EvolutionCycleResult[]> {
  const { rounds, concurrency = 2, idPrefix = `evo-${Date.now().toString(36)}`, ...cycleOpts } = opts;
  const ids = Array.from({ length: Math.max(1, rounds) }, (_, i) => `${idPrefix}-${i + 1}`);
  const results: EvolutionCycleResult[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= ids.length) return;
      try {
        results.push(await runEvolutionCycle({ ...cycleOpts, variantId: ids[i] as string }));
      } catch (err) {
        logger.warn(`[evolve] candidate ${ids[i]} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  const pool = Array.from({ length: Math.min(Math.max(1, concurrency), ids.length) }, () => worker());
  await Promise.all(pool);
  return results.sort((a, b) => b.report.score - a.report.score);
}
