/**
 * Compiles the visual DAG produced by the Cowork WorkflowEditor into the
 * `WorkflowDefinition` shape consumed by the core `Orchestrator`
 * (`src/orchestration/orchestrator.ts`).
 *
 * V0.5 features:
 *  - `loop` nodes with `body` + `exit` outgoing edges (the loop body is
 *    a linear chain ; iteration is handled by the core engine).
 *  - Convergence after a `parallel` or `condition` block — branches can
 *    rejoin at a single "join" node before continuing the main chain.
 *
 * Limitations still in place:
 *  - All branches of a `parallel`/`condition` must converge on the same
 *    join (or all flow to `end`). Heterogeneous endings → CompilationError.
 *  - `condition` requires labelled `'true'`/`'false'` outgoing edges.
 *  - `loop` body is a linear chain (it must not contain another loop or
 *    parallel/condition that re-enters the same loop body).
 *  - Tool nodes must carry `config: { toolName, toolInput }`.
 *  - Approval nodes carry `config: { message, timeoutMs? }`.
 *  - Loop nodes carry `config: { condition, maxIterations? }`.
 */
import type {
  WorkflowVisualDefinition,
  WorkflowVisualNode,
  WorkflowVisualEdge,
  ToolNodeConfig,
  ConditionNodeConfig,
  ApprovalNodeConfig,
  LoopNodeConfig,
  BatchNodeConfig,
  SetVariableNodeConfig,
} from '../../shared/workflow-types';

export type CoreTaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface CoreTaskDefinition {
  id: string;
  type: string;
  name: string;
  description: string;
  input: Record<string, unknown>;
  requiredCapabilities?: string[];
  priority: CoreTaskPriority;
  timeout?: number;
  maxRetries?: number;
  /** See `Orchestrator.executeTaskStep` — stores output at `context[aliasAs]`. */
  aliasAs?: string;
}

export interface CoreWorkflowStep {
  id: string;
  name: string;
  type: 'task' | 'parallel' | 'conditional' | 'loop' | 'batch';
  tasks?: CoreTaskDefinition[];
  branches?: CoreWorkflowStep[][];
  condition?: string;
  trueBranch?: CoreWorkflowStep[];
  falseBranch?: CoreWorkflowStep[];
  loopCondition?: string;
  loopBody?: CoreWorkflowStep[];
  batchItemsExpression?: string;
  batchVariableName?: string;
  batchConcurrencyLimit?: number;
  batchBody?: CoreWorkflowStep[];
}

export interface CoreWorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: CoreWorkflowStep[];
}

export class CompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilationError';
  }
}

interface CompileContext {
  byId: Map<string, WorkflowVisualNode>;
  outgoingByNode: Map<string, WorkflowVisualEdge[]>;
  incomingByNode: Map<string, WorkflowVisualEdge[]>;
}

interface CompiledStep {
  step: CoreWorkflowStep;
  /**
   * Where the main chain should resume after this step.
   * - `undefined` → the structure does not specify a continuation; the
   *   compiler should follow the node's single outgoing edge (default
   *   for tool/approval).
   * - `null` → the structure absorbs everything downstream and the main
   *   chain ends here (parallel/condition with all branches reaching
   *   `end`).
   * - `WorkflowVisualNode` → the structure provides this node as the
   *   explicit continuation (loop exit, parallel/condition join).
   */
  continueFrom?: WorkflowVisualNode | null;
}

function buildContext(def: WorkflowVisualDefinition): CompileContext {
  const byId = new Map<string, WorkflowVisualNode>();
  const outgoingByNode = new Map<string, WorkflowVisualEdge[]>();
  const incomingByNode = new Map<string, WorkflowVisualEdge[]>();
  for (const node of def.nodes) byId.set(node.id, node);
  for (const edge of def.edges) {
    if (!byId.has(edge.source)) {
      throw new CompilationError(`Edge ${edge.id}: source node '${edge.source}' missing`);
    }
    if (!byId.has(edge.target)) {
      throw new CompilationError(`Edge ${edge.id}: target node '${edge.target}' missing`);
    }
    if (!outgoingByNode.has(edge.source)) outgoingByNode.set(edge.source, []);
    outgoingByNode.get(edge.source)!.push(edge);
    if (!incomingByNode.has(edge.target)) incomingByNode.set(edge.target, []);
    incomingByNode.get(edge.target)!.push(edge);
  }
  return { byId, outgoingByNode, incomingByNode };
}

function findStart(def: WorkflowVisualDefinition): WorkflowVisualNode {
  const starts = def.nodes.filter((n) => n.type === 'start');
  if (starts.length === 0) {
    throw new CompilationError('No `start` node in the workflow');
  }
  if (starts.length > 1) {
    throw new CompilationError(`Expected 1 start node, found ${starts.length}`);
  }
  return starts[0];
}

function makeStepId(prefix: string, nodeId: string): string {
  return `${prefix}_${nodeId}`;
}

function compileExpressions(str: string): string {
  return str.replace(/\$task_([a-zA-Z0-9_-]+)(?:\.output)?/g, '$task_task_$1');
}

function compileInput(input: unknown): unknown {
  if (typeof input === 'string') {
    return compileExpressions(input);
  }
  if (Array.isArray(input)) {
    return input.map(compileInput);
  }
  if (input !== null && typeof input === 'object') {
    const res: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      res[key] = compileInput(val);
    }
    return res;
  }
  return input;
}

function ensureToolConfig(node: WorkflowVisualNode): ToolNodeConfig {
  const cfg = node.config as Partial<ToolNodeConfig> | undefined;
  if (!cfg || typeof cfg.toolName !== 'string' || cfg.toolName.length === 0) {
    throw new CompilationError(
      `Node '${node.id}' (tool): missing config.toolName — configure the node in the inspector`
    );
  }
  return {
    toolName: cfg.toolName,
    toolInput: (cfg.toolInput as Record<string, unknown>) ?? {},
    maxRetries: typeof cfg.maxRetries === 'number' && cfg.maxRetries > 0
      ? cfg.maxRetries
      : undefined,
    outputAs: typeof cfg.outputAs === 'string' && cfg.outputAs.length > 0
      ? cfg.outputAs
      : undefined,
  };
}

function ensureSetVariableConfig(node: WorkflowVisualNode): SetVariableNodeConfig {
  const cfg = node.config as Partial<SetVariableNodeConfig> | undefined;
  if (!cfg || typeof cfg.name !== 'string' || cfg.name.length === 0) {
    throw new CompilationError(
      `Node '${node.id}' (setVariable): missing config.name`
    );
  }
  if (typeof cfg.valueExpression !== 'string') {
    throw new CompilationError(
      `Node '${node.id}' (setVariable): missing config.valueExpression`
    );
  }
  return {
    name: cfg.name,
    valueExpression: cfg.valueExpression,
  };
}

function ensureConditionConfig(node: WorkflowVisualNode): ConditionNodeConfig {
  const cfg = node.config as Partial<ConditionNodeConfig> | undefined;
  if (!cfg || typeof cfg.expression !== 'string' || cfg.expression.length === 0) {
    throw new CompilationError(
      `Node '${node.id}' (condition): missing config.expression`
    );
  }
  return { expression: cfg.expression };
}

function ensureApprovalConfig(node: WorkflowVisualNode): ApprovalNodeConfig {
  const cfg = node.config as Partial<ApprovalNodeConfig> | undefined;
  return {
    message: typeof cfg?.message === 'string' && cfg.message.length > 0
      ? cfg.message
      : `Approve step "${node.name}"?`,
    timeoutMs: typeof cfg?.timeoutMs === 'number' ? cfg.timeoutMs : undefined,
  };
}

function ensureLoopConfig(node: WorkflowVisualNode): LoopNodeConfig {
  const cfg = node.config as Partial<LoopNodeConfig> | undefined;
  if (!cfg || typeof cfg.condition !== 'string' || cfg.condition.length === 0) {
    throw new CompilationError(
      `Node '${node.id}' (loop): missing config.condition`
    );
  }
  return {
    condition: cfg.condition,
    maxIterations: typeof cfg.maxIterations === 'number' ? cfg.maxIterations : undefined,
  };
}

function ensureBatchConfig(node: WorkflowVisualNode): BatchNodeConfig {
  const cfg = node.config as Partial<BatchNodeConfig> | undefined;
  if (!cfg || typeof cfg.itemsExpression !== 'string' || cfg.itemsExpression.length === 0) {
    throw new CompilationError(
      `Node '${node.id}' (batch): missing config.itemsExpression`
    );
  }
  if (typeof cfg.variableName !== 'string' || cfg.variableName.length === 0) {
    throw new CompilationError(
      `Node '${node.id}' (batch): missing config.variableName`
    );
  }
  return {
    itemsExpression: cfg.itemsExpression,
    variableName: cfg.variableName,
    concurrencyLimit: typeof cfg.concurrencyLimit === 'number' ? cfg.concurrencyLimit : undefined,
  };
}

/**
 * Walk forward from `startNode` collecting nodes into a chain until we
 * reach `end` or `stopAtNodeId` (exclusive). Used for compiling the
 * branches of a parallel/condition (stopAt = join) or the body of a loop
 * (stopAt = undefined, body terminates naturally).
 */
function compileChain(
  ctx: CompileContext,
  startNode: WorkflowVisualNode,
  stopAtNodeId?: string
): CoreWorkflowStep[] {
  const steps: CoreWorkflowStep[] = [];
  const localVisited = new Set<string>();
  let current: WorkflowVisualNode | null = startNode;

  while (current && current.type !== 'end' && current.id !== stopAtNodeId) {
    if (localVisited.has(current.id)) {
      throw new CompilationError(
        `Cycle detected at node '${current.id}' — workflows must be acyclic`
      );
    }
    localVisited.add(current.id);

    const compiled = compileSingle(ctx, current);
    if (compiled) {
      steps.push(compiled.step);
      // continueFrom semantics: undefined → default edge walk; null →
      // end of chain; Node → explicit jump.
      if (compiled.continueFrom === undefined) {
        current = nextSequentialNode(ctx, current);
      } else {
        current = compiled.continueFrom;
      }
    } else {
      // Transparent node (start already filtered above; end caught by
      // the loop guard).
      current = nextSequentialNode(ctx, current);
    }
  }

  return steps;
}

/**
 * Plain-edge follower for nodes that don't define their own continuation
 * (start, tool, approval). Refuses ≥2 outgoing edges — those are reserved
 * for structural nodes (parallel, condition, loop).
 */
function nextSequentialNode(
  ctx: CompileContext,
  node: WorkflowVisualNode
): WorkflowVisualNode | null {
  const out = ctx.outgoingByNode.get(node.id) ?? [];
  if (out.length === 0) return null;
  if (out.length > 1) {
    throw new CompilationError(
      `Node '${node.id}' (${node.type}): has ${out.length} outgoing edges; only `
        + `parallel/condition/loop nodes can have multiple outputs`
    );
  }
  const target = ctx.byId.get(out[0].target);
  return target ?? null;
}

/**
 * For a node with multiple outgoing branches, find the first node where
 * all branches converge — or `null` if all branches end at `end`.
 *
 * Throws if branches converge on different nodes (heterogeneous topology
 * is unsupported in V0.5).
 */
function findJoinTarget(
  ctx: CompileContext,
  branchEntryNodes: WorkflowVisualNode[]
): WorkflowVisualNode | null {
  // For each branch entry, walk forward until we hit a node that has
  // multiple incoming edges (a candidate join) or `end`.
  const branchEnds: Array<{ branchEntryId: string; joinId: string | null }> = [];
  for (const entry of branchEntryNodes) {
    const visited = new Set<string>();
    let current: WorkflowVisualNode | null = entry;
    let join: string | null = null;
    while (current) {
      if (visited.has(current.id)) {
        // Internal cycle inside a branch → unsupported.
        throw new CompilationError(
          `Cycle detected inside branch starting at '${entry.id}'`
        );
      }
      visited.add(current.id);
      if (current.type === 'end') {
        join = null; // branch terminates at end
        break;
      }
      const incoming = (ctx.incomingByNode.get(current.id) ?? []).length;
      if (incoming > 1 && current.id !== entry.id) {
        join = current.id; // candidate join — first node with >1 incoming
        break;
      }
      const out: WorkflowVisualEdge[] = ctx.outgoingByNode.get(current.id) ?? [];
      if (out.length === 0) {
        join = null;
        break;
      }
      if (out.length > 1) {
        // Nested structural node — its own join handling will absorb
        // downstream. We treat it as the branch's "leaf".
        break;
      }
      current = ctx.byId.get(out[0].target) ?? null;
    }
    branchEnds.push({ branchEntryId: entry.id, joinId: join });
  }

  // Reconcile: all branches must agree.
  const distinct = new Set(branchEnds.map((b) => b.joinId));
  if (distinct.size === 1) {
    const only = branchEnds[0].joinId;
    return only ? ctx.byId.get(only) ?? null : null;
  }
  // Mixed (some end, some join, or different joins) → reject.
  const detail = branchEnds
    .map((b) => `${b.branchEntryId}→${b.joinId ?? 'end'}`)
    .join(', ');
  throw new CompilationError(
    `Branches converge on different nodes (or mix end/join): ${detail}`
  );
}

function compileSingle(
  ctx: CompileContext,
  node: WorkflowVisualNode
): CompiledStep | null {
  switch (node.type) {
    case 'start':
      return null;
    case 'end':
      return null;
    case 'tool': {
      const cfg = ensureToolConfig(node);
      return {
        step: {
          id: makeStepId('step', node.id),
          name: node.name || `tool ${cfg.toolName}`,
          type: 'task',
          tasks: [
            {
              id: `task_${node.id}`,
              type: 'tool_invoke',
              name: node.name || cfg.toolName,
              description: `Cowork tool_invoke for visual node '${node.id}'`,
              input: {
                cowork_visual_node_id: node.id,
                toolName: cfg.toolName,
                toolInput: compileInput(cfg.toolInput),
              },
              requiredCapabilities: ['tool_invoke'],
              priority: 'medium',
              ...(cfg.maxRetries ? { maxRetries: cfg.maxRetries } : {}),
              ...(cfg.outputAs ? { aliasAs: cfg.outputAs } : {}),
            },
          ],
        },
        // continueFrom omitted → fall through to nextSequentialNode
      };
    }
    case 'setVariable': {
      const cfg = ensureSetVariableConfig(node);
      return {
        step: {
          id: makeStepId('step', node.id),
          name: node.name || `set $${cfg.name}`,
          type: 'task',
          tasks: [
            {
              id: `task_${node.id}`,
              type: 'set_variable',
              name: node.name || `set $${cfg.name}`,
              description: `Cowork set_variable for visual node '${node.id}'`,
              input: {
                cowork_visual_node_id: node.id,
                variableName: cfg.name,
                valueExpression: compileExpressions(cfg.valueExpression),
              },
              requiredCapabilities: ['set_variable'],
              priority: 'medium',
              // The orchestrator copies the task output to `context[aliasAs]`.
              // For `setVariable` that means `$<name>` resolves to
              // `{ value: <evaluated> }` — to preserve the natural
              // `$myVar === 42` ergonomics, the runtime agent returns the
              // evaluated value directly (no envelope).
              aliasAs: cfg.name,
            },
          ],
        },
        // continueFrom omitted → fall through to nextSequentialNode
      };
    }
    case 'approval': {
      const cfg = ensureApprovalConfig(node);
      return {
        step: {
          id: makeStepId('step', node.id),
          name: node.name || 'approval',
          type: 'task',
          tasks: [
            {
              id: `task_${node.id}`,
              type: 'approval_wait',
              name: node.name || 'Approval',
              description: `Cowork approval_wait for visual node '${node.id}'`,
              input: {
                cowork_visual_node_id: node.id,
                stepId: node.id,
                message: cfg.message,
                timeoutMs: cfg.timeoutMs ?? 60000,
              },
              requiredCapabilities: ['approval_wait'],
              priority: 'medium',
              timeout: (cfg.timeoutMs ?? 60000) + 5000,
            },
          ],
        },
        // continueFrom omitted → fall through to nextSequentialNode
      };
    }
    case 'condition': {
      const cfg = ensureConditionConfig(node);
      const out = ctx.outgoingByNode.get(node.id) ?? [];
      if (out.length !== 2) {
        throw new CompilationError(
          `Node '${node.id}' (condition): expected 2 outgoing edges (true/false), found ${out.length}`
        );
      }
      const trueEdge = out.find((e) => e.label === 'true');
      const falseEdge = out.find((e) => e.label === 'false');
      if (!trueEdge || !falseEdge) {
        throw new CompilationError(
          `Node '${node.id}' (condition): outgoing edges must be labelled 'true' and 'false'`
        );
      }
      const trueTarget = ctx.byId.get(trueEdge.target);
      const falseTarget = ctx.byId.get(falseEdge.target);
      if (!trueTarget || !falseTarget) {
        throw new CompilationError(`Node '${node.id}' (condition): edge target missing`);
      }
      const join = findJoinTarget(ctx, [trueTarget, falseTarget]);
      const stopAt = join?.id;
      return {
        step: {
          id: makeStepId('step', node.id),
          name: node.name || 'condition',
          type: 'conditional',
          condition: compileExpressions(cfg.expression),
          trueBranch: compileChain(ctx, trueTarget, stopAt),
          falseBranch: compileChain(ctx, falseTarget, stopAt),
        },
        continueFrom: join,
      };
    }
    case 'parallel': {
      const out = ctx.outgoingByNode.get(node.id) ?? [];
      if (out.length < 2) {
        throw new CompilationError(
          `Node '${node.id}' (parallel): expected ≥2 outgoing edges, found ${out.length}`
        );
      }
      const branchTargets: WorkflowVisualNode[] = [];
      for (const edge of out) {
        const target = ctx.byId.get(edge.target);
        if (!target) {
          throw new CompilationError(
            `Node '${node.id}' (parallel): edge target '${edge.target}' missing`
          );
        }
        branchTargets.push(target);
      }
      const join = findJoinTarget(ctx, branchTargets);
      const stopAt = join?.id;
      const branches = branchTargets.map((t) => compileChain(ctx, t, stopAt));
      return {
        step: {
          id: makeStepId('step', node.id),
          name: node.name || 'parallel',
          type: 'parallel',
          branches,
        },
        continueFrom: join,
      };
    }
    case 'loop': {
      const cfg = ensureLoopConfig(node);
      const out = ctx.outgoingByNode.get(node.id) ?? [];
      const bodyEdge = out.find((e) => e.label === 'body');
      const exitEdge = out.find((e) => e.label === 'exit');
      if (!bodyEdge || !exitEdge) {
        throw new CompilationError(
          `Node '${node.id}' (loop): outgoing edges must be labelled 'body' and 'exit'`
        );
      }
      if (out.length !== 2) {
        throw new CompilationError(
          `Node '${node.id}' (loop): expected exactly 2 outgoing edges (body + exit), found ${out.length}`
        );
      }
      const bodyTarget = ctx.byId.get(bodyEdge.target);
      const exitTarget = ctx.byId.get(exitEdge.target);
      if (!bodyTarget || !exitTarget) {
        throw new CompilationError(`Node '${node.id}' (loop): edge target missing`);
      }
      // The loop body is a linear chain that terminates naturally — it
      // must NOT loop back to this node visually (the iteration is
      // handled by the core engine, not the DAG).
      const loopBody = compileChain(ctx, bodyTarget);
      const stepBase: CoreWorkflowStep = {
        id: makeStepId('step', node.id),
        name: node.name || 'loop',
        type: 'loop',
        loopCondition: compileExpressions(cfg.condition),
        loopBody,
      };
      // maxIterations is not natively part of the core WorkflowStep type
      // but the core engine has a hard cap of 100; we keep the user's
      // value in the step `name` for traceability if they configured one.
      if (cfg.maxIterations) {
        stepBase.name = `${stepBase.name} (max ${cfg.maxIterations})`;
      }
      return {
        step: stepBase,
        continueFrom: exitTarget,
      };
    }
    case 'batch': {
      const cfg = ensureBatchConfig(node);
      const out = ctx.outgoingByNode.get(node.id) ?? [];
      const bodyEdge = out.find((e) => e.label === 'body');
      const exitEdge = out.find((e) => e.label === 'exit');
      if (!bodyEdge || !exitEdge) {
        throw new CompilationError(
          `Node '${node.id}' (batch): outgoing edges must be labelled 'body' and 'exit'`
        );
      }
      if (out.length !== 2) {
        throw new CompilationError(
          `Node '${node.id}' (batch): expected exactly 2 outgoing edges (body + exit), found ${out.length}`
        );
      }
      const bodyTarget = ctx.byId.get(bodyEdge.target);
      const exitTarget = ctx.byId.get(exitEdge.target);
      if (!bodyTarget || !exitTarget) {
        throw new CompilationError(`Node '${node.id}' (batch): edge target missing`);
      }
      const batchBody = compileChain(ctx, bodyTarget);
      const stepBase: CoreWorkflowStep = {
        id: makeStepId('step', node.id),
        name: node.name || 'batch',
        type: 'batch',
        batchItemsExpression: compileExpressions(cfg.itemsExpression),
        batchVariableName: cfg.variableName,
        batchConcurrencyLimit: cfg.concurrencyLimit,
        batchBody,
      };
      return {
        step: stepBase,
        continueFrom: exitTarget,
      };
    }
    default:
      throw new CompilationError(
        `Unknown node type '${(node as WorkflowVisualNode).type}' on node '${node.id}'`
      );
  }
}

/**
 * Main entry point — compile the visual DAG into the core
 * `WorkflowDefinition`.
 */
export function compileVisualToCore(
  visual: WorkflowVisualDefinition
): CoreWorkflowDefinition {
  if (visual.nodes.length === 0) {
    throw new CompilationError('Workflow has no nodes');
  }
  const ctx = buildContext(visual);
  const start = findStart(visual);

  const out = ctx.outgoingByNode.get(start.id) ?? [];
  if (out.length !== 1) {
    throw new CompilationError(
      `Start node must have exactly 1 outgoing edge, found ${out.length}`
    );
  }
  const firstNode = ctx.byId.get(out[0].target);
  if (!firstNode) {
    throw new CompilationError('Start node points to missing target');
  }

  const steps = compileChain(ctx, firstNode);

  return {
    id: visual.id ?? `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: visual.name,
    description: visual.description ?? '',
    steps,
  };
}
