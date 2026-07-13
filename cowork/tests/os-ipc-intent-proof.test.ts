import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { GoalStore } from '../../src/goals/goal-store';
import { createGoalState } from '../../src/goals/goal-state';
import type { ProofRecord } from '../../src/goals/proof-ledger';
import {
  activateIntentCapsule,
  awardIntentExchangeBid,
  createIntentCapsule,
  createIntentForgeBranch,
  evaluateIntentForgeBranch,
  readIntentProof,
  rehearseIntentExchangeBid,
  revokeIntentCapsule,
  selectIntentForgeBranch,
  submitIntentExchangeBid,
  updateIntentConstitution,
} from '../src/main/ipc/os-ipc';

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'os-intent-proof-'));
}

function saveMission(home: string, sessionId: string, updatedAt = 200) {
  const state = createGoalState('Livrer le cockpit vocal temps réel', 12);
  state.goalId = `goal-${sessionId}`;
  state.turnsUsed = 4;
  state.createdAt = 100;
  state.lastTurnAt = updatedAt;
  state.verifyGated = true;
  state.subgoals = ['Le flux vocal reste sous 500 ms'];
  state.goalPlan = {
    summary: 'Réduire et prouver la latence bout en bout',
    tasks: [
      {
        id: 'T1',
        title: 'Instrumenter le pipeline vocal',
        acceptanceCriteria: ['Un test mesure la latence STT → TTS'],
        dependsOn: [],
        subtasks: [],
      },
      {
        id: 'T2',
        title: 'Activer le chemin rapide local',
        acceptanceCriteria: ['Le benchmark p95 est inférieur à 500 ms'],
        dependsOn: ['T1'],
        subtasks: [],
      },
    ],
  };
  new GoalStore({ storeDir: join(home, 'goals') }).save(`cowork:${sessionId}`, state);
  return state;
}

function proofFor(goalId: string, id: string, turn: number): ProofRecord {
  return {
    schemaVersion: 1,
    id,
    goalId,
    createdAt: `2026-07-10T10:00:0${turn}.000Z`,
    turn,
    kind: 'verification',
    status: 'pass',
    assurance: 'deterministic',
    summary: `Benchmark ${turn} validé`,
    evidence: `p95=${480 - turn}ms`,
    criterionIds: [`${goalId}:criterion:T2:1`],
    artifacts: ['reports/voice-latency.json'],
    redactionCount: 0,
  };
}

describe('readIntentProof', () => {
  it('projects the active Cowork goal and reads its proof ledger', async () => {
    const home = makeHome();
    const state = saveMission(home, 'session-proof');
    const proofsDir = join(home, 'proofs');
    mkdirSync(proofsDir, { recursive: true });
    const proof = proofFor(state.goalId, 'proof-1', 4);
    writeFileSync(
      join(proofsDir, `${state.goalId}.jsonl`),
      ['{corrupt', JSON.stringify(proof), JSON.stringify(proofFor('goal-other', 'wrong-goal', 5))].join('\n'),
    );

    const payload = await readIntentProof({ sessionId: 'session-proof', proofLimit: 10 }, home);

    expect(payload.source).toBe('cowork-session');
    expect(payload.state).toMatchObject({
      goalId: state.goalId,
      goal: state.goal,
      turnsUsed: 4,
      maxTurns: 12,
      verifyGated: true,
    });
    expect(payload.graph?.nodes.filter((node) => node.kind === 'task')).toHaveLength(2);
    expect(payload.graph?.nodes.filter((node) => node.kind === 'criterion')).toHaveLength(3);
    expect(payload.progress).toMatchObject({ total: 3, passed: 1, coverage: 1 / 3 });
    expect(payload.integrity.status).toBe('legacy');
    expect(payload.graph?.edges).toContainEqual({
      from: `${state.goalId}:task:T2`,
      to: `${state.goalId}:task:T1`,
      kind: 'depends_on',
    });
    expect(payload.proofs).toEqual([proof]);
  });

  it('keeps only the requested proof tail and selects the latest mission without a session', async () => {
    const home = makeHome();
    saveMission(home, 'older', 200);
    const latest = saveMission(home, 'latest', 500);
    const proofsDir = join(home, 'proofs');
    mkdirSync(proofsDir, { recursive: true });
    writeFileSync(
      join(proofsDir, `${latest.goalId}.jsonl`),
      [proofFor(latest.goalId, 'proof-1', 1), proofFor(latest.goalId, 'proof-2', 2)]
        .map((proof) => JSON.stringify(proof))
        .join('\n'),
    );

    const payload = await readIntentProof({ proofLimit: 1 }, home);

    expect(payload.source).toBe('latest');
    expect(payload.state?.goalId).toBe(latest.goalId);
    expect(payload.proofs.map((proof) => proof.id)).toEqual(['proof-2']);
  });

  it('does not leak another session goal when the requested session has none', async () => {
    const home = makeHome();
    saveMission(home, 'another-session');

    await expect(readIntentProof({ sessionId: 'missing-session' }, home)).resolves.toEqual({
      source: 'none',
      state: null,
      graph: null,
      progress: null,
      proofs: [],
      integrity: { status: 'empty', checked: 0, legacy: 0, errors: [] },
      forgeBranches: [],
      outcomes: [],
      constitution: null,
      exchangeBids: [],
      shadowRehearsals: [],
      capsules: [],
    });
  });

  it('creates, evaluates and selects a proof-backed Forge branch through the main bridge', async () => {
    const home = makeHome();
    const state = saveMission(home, 'forge-session');
    const created = await createIntentForgeBranch({
      sessionId: 'forge-session',
      label: 'Pocket local',
      hypothesis: 'Local streaming minimizes voice latency.',
      strategy: 'Pocket TTS with sentence chunking.',
    }, home);
    expect(created.ok).toBe(true);
    const branchId = created.payload.forgeBranches[0]!.id;
    const criterionIds = created.payload.graph!.nodes
      .filter((node) => node.kind === 'criterion')
      .map((node) => node.id);
    const proofsDir = join(home, 'proofs');
    mkdirSync(proofsDir, { recursive: true });
    writeFileSync(
      join(proofsDir, `${state.goalId}.jsonl`),
      JSON.stringify({
        ...proofFor(state.goalId, 'proof-forge', 6),
        criterionIds,
        criterionResults: criterionIds.map((criterionId) => ({ criterionId, status: 'passed' })),
      }),
    );

    const evaluated = await evaluateIntentForgeBranch({
      sessionId: 'forge-session',
      branchId,
      quality: 0.95,
      latencyMs: 468,
    }, home);
    expect(evaluated.ok).toBe(true);
    expect(evaluated.payload.forgeBranches[0]?.metrics).toMatchObject({ eligible: true });

    const selected = await selectIntentForgeBranch({ sessionId: 'forge-session', branchId }, home);
    expect(selected.ok).toBe(true);
    expect(selected.payload.forgeBranches[0]?.status).toBe('selected');
  });

  it('runs constitution, Exchange, Shadow Twin and proof-gated Forge award through IPC actions', async () => {
    const home = makeHome();
    saveMission(home, 'exchange-session');
    const policy = await updateIntentConstitution({
      sessionId: 'exchange-session',
      privacy: 'private-peers',
      maxCostUsd: 2,
      maxLatencyMs: 800,
      requireReversible: true,
      approval: 'on-risk',
      maxRisk: 'high',
    }, home);
    expect(policy.ok).toBe(true);
    const criterionIds = policy.payload.progress!.criteria.map((criterion) => criterion.criterionId);

    const submitted = await submitIntentExchangeBid({
      sessionId: 'exchange-session',
      label: 'Fleet hybride',
      provider: 'fleet',
      model: 'two-peers',
      strategy: 'Two peers with local synthesis',
      hypothesis: 'Two peers avoid one failure point',
      evidencePlan: 'Measure every criterion',
      criterionIds,
      quality: 0.94,
      latencyMs: 520,
      costUsd: 0.04,
      privacy: 'private',
      reversible: true,
      risk: 'high',
    }, home);
    expect(submitted.ok).toBe(true);
    const bidId = submitted.payload.exchangeBids[0]!.bid.id;
    expect(submitted.payload.exchangeBids[0]?.settlement.shadow).toBe(false);

    const rehearsed = await rehearseIntentExchangeBid({
      sessionId: 'exchange-session',
      bidId,
      quality: 0.9,
      latencyMs: 542,
      costUsd: 0.04,
      reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
    }, home);
    expect(rehearsed.ok).toBe(true);
    expect(rehearsed.payload.exchangeBids[0]?.settlement.readyToAward).toBe(true);

    const awarded = await awardIntentExchangeBid({
      sessionId: 'exchange-session',
      bidId,
      humanApproved: true,
    }, home);
    expect(awarded.ok).toBe(true);
    expect(awarded.payload.exchangeBids[0]?.bid.status).toBe('awarded');
    expect(awarded.payload.exchangeBids[0]?.bid.forgeBranchId).toBe(awarded.payload.forgeBranches[0]?.id);
  });

  it('compiles, activates and revokes a multi-runtime Outcome Capsule', async () => {
    const home = makeHome();
    const state = saveMission(home, 'capsule-session');
    const policy = await updateIntentConstitution({
      sessionId: 'capsule-session', privacy: 'private-peers', maxCostUsd: 2, maxLatencyMs: 800,
      requireReversible: true, approval: 'always', maxRisk: 'high',
    }, home);
    const criterionIds = policy.payload.progress!.criteria.map((criterion) => criterion.criterionId);
    for (const [label, provider, model] of [['Local', 'vllm', 'gemma'], ['Council', 'openrouter', 'nemotron']] as const) {
      const submitted = await submitIntentExchangeBid({
        sessionId: 'capsule-session', label, provider, model,
        strategy: 'Replay the proven workflow', hypothesis: 'The workflow is portable',
        evidencePlan: 'Measure every criterion', criterionIds, quality: 0.92,
        latencyMs: 400, costUsd: 0, privacy: provider === 'vllm' ? 'local' : 'private',
        reversible: true, risk: 'low',
      }, home);
      const bidId = submitted.payload.exchangeBids.find((entry) => entry.bid.label === label)!.bid.id;
      await rehearseIntentExchangeBid({
        sessionId: 'capsule-session', bidId, quality: 0.9, latencyMs: 410, costUsd: 0,
        reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
      }, home);
    }
    const outcomesDir = join(home, 'outcomes');
    mkdirSync(outcomesDir, { recursive: true });
    writeFileSync(join(outcomesDir, 'proven-outcomes.jsonl'), JSON.stringify({
      schemaVersion: 1, id: 'outcome-capsule', goalId: state.goalId,
      intentRevision: policy.payload.graph!.contractRevision, goal: state.goal,
      completedAt: '2026-07-11T00:00:00.000Z', source: 'loop', trustScore: 0.98,
      criteria: [], proofIds: ['proof-1'], proofHashes: ['proof-hash-1'], artifacts: [],
    }));

    const created = await createIntentCapsule({
      sessionId: 'capsule-session', outcomeId: 'outcome-capsule', title: 'Voice capsule', requiredRuntimes: 2,
    }, home);
    expect(created.ok).toBe(true);
    expect(created.payload.capsules[0]).toMatchObject({ status: 'portable', portability: { distinctRuntimes: 2, portable: true } });
    const capsuleId = created.payload.capsules[0]!.id;
    const activated = await activateIntentCapsule({ sessionId: 'capsule-session', capsuleId, humanApproved: true }, home);
    expect(activated.payload.capsules[0]?.status).toBe('active');
    const revoked = await revokeIntentCapsule({ sessionId: 'capsule-session', capsuleId }, home);
    expect(revoked.payload.capsules[0]?.status).toBe('revoked');
  });
});
