/**
 * WorkflowBridge + REAL Orchestrator + REAL CoworkToolAgent — answers that
 * arrive after the run is over.
 *
 * Only the tool registry, the confirmation service and userData are fixtures.
 * The core times the task out (defaultTimeout, 5 min), fails the workflow and
 * abandons the task. A confirmation given afterwards must not run the tool nor
 * publish a node event for the finished instance; the worker the executor kept
 * busy is released by its report. An approval of the ended run is cancelled by
 * the bridge (worker released) and its late answer refused. Normal runs are
 * unchanged.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Orchestrator } from '../../src/orchestration/orchestrator.js';

vi.mock('../src/main/utils/logger', () => ({
  log: () => {},
  logWarn: () => {},
  logError: () => {},
}));

const created: Orchestrator[] = [];
const registry = {
  execute: vi.fn(async (toolName: string) => ({
    success: true,
    output: 'written',
    toolName,
    duration: 1,
  })),
};
const confirmationAnswers: Array<Promise<{ confirmed: boolean }>> = [];
const requestConfirmation = vi.fn(() => confirmationAnswers.shift()!);

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
      return { getFormalToolRegistry: () => registry, registerBuiltinTools: () => 0 };
    }
    return { ConfirmationService: { getInstance: () => ({ requestConfirmation }) } };
  }),
}));

import { WorkflowBridge } from '../src/main/workflows/workflow-bridge';
import type { ServerEvent } from '../src/renderer/types';
import type { PendingApproval } from '../src/shared/workflow-types';

const CORE_TASK_TIMEOUT_MS = 300_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function at(x: number) {
  return { x, y: 0 };
}

function linear(middle: Record<string, unknown>) {
  return {
    name: 'late answers',
    description: '',
    nodes: [
      { id: 'start', type: 'start', name: 'start', position: at(0) },
      { id: 'mid', name: 'mid', position: at(1), ...middle },
      { id: 'end', type: 'end', name: 'end', position: at(2) },
    ],
    edges: [
      { id: 'start-mid', source: 'start', target: 'mid' },
      { id: 'mid-end', source: 'mid', target: 'end' },
    ],
  } as never;
}

/** The answer the dialog sends for the last approval shown: full identity. */
function answerLastApproval(events: ServerEvent[], approved: boolean) {
  const approval = events
    .filter((event) => event.type === 'workflow.approval_required')
    .map((event) => (event as { payload: PendingApproval }).payload)
    .at(-1)!;
  return {
    approvalId: approval.approvalId,
    workflowInstanceId: approval.workflowInstanceId,
    stepId: approval.stepId,
    approved,
  };
}

function nodeEvents(events: ServerEvent[]) {
  return events
    .filter((event) => event.type === 'workflow.event')
    .map((event) => (event as { payload: { type: string; instanceId: string } }).payload)
    .filter((payload) => payload.type === 'node_completed' || payload.type === 'node_failed');
}

let tmpDir: string;

describe('WorkflowBridge answers after the run ended (real Orchestrator)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-wf-late-confirm-'));
    created.length = 0;
    confirmationAnswers.length = 0;
    registry.execute.mockClear();
    requestConfirmation.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not run a tool confirmed after its run timed out, nor publish its node event', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const sent: ServerEvent[] = [];
    bridge.setSendToRenderer((event) => sent.push(event));
    const workflow = bridge.create(
      linear({ type: 'tool', config: { toolName: 'write_file', toolInput: { path: 'x.txt' } } })
    );
    const confirmation = deferred<{ confirmed: boolean }>();
    confirmationAnswers.push(confirmation.promise);

    const run = bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CORE_TASK_TIMEOUT_MS + 200);
    const result = await run;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Task timeout');
    const publishedBeforeAnswer = sent.length;

    confirmation.resolve({ confirmed: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(registry.execute).not.toHaveBeenCalled();
    expect(nodeEvents(sent.slice(publishedBeforeAnswer))).toEqual([]);
    expect(created[0].getAllAgents().filter((agent) => agent.status === 'busy')).toEqual([]);
  });

  it('refuses an approval answered after its run timed out, without publishing a node event', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const sent: ServerEvent[] = [];
    bridge.setSendToRenderer((event) => sent.push(event));
    const workflow = bridge.create(
      linear({ type: 'approval', config: { message: 'ok ?', timeoutMs: 600_000 } })
    );

    const run = bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.some((event) => event.type === 'workflow.approval_required')).toBe(true);
    await vi.advanceTimersByTimeAsync(CORE_TASK_TIMEOUT_MS + 200);
    expect((await run).success).toBe(false);
    const publishedBeforeAnswer = sent.length;

    // The run ended: main cancelled its approval, so even its exact answer is refused.
    expect(bridge.approveStep(answerLastApproval(sent, true))).toBe(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(nodeEvents(sent.slice(publishedBeforeAnswer))).toEqual([]);
    expect(registry.execute).not.toHaveBeenCalled();
    expect(created[0].getAllAgents().filter((agent) => agent.status === 'busy')).toEqual([]);
  });

  it('does not run a tool whose task the core no longer reports as running', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const workflow = bridge.create(
      linear({ type: 'tool', config: { toolName: 'write_file', toolInput: { path: 'x.txt' } } })
    );
    const confirmation = deferred<{ confirmed: boolean }>();
    confirmationAnswers.push(confirmation.promise);
    void bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(requestConfirmation).toHaveBeenCalledTimes(1);

    // No proof of activity: the core returns no task (or no status) for it.
    vi.spyOn(created[0], 'getTask').mockReturnValue(undefined);
    confirmation.resolve({ confirmed: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(registry.execute).not.toHaveBeenCalled();
  });

  it('does not run a tool confirmed after the bridge shut down, nor start work afterwards', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const sent: ServerEvent[] = [];
    bridge.setSendToRenderer((event) => sent.push(event));
    const workflow = bridge.create(
      linear({ type: 'tool', config: { toolName: 'write_file', toolInput: { path: 'x.txt' } } })
    );
    const confirmation = deferred<{ confirmed: boolean }>();
    confirmationAnswers.push(confirmation.promise, Promise.resolve({ confirmed: true }));

    const firstRun = bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    const publishedBeforeShutdown = sent.length;

    bridge.shutdown();
    confirmation.resolve({ confirmed: true });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(registry.execute).not.toHaveBeenCalled();
    expect(nodeEvents(sent.slice(publishedBeforeShutdown))).toEqual([]);
    await vi.advanceTimersByTimeAsync(CORE_TASK_TIMEOUT_MS + 200);
    expect((await firstRun).success).toBe(false);

    // A run requested after shutdown is refused at once, without waiting for the core
    // timeout (see workflow-bridge-shutdown.test.ts): no confirmation, no tool.
    const lateRun = await bridge.run(workflow.id);
    expect(lateRun).toMatchObject({ success: false, error: expect.stringMatching(/shut down/i) });
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(registry.execute).not.toHaveBeenCalled();
  });

  it('still runs a promptly confirmed tool and publishes its node event', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const sent: ServerEvent[] = [];
    bridge.setSendToRenderer((event) => sent.push(event));
    const workflow = bridge.create(
      linear({ type: 'tool', config: { toolName: 'write_file', toolInput: { path: 'x.txt' } } })
    );
    confirmationAnswers.push(Promise.resolve({ confirmed: true }));

    const run = bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(500);
    const result = await run;

    expect(result.success).toBe(true);
    expect(registry.execute).toHaveBeenCalledTimes(1);
    expect(nodeEvents(sent)).toEqual([
      expect.objectContaining({ type: 'node_completed', instanceId: result.instanceId }),
    ]);
  });

  it('still completes a promptly approved step', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const sent: ServerEvent[] = [];
    bridge.setSendToRenderer((event) => sent.push(event));
    const workflow = bridge.create(linear({ type: 'approval', config: { message: 'ok ?' } }));

    const run = bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.approveStep(answerLastApproval(sent, true))).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    const result = await run;

    expect(result.success).toBe(true);
    expect(nodeEvents(sent)).toEqual([
      expect.objectContaining({ type: 'node_completed', instanceId: result.instanceId }),
    ]);
  });
});
