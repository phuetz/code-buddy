import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntentCommand } from '../../src/commands/intent.js';
import { getGoalManager, resetGoalManagers } from '../../src/goals/goal-manager.js';
import { buildIntentGraph } from '../../src/goals/intent-graph.js';
import { ProofLedger } from '../../src/goals/proof-ledger.js';
import { GoalStore } from '../../src/goals/goal-store.js';
import { MissionConstitutionStore } from '../../src/goals/mission-constitution.js';
import { MissionExchange } from '../../src/goals/mission-exchange.js';
import { ShadowTwinStore } from '../../src/goals/shadow-twin.js';

describe('buddy intent', () => {
  let dir: string;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-command-'));
    resetGoalManagers(new GoalStore({ storeDir: dir }));
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
    resetGoalManagers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('renders the current intent as structured JSON', async () => {
    const manager = getGoalManager();
    const state = manager.set('Build the proof-carrying slice');
    manager.addSubgoal('Focused tests pass');

    await createIntentCommand().exitOverride().parseAsync(
      ['node', 'intent', 'graph', '--json'],
    );

    const rendered = JSON.parse(String(log.mock.calls.at(-1)?.[0] ?? '{}')) as {
      goalId?: string;
      nodes?: unknown[];
    };
    expect(rendered.goalId).toBe(state.goalId);
    expect(rendered.nodes).toHaveLength(2);
  });

  it('is read-only and explains how to create an intent when none exists', async () => {
    await createIntentCommand().exitOverride().parseAsync(['node', 'intent']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Start one with buddy loop'));
  });

  it('renders criterion progress and proof-chain integrity', async () => {
    const manager = getGoalManager();
    const state = manager.set('Prove criterion progress');
    manager.addSubgoal('focused test exits 0');
    const graph = buildIntentGraph(manager.state!);
    const criterionId = graph.nodes.find((node) => node.kind === 'criterion')!.id;
    const proofDir = path.join(dir, 'proofs');
    const ledger = new ProofLedger(state.goalId, { storeDir: proofDir, idFactory: () => 'cli' });
    ledger.append({
      turn: 1,
      kind: 'verification',
      status: 'pass',
      assurance: 'deterministic',
      summary: 'focused test passed',
      criterionIds: [criterionId],
    });

    // The command uses the default CODEBUDDY_HOME path, so isolate it for this assertion.
    const previousHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = dir;
    try {
      await createIntentCommand().exitOverride().parseAsync(['node', 'intent', 'progress', '--json']);
      const progress = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { coverage: number };
      expect(progress.coverage).toBe(1);

      await createIntentCommand().exitOverride().parseAsync(['node', 'intent', 'integrity', '--json']);
      const integrity = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { status: string };
      expect(integrity.status).toBe('valid');
    } finally {
      if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
      else process.env.CODEBUDDY_HOME = previousHome;
    }
  });

  it('projects the constitution, Exchange ranking and Shadow Twin read-only views', async () => {
    const previousHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = dir;
    try {
      const manager = getGoalManager();
      const state = manager.set('Select a sovereign execution path');
      manager.addSubgoal('quality is measured');
      const graph = buildIntentGraph(manager.state!);
      const constitutionStore = new MissionConstitutionStore(state.goalId);
      constitutionStore.set(graph, { privacy: 'private-peers', maxRisk: 'high' });
      const exchange = new MissionExchange(state.goalId, { idFactory: () => 'intent-view' });
      const bid = exchange.submit(graph, {
        label: 'Local fleet',
        provider: 'fleet',
        model: 'local-peer',
        strategy: 'Run on a private peer',
        hypothesis: 'Private execution reduces exposure',
        evidencePlan: 'Measure the criterion',
        prediction: { quality: 0.9, latencyMs: 300, costUsd: 0 },
        privacy: 'private',
        reversible: true,
        risk: 'low',
      });
      new ShadowTwinStore(state.goalId, { idFactory: () => 'intent-view' }).record(graph, {
        bidId: bid.id,
        prediction: bid.prediction,
        observation: bid.prediction,
        reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
      });

      await createIntentCommand().exitOverride().parseAsync(['node', 'intent', 'constitution', '--json']);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ privacy: 'private-peers' });
      await createIntentCommand().exitOverride().parseAsync(['node', 'intent', 'exchange', '--json']);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toHaveLength(1);
      await createIntentCommand().exitOverride().parseAsync(['node', 'intent', 'shadows', '--json']);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))[0]).toMatchObject({ status: 'pass' });
    } finally {
      if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
      else process.env.CODEBUDDY_HOME = previousHome;
    }
  });
});
