import { describe, expect, it } from 'vitest';
import {
  compileVisualToCore,
  CompilationError,
} from '../src/main/workflows/dag-compiler';
import type { WorkflowVisualDefinition } from '../src/shared/workflow-types';

const baseDef = (overrides: Partial<WorkflowVisualDefinition>): WorkflowVisualDefinition => ({
  id: 'wf_test',
  name: 'test',
  description: '',
  nodes: [],
  edges: [],
  ...overrides,
});

const node = (id: string, type: string, config?: Record<string, unknown>) => ({
  id,
  type: type as WorkflowVisualDefinition['nodes'][number]['type'],
  name: id,
  position: { x: 0, y: 0 },
  config,
});

const edge = (
  source: string,
  target: string,
  label?: 'true' | 'false'
) => ({
  id: `${source}-${target}`,
  source,
  target,
  label,
});

describe('dag-compiler / compileVisualToCore', () => {
  it('compiles a linear workflow start → tool → end', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('t1', 'tool', { toolName: 'bash_run', toolInput: { command: 'echo hello' } }),
        node('end', 'end'),
      ],
      edges: [edge('start', 't1'), edge('t1', 'end')],
    });

    const core = compileVisualToCore(def);

    expect(core.steps).toHaveLength(1);
    expect(core.steps[0].type).toBe('task');
    expect(core.steps[0].tasks).toHaveLength(1);
    expect(core.steps[0].tasks![0].type).toBe('tool_invoke');
    expect(core.steps[0].tasks![0].input.toolName).toBe('bash_run');
    expect(core.steps[0].tasks![0].input.toolInput).toEqual({ command: 'echo hello' });
    expect(core.steps[0].tasks![0].requiredCapabilities).toEqual(['tool_invoke']);
  });

  it('compiles a parallel workflow with two branches', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('p', 'parallel'),
        node('a', 'tool', { toolName: 'bash_run', toolInput: { command: 'echo a' } }),
        node('b', 'tool', { toolName: 'bash_run', toolInput: { command: 'echo b' } }),
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

    const core = compileVisualToCore(def);

    expect(core.steps).toHaveLength(1);
    expect(core.steps[0].type).toBe('parallel');
    expect(core.steps[0].branches).toHaveLength(2);
    // Each branch contains one task step
    expect(core.steps[0].branches![0]).toHaveLength(1);
    expect(core.steps[0].branches![0][0].type).toBe('task');
    expect(core.steps[0].branches![1]).toHaveLength(1);
    expect(core.steps[0].branches![1][0].type).toBe('task');
  });

  it('compiles a conditional workflow with true/false labels', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('c', 'condition', { expression: 'task_x.value > 0' }),
        node('ok', 'tool', { toolName: 'noop', toolInput: {} }),
        node('ko', 'tool', { toolName: 'noop', toolInput: {} }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'c'),
        edge('c', 'ok', 'true'),
        edge('c', 'ko', 'false'),
        edge('ok', 'end'),
        edge('ko', 'end'),
      ],
    });

    const core = compileVisualToCore(def);

    expect(core.steps).toHaveLength(1);
    expect(core.steps[0].type).toBe('conditional');
    expect(core.steps[0].condition).toBe('task_x.value > 0');
    expect(core.steps[0].trueBranch).toHaveLength(1);
    expect(core.steps[0].trueBranch![0].tasks![0].input.cowork_visual_node_id).toBe('ok');
    expect(core.steps[0].falseBranch![0].tasks![0].input.cowork_visual_node_id).toBe('ko');
  });

  it('compiles an approval workflow with default message', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('apv', 'approval'),
        node('go', 'tool', { toolName: 'bash_run', toolInput: { command: 'echo go' } }),
        node('end', 'end'),
      ],
      edges: [edge('start', 'apv'), edge('apv', 'go'), edge('go', 'end')],
    });

    const core = compileVisualToCore(def);

    expect(core.steps).toHaveLength(2);
    expect(core.steps[0].type).toBe('task');
    expect(core.steps[0].tasks![0].type).toBe('approval_wait');
    expect(core.steps[0].tasks![0].input.message).toBe('Approve step "apv"?');
    expect(core.steps[0].tasks![0].input.timeoutMs).toBe(60000);
    expect(core.steps[1].tasks![0].type).toBe('tool_invoke');
  });

  it('rejects a tool node missing config.toolName', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('t1', 'tool'),
        node('end', 'end'),
      ],
      edges: [edge('start', 't1'), edge('t1', 'end')],
    });

    expect(() => compileVisualToCore(def)).toThrow(CompilationError);
    expect(() => compileVisualToCore(def)).toThrow(/missing config\.toolName/);
  });

  it('rejects a condition node without true/false labels', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('c', 'condition', { expression: 'true' }),
        node('a', 'tool', { toolName: 'noop', toolInput: {} }),
        node('b', 'tool', { toolName: 'noop', toolInput: {} }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'c'),
        edge('c', 'a'), // no label
        edge('c', 'b'), // no label
        edge('a', 'end'),
        edge('b', 'end'),
      ],
    });

    expect(() => compileVisualToCore(def)).toThrow(/labelled 'true' and 'false'/);
  });

  it('rejects a graph with no start node', () => {
    const def = baseDef({
      nodes: [node('t', 'tool', { toolName: 'noop', toolInput: {} }), node('end', 'end')],
      edges: [edge('t', 'end')],
    });
    expect(() => compileVisualToCore(def)).toThrow(/No `start` node/);
  });

  it('rejects a tool node with multiple outgoing edges (must use parallel/condition)', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('t', 'tool', { toolName: 'noop', toolInput: {} }),
        node('a', 'tool', { toolName: 'noop', toolInput: {} }),
        node('b', 'tool', { toolName: 'noop', toolInput: {} }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 't'),
        edge('t', 'a'),
        edge('t', 'b'),
        edge('a', 'end'),
        edge('b', 'end'),
      ],
    });
    expect(() => compileVisualToCore(def)).toThrow(/has 2 outgoing edges/);
  });

  it('rejects a cycle', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('a', 'tool', { toolName: 'noop', toolInput: {} }),
        node('b', 'tool', { toolName: 'noop', toolInput: {} }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'a'),
        edge('a', 'b'),
        edge('b', 'a'), // cycle
      ],
    });
    expect(() => compileVisualToCore(def)).toThrow(/Cycle detected/);
  });
});

describe('dag-compiler / V0.5 — loop nodes', () => {
  it('compiles a loop with linear body', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('lp', 'loop', { condition: '$i < 3', maxIterations: 3 }),
        node('a', 'tool', { toolName: 'bash_run', toolInput: { command: 'iter' } }),
        node('after', 'tool', { toolName: 'bash_run', toolInput: { command: 'done' } }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'lp'),
        edge('lp', 'a', 'body'),
        edge('lp', 'after', 'exit'),
        edge('a', 'end'),
        edge('after', 'end'),
      ],
    });

    const core = compileVisualToCore(def);

    expect(core.steps).toHaveLength(2);
    expect(core.steps[0].type).toBe('loop');
    expect(core.steps[0].loopCondition).toBe('$i < 3');
    expect(core.steps[0].maxIterations).toBe(3);
    expect(core.steps[0].loopBody).toHaveLength(1);
    expect(core.steps[0].loopBody![0].tasks![0].input.cowork_visual_node_id).toBe('a');
    // After the exit, the main chain continues with `after`.
    expect(core.steps[1].tasks![0].input.cowork_visual_node_id).toBe('after');
  });

  it('rejects a loop missing config.condition', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('lp', 'loop'),
        node('a', 'tool', { toolName: 'noop', toolInput: {} }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'lp'),
        edge('lp', 'a', 'body'),
        edge('lp', 'end', 'exit'),
        edge('a', 'end'),
      ],
    });
    expect(() => compileVisualToCore(def)).toThrow(/missing config\.condition/);
  });

  it('rejects an unsafe loop maxIterations instead of silently using 100', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('lp', 'loop', { condition: 'true', maxIterations: 0 }),
        node('a', 'tool', { toolName: 'noop', toolInput: {} }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'lp'),
        edge('lp', 'a', 'body'),
        edge('lp', 'end', 'exit'),
        edge('a', 'end'),
      ],
    });
    expect(() => compileVisualToCore(def)).toThrow(/maxIterations must be an integer between 1 and 100/);
  });

  it("rejects a loop without 'body'/'exit' edge labels", () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('lp', 'loop', { condition: 'true' }),
        node('a', 'tool', { toolName: 'noop', toolInput: {} }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'lp'),
        edge('lp', 'a'), // no label
        edge('lp', 'end'),
        edge('a', 'end'),
      ],
    });
    expect(() => compileVisualToCore(def)).toThrow(/labelled 'body' and 'exit'/);
  });
});

describe('dag-compiler / V0.5 — convergence', () => {
  it('parallel branches rejoin on a shared node, main chain continues', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('p', 'parallel'),
        node('a', 'tool', { toolName: 'noop', toolInput: {} }),
        node('b', 'tool', { toolName: 'noop', toolInput: {} }),
        node('after', 'tool', { toolName: 'bash_run', toolInput: { command: 'done' } }),
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
    });

    const core = compileVisualToCore(def);

    expect(core.steps).toHaveLength(2);
    expect(core.steps[0].type).toBe('parallel');
    expect(core.steps[0].branches).toHaveLength(2);
    // Each branch contains one task — the join is excluded from branches.
    expect(core.steps[0].branches![0]).toHaveLength(1);
    expect(core.steps[0].branches![1]).toHaveLength(1);
    // The join `after` becomes the next step in the main chain.
    expect(core.steps[1].tasks![0].input.cowork_visual_node_id).toBe('after');
  });

  it('condition true/false branches rejoin and continue', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('c', 'condition', { expression: '$x === 1' }),
        node('ok', 'tool', { toolName: 'noop', toolInput: {} }),
        node('ko', 'tool', { toolName: 'noop', toolInput: {} }),
        node('after', 'tool', { toolName: 'bash_run', toolInput: { command: 'done' } }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'c'),
        edge('c', 'ok', 'true'),
        edge('c', 'ko', 'false'),
        edge('ok', 'after'),
        edge('ko', 'after'),
        edge('after', 'end'),
      ],
    });

    const core = compileVisualToCore(def);
    expect(core.steps).toHaveLength(2);
    expect(core.steps[0].type).toBe('conditional');
    expect(core.steps[0].trueBranch).toHaveLength(1);
    expect(core.steps[0].falseBranch).toHaveLength(1);
    expect(core.steps[1].tasks![0].input.cowork_visual_node_id).toBe('after');
  });

  it('passes maxRetries from a tool node to the core TaskDefinition', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('t1', 'tool', {
          toolName: 'shell_exec',
          toolInput: { command: 'flaky' },
          maxRetries: 3,
        }),
        node('end', 'end'),
      ],
      edges: [edge('start', 't1'), edge('t1', 'end')],
    });
    const core = compileVisualToCore(def);
    expect(core.steps[0].tasks![0].maxRetries).toBe(3);
  });

  it('omits maxRetries when zero or unset (fail-fast default)', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('t1', 'tool', { toolName: 'shell_exec', toolInput: {} }),
        node('end', 'end'),
      ],
      edges: [edge('start', 't1'), edge('t1', 'end')],
    });
    const core = compileVisualToCore(def);
    expect(core.steps[0].tasks![0].maxRetries).toBeUndefined();
  });

  it('compiles a nested parallel inside another parallel branch', () => {
    // Outer parallel splits into a/b. Branch `a` itself contains an
    // inner parallel splitting into a1/a2. Both parallels converge on
    // `end`. Tests that the recursive compiler handles arbitrary
    // structural nesting.
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('outer', 'parallel'),
        node('inner', 'parallel'),
        node('a1', 'tool', { toolName: 'noop', toolInput: {} }),
        node('a2', 'tool', { toolName: 'noop', toolInput: {} }),
        node('b', 'tool', { toolName: 'noop', toolInput: {} }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'outer'),
        edge('outer', 'inner'),
        edge('outer', 'b'),
        edge('inner', 'a1'),
        edge('inner', 'a2'),
        edge('a1', 'end'),
        edge('a2', 'end'),
        edge('b', 'end'),
      ],
    });
    const core = compileVisualToCore(def);
    expect(core.steps).toHaveLength(1);
    expect(core.steps[0].type).toBe('parallel');
    expect(core.steps[0].branches).toHaveLength(2);
    // One of the branches should itself contain a `parallel` step.
    const branches = core.steps[0].branches!;
    const hasNested = branches.some(
      (b) => b.length === 1 && b[0].type === 'parallel'
    );
    expect(hasNested).toBe(true);
  });

  it('rejects branches that converge on different terminations', () => {
    // One branch (a) walks into a real join `shared` (incoming=2 because
    // an unrelated `extra` node also points there), the other (b) goes
    // straight to `end`. Mismatched joins → CompilationError.
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('p', 'parallel'),
        node('a', 'tool', { toolName: 'noop', toolInput: {} }),
        node('b', 'tool', { toolName: 'noop', toolInput: {} }),
        node('extra', 'tool', { toolName: 'noop', toolInput: {} }),
        node('shared', 'tool', { toolName: 'noop', toolInput: {} }),
        node('end', 'end'),
      ],
      edges: [
        edge('start', 'p'),
        edge('p', 'a'),
        edge('p', 'b'),
        edge('a', 'shared'),
        edge('extra', 'shared'), // gives shared incoming=2 → real join
        edge('b', 'end'),         // b skips shared
        edge('shared', 'end'),
      ],
    });
    expect(() => compileVisualToCore(def)).toThrow(/converge on different/);
  });

  // ──────── V0.7 — setVariable + outputAs ────────

  it('compiles a setVariable node into a set_variable task with aliasAs', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('v1', 'setVariable', { name: 'count', valueExpression: '42' }),
        node('end', 'end'),
      ],
      edges: [edge('start', 'v1'), edge('v1', 'end')],
    });

    const core = compileVisualToCore(def);

    expect(core.steps).toHaveLength(1);
    expect(core.steps[0].type).toBe('task');
    expect(core.steps[0].tasks).toHaveLength(1);
    const task = core.steps[0].tasks![0];
    expect(task.type).toBe('set_variable');
    expect(task.input.variableName).toBe('count');
    expect(task.input.valueExpression).toBe('42');
    expect(task.aliasAs).toBe('count');
    expect(task.requiredCapabilities).toEqual(['set_variable']);
  });

  it('compiles a tool node with outputAs and emits aliasAs (not in input)', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('t1', 'tool', {
          toolName: 'bash_run',
          toolInput: { command: 'ls' },
          outputAs: 'files',
        }),
        node('end', 'end'),
      ],
      edges: [edge('start', 't1'), edge('t1', 'end')],
    });

    const core = compileVisualToCore(def);

    const task = core.steps[0].tasks![0];
    expect(task.type).toBe('tool_invoke');
    // The alias goes on the task definition (top-level) so the
    // orchestrator's executeTaskStep stores it under context['files'].
    expect(task.aliasAs).toBe('files');
    // The tool's input should NOT carry outputAs — only the runtime alias does.
    expect(task.input.outputAs).toBeUndefined();
  });

  it('rejects setVariable node missing config.name', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('v1', 'setVariable', { valueExpression: '42' }),
        node('end', 'end'),
      ],
      edges: [edge('start', 'v1'), edge('v1', 'end')],
    });
    expect(() => compileVisualToCore(def)).toThrow(CompilationError);
  });

  it('rejects setVariable node missing config.valueExpression', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('v1', 'setVariable', { name: 'foo' }),
        node('end', 'end'),
      ],
      edges: [edge('start', 'v1'), edge('v1', 'end')],
    });
    expect(() => compileVisualToCore(def)).toThrow(CompilationError);
  });

  it('omits aliasAs when tool node has no outputAs', () => {
    const def = baseDef({
      nodes: [
        node('start', 'start'),
        node('t1', 'tool', { toolName: 'bash_run', toolInput: { command: 'ls' } }),
        node('end', 'end'),
      ],
      edges: [edge('start', 't1'), edge('t1', 'end')],
    });
    const core = compileVisualToCore(def);
    expect(core.steps[0].tasks![0].aliasAs).toBeUndefined();
  });
});
