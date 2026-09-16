import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { createCapsuleCommand } from '../../src/commands/capsule.js';

function withExitOverride(cmd: Command): Command {
  cmd.exitOverride();
  for (const sub of cmd.commands) withExitOverride(sub);
  return cmd;
}
import { resetGoalManagers } from '../../src/goals/goal-manager.js';
import { GoalStore } from '../../src/goals/goal-store.js';

describe('buddy capsule', () => {
  let dir: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-command-'));
    previousHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = dir;
    resetGoalManagers(new GoalStore({ storeDir: path.join(dir, 'goals') }));
  });

  afterEach(() => {
    resetGoalManagers();
    if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = previousHome;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('list without a durable intent is a CLI error (exit 1), not an unhandled rejection', async () => {
    await expect(
      withExitOverride(createCapsuleCommand()).parseAsync(['node', 'capsule', 'list']),
    ).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('No durable intent'),
    });
  });
});
