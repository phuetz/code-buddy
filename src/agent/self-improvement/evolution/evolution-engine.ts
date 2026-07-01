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

export interface Weakness {
  id: string;
  /** Human-readable goal handed to the mutator ("fix eval task X", "reduce coupling in Y"). */
  goal: string;
  kind: 'eval-failure' | 'hotspot' | 'manual';
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
}

/** Produces a code change in the worktree toward the weakness. Returns whether it changed anything. */
export type Mutator = (args: MutateArgs) => Promise<{ changed: boolean; detail?: string; plan?: string }>;

export interface EvolutionCycleOptions {
  baselineRef: string;
  weakness: Weakness;
  mutate: Mutator;
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

/** Run one mutation→evaluate→record cycle. Never merges; prunes losing branches by default. */
export async function runEvolutionCycle(opts: EvolutionCycleOptions): Promise<EvolutionCycleResult> {
  const basePath = opts.basePath ?? process.cwd();
  const variantId = opts.variantId ?? `evo-${Date.now().toString(36)}`;
  const branch = `codebuddy/evolve/${variantId}`;
  const env = opts.env ?? process.env;
  const store = opts.store ?? new CodeVariantStore();

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

  // 1. branch off baseline.
  git(['branch', '-f', branch, opts.baselineRef], basePath);

  // 2-3. mutate in an isolated worktree, then commit the change on the branch.
  let mutated = false;
  let mutationPlan: string | undefined; // the instruction that produced this variant (for audit)
  const mgr = WorktreeSessionManager.getInstance();
  const session = mgr.createWorktreeSession(branch, basePath);
  try {
    const res = await opts.mutate({
      branch,
      weakness: opts.weakness,
      worktreeDir: session.worktreePath,
      env,
      inspirations,
      ...(plan ? { plan } : {}),
    });
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
  return async ({ weakness, worktreeDir, env, inspirations, plan }) => {
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
    if (opts.model) args.push('--model', opts.model);
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
