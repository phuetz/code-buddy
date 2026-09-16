/**
 * WorkflowBridge.shutdown() — nothing starts afterwards, not even later.
 *
 * Real WorkflowBridge, REAL core Orchestrator and REAL CoworkToolAgent. Only the
 * core imports, the tool registry, the confirmation service and userData are
 * fixtures; an import can be held to shut the bridge down while the orchestrator
 * is still booting. A run requested after shutdown must be refused at once — no
 * core task, no timer left waiting for the core timeout (5 min), no run record —
 * and a boot that finishes after shutdown must never start dispatching.
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
const started: Orchestrator[] = [];
const workflowsStarted: Orchestrator[] = [];
const heldImports = new Map<string, Promise<void>>();
const registry = {
  execute: vi.fn(async (toolName: string) => ({
    success: true,
    output: 'written',
    toolName,
    duration: 1,
  })),
};
const requestConfirmation = vi.fn(async () => ({ confirmed: true }));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (modulePath: string) => {
    for (const [prefix, held] of heldImports) {
      if (modulePath.startsWith(prefix)) await held;
    }
    if (modulePath.startsWith('orchestration/')) {
      return {
        Orchestrator: class extends Orchestrator {
          constructor(config?: Record<string, unknown>) {
            super(config);
            created.push(this);
          }
          start(): void {
            started.push(this);
            super.start();
          }
          startWorkflow(...args: Parameters<Orchestrator['startWorkflow']>) {
            workflowsStarted.push(this);
            return super.startWorkflow(...args);
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

import { loadCoreModule } from '../src/main/utils/core-loader';
import { WorkflowBridge } from '../src/main/workflows/workflow-bridge';

type Outcome<T> = { settled: true; value: T } | { settled: false };

/** Real event-loop turns only: the core's timers (setTimeout) stay frozen. */
async function settledNow<T>(promise: Promise<T>): Promise<Outcome<T>> {
  let outcome: Outcome<T> = { settled: false };
  void promise.then((value) => {
    outcome = { settled: true, value };
  });
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return outcome;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const refusedAfterShutdown = {
  settled: true,
  value: expect.objectContaining({
    success: false,
    status: 'failed',
    error: expect.stringMatching(/shut down/i),
  }),
};

let tmpDir: string;

function writeWorkflow(bridge: WorkflowBridge) {
  return bridge.create({
    name: 'shutdown',
    description: '',
    nodes: [
      { id: 'start', type: 'start', name: 'start', position: { x: 0, y: 0 } },
      {
        id: 'write',
        type: 'tool',
        name: 'write',
        position: { x: 1, y: 0 },
        config: { toolName: 'write_file', toolInput: { path: 'x.txt' } },
      },
      { id: 'end', type: 'end', name: 'end', position: { x: 2, y: 0 } },
    ],
    edges: [
      { id: 'start-write', source: 'start', target: 'write' },
      { id: 'write-end', source: 'write', target: 'end' },
    ],
  } as never);
}

describe('WorkflowBridge after shutdown (real Orchestrator)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-wf-shutdown-'));
    created.length = 0;
    started.length = 0;
    workflowsStarted.length = 0;
    heldImports.clear();
    registry.execute.mockClear();
    requestConfirmation.mockClear();
    vi.mocked(loadCoreModule).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refuses a run requested after shutdown at once, without booting the core or recording a run', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const workflow = writeWorkflow(bridge);

    bridge.shutdown();
    expect(() => bridge.shutdown()).not.toThrow();

    expect(await settledNow(bridge.run(workflow.id))).toEqual(refusedAfterShutdown);
    expect(loadCoreModule).not.toHaveBeenCalled();
    expect(created).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(registry.execute).not.toHaveBeenCalled();
    expect(bridge.history(workflow.id)).toEqual([]);
  });

  it('refuses a run and a replay at once when the orchestrator was already running', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const workflow = writeWorkflow(bridge);
    const first = bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(500);
    const firstResult = await first;
    expect(firstResult.success).toBe(true);
    expect(registry.execute).toHaveBeenCalledTimes(1);
    const timersBefore = vi.getTimerCount();

    bridge.shutdown();

    expect(await settledNow(bridge.run(workflow.id))).toEqual(refusedAfterShutdown);
    expect(await settledNow(bridge.replay(firstResult.runId!))).toEqual(refusedAfterShutdown);
    expect(workflowsStarted).toHaveLength(1);
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(registry.execute).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(timersBefore);
    expect(bridge.history(workflow.id)).toHaveLength(1);
  });

  it('does not record a rejected replay of redacted history after shutdown', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const workflow = writeWorkflow(bridge);
    const first = bridge.run(workflow.id, { apiKey: 'fixture-secret' });
    await vi.advanceTimersByTimeAsync(500);
    const firstResult = await first;
    expect(firstResult.success).toBe(true);
    expect(bridge.history(workflow.id)[0]?.initialContext.apiKey).toBe('[REDACTED]');

    bridge.shutdown();
    const historyBeforeReplay = bridge.history(workflow.id);

    expect(await settledNow(bridge.replay(firstResult.runId!))).toEqual(refusedAfterShutdown);
    expect(bridge.history(workflow.id)).toEqual(historyBeforeReplay);
    expect(workflowsStarted).toHaveLength(1);
  });

  it('never starts a run requested in the same tick as shutdown on a running orchestrator', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const workflow = writeWorkflow(bridge);
    const first = bridge.run(workflow.id);
    await vi.advanceTimersByTimeAsync(500);
    expect((await first).success).toBe(true);
    const timersBefore = vi.getTimerCount();

    const run = bridge.run(workflow.id);
    bridge.shutdown();

    expect(await settledNow(run)).toEqual(refusedAfterShutdown);
    expect(workflowsStarted).toHaveLength(1);
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(registry.execute).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it.each(['orchestration/', 'tools/'])(
    'never starts dispatching when shut down while the boot is still importing %s',
    async (heldPrefix) => {
      const bridge = new WorkflowBridge(tmpDir);
      const workflow = writeWorkflow(bridge);
      const held = deferred();
      heldImports.set(heldPrefix, held.promise);

      const run = bridge.run(workflow.id);
      expect(await settledNow(run)).toEqual({ settled: false });
      expect(vi.mocked(loadCoreModule).mock.calls.at(-1)?.[0]).toMatch(
        new RegExp(`^${heldPrefix}`)
      );

      bridge.shutdown();
      held.resolve();

      expect(await settledNow(run)).toEqual(refusedAfterShutdown);
      expect(started).toEqual([]);
      expect(workflowsStarted).toEqual([]);
      expect(requestConfirmation).not.toHaveBeenCalled();
      expect(registry.execute).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      // Later requests change nothing: no new boot, still no dispatch.
      const importsSoFar = vi.mocked(loadCoreModule).mock.calls.length;
      expect(await settledNow(bridge.run(workflow.id))).toEqual(refusedAfterShutdown);
      expect(vi.mocked(loadCoreModule).mock.calls).toHaveLength(importsSoFar);
      await vi.advanceTimersByTimeAsync(300_000 + 200);
      expect(started).toEqual([]);
      expect(registry.execute).not.toHaveBeenCalled();
    }
  );
});
