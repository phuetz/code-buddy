/**
 * Real-agent autonomous executor (opt-in).
 *
 * Unlike the v0 {@link createLocalModelTaskExecutor} (which only writes the
 * model's answer as a scoped artifact), this runs the **actual Code Buddy agent**
 * headless so it edits files to do the task. It is the production form of the
 * proven `scripts/autonomy-lab/` executor.
 *
 * Safety — this has real blast radius, so it is gated:
 *   - **Fail-closed workspace root.** It refuses to run without an explicit
 *     workspace dir (`CODEBUDDY_AUTONOMY_WORKSPACE_ROOT` or `opts.workspaceRoot`);
 *     the agent's cwd is that dir, bounding where edits land. A misconfigured
 *     daemon does nothing rather than editing an unintended tree.
 *   - It is **not** wired by default: the daemon uses the v0 artifact executor
 *     unless `CODEBUDDY_AUTONOMY_EXECUTOR=agent` is set (see createDefaultAutonomousLoop).
 *   - `critical` tasks are still never auto-claimed (enforced upstream in the store).
 *
 * The model is pinned to the fleet's tier choice: local/network tiers run on
 * Ollama (free); the escalated tier uses the configured paid model.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, type SpawnSyncReturns, type SpawnSyncOptionsWithStringEncoding } from 'child_process';
import type { ColabTask } from '../fleet/colab-store.js';
import type { AutonomousModelChoice } from '../agent/model-tier.js';
import type { TaskExecutor, TaskExecutionResult } from './autonomous-loop.js';

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
  /** Injectable spawn (tests). */
  spawnImpl?: SpawnFn;
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
  return env;
}

export function createAgentTaskExecutor(opts: AgentTaskExecutorOptions = {}): TaskExecutor {
  const workspaceRoot = opts.workspaceRoot ?? process.env['CODEBUDDY_AUTONOMY_WORKSPACE_ROOT'];
  const repoRoot = opts.repoRoot ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const permissionMode = opts.permissionMode ?? 'acceptEdits';
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

    const prompt = `${task.title}\n\n${task.description ?? ''}`.trim();
    const env = buildAgentEnv(model);
    const started = Date.now();
    const res = doSpawn(
      entry.cmd,
      [...entry.baseArgs, '-p', prompt, '--permission-mode', permissionMode, '--output-format', 'text'],
      { cwd: workspaceRoot, env, encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
    );
    const elapsedSeconds = Math.round((Date.now() - started) / 1000);
    const ok = !res.error && res.status === 0;
    if (ok) {
      return {
        ok: true,
        summary: `agent ran ${task.id} [${model.tier}/${model.model}] in ${workspaceRoot} (${elapsedSeconds}s)`,
        elapsedSeconds,
      };
    }
    const reason = res.error
      ? String((res.error as Error).message ?? res.error)
      : `agent exited ${res.status}: ${(res.stderr ?? '').slice(-300)}`;
    return {
      ok: false,
      summary: `agent failed ${task.id} [${model.tier}/${model.model}] (${elapsedSeconds}s)`,
      elapsedSeconds,
      error: reason,
    };
  };
}
