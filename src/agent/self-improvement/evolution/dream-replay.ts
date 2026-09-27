/**
 * Offline exploration-policy replay over observed variant edges.
 * Clean-room adaptation of Dream-RSI (arXiv:2609.14858): only a revealed prefix
 * reaches the policy. Missing branches have no invented score or continuation.
 * It shares strategy-replay.ts's evidence label and paired summary, while using
 * a stricter transition rule: no outcome is inferred beyond recorded edges.
 */
import type { PairedDecision } from '../paired-gate.js';
import { pairedReplayDecision } from '../strategy-replay.js';
import type { VariantRecord } from './code-variant-store.js';

export interface DiscoveryNode {
  id: string;
  parentId: string;
  weaknessId: string;
  score: number;
  passedAll: boolean;
  regressions: readonly string[];
  createdAt: string;
}

export interface DiscoveryWorld {
  id: string;
  rootScore: number;
  nodes: readonly DiscoveryNode[];
}

export interface VisiblePrefix {
  rootScore: number;
  round: number;
  nodes: readonly DiscoveryNode[];
  leaves: readonly string[];
}

export interface DiscoveryAction { parentId: string; weaknessId: string }
export type DiscoveryPolicy = (prefix: VisiblePrefix) => readonly DiscoveryAction[];

export interface ReplayStep { action: DiscoveryAction; revealedId: string; score: number }
export interface ReplayOutcome {
  status: 'completed' | 'unsupported';
  reason?: 'UNRECORDED_BRANCH' | 'ILLEGAL_PARENT' | 'INVALID_BATCH';
  revealedIds: string[];
  steps: ReplayStep[];
  bestScore: number;
  rounds: number;
  objective: number;
}

export interface PolicyCode {
  id: string;
  weaknessOrder: string[];
  parentRule: 'root' | 'best-leaf' | 'mixed';
  parallel: 1 | 2;
  maxRounds: number;
  stopGain: number;
}

export interface PolicyEvaluation {
  policy: PolicyCode;
  evidence: 'replay';
  rollouts: ReplayOutcome[];
  objective: number;
}

export type DreamResult =
  | { status: 'insufficient'; reason: 'ARCHIVE_INSUFFICIENT' | 'NO_SUPPORTED_POLICY' }
  | {
      status: 'selected'; best: PolicyEvaluation; baseline: PolicyEvaluation;
      selection: DiscoveryAction; paired: PairedDecision;
    };

/** The old inspiration DAG is not a checkout genealogy. Only explicit edges are replayable. */
export function worldsFromVariants(records: readonly VariantRecord[]): DiscoveryWorld[] {
  const groups = new Map<string, VariantRecord[]>();
  for (const record of records) {
    const edge = record.discovery;
    if (!edge?.worldId || !edge.primaryParentId || !edge.weaknessId) continue;
    const group = groups.get(edge.worldId) ?? [];
    group.push(record);
    groups.set(edge.worldId, group);
  }
  const worlds: DiscoveryWorld[] = [];
  for (const [id, group] of groups) {
    // CodeVariantStore is append-only; its order is the observed completion order.
    const rootScore = group[0]?.discovery?.baselineScore;
    if (rootScore === undefined || !Number.isFinite(rootScore)
      || rootScore < 0 || rootScore > 1 || group.length < 2) continue;
    const seen = new Set<string>();
    const nonRootChildren = new Set<string>();
    let valid = true;
    const nodes: DiscoveryNode[] = [];
    for (const record of group) {
      const edge = record.discovery!;
      if (!record.id || seen.has(record.id) || !Number.isFinite(record.score)
        || record.score < 0 || record.score > 1 || edge.baselineScore !== rootScore
        || typeof record.passedAll !== 'boolean' || !Array.isArray(record.regressions)
        || !Number.isFinite(Date.parse(record.createdAt))
        || (edge.primaryParentId !== 'root' && (!seen.has(edge.primaryParentId)
          || nonRootChildren.has(edge.primaryParentId)))) {
        valid = false;
        break;
      }
      if (edge.primaryParentId !== 'root') nonRootChildren.add(edge.primaryParentId);
      seen.add(record.id);
      nodes.push({
        id: record.id, parentId: edge.primaryParentId, weaknessId: edge.weaknessId,
        score: record.score, passedAll: record.passedAll,
        regressions: record.regressions, createdAt: record.createdAt,
      });
    }
    if (valid) worlds.push({ id, rootScore, nodes });
  }
  return worlds.sort((a, b) =>
    a.nodes[a.nodes.length - 1]!.createdAt.localeCompare(b.nodes[b.nodes.length - 1]!.createdAt)
      || a.id.localeCompare(b.id));
}

/** Replay a policy without exposing scores or descendants before their recorded parent is revealed. */
export function replayDiscoveryWorld(
  world: DiscoveryWorld,
  policy: DiscoveryPolicy,
  options: { maxRounds?: number; maxParallel?: number; costPenalty?: number; parallelBonus?: number } = {},
): ReplayOutcome {
  const maxRounds = options.maxRounds ?? 4;
  const maxParallel = options.maxParallel ?? 2;
  const observed: DiscoveryNode[] = [];
  const revealed = new Set<string>();
  const steps: ReplayStep[] = [];
  let rounds = 0;
  const finish = (status: ReplayOutcome['status'], reason?: ReplayOutcome['reason']): ReplayOutcome => {
    // Fitness remains observed, but only empirically passing, non-regressing
    // variants can raise the usable best score (same gate as CodeVariantStore.best).
    const bestScore = Math.max(world.rootScore, ...observed
      .filter((node) => node.passedAll && node.regressions.length === 0)
      .map((node) => node.score));
    const attempts = observed.length;
    return {
      status, ...(reason ? { reason } : {}), revealedIds: observed.map((node) => node.id),
      steps, bestScore, rounds,
      objective: status === 'completed'
        ? bestScore - (options.costPenalty ?? 0.05) * attempts
          + (options.parallelBonus ?? 0.01) * attempts / Math.max(1, rounds)
        : Number.NEGATIVE_INFINITY,
    };
  };
  while (rounds < maxRounds && observed.length < world.nodes.length) {
    const leaves = observed.filter((node) => !observed.some((child) => child.parentId === node.id))
      .map((node) => node.id);
    const prefix: VisiblePrefix = {
      rootScore: world.rootScore, round: rounds,
      nodes: observed.map((node) => ({ ...node, regressions: [...node.regressions] })),
      leaves: [...leaves],
    };
    const batch = policy(prefix);
    if (batch.length === 0) return finish('completed');
    if (batch.length > maxParallel || new Set(batch.map((action) => action.parentId)).size !== batch.length) {
      return finish('unsupported', 'INVALID_BATCH');
    }
    const next: DiscoveryNode[] = [];
    for (const action of batch) {
      if (action.parentId !== 'root' && !leaves.includes(action.parentId)) {
        return finish('unsupported', 'ILLEGAL_PARENT');
      }
      // Root opens the earliest unseen recorded branch; a leaf has one recorded child.
      const child = world.nodes.find((node) => node.parentId === action.parentId && !revealed.has(node.id));
      if (!child || child.weaknessId !== action.weaknessId) {
        return finish('unsupported', 'UNRECORDED_BRANCH');
      }
      next.push(child);
    }
    for (let index = 0; index < batch.length; index++) {
      const child = next[index]!;
      observed.push(child);
      revealed.add(child.id);
      steps.push({ action: { ...batch[index]! }, revealedId: child.id, score: child.score });
    }
    rounds++;
  }
  return finish('completed');
}

/** Bounded, executable policy family. The closure reads only VisiblePrefix. */
export function explorationPolicy(code: PolicyCode): DiscoveryPolicy {
  return (prefix) => {
    if (prefix.round >= code.maxRounds) return [];
    const best = Math.max(prefix.rootScore, ...prefix.nodes
      .filter((node) => node.passedAll && node.regressions.length === 0)
      .map((node) => node.score));
    if (prefix.nodes.length > 0 && best - prefix.rootScore >= code.stopGain) return [];
    const rootVisits = prefix.nodes.filter((node) => node.parentId === 'root').length;
    const root: DiscoveryAction = {
      parentId: 'root',
      weaknessId: code.weaknessOrder[rootVisits % code.weaknessOrder.length]!,
    };
    const leaf = prefix.nodes
      .filter((node) => prefix.leaves.includes(node.id) && node.passedAll && node.regressions.length === 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
    const continuation = leaf ? { parentId: leaf.id, weaknessId: leaf.weaknessId } : undefined;
    if (code.parentRule === 'root' || !continuation) return [root];
    if (code.parentRule === 'best-leaf') return [continuation];
    return code.parallel === 2 ? [root, continuation] : [continuation];
  };
}

function orders(values: string[], worlds: readonly DiscoveryWorld[]): string[][] {
  const result: string[][] = [values];
  for (const first of values) {
    for (const second of values) {
      result.push([first, second]);
    }
  }
  for (const world of worlds) {
    result.push(world.nodes.filter((node) => node.parentId === 'root')
      .slice(0, 4).map((node) => node.weaknessId));
  }
  const distinct = new Map<string, string[]>();
  for (const order of result) {
    if (order.length > 0) distinct.set(order.join('\u0000'), order);
  }
  return [...distinct.values()];
}

function evaluate(worlds: readonly DiscoveryWorld[], policy: PolicyCode): PolicyEvaluation | null {
  const rollouts = worlds.map((world) => replayDiscoveryWorld(world, explorationPolicy(policy), {
    maxRounds: policy.maxRounds, maxParallel: policy.parallel,
  }));
  if (rollouts.some((rollout) => rollout.status === 'unsupported')) return null;
  return {
    policy, evidence: 'replay', rollouts,
    objective: rollouts.reduce((sum, rollout) => sum + rollout.objective, 0) / rollouts.length,
  };
}

/** Search a small fixed family; retain a strictly better replay policy, never install it. */
export function dreamExplorationPolicy(worlds: readonly DiscoveryWorld[]): DreamResult {
  if (worlds.length === 0 || worlds.some((world) => world.nodes.length < 2)) {
    return { status: 'insufficient', reason: 'ARCHIVE_INSUFFICIENT' };
  }
  const weaknesses = [...new Set(worlds.flatMap((world) => world.nodes.map((node) => node.weaknessId)))].sort();
  if (weaknesses.length === 0 || weaknesses.length > 8) {
    return { status: 'insufficient', reason: 'ARCHIVE_INSUFFICIENT' };
  }
  const baselineCode: PolicyCode = {
    id: 'fixed-root-once', weaknessOrder: [worlds[0]!.nodes[0]!.weaknessId],
    parentRule: 'root', parallel: 1, maxRounds: 1, stopGain: Number.POSITIVE_INFINITY,
  };
  const baseline = evaluate(worlds, baselineCode);
  if (!baseline) return { status: 'insufficient', reason: 'NO_SUPPORTED_POLICY' };
  let best = baseline;
  for (const order of orders(weaknesses, worlds)) {
    for (const parentRule of ['root', 'best-leaf', 'mixed'] as const) {
      for (const parallel of [1, 2] as const) {
        for (const maxRounds of [1, 2, 3, 4]) {
          for (const stopGain of [0.1, 0.3, Number.POSITIVE_INFINITY]) {
            const policy: PolicyCode = {
              id: `${order.join('+')}:${parentRule}:${parallel}:${maxRounds}:${stopGain}`,
              weaknessOrder: order, parentRule, parallel, maxRounds, stopGain,
            };
            const candidate = evaluate(worlds, policy);
            const regresses = candidate?.rollouts.some((rollout, index) =>
              rollout.objective < baseline.rollouts[index]!.objective - 1e-12);
            if (candidate && !regresses && candidate.objective > best.objective + 1e-12) best = candidate;
          }
        }
      }
    }
  }
  const latest = worlds[worlds.length - 1]!;
  const replay = best.rollouts[worlds.length - 1]!;
  const eligible = replay.steps.filter((step) => {
    const node = latest.nodes.find((entry) => entry.id === step.revealedId);
    return node?.passedAll && node.regressions.length === 0;
  }).sort((a, b) => b.score - a.score);
  const selection = eligible[0]?.action;
  if (!selection) return { status: 'insufficient', reason: 'NO_SUPPORTED_POLICY' };
  const paired = pairedReplayDecision(worlds.map((_, index) => ({
    parent: baseline.rollouts[index]!.objective,
    candidate: best.rollouts[index]!.objective,
  })));
  return { status: 'selected', best, baseline, selection, paired };
}
