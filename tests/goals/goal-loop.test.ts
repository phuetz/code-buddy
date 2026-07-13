import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { maybeContinueGoalAfterTurn } from '../../src/goals/goal-loop.js';
import { getGoalManager, resetGoalManagers } from '../../src/goals/goal-manager.js';
import { GoalStore } from '../../src/goals/goal-store.js';

function judgeClient(...replies: string[]) {
  const queue = [...replies];
  return {
    chat: vi.fn(async () => ({
      choices: [
        {
          message: {
            role: 'assistant',
            content: queue.shift() ?? replies[replies.length - 1] ?? '{"done": false, "reason": "not done"}',
          },
          finish_reason: 'stop',
        },
      ],
    })),
    getCurrentModel: vi.fn(() => 'gpt-5.5'),
  };
}

describe('maybeContinueGoalAfterTurn', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-loop-test-'));
    resetGoalManagers(new GoalStore({ storeDir: tmpDir }));
  });

  afterEach(() => {
    resetGoalManagers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('continues a realistic fix-and-test goal and strips the usage footer before judging', async () => {
    const manager = getGoalManager();
    manager.set('Fix the checkout date parsing regression and prove it with a focused test', {
      maxTurns: 4,
    });
    const client = judgeClient('{"done": false, "reason": "test proof is still missing"}');

    const outcome = await maybeContinueGoalAfterTurn({
      client: client as never,
      lastResponse:
        'I updated src/checkout/date-parser.ts and found the failing edge case, but I still need to run the focused regression test.\n' +
        '[tokens: 936 input, 214 output | cost: $0.0042]',
      interrupted: false,
    });

    expect(outcome?.message).toBe('↻ Continuing toward goal (1/4): test proof is still missing');
    expect(outcome?.continuationPrompt).toContain(
      'Goal: Fix the checkout date parsing regression and prove it with a focused test'
    );
    expect(manager.state).toMatchObject({
      status: 'active',
      turnsUsed: 1,
      lastVerdict: 'continue',
      lastReason: 'test proof is still missing',
    });

    const judgePrompt = client.chat.mock.calls[0]![0][1].content as string;
    expect(judgePrompt).toContain('I updated src/checkout/date-parser.ts');
    expect(judgePrompt).not.toContain('[tokens:');
    expect(client.chat.mock.calls[0]![2]).toMatchObject({ maxTokens: 4096, temperature: 0 });
  });

  it('marks the goal done when the last response contains the completed deliverable', async () => {
    const manager = getGoalManager();
    manager.set('Patch the flaky export test and report the verification command');
    const client = judgeClient('{"done": true, "reason": "patch applied and verification command passed"}');

    const outcome = await maybeContinueGoalAfterTurn({
      client: client as never,
      lastResponse:
        'Done. I updated tests/export/pdf-export.test.ts and ran `npm test -- tests/export/pdf-export.test.ts`; all 8 tests passed.',
      interrupted: false,
    });

    // Outcome carries the human message AND the structured snapshot used by host
    // UIs (Cowork goal banner). toMatchObject tolerates the added snapshot fields.
    expect(outcome).toMatchObject({
      message: '✓ Goal achieved: patch applied and verification command passed',
      status: 'done',
      turnsUsed: 1,
      lastVerdict: 'done',
      goalText: 'Patch the flaky export test and report the verification command',
    });
    expect(manager.state).toMatchObject({
      status: 'done',
      turnsUsed: 1,
      lastVerdict: 'done',
    });
  });

  it('auto-pauses on user interruption without calling the judge', async () => {
    const manager = getGoalManager();
    manager.set('Refactor the CLI auth flow without losing existing sessions');
    const client = judgeClient('{"done": false, "reason": "would have continued"}');

    const outcome = await maybeContinueGoalAfterTurn({
      client: client as never,
      lastResponse: 'Partial refactor in progress...',
      interrupted: true,
    });

    expect(outcome?.message).toBe(
      '⏸ Goal paused — turn was interrupted. Use /goal resume to continue, or /goal clear to stop.'
    );
    expect(outcome?.continuationPrompt).toBeUndefined();
    expect(client.chat).not.toHaveBeenCalled();
    expect(manager.state).toMatchObject({
      status: 'paused',
      turnsUsed: 0,
      pausedReason: 'user-interrupted (Esc)',
    });
  });

  it('skips judging empty or footer-only responses without burning the turn budget', async () => {
    const manager = getGoalManager();
    manager.set('Diagnose the failing GUI smoke test');
    const client = judgeClient('{"done": false, "reason": "not enough output"}');

    const outcome = await maybeContinueGoalAfterTurn({
      client: client as never,
      lastResponse: '\n[tokens: 120 input, 0 output | cost: $0.0001]',
      interrupted: false,
    });

    expect(outcome).toBeNull();
    expect(client.chat).not.toHaveBeenCalled();
    expect(manager.state?.turnsUsed).toBe(0);
    expect(manager.state?.lastVerdict).toBeUndefined();
  });

  it('passes user-added subgoals into the judge prompt and the continuation prompt', async () => {
    const manager = getGoalManager();
    manager.set('Ship the fleet peer-session goal loop', { maxTurns: 5 });
    manager.addSubgoal('include a regression test for continuation prompts');
    manager.addSubgoal('mention the exact test command that was run');
    const client = judgeClient('{"done": false, "reason": "verification command is not reported"}');

    const outcome = await maybeContinueGoalAfterTurn({
      client: client as never,
      lastResponse: 'Implemented the peer-session loop and added a test, but verification is still pending.',
      interrupted: false,
    });

    expect(outcome?.continuationPrompt).toContain(
      'Additional criteria the user added mid-loop:'
    );
    expect(outcome?.continuationPrompt).toContain(
      '- 1. include a regression test for continuation prompts'
    );
    expect(outcome?.continuationPrompt).toContain(
      '- 2. mention the exact test command that was run'
    );

    const judgePrompt = client.chat.mock.calls[0]![0][1].content as string;
    expect(judgePrompt).toContain('Additional criteria the user added mid-loop');
    expect(judgePrompt).toContain('- 1. include a regression test for continuation prompts');
    expect(judgePrompt).toContain('- 2. mention the exact test command that was run');
  });

  it('auto-attaches a decomposition plan before judging complex goals', async () => {
    const manager = getGoalManager();
    manager.set('Implement the parser fix then verify it with a focused regression test', {
      maxTurns: 5,
    });
    const client = judgeClient(
      JSON.stringify({
        summary: 'Fix then verify',
        tasks: [
          { id: 'T1', title: 'Fix parser', acceptanceCriteria: ['parser diff exists'] },
          {
            id: 'T2',
            title: 'Verify parser',
            dependsOn: ['T1'],
            acceptanceCriteria: ['focused regression test passes'],
            subtasks: [
              {
                id: 'T2.1',
                title: 'Run test',
                acceptanceCriteria: ['command output is included'],
              },
            ],
          },
        ],
      }),
      '{"done": false, "reason": "test output missing"}'
    );

    const outcome = await maybeContinueGoalAfterTurn({
      client: client as never,
      lastResponse: 'I patched the parser but have not run the test yet.',
      interrupted: false,
    });

    expect(outcome?.continuationPrompt).toContain('Decomposition plan:');
    expect(outcome?.continuationPrompt).toContain('T2.1');
    expect(manager.state?.goalPlan?.tasks).toHaveLength(2);
    expect(client.chat).toHaveBeenCalledTimes(2);
    const judgePrompt = client.chat.mock.calls[1]![0][1].content as string;
    expect(judgePrompt).toContain('T1 Fix parser: parser diff exists');
    expect(judgePrompt).toContain('T2 Verify parser after T1: focused regression test passes');
    expect(judgePrompt).toContain('T2.1 Verify parser / Run test: command output is included');
  });

  describe('dev-loop Verifier gate (/loop)', () => {
    it('downgrades a judge "done" to "continue" when the Verifier is not CONFIRMED', async () => {
      const manager = getGoalManager();
      manager.set('Ship the fix and prove it', { maxTurns: 4, verifyGated: true });
      const client = judgeClient('{"done": true, "reason": "looks done to me"}');
      const verify = vi.fn(async () => ({ verdict: 'NEEDS REVIEW' as const }));

      const outcome = await maybeContinueGoalAfterTurn({
        client: client as never,
        lastResponse: 'I believe I fixed it.',
        interrupted: false,
        verify,
      });

      expect(verify).toHaveBeenCalledOnce();
      expect(manager.state).toMatchObject({ status: 'active', lastVerdict: 'continue' });
      expect(manager.state?.lastReason).toContain('verification not CONFIRMED');
      expect(outcome?.continuationPrompt).toBeTruthy();
    });

    it('accepts a judge "done" once the Verifier CONFIRMS', async () => {
      const manager = getGoalManager();
      manager.set('Ship the fix and prove it', { maxTurns: 4, verifyGated: true });
      const client = judgeClient('{"done": true, "reason": "patch + passing test shown"}');
      const verify = vi.fn(async () => ({ verdict: 'CONFIRMED' as const }));

      const outcome = await maybeContinueGoalAfterTurn({
        client: client as never,
        lastResponse: 'Applied the patch; the focused test passes (output shown).',
        interrupted: false,
        verify,
      });

      expect(verify).toHaveBeenCalledOnce();
      expect(manager.state).toMatchObject({ status: 'done', lastVerdict: 'done' });
      expect(outcome?.continuationPrompt).toBeUndefined();
    });

    it('records interactive verifier and decision evidence through an injected ledger', async () => {
      const manager = getGoalManager();
      manager.set('Ship the fix and prove it', { maxTurns: 4, verifyGated: true });
      const client = judgeClient('{"done": true, "reason": "proof accepted"}');
      const append = vi.fn(() => null);

      await maybeContinueGoalAfterTurn({
        client: client as never,
        lastResponse: 'Focused test passed.',
        interrupted: false,
        verify: async () => ({ verdict: 'CONFIRMED', evidence: '1 test passed' }),
        proofRecorder: { append },
      });

      expect(append).toHaveBeenCalledTimes(2);
      expect(append).toHaveBeenNthCalledWith(1, expect.objectContaining({
        kind: 'verification',
        source: 'interactive-loop',
      }));
      expect(append).toHaveBeenNthCalledWith(2, expect.objectContaining({
        kind: 'decision',
        status: 'pass',
      }));
    });

    it('never runs the Verifier for a classic /goal (not verifyGated)', async () => {
      const manager = getGoalManager();
      manager.set('Ship the fix and prove it', { maxTurns: 4 }); // no verifyGated
      const client = judgeClient('{"done": true, "reason": "done"}');
      const verify = vi.fn(async () => ({ verdict: 'NEEDS REVIEW' as const }));

      await maybeContinueGoalAfterTurn({
        client: client as never,
        lastResponse: 'Done.',
        interrupted: false,
        verify,
      });

      // /goal is judge-only: the gate must not fire even though a verify bridge
      // is present, so a plain judge "done" completes as before.
      expect(verify).not.toHaveBeenCalled();
      expect(manager.state).toMatchObject({ status: 'done', lastVerdict: 'done' });
    });
  });
});
