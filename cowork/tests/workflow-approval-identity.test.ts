/**
 * Workflow approval answers are bound to the exact request and its run.
 *
 * REAL WorkflowBridge, current core Orchestrator and CoworkToolAgent; only the
 * tool registry, the confirmation service and userData are fixtures. The step
 * id alone identifies nothing: the next run, the next loop iteration or a
 * parallel branch can wait on an approval at the same time or later. An answer
 * must quote the approval id, run and step it was shown for; anything else —
 * including the former positional `(stepId, approved)` call — is refused, and
 * main does not rely on IPC ordering to tell them apart.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Orchestrator } from '../../src/orchestration/orchestrator.js';

vi.mock('../src/main/utils/logger', () => ({
  log: () => {},
  logWarn: () => {},
  logError: () => {},
}));

const created: Orchestrator[] = [];

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (modulePath: string) => {
    if (modulePath.startsWith('orchestration/')) {
      return {
        Orchestrator: class extends Orchestrator {
          constructor(config?: Record<string, unknown>) {
            super(config);
            created.push(this);
          }
        },
      };
    }
    if (modulePath.startsWith('tools/')) {
      return { getFormalToolRegistry: () => ({ execute: vi.fn() }), registerBuiltinTools: () => 0 };
    }
    return {
      ConfirmationService: {
        getInstance: () => ({ requestConfirmation: async () => ({ confirmed: false }) }),
      },
    };
  }),
}));

import { WorkflowBridge } from '../src/main/workflows/workflow-bridge';
import type { ServerEvent } from '../src/renderer/types';
import type { PendingApproval } from '../src/shared/workflow-types';

const CORE_TASK_TIMEOUT_MS = 300_000;

type Visual = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

function node(id: string, type: string, config?: Record<string, unknown>) {
  return { id, type, name: id, position: { x: 0, y: 0 }, ...(config ? { config } : {}) };
}

function edge(source: string, target: string, label?: string) {
  return { id: `${source}-${target}`, source, target, ...(label ? { label } : {}) };
}

const gate = (id: string) => node(id, 'approval', { message: `${id} ?`, timeoutMs: 600_000 });

function answer(approval: PendingApproval, approved: boolean) {
  return {
    approvalId: approval.approvalId,
    workflowInstanceId: approval.workflowInstanceId,
    stepId: approval.stepId,
    approved,
  };
}

let tmpDir: string;

function setup(visual: Visual) {
  const bridge = new WorkflowBridge(tmpDir);
  const sent: ServerEvent[] = [];
  bridge.setSendToRenderer((event) => sent.push(event));
  const workflow = bridge.create({ name: 'approvals', description: '', ...visual } as never);
  const approvals = () =>
    sent
      .filter((event) => event.type === 'workflow.approval_required')
      .map((event) => (event as { payload: PendingApproval }).payload);
  const completedNodes = (instanceId: string) =>
    sent
      .filter((event) => event.type === 'workflow.event')
      .map(
        (event) =>
          (event as { payload: { type: string; instanceId: string; nodeId?: string } }).payload
      )
      .filter((payload) => payload.type === 'node_completed' && payload.instanceId === instanceId)
      .map((payload) => payload.nodeId);
  return { bridge, workflow, approvals, completedNodes };
}

function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T } = { settled: false };
  void promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
}

describe('workflow approval identity (real bridge and core)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-wf-approval-id-'));
    created.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('an answer for run 1 never validates run 2 waiting on the same step; run 2’s own answer does', async () => {
    const { bridge, workflow, approvals, completedNodes } = setup({
      nodes: [node('start', 'start'), gate('gate'), node('end', 'end')],
      edges: [edge('start', 'gate'), edge('gate', 'end')],
    });

    const run1 = bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    const [first] = approvals();
    expect(first.approvalId).toEqual(expect.any(String));
    expect(first.approvalId).not.toBe('');
    await vi.advanceTimersByTimeAsync(CORE_TASK_TIMEOUT_MS + 200);
    const result1 = await run1;
    expect(result1.success).toBe(false);
    expect(first.workflowInstanceId).toBe(result1.instanceId);
    // The ended run's approval no longer holds a worker.
    expect(created[0].getAllAgents().filter((agent) => agent.status === 'busy')).toEqual([]);

    const run2 = track(bridge.run(workflow.id));
    await vi.advanceTimersByTimeAsync(0);
    const second = approvals()[1];
    expect(second).toMatchObject({ stepId: 'gate' });
    expect(second.workflowInstanceId).not.toBe(first.workflowInstanceId);
    expect(second.approvalId).not.toBe(first.approvalId);

    // What the dialog used to send, then run 1's exact answer: both refused.
    const legacyApprove = bridge.approveStep as unknown as (...args: unknown[]) => boolean;
    expect(legacyApprove.call(bridge, 'gate', true)).toBe(false);
    expect(bridge.approveStep(answer(first, true))).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run2.settled).toBe(false);
    expect(completedNodes(second.workflowInstanceId)).toEqual([]);

    expect(bridge.approveStep(answer(second, true))).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run2.settled).toBe(true);
    expect(run2.value).toMatchObject({ success: true, instanceId: second.workflowInstanceId });
    expect(completedNodes(second.workflowInstanceId)).toEqual(['gate']);
    expect(bridge.approveStep(answer(second, true))).toBe(false);
  });

  it('a loop asks again for the same step in the same run: the previous answer does not count twice', async () => {
    const { bridge, workflow, approvals } = setup({
      nodes: [
        node('start', 'start'),
        node('lp', 'loop', { condition: 'true', maxIterations: 2 }),
        gate('gate'),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'lp'),
        edge('lp', 'gate', 'body'),
        edge('lp', 'end', 'exit'),
        edge('gate', 'end'),
      ],
    });

    const run = track(bridge.run(workflow.id));
    await vi.advanceTimersByTimeAsync(0);
    const [iteration1] = approvals();
    expect(bridge.approveStep(answer(iteration1, true))).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);

    const iteration2 = approvals()[1];
    expect(iteration2).toMatchObject({
      stepId: iteration1.stepId,
      workflowInstanceId: iteration1.workflowInstanceId,
    });
    expect(iteration2.approvalId).not.toBe(iteration1.approvalId);

    expect(bridge.approveStep(answer(iteration1, true))).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run.settled).toBe(false);

    expect(bridge.approveStep(answer(iteration2, true))).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run.settled).toBe(true);
    expect(run.value).toMatchObject({ success: true });
  });

  it('parallel approvals of one run are answered each with its own identity', async () => {
    const { bridge, workflow, approvals, completedNodes } = setup({
      nodes: [
        node('start', 'start'),
        node('p', 'parallel'),
        gate('a'),
        gate('b'),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'p'),
        edge('p', 'a'),
        edge('p', 'b'),
        edge('a', 'end'),
        edge('b', 'end'),
      ],
    });

    const run = track(bridge.run(workflow.id));
    await vi.advanceTimersByTimeAsync(0);
    const pending = approvals();
    expect(pending.map((approval) => approval.stepId).sort()).toEqual(['a', 'b']);
    const a = pending.find((approval) => approval.stepId === 'a')!;
    const b = pending.find((approval) => approval.stepId === 'b')!;

    expect(bridge.approveStep({ ...answer(a, true), approvalId: b.approvalId })).toBe(false);
    expect(bridge.approveStep({ ...answer(b, true), stepId: 'a' })).toBe(false);
    expect(bridge.approveStep(answer(a, true))).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(completedNodes(a.workflowInstanceId)).toEqual(['a']);
    expect(run.settled).toBe(false);

    expect(bridge.approveStep(answer(b, true))).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run.settled).toBe(true);
    expect(run.value).toMatchObject({ success: true });
  });

  it('refuses any answer that does not carry the full identity, without resolving the approval', async () => {
    const { bridge, workflow, approvals } = setup({
      nodes: [node('start', 'start'), gate('gate'), node('end', 'end')],
      edges: [edge('start', 'gate'), edge('gate', 'end')],
    });
    expect(
      bridge.approveStep({
        approvalId: 'x',
        workflowInstanceId: 'y',
        stepId: 'gate',
        approved: true,
      })
    ).toBe(false);

    const run = track(bridge.run(workflow.id));
    await vi.advanceTimersByTimeAsync(0);
    const [pending] = approvals();

    for (const invalid of [
      'gate',
      null,
      { stepId: 'gate', approved: true },
      { ...answer(pending, true), approvalId: '' },
      { ...answer(pending, true), workflowInstanceId: undefined },
      { ...answer(pending, true), workflowInstanceId: 'wf_other' },
      { ...answer(pending, true), approvalId: 'forged' },
      { ...answer(pending, true), approved: 'yes' },
    ]) {
      expect(bridge.approveStep(invalid), JSON.stringify(invalid)).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run.settled).toBe(false);

    expect(bridge.approveStep(answer(pending, false))).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run.settled).toBe(true);
    expect(run.value).toMatchObject({ success: false });
  });
});

describe('workflow.approve IPC contract', () => {
  const read = (relative: string) =>
    fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

  it('main hands the whole answer to the bridge, with no positional stepId path', () => {
    const main = read('../src/main/index.ts');
    const start = main.indexOf("'workflow.approve'");
    const handler = main.slice(
      main.lastIndexOf('ipcMain.handle(', start),
      main.indexOf('\n);\n', start)
    );
    expect(handler).toMatch(/async \(_event, answer: unknown\): Promise<boolean>/);
    expect(handler).toMatch(/workflowBridge\.approveStep\(answer\)/);
    expect(handler).not.toMatch(/stepId/);
  });

  it('the preload sends one answer object, implementation and declaration alike', () => {
    const preload = read('../src/preload/index.ts');
    expect(preload).toMatch(
      /approve: \(answer: WorkflowApprovalAnswer\): Promise<boolean> =>\s*ipcRenderer\.invoke\('workflow\.approve', answer\)/
    );
    expect(preload).toMatch(/approve: \(answer: WorkflowApprovalAnswer\) => Promise<boolean>;/);
    expect(preload).not.toMatch(/approve: \(stepId: string, approved: boolean\)/);
  });
});
