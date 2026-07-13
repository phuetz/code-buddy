import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OutcomeCapsuleStore } from '../../src/goals/outcome-capsule.js';
import type { MissionConstitution } from '../../src/goals/mission-constitution.js';
import type { MissionBidEvaluation } from '../../src/goals/mission-exchange.js';
import type { ProvenOutcomeRecord } from '../../src/goals/proven-outcome-memory.js';

const dirs: string[] = [];

function outcome(): ProvenOutcomeRecord {
  return {
    schemaVersion: 1,
    id: 'outcome-1',
    goalId: 'goal-capsule',
    intentRevision: 'intent-1',
    goal: 'Ship a verified voice loop',
    completedAt: '2026-07-11T00:00:00.000Z',
    source: 'loop',
    trustScore: 0.96,
    criteria: [{ criterionId: 'c1', title: 'p95 below 500 ms', assurance: 'deterministic', proofIds: ['proof-1'] }],
    proofIds: ['proof-1'],
    proofHashes: ['proof-hash-1'],
    artifacts: [{ schemaVersion: 1, id: 'sha256:artifact-1', path: 'voice.json', sha256: 'artifact-1', sizeBytes: 42, capturedAt: '2026-07-11T00:00:00.000Z' }],
  };
}

function constitution(): MissionConstitution {
  return {
    schemaVersion: 1,
    goalId: 'goal-capsule',
    intentRevision: 'intent-1',
    privacy: 'private-peers',
    maxCostUsd: 2,
    maxLatencyMs: 800,
    requireReversible: true,
    approval: 'always',
    maxRisk: 'medium',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
  };
}

function evaluation(id: string, provider: string, model: string): MissionBidEvaluation {
  return {
    bid: {
      schemaVersion: 1,
      id,
      goalId: 'goal-capsule',
      intentRevision: 'intent-1',
      label: `${provider} ${model}`,
      provider,
      model,
      origin: 'test',
      strategy: 'Replay the proven workflow',
      hypothesis: 'The workflow is portable',
      evidencePlan: 'Run every criterion',
      criterionIds: ['c1'],
      prediction: { quality: 0.9, latencyMs: 300, costUsd: 0 },
      privacy: 'local',
      reversible: true,
      risk: 'low',
      status: 'rehearsed',
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
    },
    policy: { allowed: true, requiresApproval: false, violations: [] },
    pareto: true,
    score: 0.9,
    rehearsal: {
      schemaVersion: 1,
      id: `shadow-${id}`,
      goalId: 'goal-capsule',
      intentRevision: 'intent-1',
      bidId: id,
      prediction: { quality: 0.9, latencyMs: 300, costUsd: 0 },
      observation: { quality: 0.89, latencyMs: 310, costUsd: 0 },
      drift: { quality: 0.01, latency: 0.033, cost: 0, score: 0.02, threshold: 0.1 },
      reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
      status: 'pass',
      journal: ['pass'],
      createdAt: '2026-07-11T00:00:00.000Z',
    },
    settlement: { constitution: true, shadow: true, proofPlan: true, reversibility: true, readyToAward: true },
  };
}

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-capsule-'));
  dirs.push(root);
  return new OutcomeCapsuleStore({
    filePath: path.join(root, 'capsules.jsonl'),
    now: () => new Date('2026-07-11T10:00:00.000Z'),
    idFactory: () => 'stable-id',
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('OutcomeCapsuleStore', () => {
  it('creates a portable capsule only after two distinct passing runtimes', () => {
    const store = harness();
    const capsule = store.create({
      outcome: outcome(),
      constitution: constitution(),
      evaluations: [evaluation('b1', 'vllm', 'gemma'), evaluation('b2', 'openrouter', 'nemotron')],
      parameters: [{ name: 'language', label: 'Language', type: 'string', required: true }],
    });
    expect(capsule.status).toBe('portable');
    expect(capsule.portability).toEqual({ requiredRuntimes: 2, distinctRuntimes: 2, portable: true });
    expect(capsule.proofHashes).toEqual(['proof-hash-1']);
    expect(store.get(capsule.id)?.contentHash).toBe(capsule.contentHash);
  });

  it('requires explicit approval to activate and makes revocation terminal', () => {
    const store = harness();
    const capsule = store.create({
      outcome: outcome(),
      constitution: constitution(),
      evaluations: [evaluation('b1', 'vllm', 'gemma'), evaluation('b2', 'openrouter', 'nemotron')],
    });
    expect(() => store.activate(capsule.id)).toThrow(/human approval/);
    expect(store.activate(capsule.id, true).status).toBe('active');
    expect(store.revoke(capsule.id).status).toBe('revoked');
    expect(() => store.activate(capsule.id, true)).toThrow(/revoked/);
  });

  it('stays draft with one runtime and rejects secrets or weak outcomes', () => {
    const store = harness();
    expect(store.create({ outcome: outcome(), constitution: constitution(), evaluations: [evaluation('b1', 'vllm', 'gemma')] }).status).toBe('draft');
    expect(() => store.create({ outcome: outcome(), constitution: constitution(), evaluations: [], description: 'api_key=sk-secretsecretsecret' })).toThrow(/secret/);
    expect(() => store.create({ outcome: { ...outcome(), trustScore: 0.5 }, constitution: constitution(), evaluations: [] })).toThrow(/trust score/);
  });
});
