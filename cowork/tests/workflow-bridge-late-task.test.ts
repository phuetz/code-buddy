/**
 * WorkflowBridge — a tool task that outlives its run.
 *
 * The core Orchestrator gives up on a task after its timeout, so a run can end
 * while the bridge's `task_assigned` handler is still awaiting the tool. When
 * that tool finally answers, its node event must not be recorded into the next
 * run's persisted history. Fixture orchestrator and tool agent only: no real
 * tool, LLM or workflow runs.
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/utils/logger', () => ({
  log: () => {},
  logWarn: () => {},
  logError: () => {},
}));

type Instance = Record<string, unknown>;
type Script = (orchestrator: FakeOrchestrator) => Promise<Instance>;

class FakeOrchestrator extends EventEmitter {
  static scripts: Script[] = [];
  tasks = new Map<string, unknown>();
  registerAgent(): void {}
  start(): void {}
  processQueue(): void {}
  getTask(taskId: string): unknown {
    return this.tasks.get(taskId);
  }
  completeTask(): void {}
  failTask(): void {}
  startWorkflow(): Promise<Instance> {
    return FakeOrchestrator.scripts.shift()!(this);
  }
}

const pendingTools: Array<(output: Record<string, unknown>) => void> = [];

vi.mock('../src/main/workflows/cowork-tool-agent', () => ({
  COWORK_TOOL_AGENT_ID: 'cowork-tool-runner',
  CoworkToolAgent: class {
    runToolInvoke(): Promise<Record<string, unknown>> {
      return new Promise((resolve) => pendingTools.push(resolve));
    }
    cancelPending(): void {}
  },
}));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (modulePath: string) =>
    modulePath.startsWith('orchestration/')
      ? { Orchestrator: FakeOrchestrator }
      : { getFormalToolRegistry: () => ({}), registerBuiltinTools: () => 0 }
  ),
}));

import { WorkflowBridge } from '../src/main/workflows/workflow-bridge';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-wf-late-'));

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('WorkflowBridge late task answers', () => {
  it('never records a finished run’s late node event into the next run, nor publishes it', async () => {
    const bridge = new WorkflowBridge(tmpDir);
    const sent: Array<{ type: string; payload?: { type?: string; instanceId?: string } }> = [];
    bridge.setSendToRenderer((event) => sent.push(event as never));
    const workflow = bridge.create({
      name: 'late tool',
      description: '',
      nodes: [
        { id: 'start', type: 'start', name: 'start', position: { x: 0, y: 0 } },
        {
          id: 't1',
          type: 'tool',
          name: 't1',
          position: { x: 0, y: 0 },
          config: { toolName: 'view_file', toolInput: { path: 'README.md' } },
        },
        { id: 'end', type: 'end', name: 'end', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: 'start-t1', source: 'start', target: 't1' },
        { id: 't1-end', source: 't1', target: 'end' },
      ],
    } as never);

    let finishSecond!: (instance: Instance) => void;
    FakeOrchestrator.scripts.push(
      async (orchestrator) => {
        orchestrator.emit('workflow_started', { instanceId: 'inst-1' });
        // Like the real core at `task_assigned`, the task is reported as running.
        orchestrator.tasks.set('task-1', {
          status: 'in_progress',
          definition: { type: 'tool_invoke', input: { cowork_visual_node_id: 't1' } },
        });
        orchestrator.emit('task_assigned', { taskId: 'task-1', agentId: 'cowork-tool-runner' });
        // The core timed the task out: the run ends while the tool is still busy, and
        // the real Orchestrator abandons the task (proved against the real core in
        // tests/orchestration/orchestrator-abandoned-tasks.test.ts and
        // workflow-bridge-late-confirmation.test.ts).
        (orchestrator.tasks.get('task-1') as { status?: string }).status = 'cancelled';
        return {
          instanceId: 'inst-1',
          status: 'failed',
          error: 'Task timeout',
          completedSteps: [],
        };
      },
      (orchestrator) => {
        orchestrator.emit('workflow_started', { instanceId: 'inst-2' });
        return new Promise((resolve) => {
          finishSecond = resolve;
        });
      }
    );

    const first = await bridge.run(workflow.id);
    expect(first.success).toBe(false);
    expect(pendingTools).toHaveLength(1);

    const secondRun = bridge.run(workflow.id);
    await flush();
    const publishedBeforeLateAnswer = sent.length;
    pendingTools[0]({ content: 'late answer from the first run' });
    await flush();
    expect(
      sent
        .slice(publishedBeforeLateAnswer)
        .filter(
          (event) => event.type === 'workflow.event' && event.payload?.instanceId === 'inst-1'
        )
    ).toEqual([]);
    finishSecond({ instanceId: 'inst-2', status: 'completed', output: {}, completedSteps: [] });
    const second = await secondRun;

    const record = bridge.history(workflow.id).find((run) => run.id === second.runId);
    expect(record).toBeDefined();
    expect(record!.events.map((event) => event.instanceId)).toEqual(['inst-2', 'inst-2']);
  });
});
