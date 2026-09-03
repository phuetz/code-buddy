import { describe, it, expect } from 'vitest';
import type { SpawnSyncReturns } from 'child_process';
import { createAgentTaskExecutor, buildAgentEnv, type SpawnFn } from '../../src/daemon/agent-task-executor.js';
import type { ColabTask } from '../../src/fleet/colab-store.js';
import type { AutonomousModelChoice } from '../../src/agent/model-tier.js';

const localModel = {
  model: 'qwen3.6:35b-a3b',
  tier: 'local',
  baseUrl: 'http://localhost:11434/v1',
  paid: false,
  reason: 'free-first',
} as unknown as AutonomousModelChoice;

const paidModel = {
  model: 'grok-4',
  tier: 'escalated',
  paid: true,
  reason: 'escalated',
} as unknown as AutonomousModelChoice;

const task = {
  id: 't1',
  title: 'Do the thing',
  description: 'details here',
  status: 'in_progress',
  priority: 'medium',
} as unknown as ColabTask;

function spawnReturning(over: Partial<SpawnSyncReturns<string>>): { fn: SpawnFn; calls: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> } {
  const calls: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> = [];
  const fn: SpawnFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts: opts as unknown as Record<string, unknown> });
    return { status: 0, stdout: '', stderr: '', signal: null, pid: 1, output: [], ...over } as unknown as SpawnSyncReturns<string>;
  };
  return { fn, calls };
}

/** Mock that returns a per-command result (agent run vs `sh -c` verify gate). */
function spawnDispatch(handler: (cmd: string) => Partial<SpawnSyncReturns<string>>): { fn: SpawnFn; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const fn: SpawnFn = (cmd, args) => {
    calls.push({ cmd, args });
    return { status: 0, stdout: '', stderr: '', signal: null, pid: 1, output: [], ...handler(cmd) } as unknown as SpawnSyncReturns<string>;
  };
  return { fn, calls };
}

const taskWithGate = { ...(task as object), verifyCommand: 'node check.mjs' } as unknown as ColabTask;

describe('agent-task-executor', () => {
  it('is fail-closed without a workspace root', async () => {
    const { fn, calls } = spawnReturning({});
    // Empty workspaceRoot must NOT fall through to env (?? keeps '') and must refuse.
    const exec = createAgentTaskExecutor({ workspaceRoot: '', repoRoot: process.cwd(), spawnImpl: fn });
    const r = await exec(task, localModel);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/WORKSPACE_ROOT|fail-closed/i);
    expect(calls).toHaveLength(0); // never spawned the agent
  });

  it('runs the real agent with the right argv/cwd/env on a local model', async () => {
    const { fn, calls } = spawnReturning({ status: 0 });
    const exec = createAgentTaskExecutor({ workspaceRoot: '/tmp/ws', repoRoot: process.cwd(), spawnImpl: fn });
    const r = await exec(task, localModel);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const { args, opts } = calls[0]!;
    expect(opts.cwd).toBe('/tmp/ws');
    expect(args).toEqual(expect.arrayContaining(['-p', '--permission-mode', 'acceptEdits', '--output-format', 'text']));
    const env = opts.env as NodeJS.ProcessEnv;
    expect(env.CODEBUDDY_PROVIDER).toBe('ollama');
    expect(env.OLLAMA_HOST).toBe('http://localhost:11434'); // /v1 stripped
    expect(env.GROK_MODEL).toBe('qwen3.6:35b-a3b');
  });

  it('appends extra args (e.g. --disallowedTools) to tighten the tool surface', async () => {
    const { fn, calls } = spawnReturning({ status: 0 });
    const exec = createAgentTaskExecutor({
      workspaceRoot: '/tmp/ws',
      repoRoot: process.cwd(),
      extraArgs: ['--disallowedTools', 'bash,run_command'],
      spawnImpl: fn,
    });
    await exec(task, localModel);
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--disallowedTools', 'bash,run_command']));
  });

  it('reports failure on a non-zero agent exit', async () => {
    const { fn } = spawnReturning({ status: 1, stderr: 'kaboom' });
    const exec = createAgentTaskExecutor({ workspaceRoot: '/tmp/ws', repoRoot: process.cwd(), spawnImpl: fn });
    const r = await exec(task, localModel);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/exited 1|kaboom/);
  });

  it('reports failure on a spawn error (timeout/ENOENT)', async () => {
    const { fn } = spawnReturning({ status: null, error: new Error('ETIMEDOUT') });
    const exec = createAgentTaskExecutor({ workspaceRoot: '/tmp/ws', repoRoot: process.cwd(), spawnImpl: fn });
    const r = await exec(task, localModel);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ETIMEDOUT/);
  });

  it('passes when the gate is allowed and it exits 0', async () => {
    // agent (tsx/node) succeeds; gate (`sh -c`) succeeds.
    const { fn, calls } = spawnDispatch(() => ({ status: 0 }));
    const exec = createAgentTaskExecutor({ workspaceRoot: '/tmp/ws', repoRoot: process.cwd(), allowVerifyCommand: true, spawnImpl: fn });
    const r = await exec(taskWithGate, localModel);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/gate .*passed/);
    const gateCall = calls.find((c) => c.cmd === 'sh');
    expect(gateCall?.args).toEqual(['-c', 'node check.mjs']);
  });

  it('fails (releases) when the allowed gate fails even though the agent finished', async () => {
    // agent succeeds (exit 0), gate fails (exit 1).
    const { fn } = spawnDispatch((cmd) => (cmd === 'sh' ? { status: 1, stderr: 'assertion failed' } : { status: 0 }));
    const exec = createAgentTaskExecutor({ workspaceRoot: '/tmp/ws', repoRoot: process.cwd(), allowVerifyCommand: true, spawnImpl: fn });
    const r = await exec(taskWithGate, localModel);
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/acceptance gate failed/);
    expect(r.error).toMatch(/exited 1|assertion failed/);
  });

  it('does NOT run a verifyCommand unless explicitly allowed (security default)', async () => {
    // Task carries a gate, but allowVerifyCommand is off → the sh -c is never run.
    const { fn, calls } = spawnDispatch(() => ({ status: 0 }));
    const exec = createAgentTaskExecutor({ workspaceRoot: '/tmp/ws', repoRoot: process.cwd(), spawnImpl: fn });
    const r = await exec(taskWithGate, localModel);
    expect(r.ok).toBe(true); // completes on agent success...
    expect(calls.some((c) => c.cmd === 'sh')).toBe(false); // ...but the task command was never executed
  });

  it('skips the gate when the task has no verifyCommand', async () => {
    const { fn, calls } = spawnDispatch(() => ({ status: 0 }));
    const exec = createAgentTaskExecutor({ workspaceRoot: '/tmp/ws', repoRoot: process.cwd(), allowVerifyCommand: true, spawnImpl: fn });
    const r = await exec(task, localModel);
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.cmd === 'sh')).toBe(false); // no gate spawned
  });

  it('buildAgentEnv pins ollama for local tiers and leaves paid tiers on their provider', () => {
    const local = buildAgentEnv(localModel, {});
    expect(local.CODEBUDDY_PROVIDER).toBe('ollama');
    expect(local.OLLAMA_HOST).toBe('http://localhost:11434');
    expect(local.GROK_MODEL).toBe('qwen3.6:35b-a3b');

    const paid = buildAgentEnv(paidModel, {});
    expect(paid.CODEBUDDY_PROVIDER).toBeUndefined(); // no baseUrl → don't force ollama
    expect(paid.GROK_MODEL).toBe('grok-4');
  });

  it('fails when filesToModify were listed but none of those files changed', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const ws = mkdtempSync(join(tmpdir(), 'agent-ws-'));
    try {
      writeFileSync(join(ws, 'add.mjs'), 'export function add(a, b) { return a - b; }\n');
      const { fn } = spawnReturning({ status: 0, stdout: 'I thought about it' });
      const exec = createAgentTaskExecutor({ workspaceRoot: ws, repoRoot: process.cwd(), spawnImpl: fn });
      const r = await exec(
        { ...task, filesToModify: ['add.mjs'] } as unknown as ColabTask,
        localModel,
      );
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/filesToModify|unchanged|no change/i);
    } finally {
      rmSync(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
