/**
 * dev-loop — the unified development loop. Real GoalManager + real judge
 * (injected fake) + injected fake Verifier and cost reader: proves the
 * load-bearing behaviour without any network.
 *
 * Core guarantee: the independent Verifier GATES "done" — a judge verdict of
 * "done" is overridden to "continue" until the Verifier CONFIRMS. A cost
 * budget stops the loop. --no-verify falls back to judge-only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDevLoop, type DevLoopAgent, type DevLoopVerifier } from '../../src/agent/dev-loop/dev-loop.js';
import { resetGoalManagers } from '../../src/goals/goal-manager.js';
import type { ChatEntry } from '../../src/agent/codebuddy-agent.js';

// A fake judge is injected via the goal-judge module; but runDevLoop builds its
// own gatedJudge around judgeGoal(judgeClient, …). To keep the test network-free
// we stub judgeGoal to return a scripted verdict sequence.
vi.mock('../../src/goals/goal-judge.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/goals/goal-judge.js')>(
    '../../src/goals/goal-judge.js',
  );
  return {
    ...actual,
    judgeGoal: vi.fn(),
  };
});
// Decomposition off in tests (goals are short → shouldAutoDecomposeGoal false anyway).

import { judgeGoal } from '../../src/goals/goal-judge.js';
const judgeMock = judgeGoal as unknown as ReturnType<typeof vi.fn>;

function fakeAgent(replies: string[]): DevLoopAgent {
  let i = 0;
  return {
    processUserMessage: async (): Promise<ChatEntry[]> => {
      const content = replies[Math.min(i, replies.length - 1)] ?? 'ok';
      i += 1;
      return [{ type: 'assistant', content } as ChatEntry];
    },
    getClient: () => ({}) as never,
    executeToolByName: async () => ({ success: true, output: '' }),
  };
}

const zeroCost = () => 0;

beforeEach(() => {
  resetGoalManagers();
  judgeMock.mockReset();
});

afterEach(() => {
  resetGoalManagers();
});

describe('runDevLoop — Verifier gate', () => {
  it('blocks "done" while the Verifier says NEEDS REVIEW, accepts once CONFIRMED', async () => {
    // Judge always says done; Verifier says NEEDS REVIEW then CONFIRMED.
    judgeMock.mockResolvedValue({ verdict: 'done', reason: 'looks done', parseFailed: false });
    const verdicts = ['NEEDS REVIEW', 'CONFIRMED'];
    let vi_ = 0;
    const verify: DevLoopVerifier = async () => ({
      verdict: verdicts[Math.min(vi_++, verdicts.length - 1)] as 'CONFIRMED' | 'NEEDS REVIEW',
      evidence: 'e',
    });
    const result = await runDevLoop(fakeAgent(['work', 'work']), 'court objectif', {
      maxTurns: 5,
      verify,
      currentCostUsd: zeroCost,
      noPlan: true,
    });
    // Turn 1: judge=done but verifier=NEEDS REVIEW → continue. Turn 2: verifier=CONFIRMED → done.
    expect(result.status).toBe('done');
    expect(result.turnsUsed).toBe(2);
    expect(result.lastVerifierVerdict).toBe('CONFIRMED');
  });

  it('never accepts "done" if the Verifier never CONFIRMS (pauses on turn budget)', async () => {
    judgeMock.mockResolvedValue({ verdict: 'done', reason: 'claims done', parseFailed: false });
    const verify: DevLoopVerifier = async () => ({ verdict: 'NEEDS REVIEW', evidence: 'no proof' });
    const result = await runDevLoop(fakeAgent(['work']), 'court objectif', {
      maxTurns: 3,
      verify,
      currentCostUsd: zeroCost,
      noPlan: true,
    });
    expect(result.status).not.toBe('done');
    expect(result.lastVerifierVerdict).toBe('NEEDS REVIEW');
  });

  it('--no-verify falls back to judge-only (done accepted on turn 1)', async () => {
    judgeMock.mockResolvedValue({ verdict: 'done', reason: 'done', parseFailed: false });
    const verify = vi.fn();
    const result = await runDevLoop(fakeAgent(['work']), 'court objectif', {
      maxTurns: 3,
      noVerify: true,
      verify: verify as unknown as DevLoopVerifier,
      currentCostUsd: zeroCost,
      noPlan: true,
    });
    expect(result.status).toBe('done');
    expect(result.turnsUsed).toBe(1);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('runDevLoop — cost budget', () => {
  it('pauses when the session cost reaches the budget', async () => {
    judgeMock.mockResolvedValue({ verdict: 'continue', reason: 'keep going', parseFailed: false });
    const result = await runDevLoop(fakeAgent(['work', 'work', 'work']), 'court objectif', {
      maxTurns: 10,
      budgetUsd: 1,
      currentCostUsd: () => 1.5, // already over budget
      verify: async () => ({ verdict: 'CONFIRMED', evidence: 'e' }),
      noPlan: true,
    });
    // maxTurns=10 but the budget check stops it after the first turn.
    expect(result.status).toBe('paused');
    expect(result.turnsUsed).toBe(1);
  });
});
