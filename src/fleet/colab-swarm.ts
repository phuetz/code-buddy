/**
 * Fleet swarm — Hermes-kanban-style "workers → verifier → synthesizer" topology
 * expressed as a dependency DAG on the {@link FleetColabStore}.
 *
 * A goal becomes N parallel worker tasks (claimable immediately, any agent, free
 * local tier), one verifier task that `dependsOn` all workers, and one
 * synthesizer task that `dependsOn` the verifier. Because the store gates
 * claiming on completed dependencies, the autonomous loop runs the graph in the
 * right order with **no loop changes**: verifier only after every worker is done,
 * synthesizer only after the verifier — the verify-before-done discipline, made
 * a first-class fleet primitive.
 *
 * Pure composition over the store's public API (`addTask` with `dependsOn`).
 */

import type { ColabTaskPriority, FleetColabStore } from './colab-store.js';

export interface SwarmWorkerSpec {
  title: string;
  priority?: ColabTaskPriority;
  description?: string;
}

export interface CreateSwarmInput {
  goal: string;
  workers: SwarmWorkerSpec[];
  /** Verifier task title (default: "Verify: <goal>"). */
  verifierTitle?: string;
  /** Synthesizer task title (default: "Synthesize: <goal>"). */
  synthesizerTitle?: string;
  createdBy?: string;
}

export interface SwarmGraph {
  goal: string;
  workerIds: string[];
  verifierId: string;
  synthesizerId: string;
}

export function createSwarm(store: FleetColabStore, input: CreateSwarmInput): SwarmGraph {
  if (input.workers.length === 0) {
    throw new Error('A swarm needs at least one worker');
  }

  const workerIds = input.workers.map((worker, i) =>
    store.addTask({
      title: worker.title,
      description: worker.description ?? `Swarm worker ${i + 1}/${input.workers.length} for goal: ${input.goal}`,
      priority: worker.priority ?? 'medium',
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    }).id,
  );

  const verifier = store.addTask({
    title: input.verifierTitle ?? `Verify: ${input.goal}`,
    description: `Verify all ${workerIds.length} worker outputs for goal: ${input.goal}`,
    priority: 'high',
    dependsOn: workerIds,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  });

  const synthesizer = store.addTask({
    title: input.synthesizerTitle ?? `Synthesize: ${input.goal}`,
    description: `Synthesize the verified worker outputs into the final result for goal: ${input.goal}`,
    priority: 'high',
    dependsOn: [verifier.id],
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  });

  return { goal: input.goal, workerIds, verifierId: verifier.id, synthesizerId: synthesizer.id };
}
