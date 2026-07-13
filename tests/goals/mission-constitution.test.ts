import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MissionConstitutionStore } from '../../src/goals/mission-constitution.js';
import type { IntentGraph } from '../../src/goals/intent-graph.js';

const dirs: string[] = [];

function graph(): IntentGraph {
  return {
    schemaVersion: 1,
    goalId: 'goal-sovereign',
    contractRevision: 'contract-1',
    revision: 'runtime-1',
    rootNodeId: 'root',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    nodes: [{ id: 'root', kind: 'objective', title: 'Ship safely', status: 'active' }],
    edges: [],
  };
}

function store() {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-constitution-'));
  dirs.push(storeDir);
  return new MissionConstitutionStore('goal-sovereign', {
    storeDir,
    now: () => new Date('2026-07-10T10:00:00.000Z'),
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('MissionConstitutionStore', () => {
  it('provides a restrictive-by-default reversible policy without persisting it', () => {
    const subject = store();
    const constitution = subject.get(graph());
    expect(constitution).toMatchObject({
      privacy: 'cloud-allowed',
      maxCostUsd: 10,
      maxLatencyMs: 5000,
      requireReversible: true,
      approval: 'on-risk',
      maxRisk: 'medium',
    });
    expect(fs.existsSync(subject.getFilePath())).toBe(false);
  });

  it('persists revisions and evaluates every sovereignty constraint', () => {
    const subject = store();
    const constitution = subject.set(graph(), {
      privacy: 'local-only',
      maxCostUsd: 2,
      maxLatencyMs: 800,
      requireReversible: true,
      approval: 'on-risk',
      maxRisk: 'high',
    });
    const blocked = subject.evaluate(constitution, {
      privacy: 'cloud',
      costUsd: 3,
      latencyMs: 900,
      reversible: false,
      risk: 'high',
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiresApproval).toBe(true);
    expect(blocked.violations).toHaveLength(4);
    expect(subject.get(graph())).toEqual(constitution);
  });

  it('fails closed on invalid identifiers and numeric constraints', () => {
    expect(() => new MissionConstitutionStore('../escape')).toThrow(/invalid goal id/);
    expect(() => store().set(graph(), { maxCostUsd: -1 })).toThrow(/non-negative/);
  });
});
