/**
 * Integration test — boots a real core `Orchestrator`, registers the
 * Cowork worker pool + the `task_assigned` listener (mirroring
 * `WorkflowBridge.ensureOrchestrator`), and runs a full workflow
 * compiled from a visual DAG.
 *
 * This catches the bugs the unit tests can't:
 *  1. The orchestrator deadlock if `processQueue` isn't triggered after
 *     `queueTask`.
 *  2. The listener-order issue where the global `workflow_started`
 *     listener would fire before the run-scoped capture handler.
 *
 * We don't import `WorkflowBridge` directly because it pulls in
 * `electron.app.getPath`, which is mocked but not as functional as a
 * real userData path. Instead we replicate the bridge's wiring inline.
 */
import { describe, expect, it } from 'vitest';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import {
  CoworkToolAgent,
  COWORK_TOOL_AGENT_ID,
  type FormalToolRegistryLike,
} from '../src/main/workflows/cowork-tool-agent';
import { compileVisualToCore } from '../src/main/workflows/dag-compiler';
import type {
  WorkflowVisualDefinition,
  WorkflowEventPayload,
} from '../src/shared/workflow-types';

interface BridgeFixture {
  orchestrator: InstanceType<typeof Orchestrator>;
  events: WorkflowEventPayload[];
  toolAgent: CoworkToolAgent;
  registryCalls: Array<{ name: string; input: Record<string, unknown> }>;
  run: (
    visual: WorkflowVisualDefinition,
    workflowId: string,
    initialContext?: Record<string, unknown>
  ) => Promise<{
    instance: { instanceId: string; status: string; output?: Record<string, unknown> };
    workflowId: string;
  }>;
}

function setupBridgeLikeFixture(): BridgeFixture {
  const events: WorkflowEventPayload[] = [];
  const registryCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const registry: FormalToolRegistryLike = {
    execute: async (name, input) => {
      registryCalls.push({ name, input });
      return {
        success: true,
        output: { stdout: `${name} ok` },
        toolName: name,
        duration: 1,
      };
    },
  };

  const orchestrator = new Orchestrator({ maxAgents: 4, logLevel: 'warn' });
  const toolAgent = new CoworkToolAgent({
    registry,
    confirmToolInvocation: async () => ({ confirmed: true }),
    onApprovalRequired: () => {
      // Tests that need approvals install their own handler before running.
    },
  });

  // Worker pool — 4 agents (mirrors WorkflowBridge.ensureOrchestrator).
  const POOL = 4;
  for (let i = 0; i < POOL; i++) {
    orchestrator.registerAgent({
      id: i === 0 ? COWORK_TOOL_AGENT_ID : `${COWORK_TOOL_AGENT_ID}-${i}`,
      name: `Cowork Tool Runner ${i}`,
      role: 'executor',
      description: 'integration test runner',
      capabilities: {
        tools: [],
        maxConcurrency: 1,
        taskTypes: ['tool_invoke', 'approval_wait', 'set_variable'],
      },
    });
  }

  // Active run state for tagging events.
  let currentRun: { workflowId: string; instanceId: string } | null = null;

  // Trigger processQueue after task_created (deferred so queueTask runs first).
  orchestrator.on('task_created', () => {
    queueMicrotask(() => orchestrator.processQueue());
  });

  // Task assignment dispatcher.
  orchestrator.on('task_assigned', async (...args: unknown[]) => {
    const evt = args[0] as { taskId: string; agentId: string };
    if (!evt.agentId.startsWith(COWORK_TOOL_AGENT_ID)) return;
    const task = orchestrator.getTask(evt.taskId);
    if (!task) return;
    const visualNodeId = task.definition.input.cowork_visual_node_id as
      | string
      | undefined;
    const workflowId = currentRun?.workflowId ?? '';
    const instanceId = currentRun?.instanceId ?? '';
    if (visualNodeId) {
      events.push({
        type: 'node_started',
        workflowId,
        instanceId,
        nodeId: visualNodeId,
      });
    }
    try {
      let output: Record<string, unknown>;
      if (task.definition.type === 'tool_invoke') {
        output = await toolAgent.runToolInvoke(task.definition.input);
      } else if (task.definition.type === 'approval_wait') {
        output = await toolAgent.runApprovalWait(task.definition.input, instanceId);
      } else if (task.definition.type === 'set_variable') {
        output = await toolAgent.runSetVariable(task.definition.input);
      } else {
        throw new Error(`unsupported ${task.definition.type}`);
      }
      orchestrator.completeTask(evt.taskId, output);
      if (visualNodeId) {
        events.push({
          type: 'node_completed',
          workflowId,
          instanceId,
          nodeId: visualNodeId,
          output,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      orchestrator.failTask(evt.taskId, message);
      if (visualNodeId) {
        events.push({
          type: 'node_failed',
          workflowId,
          instanceId,
          nodeId: visualNodeId,
          error: message,
        });
      }
    }
  });

  // Global lifecycle (registered FIRST — captureHandler in run() must
  // prependListener to ensure mapping is set before this fires).
  orchestrator.on('workflow_started', (...args: unknown[]) => {
    const evt = args[0] as { instanceId: string };
    events.push({
      type: 'started',
      workflowId: currentRun?.workflowId ?? '',
      instanceId: evt.instanceId,
    });
  });

  orchestrator.start();

  const run = async (
    visual: WorkflowVisualDefinition,
    workflowId: string,
    initialContext: Record<string, unknown> = {}
  ) => {
    const coreDef = compileVisualToCore(visual);

    // Run-scoped captureHandler — prepended so it runs BEFORE the global
    // lifecycle listener.
    let captured = false;
    const captureHandler = (...args: unknown[]): void => {
      if (captured) return;
      captured = true;
      const evt = args[0] as { instanceId: string };
      currentRun = { workflowId, instanceId: evt.instanceId };
    };
    orchestrator.prependListener('workflow_started', captureHandler);

    try {
      const instance = await orchestrator.startWorkflow(
        coreDef as unknown as Record<string, unknown>,
        initialContext
      );
      events.push({
        type: instance.status === 'completed' ? 'completed' : 'failed',
        workflowId,
        instanceId: instance.instanceId,
        ...(instance.status === 'completed'
          ? { output: instance.output ?? {} }
          : { error: instance.error ?? 'failed' }),
      } as WorkflowEventPayload);
      return { instance, workflowId };
    } finally {
      orchestrator.removeListener('workflow_started', captureHandler);
      currentRun = null;
    }
  };

  return { orchestrator, events, toolAgent, registryCalls, run };
}

const node = (
  id: string,
  type: string,
  config?: Record<string, unknown>
): WorkflowVisualDefinition['nodes'][number] => ({
  id,
  type: type as WorkflowVisualDefinition['nodes'][number]['type'],
  name: id,
  position: { x: 0, y: 0 },
  config,
});

const edge = (source: string, target: string, label?: 'true' | 'false') => ({
  id: `${source}-${target}`,
  source,
  target,
  label,
});

describe('workflow-bridge integration (real Orchestrator)', () => {
  it(
    'runs a single tool node end-to-end (covers bug 1 — processQueue trigger)',
    async () => {
      const fixture = setupBridgeLikeFixture();

      const visual: WorkflowVisualDefinition = {
        id: 'wf_int',
        name: 'integration',
        nodes: [
          node('start', 'start'),
          node('t1', 'tool', { toolName: 'bash_run', toolInput: { command: 'echo hi' } }),
          node('end', 'end'),
        ],
        edges: [edge('start', 't1'), edge('t1', 'end')],
      };

      const { instance } = await fixture.run(visual, 'wf_int');

      expect(instance.status).toBe('completed');
      expect(fixture.registryCalls).toEqual([
        { name: 'bash_run', input: { command: 'echo hi' } },
      ]);
      const nodeEvents = fixture.events.filter(
        (e) => e.type === 'node_started' || e.type === 'node_completed'
      );
      expect(nodeEvents.map((e) => `${e.type}:${(e as { nodeId: string }).nodeId}`)).toEqual([
        'node_started:t1',
        'node_completed:t1',
      ]);
    },
    10000 // 10 s — well under the 5-min waitForTask timeout the bug would hit
  );

  it(
    'tags workflow_started with the right workflowId (covers bug 2 — listener order)',
    async () => {
      const fixture = setupBridgeLikeFixture();
      const visual: WorkflowVisualDefinition = {
        id: 'wf_lo',
        name: 'listener order',
        nodes: [
          node('start', 'start'),
          node('t1', 'tool', { toolName: 'noop', toolInput: {} }),
          node('end', 'end'),
        ],
        edges: [edge('start', 't1'), edge('t1', 'end')],
      };

      await fixture.run(visual, 'wf_lo');

      const startedEvent = fixture.events.find((e) => e.type === 'started');
      expect(startedEvent).toBeDefined();
      expect((startedEvent as { workflowId: string }).workflowId).toBe('wf_lo');
    },
    10000
  );

  it(
    'runs two parallel tool nodes (parallel branches converge to end)',
    async () => {
      const fixture = setupBridgeLikeFixture();
      const visual: WorkflowVisualDefinition = {
        id: 'wf_par',
        name: 'parallel',
        nodes: [
          node('start', 'start'),
          node('p', 'parallel'),
          node('a', 'tool', { toolName: 'bash_run', toolInput: { command: 'a' } }),
          node('b', 'tool', { toolName: 'bash_run', toolInput: { command: 'b' } }),
          node('end', 'end'),
        ],
        edges: [
          edge('start', 'p'),
          edge('p', 'a'),
          edge('p', 'b'),
          edge('a', 'end'),
          edge('b', 'end'),
        ],
      };

      const { instance } = await fixture.run(visual, 'wf_par');
      expect(instance.status).toBe('completed');
      const completed = fixture.events.filter((e) => e.type === 'node_completed');
      const ids = new Set(
        completed.map((e) => (e as { nodeId: string }).nodeId)
      );
      expect(ids).toEqual(new Set(['a', 'b']));
    },
    10000
  );

  it(
    'pauses on approval, resumes on resolveApproval(true)',
    async () => {
      const fixture = setupBridgeLikeFixture();
      // Override the agent's onApprovalRequired so we can resolve from the test.
      const visual: WorkflowVisualDefinition = {
        id: 'wf_apv',
        name: 'approval',
        nodes: [
          node('start', 'start'),
          node('apv', 'approval'),
          node('go', 'tool', { toolName: 'bash_run', toolInput: { command: 'go' } }),
          node('end', 'end'),
        ],
        edges: [edge('start', 'apv'), edge('apv', 'go'), edge('go', 'end')],
      };

      const runPromise = fixture.run(visual, 'wf_apv');

      // Wait one microtask cycle for the approval to be requested.
      await new Promise((r) => setTimeout(r, 50));
      expect(fixture.toolAgent.pendingCount()).toBe(1);

      // Approve it.
      const matched = fixture.toolAgent.resolveApproval('apv', true);
      expect(matched).toBe(true);

      const { instance } = await runPromise;
      expect(instance.status).toBe('completed');
      const completedNodes = fixture.events
        .filter((e) => e.type === 'node_completed')
        .map((e) => (e as { nodeId: string }).nodeId);
      expect(completedNodes).toEqual(['apv', 'go']);
    },
    10000
  );

  it(
    'V0.5 — runs a loop body 3 times via core engine iteration',
    async () => {
      const fixture = setupBridgeLikeFixture();
      // Note on the loop semantics: the core engine evaluates
      // `loopCondition` *before* updating `context.iteration` from its
      // local counter, which adds a one-tick lag. With initial
      // `iteration: 0` and condition `iteration < 2`, the body runs
      // exactly 3 times (iter values 0, 1, 2) before the condition
      // becomes false on the 4th check (ctx.iter=2, 2<2 → false).
      const visual: WorkflowVisualDefinition = {
        id: 'wf_loop',
        name: 'loop',
        nodes: [
          node('start', 'start'),
          node('lp', 'loop', { condition: 'iteration < 2' }),
          node('body', 'tool', { toolName: 'bash_run', toolInput: { command: 'iter' } }),
          node('after', 'tool', { toolName: 'bash_run', toolInput: { command: 'done' } }),
          node('end', 'end'),
        ],
        edges: [
          edge('start', 'lp'),
          edge('lp', 'body', 'body'),
          edge('lp', 'after', 'exit'),
          edge('body', 'end'),
          edge('after', 'end'),
        ],
      };

      const { instance } = await fixture.run(visual, 'wf_loop', { iteration: 0 });
      expect(instance.status).toBe('completed');
      // 3 body invocations (iter 0, 1, 2) + 1 after = 4 total.
      expect(fixture.registryCalls).toHaveLength(4);
      const bodyCalls = fixture.registryCalls.filter(
        (c) => c.input.command === 'iter'
      );
      expect(bodyCalls).toHaveLength(3);
      expect(fixture.registryCalls[3].input.command).toBe('done');
    },
    10000
  );

  it(
    'V0.5 — enforces the visual maxIterations in the production core',
    async () => {
      const fixture = setupBridgeLikeFixture();
      const visual: WorkflowVisualDefinition = {
        id: 'wf_loop_limit',
        name: 'loop-limit',
        nodes: [
          node('start', 'start'),
          node('lp', 'loop', { condition: 'true', maxIterations: 2 }),
          node('body', 'tool', { toolName: 'bash_run', toolInput: { command: 'iter' } }),
          node('after', 'tool', { toolName: 'bash_run', toolInput: { command: 'done' } }),
          node('end', 'end'),
        ],
        edges: [
          edge('start', 'lp'),
          edge('lp', 'body', 'body'),
          edge('lp', 'after', 'exit'),
          edge('body', 'end'),
          edge('after', 'end'),
        ],
      };

      const { instance } = await fixture.run(visual, 'wf_loop_limit');
      expect(instance.status).toBe('completed');
      expect(fixture.registryCalls.filter((call) => call.input.command === 'iter')).toHaveLength(2);
      expect(fixture.registryCalls.at(-1)?.input.command).toBe('done');
    },
    10000
  );

  it(
    'V0.5 — parallel branches converge on a join, main chain continues',
    async () => {
      const fixture = setupBridgeLikeFixture();
      const visual: WorkflowVisualDefinition = {
        id: 'wf_join',
        name: 'parallel-join',
        nodes: [
          node('start', 'start'),
          node('p', 'parallel'),
          node('a', 'tool', { toolName: 'bash_run', toolInput: { command: 'A' } }),
          node('b', 'tool', { toolName: 'bash_run', toolInput: { command: 'B' } }),
          node('after', 'tool', { toolName: 'bash_run', toolInput: { command: 'AFTER' } }),
          node('end', 'end'),
        ],
        edges: [
          edge('start', 'p'),
          edge('p', 'a'),
          edge('p', 'b'),
          edge('a', 'after'),
          edge('b', 'after'),
          edge('after', 'end'),
        ],
      };

      const { instance } = await fixture.run(visual, 'wf_join');
      expect(instance.status).toBe('completed');
      const cmds = fixture.registryCalls.map((c) => c.input.command);
      // A and B run (order not guaranteed because parallel), then AFTER.
      const lastIdx = cmds.length - 1;
      expect(cmds[lastIdx]).toBe('AFTER');
      expect(new Set(cmds.slice(0, 2))).toEqual(new Set(['A', 'B']));
    },
    10000
  );

  it(
    'V0.7 — setVariable node JSON-parses literals and stores them under aliasAs',
    async () => {
      const fixture = setupBridgeLikeFixture();

      const visual: WorkflowVisualDefinition = {
        id: 'wf_v07_setvar',
        name: 'setVariable smoke',
        nodes: [
          node('start', 'start'),
          node('v_count', 'setVariable', { name: 'count', valueExpression: '42' }),
          node('v_label', 'setVariable', {
            name: 'label',
            valueExpression: '"hello world"',
          }),
          node('end', 'end'),
        ],
        edges: [
          edge('start', 'v_count'),
          edge('v_count', 'v_label'),
          edge('v_label', 'end'),
        ],
      };

      const { instance } = await fixture.run(visual, 'wf_v07_setvar');
      expect(instance.status).toBe('completed');
      // The orchestrator's final output is the workflow context. The
      // aliasAs entries should appear at top-level with the parsed values.
      expect(instance.output).toBeTruthy();
      expect(instance.output?.count).toEqual({ name: 'count', value: 42 });
      expect(instance.output?.label).toEqual({ name: 'label', value: 'hello world' });
    },
    10000
  );

  it(
    'V0.7 — tool node with outputAs stores the tool output at $alias',
    async () => {
      const fixture = setupBridgeLikeFixture();

      const visual: WorkflowVisualDefinition = {
        id: 'wf_v07_outputas',
        name: 'outputAs smoke',
        nodes: [
          node('start', 'start'),
          node('t1', 'tool', {
            toolName: 'bash_run',
            toolInput: { command: 'echo hello' },
            outputAs: 'firstResult',
          }),
          node('end', 'end'),
        ],
        edges: [edge('start', 't1'), edge('t1', 'end')],
      };

      const { instance } = await fixture.run(visual, 'wf_v07_outputas');
      expect(instance.status).toBe('completed');
      const ctx = instance.output as Record<string, unknown> | undefined;
      expect(ctx?.firstResult).toBeTruthy();
      // Both the namespaced key and the alias point to the same shape.
      const firstResult = ctx!.firstResult as Record<string, unknown>;
      expect(firstResult.success).toBe(true);
      expect(firstResult.toolName).toBe('bash_run');
    },
    10000
  );
});
