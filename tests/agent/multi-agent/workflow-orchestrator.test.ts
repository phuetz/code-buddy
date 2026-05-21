/**
 * Phase O (V0.4.1) — WorkflowOrchestrator unit tests.
 *
 * Validates pool acquisition, queue policy (queue/reject), stop semantics
 * (stopAll vs per-workflow gated), persistence side-effects, and lifecycle
 * cleanup. The MAS itself is mocked so tests run fast and don't hit LLMs.
 */

// Set unique paths per test file BEFORE imports — vitest pool=forks runs
// files in parallel.
import path from 'path';
import os from 'os';
process.env.CODEBUDDY_WORKFLOWS_DIR = path.join(
  os.tmpdir(),
  `codebuddy-workflows-test-${process.pid}-orch`,
);

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const masMocks = vi.hoisted(() => {
  // We track every MAS instance created so tests can assert pool size.
  const created: Array<{ runWorkflow: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> }> = [];
  let workflowCounter = 0;

  function makeFakeMAS() {
    const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    const fake = {
      runWorkflow: vi.fn(async (goal: string) => {
        workflowCounter += 1;
        // Allow tests to inject delay/failure via mockImplementationOnce
        return {
          success: true,
          plan: { id: 'p', goal, summary: '', phases: [], estimatedComplexity: 'simple', requiredAgents: [], createdAt: new Date(), status: 'completed' },
          results: new Map(),
          artifacts: [],
          timeline: [],
          totalDuration: 100,
          summary: `done: ${goal}`,
          errors: [],
        };
      }),
      stop: vi.fn(),
      dispose: vi.fn(),
      on: vi.fn((event: string, h: (...a: unknown[]) => void) => {
        const list = handlers.get(event) || [];
        list.push(h);
        handlers.set(event, list);
      }),
      off: vi.fn((event: string, h: (...a: unknown[]) => void) => {
        const list = handlers.get(event) || [];
        const idx = list.indexOf(h);
        if (idx >= 0) list.splice(idx, 1);
      }),
      // Phase (d).3 — once() needed by orchestrator's workflow:start /
      // workflow:complete fleet hooks. No-op for these tests since they
      // don't exercise lifecycle event paths.
      once: vi.fn(),
      removeListener: vi.fn(),
    };
    created.push(fake);
    return fake;
  }

  let singletonInstance: ReturnType<typeof makeFakeMAS> | null = null;
  const getMultiAgentSystemMock = vi.fn(() => {
    if (!singletonInstance) singletonInstance = makeFakeMAS();
    return singletonInstance;
  });
  const createMultiAgentSystemMock = vi.fn(() => makeFakeMAS());
  const resetMultiAgentSystemMock = vi.fn(() => { singletonInstance = null; });

  return { created, getMultiAgentSystemMock, createMultiAgentSystemMock, resetMultiAgentSystemMock, reset: () => { created.length = 0; singletonInstance = null; workflowCounter = 0; } };
});

vi.mock('../../../src/agent/multi-agent/multi-agent-system.js', () => ({
  getMultiAgentSystem: masMocks.getMultiAgentSystemMock,
  createMultiAgentSystem: masMocks.createMultiAgentSystemMock,
  resetMultiAgentSystem: masMocks.resetMultiAgentSystemMock,
}));

// Streamer mock to avoid stdout noise + unhandled imports
vi.mock('../../../src/agent/multi-agent/workflow-event-streamer.js', () => ({
  attachStreamer: vi.fn(() => ({ detach: vi.fn() })),
}));

import {
  WorkflowOrchestrator,
  resetWorkflowOrchestrator,
  _resetWorkflowCounterForTests,
} from '../../../src/agent/multi-agent/workflow-orchestrator.js';

describe('WorkflowOrchestrator — Phase O (V0.4.1)', () => {
  beforeEach(() => {
    masMocks.reset();
    masMocks.getMultiAgentSystemMock.mockClear();
    masMocks.createMultiAgentSystemMock.mockClear();
    masMocks.resetMultiAgentSystemMock.mockClear();
    _resetWorkflowCounterForTests();
    resetWorkflowOrchestrator();
  });

  afterEach(() => {
    resetWorkflowOrchestrator();
  });

  describe('default config (max=1, queue policy)', () => {
    it('starts immediately when pool has space', async () => {
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const r = await o.submitWorkflow('goal-A');
      expect(r.status).toBe('started');
      expect(r.workflowId).toMatch(/^wf-/);
      // Should use the singleton, not create
      expect(masMocks.getMultiAgentSystemMock).toHaveBeenCalledOnce();
      expect(masMocks.createMultiAgentSystemMock).not.toHaveBeenCalled();
      if (r.status === 'started') await r.promise;
      o.dispose();
    });

    it('uses singleton MAS for the first slot (V0.3 compat)', async () => {
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const r = await o.submitWorkflow('a');
      if (r.status !== 'started') throw new Error('expected started');
      await r.promise;
      // Singleton should have been the only instance acquired.
      expect(masMocks.created).toHaveLength(1);
      o.dispose();
    });
  });

  describe('pool > 1 — concurrent + create-on-demand', () => {
    it('spawns extra MAS instances via createMultiAgentSystem when pool grows', async () => {
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 2 });
      // Make the first runWorkflow hang so the second submit goes to slot 2
      let resolveFirst!: (v: unknown) => void;
      expect(masMocks.created).toHaveLength(0); // reset by beforeEach; instances populate below as submits come in
      // We need to slow the first one
      const block = new Promise<void>((resolve) => { resolveFirst = resolve as (v: unknown) => void; });
      let firstRunImpl = false;
      // Patch the next created MAS's runWorkflow once
      const origGet = masMocks.getMultiAgentSystemMock.getMockImplementation();
      masMocks.getMultiAgentSystemMock.mockImplementationOnce(() => {
        const inst = origGet ? origGet() : { runWorkflow: vi.fn(), stop: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn() };
        // wrap runWorkflow to wait
        const orig = inst.runWorkflow;
        inst.runWorkflow = vi.fn(async (g: string) => {
          if (!firstRunImpl) { firstRunImpl = true; await block; }
          return orig(g);
        });
        return inst;
      });

      const r1 = await o.submitWorkflow('a');
      const r2 = await o.submitWorkflow('b');
      expect(r1.status).toBe('started');
      expect(r2.status).toBe('started');
      expect(masMocks.createMultiAgentSystemMock).toHaveBeenCalledOnce();

      // Unblock first; let both finish
      resolveFirst(undefined);
      if (r1.status === 'started') await r1.promise;
      if (r2.status === 'started') await r2.promise;
      o.dispose();
    });

    it('queues when pool full + queue_policy=queue', async () => {
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1, queuePolicy: 'queue' });
      // Block the first
      let resolveFirst!: () => void;
      const block = new Promise<void>((resolve) => { resolveFirst = resolve; });
      const inst = masMocks.created[0] || (masMocks.getMultiAgentSystemMock(), masMocks.created[0]);
      inst.runWorkflow.mockImplementationOnce(async () => {
        await block;
        return { success: true, plan: null, results: new Map(), artifacts: [], timeline: [], totalDuration: 1, summary: 'done', errors: [] };
      });

      const r1 = await o.submitWorkflow('a');
      const r2 = await o.submitWorkflow('b');
      expect(r1.status).toBe('started');
      expect(r2.status).toBe('queued');
      expect(o.getStats()).toEqual({ active: 1, queued: 1, capacity: 1 });

      // Release first; queued one should pick up
      resolveFirst();
      if (r1.status === 'started') await r1.promise;
      if (r2.status === 'queued') {
        const result2 = await r2.promise;
        expect(result2.success).toBe(true);
      }
      o.dispose();
    });

    it('rejects when pool full + queue_policy=reject', async () => {
      const o = new WorkflowOrchestrator({
        apiKey: 'k',
        maxConcurrentWorkflows: 1,
        queuePolicy: 'reject',
      });

      // Block the first so the slot stays occupied
      let resolveFirst!: () => void;
      const block = new Promise<void>((r) => { resolveFirst = r; });
      const inst = masMocks.created[0] || (masMocks.getMultiAgentSystemMock(), masMocks.created[0]);
      inst.runWorkflow.mockImplementationOnce(async () => {
        await block;
        return { success: true, plan: null, results: new Map(), artifacts: [], timeline: [], totalDuration: 1, summary: 'done', errors: [] };
      });

      const r1 = await o.submitWorkflow('a');
      expect(r1.status).toBe('started');

      const r2 = await o.submitWorkflow('b');
      expect(r2.status).toBe('rejected');
      if (r2.status === 'rejected') {
        expect(r2.reason).toContain('queue_policy=reject');
      }

      resolveFirst();
      if (r1.status === 'started') await r1.promise;
      o.dispose();
    });
  });

  describe('stop semantics', () => {
    it('stopAll calls .stop() on every active MAS', async () => {
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 2 });
      // Block both
      const blocks: Array<() => void> = [];
      // First (singleton)
      const singleton = masMocks.getMultiAgentSystemMock();
      singleton.runWorkflow.mockImplementationOnce(async () => {
        await new Promise<void>((r) => blocks.push(r));
        return { success: true, plan: null, results: new Map(), artifacts: [], timeline: [], totalDuration: 1, summary: 'done', errors: [] };
      });
      // Second (extra)
      const extraInstanceFactory = masMocks.createMultiAgentSystemMock.getMockImplementation();
      masMocks.createMultiAgentSystemMock.mockImplementationOnce(() => {
        const inst = extraInstanceFactory ? extraInstanceFactory() : null;
        if (inst) inst.runWorkflow.mockImplementationOnce(async () => {
          await new Promise<void>((r) => blocks.push(r));
          return { success: true, plan: null, results: new Map(), artifacts: [], timeline: [], totalDuration: 1, summary: 'done', errors: [] };
        });
        return inst;
      });

      const r1 = await o.submitWorkflow('a');
      const r2 = await o.submitWorkflow('b');
      expect(o.getStats().active).toBe(2);

      await o.stopAll();
      // Each MAS's stop was called once
      const stopCalls = masMocks.created.reduce((acc, inst) => acc + inst.stop.mock.calls.length, 0);
      expect(stopCalls).toBeGreaterThanOrEqual(2);

      // Cleanup
      blocks.forEach((b) => b());
      if (r1.status === 'started') await r1.promise.catch(() => {});
      if (r2.status === 'started') await r2.promise.catch(() => {});
      o.dispose();
    });

    it('stopWorkflow throws when enable_per_workflow_stop=false (default)', async () => {
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 2 });
      await expect(o.stopWorkflow('any-id')).rejects.toThrow(/Per-workflow stop is disabled/);
      o.dispose();
    });

    it('stopWorkflow targets a specific workflow when enable_per_workflow_stop=true', async () => {
      const o = new WorkflowOrchestrator({
        apiKey: 'k',
        maxConcurrentWorkflows: 2,
        enablePerWorkflowStop: true,
      });
      // Block the workflow so it stays active
      const singleton = masMocks.getMultiAgentSystemMock();
      let resolveFirst!: () => void;
      singleton.runWorkflow.mockImplementationOnce(async () => {
        await new Promise<void>((r) => (resolveFirst = r));
        return { success: true, plan: null, results: new Map(), artifacts: [], timeline: [], totalDuration: 1, summary: 'done', errors: [] };
      });

      const r = await o.submitWorkflow('a');
      if (r.status !== 'started') throw new Error('expected started');
      const id = r.workflowId;

      await o.stopWorkflow(id);
      expect(singleton.stop).toHaveBeenCalledOnce();

      resolveFirst();
      await r.promise.catch(() => {});
      o.dispose();
    });

    it('stopWorkflow throws on unknown id', async () => {
      const o = new WorkflowOrchestrator({
        apiKey: 'k',
        maxConcurrentWorkflows: 2,
        enablePerWorkflowStop: true,
      });
      await expect(o.stopWorkflow('does-not-exist')).rejects.toThrow(/No active workflow/);
      o.dispose();
    });
  });

  describe('lifecycle and stats', () => {
    it('getStats reflects active + queued counts', async () => {
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      expect(o.getStats()).toEqual({ active: 0, queued: 0, capacity: 1 });

      const singleton = masMocks.getMultiAgentSystemMock();
      let resolveFirst!: () => void;
      singleton.runWorkflow.mockImplementationOnce(async () => {
        await new Promise<void>((r) => (resolveFirst = r));
        return { success: true, plan: null, results: new Map(), artifacts: [], timeline: [], totalDuration: 1, summary: 'done', errors: [] };
      });

      const r1 = await o.submitWorkflow('a');
      const r2 = await o.submitWorkflow('b');
      expect(o.getStats()).toEqual({ active: 1, queued: 1, capacity: 1 });

      resolveFirst();
      if (r1.status === 'started') await r1.promise;
      if (r2.status === 'queued') await r2.promise;
      // Pool drained
      expect(o.getStats().active).toBe(0);
      expect(o.getStats().queued).toBe(0);
      o.dispose();
    });

    it('dispose rejects queued workflows', async () => {
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const singleton = masMocks.getMultiAgentSystemMock();
      let resolveFirst!: () => void;
      singleton.runWorkflow.mockImplementationOnce(async () => {
        await new Promise<void>((r) => (resolveFirst = r));
        return { success: true, plan: null, results: new Map(), artifacts: [], timeline: [], totalDuration: 1, summary: 'done', errors: [] };
      });

      const r1 = await o.submitWorkflow('a');
      const r2 = await o.submitWorkflow('b');
      o.dispose();

      if (r2.status === 'queued') {
        await expect(r2.promise).rejects.toThrow(/disposed/);
      }
      // r1 — release the block so we don't hang the test
      resolveFirst();
      if (r1.status === 'started') await r1.promise.catch(() => {});
    });

    it('rejects maxConcurrentWorkflows < 1 in constructor', () => {
      expect(() =>
        new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 0 }),
      ).toThrow(/>= 1/);
    });

    it('emits workflow:started + workflow:finished events', async () => {
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const startedEvents: unknown[] = [];
      const finishedEvents: unknown[] = [];
      o.on('workflow:started', (e) => startedEvents.push(e));
      o.on('workflow:finished', (e) => finishedEvents.push(e));

      const r = await o.submitWorkflow('a');
      if (r.status === 'started') await r.promise;
      // Allow any pending microtasks to flush
      await new Promise((res) => setTimeout(res, 10));

      expect(startedEvents).toHaveLength(1);
      expect(finishedEvents).toHaveLength(1);
      expect((finishedEvents[0] as { success: boolean }).success).toBe(true);
      o.dispose();
    });
  });
});
