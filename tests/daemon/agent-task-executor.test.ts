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

  it('buildAgentEnv pins ollama for local tiers and leaves paid tiers on their provider', () => {
    const local = buildAgentEnv(localModel, {});
    expect(local.CODEBUDDY_PROVIDER).toBe('ollama');
    expect(local.OLLAMA_HOST).toBe('http://localhost:11434');
    expect(local.GROK_MODEL).toBe('qwen3.6:35b-a3b');

    const paid = buildAgentEnv(paidModel, {});
    expect(paid.CODEBUDDY_PROVIDER).toBeUndefined(); // no baseUrl → don't force ollama
    expect(paid.GROK_MODEL).toBe('grok-4');
  });
});
