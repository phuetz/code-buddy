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
import { CodeVariantStore, type VariantRecord } from './code-variant-store.js';
import type { FitnessComponent, FitnessReport } from './variant-fitness.js';

export interface Weakness {
  id: string;
  /** Human-readable goal handed to the mutator ("fix eval task X", "reduce coupling in Y"). */
  goal: string;
  kind: 'eval-failure' | 'hotspot' | 'manual';
}

export interface MutateArgs {
  branch: string;
  weakness: Weakness;
  /** Isolated worktree the mutator must edit (cwd). */
  worktreeDir: string;
  env: NodeJS.ProcessEnv;
}

/** Produces a code change in the worktree toward the weakness. Returns whether it changed anything. */
export type Mutator = (args: MutateArgs) => Promise<{ changed: boolean; detail?: string }>;

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

/** Run one mutation→evaluate→record cycle. Never merges; prunes losing branches by default. */
export async function runEvolutionCycle(opts: EvolutionCycleOptions): Promise<EvolutionCycleResult> {
  const basePath = opts.basePath ?? process.cwd();
  const variantId = opts.variantId ?? `evo-${Date.now().toString(36)}`;
  const branch = `codebuddy/evolve/${variantId}`;
  const env = opts.env ?? process.env;

  // 1. branch off baseline.
  git(['branch', '-f', branch, opts.baselineRef], basePath);

  // 2-3. mutate in an isolated worktree, then commit the change on the branch.
  let mutated = false;
  const mgr = WorktreeSessionManager.getInstance();
  const session = mgr.createWorktreeSession(branch, basePath);
  try {
    const res = await opts.mutate({ branch, weakness: opts.weakness, worktreeDir: session.worktreePath, env });
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
  const record: VariantRecord = {
    id: variantId,
    branch,
    sha,
    score: report.score,
    passedAll: report.passedAll,
    regressions: report.regressions,
    createdAt: new Date().toISOString(),
    detail: `${opts.weakness.kind}: ${opts.weakness.goal}`,
  };
  (opts.store ?? new CodeVariantStore()).record(record);

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
  return async ({ weakness, worktreeDir, env }) => {
    const cli = process.argv[1];
    if (!cli) return { changed: false, detail: 'no CLI entrypoint' };
    const args = [
      cli,
      '--prompt',
      `You are improving Code Buddy's own source. Goal: ${weakness.goal}. Make the smallest correct code change. Do NOT modify tests, benchmarks, gates, or the eval harness.`,
      '--directory',
      worktreeDir,
    ];
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
    return { changed: true, detail: 'agent run complete (changes detected by git)' };
  };
}
