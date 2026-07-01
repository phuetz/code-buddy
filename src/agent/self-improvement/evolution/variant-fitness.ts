/**
 * Variant fitness harness (Phase A of git-versioned evolutionary self-improvement).
 *
 * Computes a single numeric fitness in [0,1] for a CHECKOUT of Code Buddy (a directory — the main
 * repo for the baseline, a git worktree for a candidate variant). Fitness is a weighted blend of
 * independent COMPONENTS, each producing a 0..1 score + pass/fail:
 *   - deterministic components (typecheck, targeted unit tests, capability benchmark) → a stable,
 *     reproducible baseline;
 *   - stochastic components (eval task pass-rate via `eval/run-task.mjs`, which spawn the real CLI
 *     and make LLM calls) → opt-in, weighted, used when willing to pay.
 *
 * The aggregation + regression logic is pure and unit-tested; the real components shell out.
 * NOTHING here merges or mutates the repo — it only SCORES a checkout. Keep/merge stays human-gated.
 *
 * @module agent/self-improvement/evolution/variant-fitness
 */

import { spawn } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface FitnessContext {
  /** Directory to score (repo root or a worktree). Must contain node_modules + dist for slow components. */
  checkoutDir: string;
  /** Per-process timeout for a component's subprocess. */
  timeoutMs?: number;
  /** Env for subprocesses. Callers may pass a SCRUBBED env (no host secrets) for untrusted variants. */
  env?: NodeJS.ProcessEnv;
}

export interface ComponentResult {
  name: string;
  weight: number;
  /** 0..1. */
  score: number;
  passed: boolean;
  detail: string;
  metrics?: Record<string, number>;
}

export interface FitnessComponent {
  name: string;
  weight: number;
  /** Deterministic components give a reproducible baseline; stochastic ones (LLM evals) do not. */
  deterministic: boolean;
  run(ctx: FitnessContext): Promise<ComponentResult>;
}

export interface FitnessReport {
  /** Weighted aggregate in [0,1]. */
  score: number;
  passedAll: boolean;
  components: ComponentResult[];
  /** Component names that regressed vs a baseline (score dropped or pass→fail). */
  regressions: string[];
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run a subprocess in the checkout, capped output + timeout. Never throws (resolves with code). */
export function runProc(
  cmd: string,
  args: string[],
  ctx: FitnessContext,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const MAX = 1_000_000;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd: ctx.checkoutDir, env: ctx.env ?? process.env });
    } catch (err) {
      resolve({ code: 1, stdout: '', stderr: msg(err), timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, 1000);
      } catch {
        /* ignore */
      }
    }, ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout?.on('data', (d) => {
      if (stdout.length < MAX) stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      if (stderr.length < MAX) stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr + msg(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

function lastLines(s: string, n = 8): string {
  return s.trim().split('\n').slice(-n).join('\n');
}

/** Parse vitest summary lines: "Tests  3 passed (3)" / "Tests  2 failed | 5 passed (7)". */
export function parseVitestCounts(out: string): { passed: number; failed: number } {
  const passed = /(\d+)\s+passed/.exec(out);
  const failed = /(\d+)\s+failed/.exec(out);
  return { passed: passed ? Number(passed[1]) : 0, failed: failed ? Number(failed[1]) : 0 };
}

export function listEvalTasks(checkoutDir: string): string[] {
  const dir = join(checkoutDir, 'eval', 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((t) => {
    try {
      return statSync(join(dir, t)).isDirectory();
    } catch {
      return false;
    }
  });
}

// ---- Built-in components -------------------------------------------------------------------

/** TypeScript typecheck: `tsc --noEmit`. Deterministic, the cheapest correctness signal. */
export function typecheckComponent(weight = 3): FitnessComponent {
  return {
    name: 'typecheck',
    weight,
    deterministic: true,
    async run(ctx) {
      const r = await runProc('npx', ['tsc', '--noEmit'], ctx);
      const passed = r.code === 0 && !r.timedOut;
      return {
        name: 'typecheck',
        weight,
        score: passed ? 1 : 0,
        passed,
        detail: passed ? 'tsc --noEmit clean' : lastLines(r.stdout + r.stderr),
      };
    },
  };
}

/** Targeted unit tests: `vitest run <patterns>`. Deterministic; score = passed/(passed+failed). */
export function unitTestsComponent(patterns: string[], weight = 4): FitnessComponent {
  return {
    name: 'unit-tests',
    weight,
    deterministic: true,
    async run(ctx) {
      const r = await runProc('npx', ['vitest', 'run', ...patterns], ctx);
      const { passed, failed } = parseVitestCounts(r.stdout + r.stderr);
      const total = passed + failed;
      const score = total > 0 ? passed / total : r.code === 0 ? 1 : 0;
      return {
        name: 'unit-tests',
        weight,
        score,
        passed: failed === 0 && r.code === 0 && !r.timedOut,
        detail: total > 0 ? `${passed} passed / ${failed} failed` : lastLines(r.stdout + r.stderr, 4),
        metrics: { passed, failed },
      };
    },
  };
}

/**
 * Whole-agent eval task pass-rate via `eval/run-task.mjs` (spawns the real CLI per task).
 * STOCHASTIC (LLM calls) — opt-in. Requires the checkout to be built (dist/index.js).
 */
export function evalTasksComponent(tasks?: string[], weight = 5): FitnessComponent {
  return {
    name: 'eval-tasks',
    weight,
    deterministic: false,
    async run(ctx) {
      const all = tasks ?? listEvalTasks(ctx.checkoutDir);
      if (all.length === 0) {
        return { name: 'eval-tasks', weight, score: 0, passed: false, detail: 'no eval tasks found' };
      }
      let pass = 0;
      for (const t of all) {
        const r = await runProc(process.execPath, ['eval/run-task.mjs', t], ctx);
        if (r.code === 0 && !r.timedOut) pass++;
      }
      return {
        name: 'eval-tasks',
        weight,
        score: pass / all.length,
        passed: pass === all.length,
        detail: `${pass}/${all.length} eval tasks passed`,
        metrics: { passed: pass, total: all.length },
      };
    },
  };
}

/** Default deterministic set → a fast, reproducible baseline (no LLM, no build). */
export function defaultDeterministicComponents(): FitnessComponent[] {
  return [typecheckComponent(), unitTestsComponent(['tests/agent/self-improvement'])];
}

// ---- Aggregation (pure, unit-tested) ------------------------------------------------------

export function detectRegressions(baseline: FitnessReport, current: ComponentResult[], eps = 1e-9): string[] {
  const byName = new Map(baseline.components.map((c) => [c.name, c]));
  const out: string[] = [];
  for (const r of current) {
    const b = byName.get(r.name);
    if (!b) continue;
    if (r.score < b.score - eps || (b.passed && !r.passed)) out.push(r.name);
  }
  return out;
}

/** Run components, aggregate to a weighted [0,1] fitness, flag regressions vs an optional baseline. */
export async function computeFitness(
  ctx: FitnessContext,
  components: FitnessComponent[],
  baseline?: FitnessReport,
): Promise<FitnessReport> {
  const results: ComponentResult[] = [];
  for (const c of components) {
    try {
      results.push(await c.run(ctx));
    } catch (err) {
      results.push({ name: c.name, weight: c.weight, score: 0, passed: false, detail: `error: ${msg(err)}` });
    }
  }
  const totalWeight = results.reduce((s, r) => s + r.weight, 0) || 1;
  const score = results.reduce((s, r) => s + r.weight * r.score, 0) / totalWeight;
  const passedAll = results.length > 0 && results.every((r) => r.passed);
  const regressions = baseline ? detectRegressions(baseline, results) : [];
  return { score, passedAll, components: results, regressions };
}
