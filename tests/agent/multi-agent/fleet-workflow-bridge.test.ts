/**
 * Phase (d).3 V0.4.1 — fleet workflow event broadcast tests.
 *
 * Validates that the WorkflowOrchestrator broadcasts fleet:workflow:start,
 * fleet:workflow:event, and fleet:workflow:complete when CODEBUDDY_FLEET_STREAM
 * is set, and stays silent when it isn't.
 */

// Set unique paths per test file BEFORE imports.
import path from 'path';
import os from 'os';
process.env.CODEBUDDY_WORKFLOWS_DIR = path.join(
  os.tmpdir(),
  `codebuddy-workflows-test-${process.pid}-fleet`,
);

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const broadcastFleetEventMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/server/websocket/fleet-bridge.js', () => ({
  broadcastFleetEvent: broadcastFleetEventMock,
}));

const masMocks = vi.hoisted(() => {
  function makeFakeMAS() {
    const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    const onceHandlers = new Map<string, Array<(...a: unknown[]) => void>>();
    return {
      runWorkflow: vi.fn(async (goal: string) => {
        // Fire workflow:start synchronously after a tick
        const startListeners = onceHandlers.get('workflow:start') ?? [];
        for (const h of startListeners) h({ plan: { goal } });
        onceHandlers.set('workflow:start', []);

        // Fire workflow:event for a task_completed
        const eventListeners = handlers.get('workflow:event') ?? [];
        for (const h of eventListeners) {
          h({ type: 'task_completed', message: 't1 done', timestamp: new Date(), data: {} });
        }

        // Fire workflow:complete
        const completeListeners = onceHandlers.get('workflow:complete') ?? [];
        const result = {
          success: true,
          plan: { id: 'p', goal, summary: '', phases: [], estimatedComplexity: 'simple', requiredAgents: [], createdAt: new Date(), status: 'completed' },
          results: new Map(),
          artifacts: [],
          timeline: [],
          totalDuration: 100,
          summary: `done: ${goal}`,
          errors: [],
        };
        for (const h of completeListeners) h({ result });
        onceHandlers.set('workflow:complete', []);

        return result;
      }),
      stop: vi.fn(),
      dispose: vi.fn(),
      on: vi.fn((event: string, h: (...a: unknown[]) => void) => {
        const list = handlers.get(event) || [];
        list.push(h);
        handlers.set(event, list);
      }),
      off: vi.fn(),
      once: vi.fn((event: string, h: (...a: unknown[]) => void) => {
        const list = onceHandlers.get(event) || [];
        list.push(h);
        onceHandlers.set(event, list);
      }),
      removeListener: vi.fn(),
    };
  }

  let singletonInstance: ReturnType<typeof makeFakeMAS> | null = null;
  const getMultiAgentSystemMock = vi.fn(() => {
    if (!singletonInstance) singletonInstance = makeFakeMAS();
    return singletonInstance;
  });
  const createMultiAgentSystemMock = vi.fn(() => makeFakeMAS());
  const resetMultiAgentSystemMock = vi.fn(() => { singletonInstance = null; });

  return {
    getMultiAgentSystemMock, createMultiAgentSystemMock, resetMultiAgentSystemMock,
    reset: () => { singletonInstance = null; },
  };
});

vi.mock('../../../src/agent/multi-agent/multi-agent-system.js', () => ({
  getMultiAgentSystem: masMocks.getMultiAgentSystemMock,
  createMultiAgentSystem: masMocks.createMultiAgentSystemMock,
  resetMultiAgentSystem: masMocks.resetMultiAgentSystemMock,
}));

vi.mock('../../../src/agent/multi-agent/workflow-event-streamer.js', () => ({
  attachStreamer: vi.fn(() => ({ detach: vi.fn() })),
}));

import {
  WorkflowOrchestrator,
  resetWorkflowOrchestrator,
  _resetWorkflowCounterForTests,
} from '../../../src/agent/multi-agent/workflow-orchestrator.js';

describe('fleet workflow events — Phase (d).3 V0.4.1', () => {
  beforeEach(() => {
    broadcastFleetEventMock.mockReset();
    masMocks.reset();
    masMocks.getMultiAgentSystemMock.mockClear();
    masMocks.createMultiAgentSystemMock.mockClear();
    _resetWorkflowCounterForTests();
    resetWorkflowOrchestrator();
    delete process.env.CODEBUDDY_FLEET_STREAM;
  });

  afterEach(() => {
    resetWorkflowOrchestrator();
    delete process.env.CODEBUDDY_FLEET_STREAM;
  });

  describe('opt-in gating', () => {
    it('no fleet broadcasts when CODEBUDDY_FLEET_STREAM is unset', async () => {
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const r = await o.submitWorkflow('test-goal');
      if (r.status === 'started') await r.promise;
      expect(broadcastFleetEventMock).not.toHaveBeenCalled();
      o.dispose();
    });

    it('emits fleet:workflow:start when CODEBUDDY_FLEET_STREAM=1', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const r = await o.submitWorkflow('streaming-goal');
      if (r.status === 'started') await r.promise;

      const startCall = broadcastFleetEventMock.mock.calls.find(
        (c) => c[0] === 'fleet:workflow:start',
      );
      expect(startCall).toBeDefined();
      const payload = startCall![1] as { workflowId: string; goal: string; strategy: string };
      expect(payload.workflowId).toMatch(/^wf-/);
      expect(payload.goal).toBe('streaming-goal');
      o.dispose();
    });

    it('emits fleet:workflow:event for each MAS event', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const r = await o.submitWorkflow('event-goal');
      if (r.status === 'started') await r.promise;
      // Fleet broadcasts are synchronous; r.promise completes the workflow.

      const allTypes = broadcastFleetEventMock.mock.calls.map((c) => c[0]);
      const eventCalls = broadcastFleetEventMock.mock.calls.filter(
        (c) => c[0] === 'fleet:workflow:event',
      );
      expect(eventCalls.length, `Got types: ${JSON.stringify(allTypes)}`).toBeGreaterThan(0);
      const firstEventPayload = eventCalls[0][1] as { workflowId: string; event: { type: string } };
      expect(firstEventPayload.event.type).toBe('task_completed');
      o.dispose();
    });

    it('emits fleet:workflow:complete with success + duration', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const r = await o.submitWorkflow('complete-goal');
      if (r.status === 'started') await r.promise;

      const completeCall = broadcastFleetEventMock.mock.calls.find(
        (c) => c[0] === 'fleet:workflow:complete',
      );
      expect(completeCall).toBeDefined();
      const payload = completeCall![1] as {
        workflowId: string;
        success: boolean;
        summary: string;
        durationMs: number;
      };
      expect(payload.success).toBe(true);
      expect(payload.summary).toContain('done:');
      expect(payload.durationMs).toBe(100);
      o.dispose();
    });

    it('does NOT emit on CODEBUDDY_FLEET_STREAM=0', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '0';
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const r = await o.submitWorkflow('no-fleet');
      if (r.status === 'started') await r.promise;
      expect(broadcastFleetEventMock).not.toHaveBeenCalled();
      o.dispose();
    });

    it('all fleet events carry workflowId in payload', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const r = await o.submitWorkflow('id-test');
      if (r.status === 'started') await r.promise;

      for (const call of broadcastFleetEventMock.mock.calls) {
        const payload = call[1] as { workflowId?: string };
        expect(payload.workflowId).toMatch(/^wf-/);
      }
      o.dispose();
    });

    it('fleet broadcast errors are swallowed (best-effort)', async () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      broadcastFleetEventMock.mockImplementation(() => {
        throw new Error('WS server not running');
      });
      const o = new WorkflowOrchestrator({ apiKey: 'k', maxConcurrentWorkflows: 1 });
      const r = await o.submitWorkflow('error-tolerance');
      if (r.status === 'started') {
        await expect(r.promise).resolves.toBeDefined();
      }
      o.dispose();
    });
  });
});
