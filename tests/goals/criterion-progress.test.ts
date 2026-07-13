import { describe, expect, it } from 'vitest';
import { deriveIntentProgress } from '../../src/goals/criterion-progress.js';
import { buildIntentGraph } from '../../src/goals/intent-graph.js';
import type { ProofRecord } from '../../src/goals/proof-ledger.js';
import { createGoalState } from '../../src/goals/goal-state.js';

function proof(overrides: Partial<ProofRecord>): ProofRecord {
  return {
    schemaVersion: 1,
    id: 'proof-1',
    goalId: 'goal-progress',
    createdAt: '2026-07-10T10:00:00.000Z',
    turn: 1,
    kind: 'verification',
    status: 'unknown',
    assurance: 'independent',
    summary: 'verification result',
    evidence: '',
    criterionIds: [],
    artifacts: [],
    redactionCount: 0,
    ...overrides,
  };
}

describe('deriveIntentProgress', () => {
  it('tracks each criterion independently across proof turns', () => {
    const state = createGoalState('Ship verified voice latency');
    state.goalId = 'goal-progress';
    state.subgoals = ['p95 is below 500 ms', 'barge-in interrupts playback'];
    const graph = buildIntentGraph(state);
    const [latencyId, bargeInId] = graph.nodes
      .filter((node) => node.kind === 'criterion')
      .map((node) => node.id);

    const progress = deriveIntentProgress(graph, [
      proof({
        criterionResults: [
          { criterionId: latencyId!, status: 'passed', evidence: 'p95=468ms' },
          { criterionId: bargeInId!, status: 'failed', evidence: 'playback continued' },
        ],
        criterionIds: [latencyId!, bargeInId!],
      }),
      proof({
        id: 'proof-2',
        createdAt: '2026-07-10T10:05:00.000Z',
        status: 'pass',
        assurance: 'deterministic',
        criterionResults: [
          { criterionId: bargeInId!, status: 'passed', evidence: 'interruptions=0' },
        ],
        criterionIds: [bargeInId!],
      }),
    ]);

    expect(progress).toMatchObject({ total: 2, passed: 2, failed: 0, coverage: 1 });
    expect(progress.criteria.find((item) => item.criterionId === latencyId)).toMatchObject({
      status: 'passed',
      assurance: 'independent',
      proofIds: ['proof-1'],
    });
    expect(progress.criteria.find((item) => item.criterionId === bargeInId)).toMatchObject({
      status: 'passed',
      assurance: 'deterministic',
      proofIds: ['proof-1', 'proof-2'],
    });
  });

  it('keeps a conclusive result when a later attempt is unknown', () => {
    const state = createGoalState('Prove one criterion');
    state.goalId = 'goal-progress';
    state.subgoals = ['focused test passes'];
    const graph = buildIntentGraph(state);
    const criterionId = graph.nodes.find((node) => node.kind === 'criterion')!.id;

    const progress = deriveIntentProgress(graph, [
      proof({ status: 'pass', criterionIds: [criterionId] }),
      proof({ id: 'proof-2', status: 'unknown', criterionIds: [criterionId] }),
    ]);

    expect(progress.criteria[0]?.status).toBe('passed');
    expect(progress.criteria[0]?.proofIds).toEqual(['proof-1', 'proof-2']);
  });
});
