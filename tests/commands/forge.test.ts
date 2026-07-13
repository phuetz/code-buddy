import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createForgeCommand } from '../../src/commands/forge.js';
import { CounterfactualForge } from '../../src/goals/counterfactual-forge.js';
import { getGoalManager, resetGoalManagers } from '../../src/goals/goal-manager.js';
import { buildIntentGraph } from '../../src/goals/intent-graph.js';
import { ProofLedger } from '../../src/goals/proof-ledger.js';
import { GoalStore } from '../../src/goals/goal-store.js';

describe('buddy forge', () => {
  let dir: string;
  let previousHome: string | undefined;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-command-'));
    previousHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = dir;
    resetGoalManagers(new GoalStore({ storeDir: path.join(dir, 'goals') }));
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
    resetGoalManagers();
    if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = previousHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates, evaluates, compares and selects a proof-backed branch', async () => {
    const manager = getGoalManager();
    const state = manager.set('Optimize the real-time voice path');
    manager.addSubgoal('p95 stays below 500 ms');
    const graph = buildIntentGraph(manager.state!);
    const criterionId = graph.nodes.find((node) => node.kind === 'criterion')!.id;
    new ProofLedger(state.goalId).append({
      turn: 1,
      kind: 'verification',
      status: 'pass',
      assurance: 'deterministic',
      summary: 'benchmark passed',
      criterionResults: [{ criterionId, status: 'passed', evidence: 'p95=468ms' }],
    });

    await createForgeCommand().exitOverride().parseAsync([
      'node', 'forge', 'create', 'Pocket local',
      '--hypothesis', 'Local streaming reduces latency',
      '--strategy', 'Pocket TTS with sentence chunking',
    ]);
    const forge = new CounterfactualForge(state.goalId);
    const branchId = forge.list()[0]!.id;

    await createForgeCommand().exitOverride().parseAsync([
      'node', 'forge', 'evaluate', branchId,
      '--quality', '0.94', '--latency-ms', '468', '--cost-usd', '0',
    ]);
    await createForgeCommand().exitOverride().parseAsync(['node', 'forge', 'select']);
    await createForgeCommand().exitOverride().parseAsync(['node', 'forge', 'compare', '--json']);

    const rendered = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Array<{ status: string }>;
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.status).toBe('selected');
  });
});
