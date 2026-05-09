/**
 * Compiles the visual DAG produced by the Cowork WorkflowEditor into the
 * `WorkflowDefinition` shape consumed by the core `Orchestrator`
 * (`src/orchestration/orchestrator.ts`).
 *
 * V1 limitations (documented in `cowork/src/main/workflows/README.md`):
 *  - Each `parallel` node's branches must be disconnected sub-trees that
 *    flow to `end` (no convergence before `end`).
 *  - `condition` nodes require exactly two outgoing edges labelled `'true'`
 *    and `'false'`.
 *  - Tool nodes must carry a `config: { toolName, toolInput }`.
 *  - Approval nodes carry `config: { message, timeoutMs? }`.
 */
import type {
  WorkflowVisualDefinition,
  WorkflowVisualNode,
  WorkflowVisualEdge,
  ToolNodeConfig,
  ConditionNodeConfig,
  ApprovalNodeConfig,
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
}

export interface CoreWorkflowStep {
  id: string;
  name: string;
  type: 'task' | 'parallel' | 'conditional' | 'loop';
  tasks?: CoreTaskDefinition[];
  branches?: CoreWorkflowStep[][];
  condition?: string;
  trueBranch?: CoreWorkflowStep[];
  falseBranch?: CoreWorkflowStep[];
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

/**
 * Compile a chain of nodes starting at `node` and walking forward. Stops
 * when reaching `end`, a node with multiple incoming edges (would mean
 * convergence — unsupported V1), or a node we've already visited.
 */
function compileChain(
  ctx: CompileContext,
  node: WorkflowVisualNode
): CoreWorkflowStep[] {
  const steps: CoreWorkflowStep[] = [];
  const localVisited = new Set<string>();
  let current: WorkflowVisualNode | null = node;

  while (current && current.type !== 'end') {
    if (localVisited.has(current.id)) {
      throw new CompilationError(
        `Cycle detected at node '${current.id}' — workflows must be acyclic`
      );
    }
    localVisited.add(current.id);

    const compiledStep = compileSingle(ctx, current);
    if (compiledStep) steps.push(compiledStep);

    current = nextSequentialNode(ctx, current);
  }

  return steps;
}

function nextSequentialNode(
  ctx: CompileContext,
  node: WorkflowVisualNode
): WorkflowVisualNode | null {
  const out = ctx.outgoingByNode.get(node.id) ?? [];
  // For tool/approval/start nodes we follow the single outgoing edge.
  // For parallel/condition nodes the *next* sequential node is whatever
  // they all converge into — but V1 forbids convergence inside branches,
  // so the parallel/condition step itself absorbs all downstream nodes.
  if (node.type === 'parallel' || node.type === 'condition') {
    // The branches are absorbed; downstream after the structure is ignored.
    // V1 contract: a parallel/condition is a "leaf" of the main chain.
    return null;
  }
  if (out.length === 0) return null;
  if (out.length > 1) {
    throw new CompilationError(
      `Node '${node.id}' (${node.type}): has ${out.length} outgoing edges; only `
        + `parallel/condition nodes can have multiple outputs`
    );
  }
  const target = ctx.byId.get(out[0].target);
  return target ?? null;
}

function compileSingle(
  ctx: CompileContext,
  node: WorkflowVisualNode
): CoreWorkflowStep | null {
  switch (node.type) {
    case 'start':
      return null;
    case 'end':
      return null;
    case 'tool': {
      const cfg = ensureToolConfig(node);
      return {
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
              toolInput: cfg.toolInput,
            },
            requiredCapabilities: ['tool_invoke'],
            priority: 'medium',
          },
        ],
      };
    }
    case 'approval': {
      const cfg = ensureApprovalConfig(node);
      return {
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
      return {
        id: makeStepId('step', node.id),
        name: node.name || 'condition',
        type: 'conditional',
        condition: cfg.expression,
        trueBranch: compileBranch(ctx, trueTarget),
        falseBranch: compileBranch(ctx, falseTarget),
      };
    }
    case 'parallel': {
      const out = ctx.outgoingByNode.get(node.id) ?? [];
      if (out.length < 2) {
        throw new CompilationError(
          `Node '${node.id}' (parallel): expected ≥2 outgoing edges, found ${out.length}`
        );
      }
      const branches: CoreWorkflowStep[][] = [];
      for (const edge of out) {
        const target = ctx.byId.get(edge.target);
        if (!target) {
          throw new CompilationError(
            `Node '${node.id}' (parallel): edge target '${edge.target}' missing`
          );
        }
        branches.push(compileBranch(ctx, target));
      }
      return {
        id: makeStepId('step', node.id),
        name: node.name || 'parallel',
        type: 'parallel',
        branches,
      };
    }
    default:
      throw new CompilationError(
        `Unknown node type '${(node as WorkflowVisualNode).type}' on node '${node.id}'`
      );
  }
}

function compileBranch(
  ctx: CompileContext,
  startNode: WorkflowVisualNode
): CoreWorkflowStep[] {
  // A branch is a linear chain from `startNode` until we hit `end` or
  // a parallel/condition leaf. Reuses compileChain so nested
  // parallel/condition inside a branch is supported.
  return compileChain(ctx, startNode);
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
