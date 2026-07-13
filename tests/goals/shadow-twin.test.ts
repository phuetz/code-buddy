import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ShadowTwinStore } from '../../src/goals/shadow-twin.js';
import type { IntentGraph } from '../../src/goals/intent-graph.js';

const dirs: string[] = [];

function graph(): IntentGraph {
  return {
    schemaVersion: 1,
    goalId: 'goal-shadow',
    contractRevision: 'contract-shadow',
    revision: 'runtime-shadow',
    rootNodeId: 'root',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    nodes: [{ id: 'root', kind: 'objective', title: 'Rehearse', status: 'active' }],
    edges: [],
  };
}

function store() {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-twin-'));
  dirs.push(storeDir);
  return new ShadowTwinStore('goal-shadow', {
    storeDir,
    now: () => new Date('2026-07-10T10:00:00.000Z'),
    idFactory: () => 'shadow-id',
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('ShadowTwinStore', () => {
  it('records measured drift and passes a reversible rehearsal', () => {
    const subject = store();
    const rehearsal = subject.record(graph(), {
      bidId: 'bid-1',
      prediction: { quality: 0.94, latencyMs: 520, costUsd: 0.04 },
      observation: { quality: 0.9, latencyMs: 542, costUsd: 0.04 },
      reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
    });
    expect(rehearsal.status).toBe('pass');
    expect(rehearsal.drift.score).toBeLessThan(0.1);
    expect(subject.latestForBid('bid-1')?.id).toBe('shadow-shadow-id');
  });

  it('fails when rollback is incomplete or observations drift too far', () => {
    const subject = store();
    const rehearsal = subject.record(graph(), {
      bidId: 'bid-2',
      prediction: { quality: 0.9, latencyMs: 100, costUsd: 0 },
      observation: { quality: 0.5, latencyMs: 500, costUsd: 1 },
      reversibility: { checkpointTaken: true, rollbackValidated: false, noPersistentSideEffects: true },
    });
    expect(rehearsal.status).toBe('fail');
    expect(rehearsal.drift.cost).toBe(1);
  });

  it('rejects invented or invalid metric ranges', () => {
    expect(() => store().record(graph(), {
      bidId: 'bid-invalid',
      prediction: { quality: 2, latencyMs: 0, costUsd: 0 },
      observation: { quality: 1, latencyMs: 0, costUsd: 0 },
      reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
    })).toThrow(/valid range/);
  });
});
