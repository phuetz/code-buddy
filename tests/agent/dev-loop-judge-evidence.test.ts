import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { makeShellVerifier, runDevLoop } from '../../src/agent/dev-loop/dev-loop.js';
import type { DevLoopAgent } from '../../src/agent/dev-loop/dev-loop.js';
import type { CodeBuddyClient, CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { resetGoalManagers } from '../../src/goals/goal-manager.js';

afterEach(() => resetGoalManagers());

it.each([true, false])('uses the judge response contract with a real shell oracle (fixed=%s)', async (fixed) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-judge-proof-'));
  const target = path.join(dir, 'answer.json');
  fs.writeFileSync(target, '{"ok":false}');
  // A strict model returns the requested JSON fields. The old two-field
  // contract omitted evidence even when the independent oracle confirmed it.
  const chat = vi.fn(async (messages: CodeBuddyMessage[]) => ({
    choices: [{ message: {
      role: 'assistant',
      content: JSON.stringify({
        done: true,
        reason: 'the requested change is complete',
        ...(String(messages[0]?.content).includes('"evidence"')
          ? { evidence: 'Independent verifier: answer.json ok=true, exit 0' }
          : {}),
      }),
    } }],
  }));
  const client = { chat, getCurrentModel: () => 'local-judge' } as unknown as CodeBuddyClient;
  const agent: DevLoopAgent = {
    processUserMessage: async () => {
      if (fixed) fs.writeFileSync(target, '{"ok":true}');
      return [{ type: 'assistant', content: 'Changed answer.json.', timestamp: new Date() }];
    },
    getClient: () => client,
    executeToolByName: async () => ({ success: false }),
  };
  try {
    const result = await runDevLoop(agent, 'make answer.json ok=true', {
      maxTurns: 1, noPlan: true, currentCostUsd: () => 0,
      verify: makeShellVerifier('node -e "if (!require(\'./answer.json\').ok) process.exit(1)"', { cwd: dir }),
    });
    expect(result.status).toBe(fixed ? 'done' : 'paused');
    expect(result.lastVerifierVerdict).toBe(fixed ? 'CONFIRMED' : 'NEEDS REVIEW');
    expect(chat).toHaveBeenCalledTimes(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
