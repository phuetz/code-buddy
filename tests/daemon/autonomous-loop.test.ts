import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetColabStore } from '../../src/fleet/colab-store';
import { FleetAutonomousLoop, type TaskExecutor } from '../../src/daemon/autonomous-loop';
import type { ModelTierConfig } from '../../src/agent/model-tier';

const TIER: ModelTierConfig = {
  localModel: 'qwen2.5:7b-instruct',
  localBaseUrl: 'http://localhost:11434/v1',
  escalationModel: 'claude-opus-4-8',
};

describe('FleetAutonomousLoop', () => {
  let dir: string;
  let store: FleetColabStore;

  function seedTasks(tasks: unknown[]): void {
    writeFileSync(join(dir, 'colab-tasks.json'), JSON.stringify({ version: '0.1', tasks }, null, 2));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auto-loop-'));
    store = new FleetColabStore({ dir, agentId: 'ministar-linux/code-buddy', now: () => 1_000, generateId: (p) => `${p}-x` });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function makeLoop(executor: TaskExecutor, enabled = true): FleetAutonomousLoop {
    return new FleetAutonomousLoop({ store, tierConfig: TIER, executor, enabled: () => enabled });
  }

  it('is a no-op when the kill-switch is off', async () => {
    seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'high', claimedBy: null }]);
    const executor = vi.fn();
    const result = await makeLoop(executor as unknown as TaskExecutor, false).tick();
    expect(result.outcome).toBe('disabled');
    expect(executor).not.toHaveBeenCalled();
    expect(store.getTask('t1')?.status).toBe('open');
  });

  it('goes idle when there is no claimable task', async () => {
    seedTasks([]);
    const result = await makeLoop(async () => ({ ok: true, summary: 'n/a' })).tick();
    expect(result.outcome).toBe('idle');
    expect(store.listPresence()['ministar-linux/code-buddy']?.status).toBe('idle');
  });

  it('never auto-claims a critical task (guardrail)', async () => {
    seedTasks([{ id: 'crit', title: 'danger', status: 'open', priority: 'critical', claimedBy: null }]);
    const executor = vi.fn();
    const result = await makeLoop(executor as unknown as TaskExecutor).tick();
    expect(result.outcome).toBe('idle');
    expect(executor).not.toHaveBeenCalled();
    expect(store.getTask('crit')?.status).toBe('open');
  });

  it('claims, runs on the local tier, completes, and logs on success', async () => {
    seedTasks([{ id: 't1', title: 'write haiku', status: 'open', priority: 'low', claimedBy: null }]);
    const executor: TaskExecutor = async (task, model) => {
      expect(model.tier).toBe('local');
      expect(model.paid).toBe(false);
      expect(model.model).toBe('qwen2.5:7b-instruct');
      return { ok: true, summary: `did ${task.title}`, filesModified: [{ file: 'out.md', changes: 'wrote haiku' }], elapsedSeconds: 3 };
    };
    const result = await makeLoop(executor).tick();
    expect(result.outcome).toBe('completed');
    expect(result.taskId).toBe('t1');
    expect(store.getTask('t1')?.status).toBe('completed');
    const log = store.listWorklog();
    expect(log).toHaveLength(1);
    expect(log[0]?.summary).toBe('did write haiku');
  });

  it('releases the task and logs the failure when the executor reports !ok', async () => {
    seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'medium', claimedBy: null }]);
    const result = await makeLoop(async () => ({ ok: false, summary: 'model unreachable', error: 'ECONNREFUSED' })).tick();
    expect(result.outcome).toBe('failed');
    expect(result.detail).toBe('ECONNREFUSED');
    // released back to the open pool so another tick/agent can retry
    expect(store.getTask('t1')?.status).toBe('open');
    expect(store.getTask('t1')?.claimedBy).toBeNull();
    expect(store.listWorklog()[0]?.issues).toContain('ECONNREFUSED');
  });

  it('treats an executor that throws as a failure (loop never crashes)', async () => {
    seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'low', claimedBy: null }]);
    const result = await makeLoop(async () => { throw new Error('boom'); }).tick();
    expect(result.outcome).toBe('failed');
    expect(store.getTask('t1')?.status).toBe('open');
  });

  it('escalates the model up the ladder after a task keeps failing', async () => {
    seedTasks([{ id: 't1', title: 'hard task', status: 'open', priority: 'medium', claimedBy: null }]);
    const tiersSeen: string[] = [];
    let attempt = 0;
    const executor: TaskExecutor = async (_task, model) => {
      tiersSeen.push(model.tier);
      attempt += 1;
      return attempt === 1 ? { ok: false, summary: 'flaky', error: 'flaked' } : { ok: true, summary: 'ok' };
    };
    const tierConfig: ModelTierConfig = {
      localModel: 'local-m',
      localBaseUrl: 'http://localhost:11434/v1',
      networkModels: [{ model: 'net-m', baseUrl: 'http://net:11434/v1' }],
    };
    const loop = new FleetAutonomousLoop({ store, tierConfig, executor, policy: { escalateAfterFailures: 1 } });

    const r1 = await loop.tick(); // attempt 1: local tier, fails → released, failure count 1
    expect(r1.outcome).toBe('failed');
    expect(store.getTask('t1')?.status).toBe('open');

    const r2 = await loop.tick(); // attempt 2: 1 prior failure ≥ threshold → escalates to network
    expect(r2.outcome).toBe('completed');
    expect(r2.model?.tier).toBe('network');
    expect(tiersSeen).toEqual(['local', 'network']);
  });
});

describe('FleetAutonomousLoop — fleet load + saturation backpressure', () => {
  let dir: string;
  let store: FleetColabStore;
  const originalCap = process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'auto-loop-load-'));
    store = new FleetColabStore({ dir, agentId: 'ministar-linux/code-buddy', now: () => 1_000, generateId: (p) => `${p}-x` });
    const { _resetFleetLoadForTests } = await import('../../src/fleet/fleet-load.js');
    _resetFleetLoadForTests();
  });

  afterEach(async () => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    const { _resetFleetLoadForTests } = await import('../../src/fleet/fleet-load.js');
    _resetFleetLoadForTests();
    if (originalCap === undefined) delete process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY;
    else process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY = originalCap;
  });

  function seedTasks(tasks: unknown[]): void {
    writeFileSync(join(dir, 'colab-tasks.json'), JSON.stringify({ version: '0.1', tasks }, null, 2));
  }

  it('abstains from claiming when at capacity, leaving the task for idle peers', async () => {
    const { beginFleetWork } = await import('../../src/fleet/fleet-load.js');
    process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY = '1';
    const done = beginFleetWork('peer.dispatch'); // peer is busy answering someone

    seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'high', claimedBy: null }]);
    const executor = vi.fn().mockResolvedValue({ ok: true, summary: 'done after backpressure' });
    const loop = new FleetAutonomousLoop({ store, tierConfig: TIER, executor: executor as unknown as TaskExecutor });

    const result = await loop.tick();

    expect(result.outcome).toBe('saturated');
    expect(executor).not.toHaveBeenCalled();
    // The task stays open and unclaimed — an idle peer's daemon can win it.
    expect(store.getTask('t1')?.status).toBe('open');
    expect(store.getTask('t1')?.claimedBy).toBeNull();

    // Capacity freed → the next tick claims normally.
    done();
    const retry = await loop.tick();
    expect(retry.outcome).toBe('completed');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('registers the running task as fleet load while the executor runs', async () => {
    const { getFleetLoad } = await import('../../src/fleet/fleet-load.js');
    seedTasks([{ id: 't1', title: 'measure me', status: 'open', priority: 'low', claimedBy: null }]);

    let observedDuringRun = -1;
    const loop = new FleetAutonomousLoop({
      store,
      tierConfig: TIER,
      executor: async () => {
        observedDuringRun = getFleetLoad({}).activeRequests;
        return { ok: true, summary: 'done' };
      },
    });

    const result = await loop.tick();

    expect(result.outcome).toBe('completed');
    expect(observedDuringRun).toBe(1);
    expect(getFleetLoad({}).activeRequests).toBe(0);
  });

  it('does not trigger saturation without a configured capacity (opt-in)', async () => {
    const { beginFleetWork } = await import('../../src/fleet/fleet-load.js');
    delete process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY;
    beginFleetWork('peer.dispatch');
    beginFleetWork('peer.dispatch');

    seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'low', claimedBy: null }]);
    const loop = new FleetAutonomousLoop({
      store,
      tierConfig: TIER,
      executor: async () => ({ ok: true, summary: 'done' }),
    });

    const result = await loop.tick();
    expect(result.outcome).toBe('completed');
  });
});
