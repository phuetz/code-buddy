import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissionExchange } from '../../src/goals/mission-exchange.js';
import { MissionConstitutionStore } from '../../src/goals/mission-constitution.js';
import { ShadowTwinStore } from '../../src/goals/shadow-twin.js';
import type { IntentGraph } from '../../src/goals/intent-graph.js';

const dirs: string[] = [];

function graph(): IntentGraph {
  return {
    schemaVersion: 1,
    goalId: 'goal-exchange',
    contractRevision: 'contract-exchange',
    revision: 'runtime-exchange',
    rootNodeId: 'root',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    nodes: [
      { id: 'root', kind: 'objective', title: 'Choose safely', status: 'active' },
      { id: 'c1', kind: 'criterion', title: 'Quality', status: 'pending' },
      { id: 'c2', kind: 'criterion', title: 'Latency', status: 'pending' },
    ],
    edges: [
      { from: 'root', to: 'c1', kind: 'verified_by' },
      { from: 'root', to: 'c2', kind: 'verified_by' },
    ],
  };
}

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-exchange-'));
  dirs.push(root);
  const now = () => new Date('2026-07-10T10:00:00.000Z');
  let bidSequence = 0;
  return {
    exchange: new MissionExchange('goal-exchange', {
      storeDir: path.join(root, 'exchange'),
      now,
      idFactory: () => `bid-${++bidSequence}`,
    }),
    constitution: new MissionConstitutionStore('goal-exchange', { storeDir: path.join(root, 'constitutions'), now }),
    shadow: new ShadowTwinStore('goal-exchange', { storeDir: path.join(root, 'shadows'), now, idFactory: () => 'shadow-id' }),
  };
}

function bidInput(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Fleet hybride',
    provider: 'fleet',
    model: 'two-peers',
    strategy: 'Two peers with local synthesis',
    hypothesis: 'Two peers avoid a single point of failure',
    evidencePlan: 'Measure every criterion and attach benchmark output',
    prediction: { quality: 0.94, latencyMs: 520, costUsd: 0.04 },
    privacy: 'private' as const,
    reversible: true,
    risk: 'high' as const,
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('MissionExchange', () => {
  it('submits against the immutable contract and defaults to all criteria', () => {
    const { exchange } = harness();
    const bid = exchange.submit(graph(), bidInput());
    expect(bid.criterionIds).toEqual(['c1', 'c2']);
    expect(exchange.get(bid.id)).toEqual(bid);
  });

  it('computes the Pareto frontier and blocks bids outside the constitution', () => {
    const { exchange, constitution } = harness();
    exchange.submit(graph(), bidInput());
    const cloud = exchange.submit(graph(), bidInput({
      label: 'Cloud',
      provider: 'openrouter',
      model: 'nemotron',
      prediction: { quality: 0.96, latencyMs: 680, costUsd: 0 },
      privacy: 'cloud',
    }));
    const policy = constitution.set(graph(), { privacy: 'private-peers', maxRisk: 'high' });
    const ranking = exchange.rank(graph(), policy, []);
    expect(ranking.find((entry) => entry.bid.id === cloud.id)?.policy.allowed).toBe(false);
    expect(ranking.find((entry) => entry.bid.label === 'Fleet hybride')?.pareto).toBe(true);
  });

  it('requires shadow, full proof plan, reversibility and explicit high-risk approval before award', () => {
    const { exchange, constitution, shadow } = harness();
    const bid = exchange.submit(graph(), bidInput());
    const policy = constitution.set(graph(), { privacy: 'private-peers', maxRisk: 'high', approval: 'on-risk' });
    const rehearsal = shadow.record(graph(), {
      bidId: bid.id,
      prediction: bid.prediction,
      observation: { quality: 0.9, latencyMs: 542, costUsd: 0.04 },
      reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
    });
    exchange.linkRehearsal(bid.id, rehearsal);
    const ranking = exchange.rank(graph(), policy, [rehearsal]);
    expect(ranking[0]?.settlement.readyToAward).toBe(true);
    expect(() => exchange.award(graph(), policy, [rehearsal], bid.id)).toThrow(/human approval/);

    const createForgeBranch = vi.fn(() => 'forge-branch-1');
    const awarded = exchange.award(graph(), policy, [rehearsal], bid.id, {
      humanApproved: true,
      createForgeBranch,
    });
    expect(awarded).toMatchObject({ status: 'awarded', forgeBranchId: 'forge-branch-1' });
    expect(createForgeBranch).toHaveBeenCalledWith(expect.objectContaining({ id: bid.id }));
  });

  it('fails closed when the proof plan omits a criterion or the contract changes', () => {
    const { exchange, constitution, shadow } = harness();
    const bid = exchange.submit(graph(), bidInput({ criterionIds: ['c1'] }));
    const policy = constitution.set(graph(), { privacy: 'private-peers', maxRisk: 'high' });
    const rehearsal = shadow.record(graph(), {
      bidId: bid.id,
      prediction: bid.prediction,
      observation: bid.prediction,
      reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
    });
    expect(exchange.rank(graph(), policy, [rehearsal])[0]?.settlement.proofPlan).toBe(false);
    expect(() => exchange.award(graph(), policy, [rehearsal], bid.id, { humanApproved: true })).toThrow(/not ready/);

    expect(() => exchange.rank({ ...graph(), contractRevision: 'changed' }, policy, [rehearsal])).not.toThrow();
    expect(exchange.rank({ ...graph(), contractRevision: 'changed' }, policy, [rehearsal])).toEqual([]);
  });

  it('persists rejection as the latest bid snapshot', () => {
    const { exchange } = harness();
    const bid = exchange.submit(graph(), bidInput());
    expect(exchange.reject(bid.id).status).toBe('rejected');
    expect(exchange.get(bid.id)?.status).toBe('rejected');
  });

  it('keeps settlement single-winner and immutable after award', () => {
    const { exchange, constitution, shadow } = harness();
    const winner = exchange.submit(graph(), bidInput({ label: 'Winner' }));
    const runnerUp = exchange.submit(graph(), bidInput({ label: 'Runner-up' }));
    const policy = constitution.set(graph(), { privacy: 'private-peers', maxRisk: 'high', approval: 'always' });
    const rehearse = (bid: ReturnType<typeof exchange.submit>) => {
      const rehearsal = shadow.record(graph(), {
        bidId: bid.id,
        prediction: bid.prediction,
        observation: bid.prediction,
        reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
      });
      exchange.linkRehearsal(bid.id, rehearsal);
      return rehearsal;
    };
    const rehearsals = [rehearse(winner), rehearse(runnerUp)];

    exchange.award(graph(), policy, rehearsals, winner.id, { humanApproved: true });
    expect(() => exchange.award(graph(), policy, rehearsals, runnerUp.id, { humanApproved: true }))
      .toThrow(/already awarded/);
    expect(() => exchange.reject(winner.id)).toThrow(/cannot be rejected/);
    expect(exchange.get(winner.id)?.status).toBe('awarded');
  });
});
