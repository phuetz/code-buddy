/**
 * Workflow approvals, main → renderer, with the REAL bridge and core.
 *
 * Real WorkflowBridge, current core Orchestrator (unique runtime task ids) and
 * CoworkToolAgent emit the events; the real renderer store consumes them through
 * the actions `useIPC` routes them to (checked on its source). Only the tool
 * registry, the confirmation service and userData are fixtures. An approval left
 * unanswered when its run ends must leave the renderer queue, matched by the
 * run's own instance id; a late answer is still refused by main.
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

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (modulePath: string) => {
    if (modulePath.startsWith('orchestration/')) return { Orchestrator };
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
import { useAppStore } from '../src/renderer/store';
import type { ServerEvent } from '../src/renderer/types';

const CORE_TASK_TIMEOUT_MS = 300_000;

/** What `useIPC` does with the two workflow events (see the source check below). */
function deliverToRenderer(event: ServerEvent): void {
  const store = useAppStore.getState();
  if (event.type === 'workflow.event') store.applyWorkflowEvent(event.payload);
  if (event.type === 'workflow.approval_required') store.pushPendingApproval(event.payload);
}

function approvalWorkflow(bridge: WorkflowBridge) {
  return bridge.create({
    name: 'approval',
    description: '',
    nodes: [
      { id: 'start', type: 'start', name: 'start', position: { x: 0, y: 0 } },
      {
        id: 'gate',
        type: 'approval',
        name: 'gate',
        position: { x: 1, y: 0 },
        config: { message: 'ok ?', timeoutMs: 600_000 },
      },
      { id: 'end', type: 'end', name: 'end', position: { x: 2, y: 0 } },
    ],
    edges: [
      { id: 'start-gate', source: 'start', target: 'gate' },
      { id: 'gate-end', source: 'gate', target: 'end' },
    ],
  } as never);
}

let tmpDir: string;

describe('workflow approvals from the real bridge to the renderer store', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-wf-approval-flow-'));
    useAppStore.setState({ pendingApprovals: [], workflowExecutions: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    useAppStore.setState({ pendingApprovals: [], workflowExecutions: {} });
  });

  it('useIPC routes both workflow events to these store actions', () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL('../src/renderer/hooks/useIPC.ts', import.meta.url)),
      'utf8'
    );
    expect(source).toMatch(
      /case 'workflow\.event':\s*store\.applyWorkflowEvent\(event\.payload\);/
    );
    expect(source).toMatch(
      /case 'workflow\.approval_required':\s*store\.pushPendingApproval\(event\.payload\);/
    );
  });

  it('drops an unanswered approval when its run times out, and main still refuses the late answer', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const sent: ServerEvent[] = [];
    bridge.setSendToRenderer((event) => {
      sent.push(event);
      deliverToRenderer(event);
    });
    const workflow = approvalWorkflow(bridge);

    const run = bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    const [pending] = useAppStore.getState().pendingApprovals;
    expect(pending).toMatchObject({ stepId: 'gate', message: 'ok ?' });

    await vi.advanceTimersByTimeAsync(CORE_TASK_TIMEOUT_MS + 200);
    const result = await run;
    expect(result.success).toBe(false);

    const terminal = sent
      .filter((event) => event.type === 'workflow.event')
      .map((event) => (event as { payload: { type: string; instanceId: string } }).payload)
      .find((payload) => payload.type === 'failed');
    expect(terminal?.instanceId).toBe(result.instanceId);
    expect(pending.workflowInstanceId).toBe(result.instanceId);
    expect(useAppStore.getState().pendingApprovals).toEqual([]);

    // The dialog is gone; an exact answer that was already on its way is refused
    // (main cancelled the ended run's approval) and changes nothing.
    const publishedBeforeLateAnswer = sent.length;
    expect(
      bridge.approveStep({
        approvalId: pending.approvalId,
        workflowInstanceId: pending.workflowInstanceId,
        stepId: pending.stepId,
        approved: true,
      })
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.slice(publishedBeforeLateAnswer)).toEqual([]);
    expect(useAppStore.getState().workflowExecutions[result.instanceId!]?.status).toBe('failed');
  });

  it('a promptly approved run completes and leaves no approval behind', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    bridge.setSendToRenderer(deliverToRenderer);
    const workflow = approvalWorkflow(bridge);

    const run = bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    const [pending] = useAppStore.getState().pendingApprovals;
    expect(
      bridge.approveStep({
        approvalId: pending.approvalId,
        workflowInstanceId: pending.workflowInstanceId,
        stepId: pending.stepId,
        approved: true,
      })
    ).toBe(true);
    useAppStore.getState().removePendingApproval(pending.approvalId);
    await vi.advanceTimersByTimeAsync(500);

    const result = await run;
    expect(result.success).toBe(true);
    expect(useAppStore.getState().workflowExecutions[result.instanceId!]?.status).toBe('completed');
    expect(useAppStore.getState().pendingApprovals).toEqual([]);
  });
});
