/**
 * Real-agent autonomous executor (opt-in).
 *
 * Unlike the v0 {@link createLocalModelTaskExecutor} (which only writes the
 * model's answer as a scoped artifact), this runs the **actual Code Buddy agent**
 * headless so it edits files to do the task. It is the production form of the
 * proven `scripts/autonomy-lab/` executor.
 *
 * Acceptance gate (opt-in): when `CODEBUDDY_AUTONOMY_VERIFY_COMMANDS=1` (or
 * `opts.allowVerifyCommand`) and the task carries a `verifyCommand`, it runs in
 * the workspace after the agent and MUST exit 0 — so "completed" means
 * *verified*, not merely "the agent finished". It is `sh -c <cmd>` from the task
 * (bypasses agent tool restrictions), so it stays opt-in: only enable it for an
 * operator-trusted queue, never a peer/fleet-authored one.
 *
 * Safety — this has real blast radius, so it is gated:
 *   - **Fail-closed workspace root.** It refuses to run without an explicit
 *     workspace dir (`CODEBUDDY_AUTONOMY_WORKSPACE_ROOT` or `opts.workspaceRoot`);
 *     the agent's cwd is that dir. A misconfigured daemon does nothing rather
 *     than running against an unintended tree.
 *   - It is **not** wired by default: the daemon uses the v0 artifact executor
 *     unless `CODEBUDDY_AUTONOMY_EXECUTOR=agent` is set (see createDefaultAutonomousLoop).
 *   - `critical` tasks are still never auto-claimed (enforced upstream in the store).
 *
 * NOTE — the workspace root is a **cwd bound, not a hard sandbox.** Headless mode
 * auto-approves tools, so the agent can run approved shell commands that may
 * touch paths outside the workspace. Run this against a disposable/contained
 * workspace (ideally a container), and pass `opts.permissionMode`/extra agent
 * flags (e.g. `--disallowedTools`) to tighten the tool surface for your setup.
 *
 * The model is pinned to the fleet's tier choice: local/network tiers run on
 * Ollama (free); the escalated tier uses the configured paid model.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { spawnSync, type SpawnSyncReturns, type SpawnSyncOptionsWithStringEncoding } from 'child_process';
import type { ColabTask } from '../fleet/colab-store.js';
import type { AutonomousModelChoice } from '../agent/model-tier.js';
import type { TaskExecutor, TaskExecutionResult } from './autonomous-loop.js';
import { buildColabGoalContinuationPrompt } from './colab-goal.js';

/** Tail of agent stdout kept for the goal-mode judge (matches the judge's 4 KB cap). */
const OUTPUT_TAIL_CHARS = 4000;

export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => SpawnSyncReturns<string>;

export interface AgentTaskExecutorOptions {
  /** Workspace the agent runs in (its cwd). Required — fail-closed if absent. */
  workspaceRoot?: string;
  /** code-buddy checkout root, used to locate the CLI entrypoint. Default: process.cwd(). */
  repoRoot?: string;
  /** Per-task wall-clock timeout in ms. Default 600_000 (10 min). */
  timeoutMs?: number;
  /** Permission mode passed to the agent. Default 'acceptEdits'. */
  permissionMode?: string;
  /**
   * Extra CLI flags appended to the agent invocation, e.g.
   * `['--disallowedTools', 'bash,run_command']` to tighten the tool surface.
   * Defaults to splitting `CODEBUDDY_AUTONOMY_AGENT_ARGS` on whitespace.
   */
  extraArgs?: string[];
  /**
   * Run a task's `verifyCommand` acceptance gate. It is `sh -c <cmd>` from the
   * task, so it bypasses `extraArgs` tool restrictions — only enable it when the
   * task queue is operator-trusted (NOT peer/fleet-authored). Default: off,
   * unless `CODEBUDDY_AUTONOMY_VERIFY_COMMANDS=1`. When off, a task with a
   * verifyCommand still completes on agent success — it just isn't gate-verified.
   */
  allowVerifyCommand?: boolean;
  /** Injectable spawn (tests). */
  spawnImpl?: SpawnFn;
}

function hashFileIfExists(absPath: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

function resolveWorkspaceFile(workspaceRoot: string, rel: string): string | null {
  const root = path.resolve(workspaceRoot);
  const abs = path.resolve(root, rel);
  const relToRoot = path.relative(root, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return null;
  return abs;
}

function snapshotListedFiles(workspaceRoot: string, files: string[]): Map<string, string | null> {
  const snap = new Map<string, string | null>();
  for (const rel of files) {
    const abs = resolveWorkspaceFile(workspaceRoot, rel);
    snap.set(rel, abs ? hashFileIfExists(abs) : null);
  }
  return snap;
}

function listedFilesChanged(workspaceRoot: string, before: Map<string, string | null>): string[] {
  const changed: string[] = [];
  for (const [rel, prev] of before) {
    const abs = resolveWorkspaceFile(workspaceRoot, rel);
    const next = abs ? hashFileIfExists(abs) : null;
    if (next !== prev) changed.push(rel);
  }
  return changed;
}

/** Resolve the buddy CLI entrypoint inside `repoRoot`. */
function resolveEntrypoint(repoRoot: string): { cmd: string; baseArgs: string[] } | null {
  const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  const indexTs = path.join(repoRoot, 'src', 'index.ts');
  const distJs = path.join(repoRoot, 'dist', 'index.js');
  if (fs.existsSync(indexTs) && fs.existsSync(tsx)) return { cmd: tsx, baseArgs: [indexTs] };
  if (fs.existsSync(distJs)) return { cmd: 'node', baseArgs: [distJs] };
  return null;
}

/** Build the env that pins the agent to the tier's chosen model. */
export function buildAgentEnv(model: AutonomousModelChoice, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, GROK_MODEL: model.model };
  if (model.baseUrl) {
    // local / network tier → free Ollama endpoint. Force the provider so an
    // ambient ChatGPT login doesn't override it; strip a trailing /v1 (the
    // ollama provider re-appends it).
    env['CODEBUDDY_PROVIDER'] = 'ollama';
    env['OLLAMA_HOST'] = model.baseUrl.replace(/\/v1\/?$/, '');
  }
  // Escalated/paid tier (no baseUrl): only the model is pinned. The provider is
  // left to auto-detect, so the operator must ensure the matching provider is the
  // active one — set `CODEBUDDY_PROVIDER`/the right API key, or remove a
  // conflicting ChatGPT login — else detection may route the paid model wrong.
  return env;
}

export function createAgentTaskExecutor(opts: AgentTaskExecutorOptions = {}): TaskExecutor {
  const workspaceRoot = opts.workspaceRoot ?? process.env['CODEBUDDY_AUTONOMY_WORKSPACE_ROOT'];
  const repoRoot = opts.repoRoot ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const permissionMode = opts.permissionMode ?? 'acceptEdits';
  const envArgs = process.env['CODEBUDDY_AUTONOMY_AGENT_ARGS']?.trim();
  const extraArgs = opts.extraArgs ?? (envArgs ? envArgs.split(/\s+/) : []);
  const allowVerify = opts.allowVerifyCommand ?? process.env['CODEBUDDY_AUTONOMY_VERIFY_COMMANDS'] === '1';
  const doSpawn: SpawnFn = opts.spawnImpl ?? (spawnSync as unknown as SpawnFn);

  return async (task: ColabTask, model: AutonomousModelChoice): Promise<TaskExecutionResult> => {
    if (!workspaceRoot || !workspaceRoot.trim()) {
      return {
        ok: false,
        summary: 'agent executor not configured',
        error: 'fail-closed: set CODEBUDDY_AUTONOMY_WORKSPACE_ROOT (the bounded dir the agent edits)',
      };
    }
    const entry = resolveEntrypoint(repoRoot);
    if (!entry) {
      return { ok: false, summary: 'no buddy entrypoint', error: `no src/index.ts or dist/index.js under ${repoRoot}` };
    }

    // Goal-mode continuation: on later turns the worker gets the judge's
    // nudge instead of the bare task text, so it targets the remaining gap.
    const prompt = task.goalMode && (task.goalTurnsUsed ?? 0) > 0
      ? buildColabGoalContinuationPrompt(task)
      : `${task.title}\n\n${task.description ?? ''}`.trim();
    const env = buildAgentEnv(model);
    const started = Date.now();
    const listed = (task.filesToModify ?? []).map((f) => f.trim()).filter(Boolean);
    const before = listed.length > 0 ? snapshotListedFiles(workspaceRoot, listed) : null;
    const res = doSpawn(
      entry.cmd,
      [...entry.baseArgs, '-p', prompt, '--permission-mode', permissionMode, '--output-format', 'text', ...extraArgs],
      { cwd: workspaceRoot, env, encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
    );
    const agentOk = !res.error && res.status === 0;
    if (!agentOk) {
      const elapsedSeconds = Math.round((Date.now() - started) / 1000);
      const reason = res.error
        ? String((res.error as Error).message ?? res.error)
        : `agent exited ${res.status}: ${(res.stderr ?? '').slice(-300)}`;
      return {
        ok: false,
        summary: `agent failed ${task.id} [${model.tier}/${model.model}] (${elapsedSeconds}s)`,
        elapsedSeconds,
        error: reason,
      };
    }

    // Tail of the agent's real output — what the goal-mode judge evaluates.
    const output = (res.stdout ?? '').slice(-OUTPUT_TAIL_CHARS).trim();
    const changed = before ? listedFilesChanged(workspaceRoot, before) : [];
    const filesModified = changed.map((file) => ({ file, changes: 'modified' }));

    if (before && changed.length === 0) {
      const elapsedSeconds = Math.round((Date.now() - started) / 1000);
      return {
        ok: false,
        summary: `agent ran ${task.id} but filesToModify were unchanged`,
        elapsedSeconds,
        error: `no change in filesToModify (${listed.join(', ')})`,
        ...(output ? { output } : {}),
      };
    }

    // Acceptance gate: if the task carries a verify command AND running task-
    // supplied shell is allowed (opt-in), the agent "finishing" isn't enough —
    // the gate must pass for the task to count as completed. When not allowed,
    // the gate is skipped (the command is never executed).
    const gate = allowVerify ? task.verifyCommand?.trim() : undefined;
    if (gate) {
      const v = doSpawn('sh', ['-c', gate], {
        cwd: workspaceRoot,
        env: process.env,
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const elapsedSeconds = Math.round((Date.now() - started) / 1000);
      if (v.error || v.status !== 0) {
        const why = v.error ? String((v.error as Error).message ?? v.error) : `gate exited ${v.status}: ${(v.stderr ?? '').slice(-200)}`;
        return {
          ok: false,
          summary: `agent ran ${task.id} but acceptance gate failed (\`${gate}\`) (${elapsedSeconds}s)`,
          elapsedSeconds,
          error: why,
        };
      }
      return {
        ok: true,
        summary: `agent ran ${task.id} [${model.tier}/${model.model}] + gate \`${gate}\` passed (${elapsedSeconds}s)`,
        elapsedSeconds,
        ...(filesModified.length ? { filesModified } : {}),
        ...(output ? { output } : {}),
      };
    }

    const elapsedSeconds = Math.round((Date.now() - started) / 1000);
    return {
      ok: true,
      summary: `agent ran ${task.id} [${model.tier}/${model.model}] in ${workspaceRoot} (${elapsedSeconds}s)`,
      elapsedSeconds,
      ...(filesModified.length ? { filesModified } : {}),
      ...(output ? { output } : {}),
    };
  };
}
