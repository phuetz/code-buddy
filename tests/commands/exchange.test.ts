import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExchangeCommand } from '../../src/commands/exchange.js';
import { getGoalManager, resetGoalManagers } from '../../src/goals/goal-manager.js';
import { MissionExchange } from '../../src/goals/mission-exchange.js';
import { GoalStore } from '../../src/goals/goal-store.js';

describe('buddy exchange', () => {
  let dir: string;
  let previousHome: string | undefined;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exchange-command-'));
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

  it('runs constitution → bid → rehearsal → award and creates a Forge branch', async () => {
    const manager = getGoalManager();
    const state = manager.set('Choose the safest voice execution path');
    manager.addSubgoal('p95 latency stays below 800 ms');

    await createExchangeCommand().exitOverride().parseAsync([
      'node', 'exchange', 'constitution', '--privacy', 'private-peers', '--budget-usd', '2',
      '--latency-ms', '800', '--require-reversible', '--max-risk', 'high', '--approval', 'on-risk',
    ]);
    await createExchangeCommand().exitOverride().parseAsync([
      'node', 'exchange', 'bid', 'Fleet hybride', '--provider', 'fleet', '--model', 'two-peers',
      '--strategy', 'Two peers with local synthesis', '--hypothesis', 'Two peers avoid one failure point',
      '--evidence-plan', 'Measure every criterion', '--quality', '0.94', '--latency-ms', '520',
      '--cost-usd', '0.04', '--privacy', 'private', '--risk', 'high',
    ]);
    const exchange = new MissionExchange(state.goalId);
    const bid = exchange.list()[0]!;
    await createExchangeCommand().exitOverride().parseAsync([
      'node', 'exchange', 'rehearse', bid.id, '--quality', '0.90', '--latency-ms', '542',
      '--cost-usd', '0.04', '--checkpoint', '--rollback', '--no-persistent-side-effects',
    ]);
    await createExchangeCommand().exitOverride().parseAsync([
      'node', 'exchange', 'award', bid.id, '--approve',
    ]);
    await createExchangeCommand().exitOverride().parseAsync(['node', 'exchange', 'rank', '--json']);

    const ranking = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Array<{ bid: { status: string; forgeBranchId?: string } }>;
    expect(ranking[0]?.bid.status).toBe('awarded');
    expect(ranking[0]?.bid.forgeBranchId).toMatch(/^forge-/);
  });
});
