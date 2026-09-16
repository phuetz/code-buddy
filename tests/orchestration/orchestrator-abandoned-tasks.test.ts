/**
 * Orchestrator — tasks left behind by a workflow that already ended.
 *
 * Uses the REAL Orchestrator. The executor is only a `task_assigned` listener
 * that records assignments and reports back when the test says so (a late
 * result, a late error, an approval answered after the timeout). Every
 * conclusion is read from the orchestrator's own state: task status, worker
 * reservation, queue dispatch, stats and events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import type {
  TaskDefinition,
  WorkflowDefinition,
  WorkflowStep,
} from '../../src/orchestration/types.js';

const TIMEOUT_MS = 300;

function task(id: string): TaskDefinition {
  return {
    id,
    type: 'tool_invoke',
    name: id,
    description: '',
    input: {},
    priority: 'medium',
    requiredCapabilities: ['tool_invoke'],
  };
}

function taskStep(taskId: string): WorkflowStep {
  return {
    id: `step-${taskId}`,
    name: taskId,
    type: 'task',
    tasks: [task(taskId)],
  } as WorkflowStep;
}

function workflow(id: string, steps: WorkflowStep[]): WorkflowDefinition {
  return { id, name: id, description: '', steps } as WorkflowDefinition;
}

/** Two parallel tasks: with one worker, the second waits in the queue. */
function fanOut(id: string, first: string, second: string): WorkflowDefinition {
  return workflow(id, [
    {
      id: `${id}-fan`,
      name: 'fan',
      type: 'parallel',
      branches: [[taskStep(first)], [taskStep(second)]],
    } as WorkflowStep,
  ]);
}

function setUp() {
  const orchestrator = new Orchestrator({ defaultTimeout: TIMEOUT_MS, logLevel: 'error' });
  orchestrator.registerAgent({
    id: 'worker-1',
    name: 'worker',
    role: 'executor',
    description: '',
    capabilities: { tools: [], maxConcurrency: 1, taskTypes: ['tool_invoke'] },
  } as never);
  const assigned: string[] = [];
  const assignedTaskIds: string[] = [];
  const createdTaskIds = new Map<string, string[]>();
  const completedEvents: string[] = [];
  orchestrator.on('task_assigned', (evt: { taskId: string }) => {
    assignedTaskIds.push(evt.taskId);
    assigned.push(orchestrator.getTask(evt.taskId)?.definition.name ?? evt.taskId);
  });
  orchestrator.on('task_completed', (evt: { taskId: string }) => {
    completedEvents.push(orchestrator.getTask(evt.taskId)?.definition.name ?? evt.taskId);
  });
  // Same wiring as the Cowork bridge: new tasks are dispatched on the next microtask.
  orchestrator.on('task_created', (evt: { task: { definition: { id: string; name: string } } }) => {
    const ids = createdTaskIds.get(evt.task.definition.name) ?? [];
    ids.push(evt.task.definition.id);
    createdTaskIds.set(evt.task.definition.name, ids);
    queueMicrotask(() => orchestrator.processQueue());
  });
  orchestrator.start();
  return { orchestrator, assigned, assignedTaskIds, createdTaskIds, completedEvents };
}

function taskId(createdTaskIds: Map<string, string[]>, logicalId: string, occurrence = 0): string {
  const id = createdTaskIds.get(logicalId)?.[occurrence];
  if (!id) throw new Error(`No runtime task for ${logicalId} occurrence ${occurrence}`);
  return id;
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('Orchestrator tasks abandoned by an ended workflow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not dispatch a queued task of a timed-out run once its worker is released', async () => {
    const { orchestrator, assigned, createdTaskIds } = setUp();
    const run1 = orchestrator.startWorkflow(fanOut('run1', 'run1-a', 'run1-b'), {});
    await advance(0);
    expect(assigned).toEqual(['run1-a']);
    expect(orchestrator.getTask(taskId(createdTaskIds, 'run1-b'))?.status).toBe('queued');

    await advance(TIMEOUT_MS + 100);
    expect((await run1).status).toBe('failed');

    const run2 = orchestrator.startWorkflow(workflow('run2', [taskStep('run2-c')]), {});
    await advance(0);
    // The executor of run1-a finally answers.
    orchestrator.completeTask(taskId(createdTaskIds, 'run1-a'), { late: true });
    await advance(0);

    expect(assigned).not.toContain('run1-b');
    expect(assigned).toContain('run2-c');
    orchestrator.completeTask(taskId(createdTaskIds, 'run2-c'), { ok: true });
    await advance(200);
    expect((await run2).status).toBe('completed');
  });

  it('keeps a late result from completing the abandoned task or counting it', async () => {
    const { orchestrator, createdTaskIds, completedEvents } = setUp();
    const run1 = orchestrator.startWorkflow(workflow('run1', [taskStep('run1-a')]), {});
    await advance(0);
    await advance(TIMEOUT_MS + 100);
    expect((await run1).status).toBe('failed');
    const completedBefore = orchestrator.getStats().completedTasks;

    const runtimeTaskId = taskId(createdTaskIds, 'run1-a');
    orchestrator.cancelTask(runtimeTaskId);
    expect(orchestrator.getAgent('worker-1')?.status).toBe('busy');
    orchestrator.completeTask(runtimeTaskId, { late: true });

    expect(orchestrator.getTask(runtimeTaskId)?.status).not.toBe('completed');
    expect(orchestrator.getTask(runtimeTaskId)?.output).toBeUndefined();
    expect(orchestrator.getStats().completedTasks).toBe(completedBefore);
    expect(completedEvents).not.toContain('run1-a');
    // Its worker, still reserved by that executor, is released by the report.
    expect(orchestrator.getAgent('worker-1')?.status).toBe('idle');
  });

  it('does not requeue an abandoned task when its executor reports a late retryable error', async () => {
    const { orchestrator, assigned, createdTaskIds } = setUp();
    const retryable = { ...task('run1-a'), maxRetries: 2 };
    const run1 = orchestrator.startWorkflow(
      workflow('run1', [{ id: 's', name: 's', type: 'task', tasks: [retryable] } as WorkflowStep]),
      {}
    );
    await advance(0);
    await advance(TIMEOUT_MS + 100);
    expect((await run1).status).toBe('failed');

    const runtimeTaskId = taskId(createdTaskIds, 'run1-a');
    orchestrator.failTask(runtimeTaskId, 'late network error');
    await advance(0);

    expect(orchestrator.getTask(runtimeTaskId)?.status).not.toBe('queued');
    expect(assigned.filter((id) => id === 'run1-a')).toHaveLength(1);
  });

  it('never frees a worker that has since been given another task', async () => {
    const { orchestrator, assigned, createdTaskIds } = setUp();
    const run1 = orchestrator.startWorkflow(workflow('run1', [taskStep('run1-a')]), {});
    await advance(0);
    const run1TaskId = taskId(createdTaskIds, 'run1-a');
    // Explicit cancellation releases the worker before the old executor answers.
    orchestrator.cancelTask(run1TaskId);
    await advance(100);
    await run1;
    const run2 = orchestrator.startWorkflow(workflow('run2', [taskStep('run2-c')]), {});
    await advance(0);
    expect(assigned).toContain('run2-c');
    const run2TaskId = taskId(createdTaskIds, 'run2-c');
    expect(orchestrator.getAgent('worker-1')?.currentTask).toBe(run2TaskId);

    // The approval of run1-a is answered long after: its report arrives now.
    orchestrator.completeTask(run1TaskId, { approved: true });

    expect(orchestrator.getAgent('worker-1')?.status).toBe('busy');
    expect(orchestrator.getAgent('worker-1')?.currentTask).toBe(run2TaskId);
    orchestrator.completeTask(run2TaskId, { ok: true });
    await advance(200);
    expect((await run2).status).toBe('completed');
  });

  it('keeps normal completion, parallelism and retries working', async () => {
    const { orchestrator, assigned, createdTaskIds } = setUp();
    orchestrator.registerAgent({
      id: 'worker-2',
      name: 'worker 2',
      role: 'executor',
      description: '',
      capabilities: { tools: [], maxConcurrency: 1, taskTypes: ['tool_invoke'] },
    } as never);
    const retryable = { ...task('ok-retry'), maxRetries: 1 };
    const run = orchestrator.startWorkflow(
      workflow('ok', [
        {
          id: 'fan',
          name: 'fan',
          type: 'parallel',
          branches: [[taskStep('ok-a')], [taskStep('ok-b')]],
        } as WorkflowStep,
        { id: 'retry', name: 'retry', type: 'task', tasks: [retryable] } as WorkflowStep,
      ]),
      {}
    );
    await advance(0);
    expect(assigned).toEqual(expect.arrayContaining(['ok-a', 'ok-b']));
    orchestrator.completeTask(taskId(createdTaskIds, 'ok-a'), { a: 1 });
    orchestrator.completeTask(taskId(createdTaskIds, 'ok-b'), { b: 1 });
    await advance(100);
    expect(assigned).toContain('ok-retry');
    const retryTaskId = taskId(createdTaskIds, 'ok-retry');
    orchestrator.failTask(retryTaskId, 'first attempt failed');
    await advance(0);
    expect(assigned.filter((id) => id === 'ok-retry')).toHaveLength(2);
    orchestrator.completeTask(retryTaskId, { done: true });
    await advance(200);

    const instance = await run;
    expect(instance.status).toBe('completed');
    expect(orchestrator.getStats().completedTasks).toBe(3);
  });

  it('keeps logical dependency names and output aliases with runtime task identities', async () => {
    const { orchestrator, assigned, createdTaskIds } = setUp();
    const run = orchestrator.startWorkflow(
      workflow('logical-contract', [
        {
          id: 'logical-step',
          name: 'logical step',
          type: 'task',
          tasks: [
            { ...task('prepare'), aliasAs: 'prepared' },
            { ...task('consume'), dependsOn: ['prepare'] },
          ],
        } as WorkflowStep,
      ]),
      {}
    );
    await advance(0);
    const prepareId = taskId(createdTaskIds, 'prepare');
    expect(prepareId).not.toBe('prepare');
    orchestrator.completeTask(prepareId, { value: 42 });
    await advance(100);

    expect(assigned).toContain('consume');
    const consumeId = taskId(createdTaskIds, 'consume');
    expect(orchestrator.getTask(consumeId)?.definition.dependsOn).toEqual(['prepare']);
    orchestrator.completeTask(consumeId, { used: true });
    await advance(100);

    const instance = await run;
    expect(instance.status).toBe('completed');
    expect(instance.output).toMatchObject({
      task_prepare: { value: 42 },
      prepared: { value: 42 },
      task_consume: { used: true },
    });
  });

  it('resolves a forward logical dependency within its own workflow instance', async () => {
    const { orchestrator, assigned, createdTaskIds } = setUp();
    orchestrator.registerAgent({
      id: 'worker-2',
      name: 'worker 2',
      role: 'executor',
      description: '',
      capabilities: { tools: [], maxConcurrency: 1, taskTypes: ['tool_invoke'] },
    } as never);
    const dependent = { ...task('dependent'), dependsOn: ['producer'] };
    const run = orchestrator.startWorkflow(
      workflow('forward-dependency', [
        {
          id: 'fan',
          name: 'fan',
          type: 'parallel',
          branches: [
            [{ id: 'dependent-step', name: 'dependent', type: 'task', tasks: [dependent] }],
            [taskStep('producer')],
          ],
        } as WorkflowStep,
      ]),
      {}
    );
    await advance(0);
    expect(assigned).toEqual(['producer']);

    orchestrator.completeTask(taskId(createdTaskIds, 'producer'), { ready: true });
    await advance(0);
    expect(assigned).toEqual(['producer', 'dependent']);
    orchestrator.completeTask(taskId(createdTaskIds, 'dependent'), { consumed: true });
    await advance(200);

    expect((await run).status).toBe('completed');
  });

  it('assigns a distinct runtime identity to every loop occurrence', async () => {
    const { orchestrator, assignedTaskIds } = setUp();
    orchestrator.on('task_assigned', (evt: { taskId: string }) => {
      if (orchestrator.getTask(evt.taskId)?.definition.name === 'loop-task') {
        queueMicrotask(() => orchestrator.completeTask(evt.taskId, { iteration: true }));
      }
    });
    const run = orchestrator.startWorkflow(
      workflow('loop-occurrences', [
        {
          id: 'loop',
          name: 'loop',
          type: 'loop',
          loopCondition: 'true',
          maxIterations: 2,
          loopBody: [taskStep('loop-task')],
        } as WorkflowStep,
      ]),
      {}
    );
    await advance(500);

    expect((await run).status).toBe('completed');
    expect(assignedTaskIds).toHaveLength(2);
    expect(new Set(assignedTaskIds).size).toBe(2);
  });

  it('does not consume the active task limit with completed workflow occurrences', async () => {
    const orchestrator = new Orchestrator({
      defaultTimeout: TIMEOUT_MS,
      logLevel: 'error',
      maxTasks: 1,
    });
    orchestrator.registerAgent({
      id: 'worker-1',
      name: 'worker',
      role: 'executor',
      description: '',
      capabilities: { tools: [], maxConcurrency: 1, taskTypes: ['tool_invoke'] },
    } as never);
    orchestrator.on('task_created', () => queueMicrotask(() => orchestrator.processQueue()));
    orchestrator.on('task_assigned', (evt: { taskId: string }) => {
      queueMicrotask(() => orchestrator.completeTask(evt.taskId, { ok: true }));
    });
    orchestrator.start();
    const repeated = workflow('repeat-under-limit', [taskStep('same-logical-task')]);

    const first = orchestrator.startWorkflow(repeated, {});
    await advance(200);
    expect((await first).status).toBe('completed');
    const second = orchestrator.startWorkflow(repeated, {});
    await advance(200);
    expect((await second).status).toBe('completed');
  });

  it('retains an abandoned task at capacity until its late executor reports', async () => {
    const orchestrator = new Orchestrator({
      defaultTimeout: TIMEOUT_MS,
      logLevel: 'error',
      maxTasks: 1,
    });
    const assignedTaskIds: string[] = [];
    orchestrator.registerAgent({
      id: 'worker-1',
      name: 'worker',
      role: 'executor',
      description: '',
      capabilities: { tools: [], maxConcurrency: 1, taskTypes: ['tool_invoke'] },
    } as never);
    orchestrator.on('task_created', () => queueMicrotask(() => orchestrator.processQueue()));
    orchestrator.on('task_assigned', (evt: { taskId: string }) => assignedTaskIds.push(evt.taskId));
    orchestrator.start();
    const repeated = workflow('timeout-at-limit', [taskStep('same-logical-task')]);

    const firstRun = orchestrator.startWorkflow(repeated, {});
    await advance(TIMEOUT_MS + 100);
    expect((await firstRun).status).toBe('failed');
    const firstRuntimeId = assignedTaskIds[0]!;
    const blockedReplay = await orchestrator.startWorkflow(repeated, {});
    expect(blockedReplay.status).toBe('failed');
    expect(blockedReplay.error).toContain('Maximum task limit');

    orchestrator.completeTask(firstRuntimeId, { late: true });
    const replay = orchestrator.startWorkflow(repeated, {});
    await advance(0);
    const replayRuntimeId = assignedTaskIds[1]!;
    expect(replayRuntimeId).not.toBe(firstRuntimeId);
    orchestrator.completeTask(replayRuntimeId, { current: true });
    await advance(200);
    expect((await replay).status).toBe('completed');
  });

  it('keeps a late report from an earlier run away from the same logical task in a replay', async () => {
    const { orchestrator, assigned, assignedTaskIds, createdTaskIds } = setUp();
    const repeated = workflow('same-workflow', [taskStep('shared-task')]);
    const firstRun = orchestrator.startWorkflow(repeated, {});
    await advance(0);
    const firstRuntimeId = assignedTaskIds[0]!;
    await advance(TIMEOUT_MS + 100);
    expect((await firstRun).status).toBe('failed');

    const secondRun = orchestrator.startWorkflow(repeated, {});
    await advance(0);
    orchestrator.completeTask(firstRuntimeId, { from: 'late-first-run' });
    await advance(0);

    expect(assigned.filter((id) => id === 'shared-task')).toHaveLength(2);
    const secondRuntimeId = taskId(createdTaskIds, 'shared-task', 1);
    expect(secondRuntimeId).not.toBe(firstRuntimeId);
    expect(orchestrator.getTask(secondRuntimeId)?.output).toBeUndefined();
    orchestrator.completeTask(secondRuntimeId, { from: 'second-run' });
    await advance(200);
    const second = await secondRun;
    expect(second.status).toBe('completed');
    expect(Array.from(second.tasks.values())[0]?.output).toEqual({ from: 'second-run' });
  });

  it('does not let a surviving parallel branch create another task after the run failed', async () => {
    const { orchestrator, assigned, createdTaskIds } = setUp();
    orchestrator.registerAgent({
      id: 'worker-2',
      name: 'worker 2',
      role: 'executor',
      description: '',
      capabilities: { tools: [], maxConcurrency: 1, taskTypes: ['tool_invoke'] },
    } as never);
    const run = orchestrator.startWorkflow(
      workflow('parallel-timeout', [
        {
          id: 'fan',
          name: 'fan',
          type: 'parallel',
          branches: [[taskStep('stuck')], [taskStep('finishes'), taskStep('must-not-start')]],
        } as WorkflowStep,
      ]),
      {}
    );
    await advance(0);
    expect(assigned).toEqual(expect.arrayContaining(['stuck', 'finishes']));
    await advance(150);
    orchestrator.completeTask(taskId(createdTaskIds, 'finishes'), { ok: true });
    await advance(200);

    expect((await run).status).toBe('failed');
    expect(assigned).not.toContain('must-not-start');
    expect(createdTaskIds.has('must-not-start')).toBe(false);
  });
});
