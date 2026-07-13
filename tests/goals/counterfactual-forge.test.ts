import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CounterfactualForge } from '../../src/goals/counterfactual-forge.js';
import { buildIntentGraph } from '../../src/goals/intent-graph.js';
import type { ProofRecord } from '../../src/goals/proof-ledger.js';
import { createGoalState } from '../../src/goals/goal-state.js';

describe('Counterfactual Forge', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'counterfactual-forge-'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('compares proof-backed strategies and selects only an eligible winner', () => {
    const state = createGoalState('Minimize voice latency with no quality regression');
    state.goalId = 'goal-forge';
    state.subgoals = ['p95 is below 500 ms', 'voice quality remains above 0.9'];
    const graph = buildIntentGraph(state);
    const criteria = graph.nodes.filter((node) => node.kind === 'criterion').map((node) => node.id);
    let now = 0;
    let id = 0;
    const forge = new CounterfactualForge(state.goalId, {
      storeDir: dir,
      now: () => new Date(1_700_000_000_000 + now++),
      idFactory: () => String(++id),
    });
    const local = forge.create(graph, {
      label: 'Pocket local',
      hypothesis: 'A local speculative path minimizes first audio latency.',
      strategy: 'Pocket TTS plus streaming sentence chunks.',
    });
    const cloud = forge.create(graph, {
      label: 'Cloud quality',
      hypothesis: 'A remote voice improves quality at acceptable latency.',
      strategy: 'Remote synthesis with connection pre-warming.',
    });
    const proof: ProofRecord = {
      schemaVersion: 1,
      id: 'proof-local',
      goalId: state.goalId,
      createdAt: '2026-07-10T10:00:00.000Z',
      turn: 1,
      kind: 'verification',
      status: 'pass',
      assurance: 'deterministic',
      summary: 'benchmark passed',
      evidence: 'p95=468ms; MOS=0.93',
      criterionIds: criteria,
      criterionResults: criteria.map((criterionId) => ({ criterionId, status: 'passed' as const })),
      artifacts: ['reports/voice.json'],
      artifactRefs: [{
        schemaVersion: 1,
        id: 'sha256:abc',
        path: 'reports/voice.json',
        sha256: 'abc',
        sizeBytes: 10,
        mediaType: 'application/json',
        capturedAt: '2026-07-10T10:00:00.000Z',
      }],
      redactionCount: 0,
    };

    const evaluatedLocal = forge.evaluate(local.id, {
      graph,
      proofs: [proof],
      quality: 0.93,
      latencyMs: 468,
      costUsd: 0,
    });
    const evaluatedCloud = forge.evaluate(cloud.id, {
      graph,
      proofs: [proof],
      quality: 0.98,
      latencyMs: 1200,
      costUsd: 0.02,
      regressions: ['latency budget exceeded'],
    });

    expect(evaluatedLocal.metrics).toMatchObject({ eligible: true, proofCoverage: 1 });
    expect(evaluatedLocal.artifactHashes).toEqual(['abc']);
    expect(evaluatedCloud.metrics?.eligible).toBe(false);
    expect(() => forge.select(cloud.id)).toThrow('not eligible');
    expect(forge.select()?.id).toBe(local.id);
    expect(forge.list().find((branch) => branch.id === local.id)?.status).toBe('selected');
  });

  it('rejects evaluation after the intent contract changes', () => {
    const state = createGoalState('Ship one contract');
    state.goalId = 'goal-forge';
    state.subgoals = ['first criterion'];
    const graph = buildIntentGraph(state);
    const forge = new CounterfactualForge(state.goalId, { storeDir: dir, idFactory: () => 'stale' });
    const branch = forge.create(graph, {
      label: 'Original',
      hypothesis: 'The original strategy works.',
      strategy: 'Run focused tests.',
    });
    state.subgoals.push('new contract criterion');

    expect(() => forge.evaluate(branch.id, { graph: buildIntentGraph(state), proofs: [] }))
      .toThrow('intent revision changed');
  });
});
