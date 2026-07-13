import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getLessonCandidateQueue,
  resetLessonCandidateQueues,
} from '../../src/agent/lesson-candidate-queue.js';
import { buildIntentGraph } from '../../src/goals/intent-graph.js';
import type { ProofRecord } from '../../src/goals/proof-ledger.js';
import {
  ProvenOutcomeStore,
} from '../../src/goals/proven-outcome-memory.js';
import { proposeLessonFromProvenOutcome } from '../../src/goals/proven-outcome-lessons.js';
import { createGoalState } from '../../src/goals/goal-state.js';

describe('Proven Outcome Memory', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proven-outcome-'));
    resetLessonCandidateQueues();
  });

  afterEach(() => {
    resetLessonCandidateQueues();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    const state = createGoalState('Deliver verified real-time voice interactions');
    state.goalId = 'goal-outcome';
    state.status = 'done';
    state.subgoals = ['p95 is below 500 ms'];
    const graph = buildIntentGraph(state);
    const criterionId = graph.nodes.find((node) => node.kind === 'criterion')!.id;
    const proof: ProofRecord = {
      schemaVersion: 1,
      id: 'proof-outcome',
      goalId: state.goalId,
      createdAt: '2026-07-10T10:00:00.000Z',
      turn: 2,
      kind: 'verification',
      status: 'pass',
      assurance: 'deterministic',
      summary: 'voice benchmark passed',
      evidence: 'p95=468ms',
      criterionIds: [criterionId],
      criterionResults: [{ criterionId, status: 'passed', evidence: 'p95=468ms' }],
      artifacts: [],
      artifactRefs: [{
        schemaVersion: 1,
        id: 'sha256:voice',
        path: 'reports/voice.json',
        sha256: 'voice',
        sizeBytes: 100,
        mediaType: 'application/json',
        capturedAt: '2026-07-10T10:00:00.000Z',
      }],
      redactionCount: 0,
      recordHash: 'record-hash',
    };
    return { state, graph, proof };
  }

  it('stores only strongly proven outcomes and de-duplicates the same intent contract', () => {
    const { state, graph, proof } = setup();
    const store = new ProvenOutcomeStore({
      filePath: path.join(dir, 'outcomes.jsonl'),
      now: () => new Date('2026-07-10T12:00:00.000Z'),
    });

    const first = store.capture({ state, graph, proofs: [proof], source: 'test-loop' });
    const second = store.capture({ state, graph, proofs: [proof], source: 'test-loop' });

    expect(first.outcome).toMatchObject({
      goalId: state.goalId,
      trustScore: 1,
      proofHashes: ['record-hash'],
    });
    expect(first.outcome?.artifacts.map((artifact) => artifact.sha256)).toEqual(['voice']);
    expect(second).toMatchObject({ deduped: true, outcome: { id: first.outcome?.id } });
    expect(store.list()).toHaveLength(1);
  });

  it('refuses unsupported completion claims', () => {
    const { state, graph, proof } = setup();
    const store = new ProvenOutcomeStore({ filePath: path.join(dir, 'outcomes.jsonl') });
    const weak = { ...proof, status: 'fail' as const, assurance: 'judge' as const };

    expect(store.capture({ state, graph, proofs: [weak], source: 'test-loop' })).toEqual({
      outcome: null,
      reason: 'no deterministic or independent passing proof',
    });
  });

  it('feeds a proven outcome into the human-reviewed lesson queue, never lessons.md', () => {
    const { state, graph, proof } = setup();
    const store = new ProvenOutcomeStore({ filePath: path.join(dir, 'outcomes.jsonl') });
    const outcome = store.capture({ state, graph, proofs: [proof], source: 'test-loop' }).outcome!;

    const proposed = proposeLessonFromProvenOutcome(outcome, dir);

    expect(proposed.candidate.status).toBe('pending');
    expect(proposed.candidate.provenance?.outcomeId).toBe(outcome.id);
    expect(getLessonCandidateQueue(dir).list('pending')).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, '.codebuddy', 'lessons.md'))).toBe(false);
  });
});
