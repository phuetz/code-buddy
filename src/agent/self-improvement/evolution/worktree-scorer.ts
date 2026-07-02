/**
 * Worktree scorer (Phase B): materialize a git BRANCH in an isolated worktree, score it with the
 * variant-fitness harness, then tear the worktree down. This is how a candidate variant is
 * evaluated without touching the working tree or `main`.
 *
 * node_modules is symlinked from the base repo (git worktrees don't copy gitignored deps), which is
 * correct as long as the variant didn't change dependencies (the common case; a deps change is a
 * rare edge handled by a real install — flagged, not silently wrong). Disk is preflighted via the
 * disk-guard. The worktree is always cleaned up (finally), the branch is kept as the artifact.
 *
 * @module agent/self-improvement/evolution/worktree-scorer
 */

import { existsSync, symlinkSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import { WorktreeSessionManager } from '../../../git/worktree-sessions.js';
import { ensureFreeSpace } from '../../../utils/disk-guard.js';
import {
  computeFitness,
  defaultDeterministicComponents,
  type FitnessComponent,
  type FitnessContext,
  type FitnessReport,
} from './variant-fitness.js';
import { assertNoProtectedChanges, resetProtectedToBaseline } from './protected-paths.js';
import { scrubbedEnv } from './scrub-env.js';

export interface ScoreBranchOptions {
  /** Repo root that owns the worktree. Default: process.cwd(). */
  basePath?: string;
  components?: FitnessComponent[];
  /** Baseline report to flag regressions against. */
  baseline?: FitnessReport;
  timeoutMs?: number;
  /** Env for the fitness subprocesses. If unset, a SCRUBBED env (no secrets) is used by default. */
  env?: NodeJS.ProcessEnv;
  /** Symlink node_modules from base into the worktree (default true). */
  linkNodeModules?: boolean;
  /**
   * Baseline ref (e.g. 'main'). When set: a branch that touches a PROTECTED path is rejected
   * unscored (anti-self-weakening), and protected paths are reset to this ref in the worktree
   * before scoring (defense-in-depth).
   */
  baselineRef?: string;
  /** Use a secret-scrubbed env by default (true). Set false (or pass env) when eval-tasks need keys. */
  scrubEnv?: boolean;
}

export interface ScoreBranchResult {
  branch: string;
  worktreePath: string;
  report: FitnessReport;
}

/**
 * Score a branch in an isolated worktree. The branch must NOT be the one currently checked out in
 * `basePath` (git refuses to add a worktree for an already-checked-out branch). Never throws on
 * cleanup; throws only if the worktree cannot be created.
 */
export async function scoreBranchInWorktree(branch: string, opts: ScoreBranchOptions = {}): Promise<ScoreBranchResult> {
  const basePath = opts.basePath ?? process.cwd();
  const components = opts.components ?? defaultDeterministicComponents();

  // Anti-self-weakening: reject a variant that changes any protected path (gates/benchmarks/
  // held-out/harness) BEFORE building or scoring it. The core Phase-C guard.
  if (opts.baselineRef) {
    const check = assertNoProtectedChanges(branch, opts.baselineRef, basePath);
    if (!check.ok) {
      return {
        branch,
        worktreePath: '',
        report: {
          score: 0,
          passedAll: false,
          regressions: [],
          components: [
            {
              name: 'protected-violation',
              weight: 1,
              score: 0,
              passed: false,
              detail: `variant changes protected paths: ${check.violations.join(', ')}`,
            },
          ],
        },
      };
    }
  }

  // Preflight disk so a build/test loop can't fill the disk (disk-guard; throws if too low).
  ensureFreeSpace(basePath, undefined, { label: 'evolve worktree' });

  const mgr = WorktreeSessionManager.getInstance();
  const session = mgr.createWorktreeSession(branch, basePath);
  // Default scoring env: secrets stripped AND HOME redirected into the
  // worktree so the variant's own code (which runs under `npx vitest`) cannot
  // read `~/.codebuddy/*.json` credential files and exfiltrate them.
  const env =
    opts.env ?? (opts.scrubEnv === false ? process.env : scrubbedEnv(process.env, { homeDir: session.worktreePath }));
  try {
    if (opts.linkNodeModules !== false) {
      linkNodeModules(basePath, session.worktreePath);
    }
    // Defense-in-depth: even if detection missed something, restore protected paths to baseline.
    if (opts.baselineRef) {
      resetProtectedToBaseline(session.worktreePath, opts.baselineRef);
    }
    const ctx: FitnessContext = {
      checkoutDir: session.worktreePath,
      env,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    };
    const report = await computeFitness(ctx, components, opts.baseline);
    return { branch, worktreePath: session.worktreePath, report };
  } finally {
    try {
      mgr.cleanupWorktree(branch);
    } catch (err) {
      logger.warn(`[evolve] worktree cleanup failed for ${branch}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function linkNodeModules(basePath: string, worktreePath: string): void {
  const src = join(basePath, 'node_modules');
  const dest = join(worktreePath, 'node_modules');
  if (!existsSync(src) || existsSync(dest)) return;
  try {
    symlinkSync(src, dest, 'dir');
  } catch (err) {
    logger.warn(`[evolve] node_modules symlink failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
