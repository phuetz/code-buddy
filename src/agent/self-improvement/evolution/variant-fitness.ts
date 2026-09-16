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

import { spawn, execFile } from 'child_process';
import { existsSync, readdirSync, statSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export interface FitnessContext {
  /** Directory to score (repo root or a worktree). Must contain node_modules + dist for slow components. */
  checkoutDir: string;
  /** Per-process timeout for a component's subprocess. */
  timeoutMs?: number;
  /** Cancel the subprocess and its process group. */
  signal?: AbortSignal;
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

/** Execute checkout-owned JavaScript CLIs directly, preserving argv on every OS. */
export function runCheckoutCli(modulePath: string, args: string[], ctx: FitnessContext) {
  try {
    const require = createRequire(resolve(ctx.checkoutDir, 'package.json'));
    // Vitest exports its manifest but deliberately does not export its CLI subpath.
    const cli = modulePath === 'vitest/vitest.mjs'
      ? join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
      : require.resolve(modulePath);
    return runProc(process.execPath, [cli, ...args], ctx);
  } catch (error) {
    return Promise.resolve({ code: 1, stdout: '', stderr: msg(error), timedOut: false });
  }
}

/** Run a bounded subprocess; terminate its process group on timeout. */
export function runProc(
  cmd: string,
  args: string[],
  ctx: FitnessContext,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const MAX = 1_000_000;
    const windows = process.platform === 'win32';
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let stopping = false;
    let child: ReturnType<typeof spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;

    const stopTree = (signal: NodeJS.Signals): Promise<void> => {
      const pid = child?.pid;
      if (!pid) return Promise.resolve();
      if (windows) {
        return new Promise(done => {
          execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, timeout: 2000 }, error => {
            if (error) { try { child?.kill(signal); } catch { /* already gone */ } }
            done();
          });
        });
      }
      try { process.kill(-pid, signal); } catch { /* group already gone */ }
      return Promise.resolve();
    };
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      ctx.signal?.removeEventListener('abort', abort);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      child?.unref();
      resolve({ code, stdout, stderr, timedOut });
    };
    const stop = (code: number, timeout: boolean): void => {
      if (settled || stopping) return;
      stopping = true;
      timedOut = timeout;
      clearTimeout(timer);
      void stopTree('SIGTERM');
      escalation = setTimeout(() => {
        void stopTree('SIGKILL').finally(() => settle(code));
      }, 250);
    };
    const abort = (): void => {
      stderr = (stderr + 'Operation cancelled').slice(0, MAX);
      stop(130, false);
    };
    if (ctx.signal?.aborted) {
      stderr = 'Operation cancelled before spawn';
      settle(130);
      return;
    }
    try {
      child = spawn(cmd, args, {
        cwd: ctx.checkoutDir, env: ctx.env ?? process.env,
        detached: !windows,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      stderr = msg(error).slice(0, MAX);
      settle(1);
      return;
    }
    ctx.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop(1, true), ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (ctx.signal?.aborted) abort();
    child.stdout?.on('data', chunk => { stdout += chunk.toString().slice(0, Math.max(0, MAX - stdout.length)); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString().slice(0, Math.max(0, MAX - stderr.length)); });
    child.once('error', error => {
      if (settled) return;
      stderr = (stderr + msg(error)).slice(0, MAX);
      if (!stopping) void stopTree('SIGKILL').finally(() => settle(1));
    });
    child.once('close', code => {
      if (settled || stopping) return;
      clearTimeout(timer);
      // A completed evaluation must not leave background work in its checkout.
      void stopTree('SIGKILL').finally(() => settle(code ?? 1));
    });
  });
}

function lastLines(s: string, n = 8): string {
  return s.trim().split('\n').slice(-n).join('\n');
}

/** Parse vitest summary lines: "Tests  3 passed (3)" / "Tests  2 failed | 5 passed (7)". */
export function parseVitestCounts(out: string): { passed: number; failed: number } {
  try {
    const report = JSON.parse(out) as Record<string, unknown>;
    const passed = report.numPassedTests;
    const failed = report.numFailedTests;
    if (typeof passed === 'number' && Number.isSafeInteger(passed) && passed >= 0 && typeof failed === 'number' && Number.isSafeInteger(failed) && failed >= 0) return { passed, failed };
  } catch { /* Compatibility for recorded human-readable summaries. */ }
  const summary = stripVTControlCharacters(out).split('\n').find(line => /^\s*Tests\s/.test(line)) ?? '';
  const passed = /(\d+)\s+passed/.exec(summary);
  const failed = /(\d+)\s+failed/.exec(summary);
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
      const r = await runCheckoutCli('typescript/bin/tsc', ['--noEmit'], ctx);
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

/**
 * Score a vitest run. ZERO collected tests is NOT evidence of correctness —
 * it is the signature of a neutered harness (config excluded them, wrong cwd,
 * `passWithNoTests`). The old `total===0 ? (code===0 ? 1 : 0)` rewarded exactly
 * that gaming vector with a perfect score; zero tests now scores 0, never a pass.
 * Pure + exported so the anti-gaming rule is testable without spawning vitest.
 */
export function scoreVitestRun(
  passed: number,
  failed: number,
  code: number,
  timedOut: boolean,
): { score: number; passed: boolean } {
  const total = passed + failed;
  return {
    score: total > 0 ? passed / total : 0,
    passed: total > 0 && failed === 0 && code === 0 && !timedOut,
  };
}

/** Targeted unit tests: `vitest run <patterns>`. Deterministic; score = passed/(passed+failed). */
export function unitTestsComponent(patterns: string[], weight = 4): FitnessComponent {
  return {
    name: 'unit-tests',
    weight,
    deterministic: true,
    async run(ctx) {
      const dir = mkdtempSync(join(tmpdir(), 'cb-fitness-'));
      try {
        const file = join(dir, 'vitest.json');
        const r = await runCheckoutCli('vitest/vitest.mjs', ['run', ...patterns, '--reporter=json', `--outputFile=${file}`], ctx);
        // A separate report avoids mixing tool/subprocess stdout with the machine-readable results.
        if (statSync(file).size > 16 * 1024 * 1024) throw new Error('Test report exceeds 16 MiB');
        const raw = readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!Number.isSafeInteger(parsed.numPassedTests) || !Number.isSafeInteger(parsed.numFailedTests) || Number(parsed.numPassedTests) < 0 || Number(parsed.numFailedTests) < 0) throw new Error('Invalid test report counts');
        const { passed, failed } = parseVitestCounts(raw);
        const { score, passed: passedFlag } = scoreVitestRun(passed, failed, r.code, r.timedOut);
        return { name: 'unit-tests', weight, score, passed: passedFlag, detail: `${passed} passed / ${failed} failed`, metrics: { passed, failed } };
      } catch (error) {
        return { name: 'unit-tests', weight, score: 0, passed: false, detail: `Missing or invalid Vitest report: ${msg(error)}` };
      } finally { rmSync(dir, { recursive: true, force: true }); }
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
      const build = await runCheckoutCli('typescript/bin/tsc', [], ctx);
      if (build.code !== 0 || build.timedOut) return { name: 'eval-tasks', weight, score: 0, passed: false, detail: 'candidate build failed' };
      let pass = 0;
      let completed = true;
      const outcomes: Record<string, number> = {};
      for (const t of all) {
        const r = await runProc(process.execPath, ['eval/run-task.mjs', t], ctx);
        const ok = r.code === 0 && !r.timedOut;
        if (ok) pass++;
        if (r.timedOut) completed = false;
        outcomes[`task:${t}`] = ok ? 1 : 0;
      }
      return {
        name: 'eval-tasks',
        weight,
        score: pass / all.length,
        // Completion is the gate; task success is a graded optimization signal.
        passed: completed,
        detail: `${pass}/${all.length} eval tasks passed`,
        metrics: { passed: pass, total: all.length, ...outcomes },
      };
    },
  };
}

/** Protected, offline task objective. Guard checks can be green while task success improves. */
export function harnessTasksComponent(weight = 5): FitnessComponent {
  return {
    name: 'harness-tasks', weight, deterministic: true,
    async run(ctx) {
      const build = await runCheckoutCli('typescript/bin/tsc', [], ctx);
      if (build.code !== 0 || build.timedOut) return { name: 'harness-tasks', weight, score: 0, passed: false, detail: 'candidate build failed' };
      const result = await runProc(process.execPath, ['eval/harness-benchmark.mjs'], ctx);
      try {
        const lines = result.stdout.trim().split('\n');
        const report = JSON.parse(lines[lines.length - 1] ?? '') as { kind?: unknown; results?: Record<string, unknown> };
        const entries = Object.entries(report.results ?? {});
        if (result.code !== 0 || result.timedOut || report.kind !== 'harness_benchmark' || !entries.length || entries.some(([, value]) => typeof value !== 'boolean')) throw new Error('Invalid harness benchmark report');
        const pass = entries.filter(([, value]) => value).length;
        return { name: 'harness-tasks', weight, passed: true, score: pass / entries.length, detail: `${pass}/${entries.length} harness tasks passed`, metrics: Object.fromEntries(entries.map(([id, value]) => [`task:${id}`, value ? 1 : 0])) };
      } catch {
        return { name: 'harness-tasks', weight, score: 0, passed: false, detail: 'harness benchmark failed or emitted an invalid report' };
      }
    },
  };
}

/** Default deterministic set → a fast, reproducible baseline (no LLM, no build). */
export function defaultDeterministicComponents(guardsOnly = false): FitnessComponent[] {
  return [typecheckComponent(guardsOnly ? 0 : 3), unitTestsComponent(['tests/agent/self-improvement'], guardsOnly ? 0 : 4)];
}

// ---- Aggregation (pure, unit-tested) ------------------------------------------------------

export function detectRegressions(baseline: FitnessReport, current: ComponentResult[], eps = 1e-9): string[] {
  const byName = new Map(baseline.components.map((c) => [c.name, c]));
  const out: string[] = [];
  for (const r of current) {
    const b = byName.get(r.name);
    if (!b) continue;
    if (r.score < b.score - eps || (b.passed && !r.passed) || Object.entries(b.metrics ?? {}).some(([key, value]) => key.startsWith('task:') && (r.metrics?.[key] ?? -1) < value)) out.push(r.name);
  }
  for (const b of baseline.components) if (!current.some(c => c.name === b.name)) out.push(b.name);
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
