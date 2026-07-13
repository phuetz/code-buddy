import { createHash } from 'node:crypto';
import type { GoalPlanSubtask } from './goal-decomposer.js';
import type { GoalState } from './goal-state.js';

export type IntentNodeKind = 'objective' | 'task' | 'criterion';
export type IntentNodeStatus = 'pending' | 'active' | 'paused' | 'satisfied' | 'cleared';
export type IntentEdgeKind = 'contains' | 'depends_on' | 'verified_by';

export interface IntentNode {
  id: string;
  kind: IntentNodeKind;
  title: string;
  status: IntentNodeStatus;
  description?: string;
  criterion?: string;
  sourceId?: string;
  manual?: boolean;
}

export interface IntentEdge {
  from: string;
  to: string;
  kind: IntentEdgeKind;
}

export interface IntentGraph {
  schemaVersion: 1;
  goalId: string;
  /** Changes only when the objective/tasks/criteria contract changes. */
  contractRevision: string;
  /** Changes with contract or runtime progress/status. */
  revision: string;
  rootNodeId: string;
  createdAt: string;
  updatedAt: string;
  nodes: IntentNode[];
  edges: IntentEdge[];
}

function childStatus(state: GoalState): IntentNodeStatus {
  if (state.status === 'done') return 'satisfied';
  if (state.status === 'paused') return 'paused';
  if (state.status === 'cleared') return 'cleared';
  return 'pending';
}

function objectiveStatus(state: GoalState): IntentNodeStatus {
  if (state.status === 'done') return 'satisfied';
  if (state.status === 'paused') return 'paused';
  if (state.status === 'cleared') return 'cleared';
  return 'active';
}

function contractRevision(state: GoalState): string {
  return createHash('sha256')
    .update(JSON.stringify({
      goal: state.goal,
      subgoals: state.subgoals,
      goalPlan: state.goalPlan,
    }))
    .digest('hex')
    .slice(0, 16);
}

function graphRevision(state: GoalState, contract: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ contract, status: state.status, turnsUsed: state.turnsUsed }))
    .digest('hex')
    .slice(0, 16);
}

function addCriteria(
  graph: Pick<IntentGraph, 'nodes' | 'edges'>,
  state: GoalState,
  parentNodeId: string,
  sourceId: string,
  criteria: string[],
  manual = false,
): void {
  criteria.forEach((criterion, index) => {
    const id = `${state.goalId}:criterion:${sourceId}:${index + 1}`;
    graph.nodes.push({
      id,
      kind: 'criterion',
      title: criterion,
      criterion,
      sourceId,
      status: childStatus(state),
      ...(manual ? { manual: true } : {}),
    });
    graph.edges.push({ from: parentNodeId, to: id, kind: 'verified_by' });
  });
}

function addTaskNode(
  graph: Pick<IntentGraph, 'nodes' | 'edges'>,
  state: GoalState,
  task: GoalPlanSubtask,
  parentNodeId: string,
): string {
  const id = `${state.goalId}:task:${task.id}`;
  graph.nodes.push({
    id,
    kind: 'task',
    title: task.title,
    status: childStatus(state),
    sourceId: task.id,
    ...(task.description ? { description: task.description } : {}),
  });
  graph.edges.push({ from: parentNodeId, to: id, kind: 'contains' });
  addCriteria(graph, state, id, task.id, task.acceptanceCriteria);
  return id;
}

/**
 * Build the canonical, read-only intent graph from durable goal state.
 * GoalState remains the persistence source; the graph is a deterministic view
 * so CLI, Cowork and Fleet cannot drift into separate mission formats.
 */
export function buildIntentGraph(state: GoalState): IntentGraph {
  const rootNodeId = `${state.goalId}:objective`;
  const timestamp = new Date(state.lastTurnAt || state.createdAt || 0).toISOString();
  const contract = contractRevision(state);
  const graph: IntentGraph = {
    schemaVersion: 1,
    goalId: state.goalId,
    contractRevision: contract,
    revision: graphRevision(state, contract),
    rootNodeId,
    createdAt: new Date(state.createdAt || 0).toISOString(),
    updatedAt: timestamp,
    nodes: [
      {
        id: rootNodeId,
        kind: 'objective',
        title: state.goal,
        status: objectiveStatus(state),
      },
    ],
    edges: [],
  };

  const taskNodeIds = new Map<string, string>();
  for (const task of state.goalPlan?.tasks ?? []) {
    const taskNodeId = addTaskNode(graph, state, task, rootNodeId);
    taskNodeIds.set(task.id, taskNodeId);
    for (const subtask of task.subtasks) {
      addTaskNode(graph, state, subtask, taskNodeId);
    }
  }

  for (const task of state.goalPlan?.tasks ?? []) {
    const from = taskNodeIds.get(task.id);
    if (!from) continue;
    for (const dependency of task.dependsOn) {
      const to = taskNodeIds.get(dependency);
      if (to) graph.edges.push({ from, to, kind: 'depends_on' });
    }
  }

  addCriteria(graph, state, rootNodeId, 'manual', state.subgoals, true);
  return graph;
}

export function intentCriterionIds(graph: IntentGraph): string[] {
  return graph.nodes.filter((node) => node.kind === 'criterion').map((node) => node.id);
}

export function formatIntentGraph(graph: IntentGraph): string {
  const root = graph.nodes.find((node) => node.id === graph.rootNodeId);
  const tasks = graph.nodes.filter((node) => node.kind === 'task');
  const criteria = graph.nodes.filter((node) => node.kind === 'criterion');
  const lines = [
    `Intent ${graph.goalId} · revision ${graph.revision}`,
    `${root?.status ?? 'pending'} · ${root?.title ?? '(objective missing)'}`,
    `${tasks.length} task(s) · ${criteria.length} criterion/criteria`,
  ];
  for (const task of tasks) {
    lines.push(`- ${task.sourceId ?? task.id}: ${task.title} [${task.status}]`);
  }
  for (const criterion of criteria) {
    lines.push(`  ✓? ${criterion.title}`);
  }
  return lines.join('\n');
}
