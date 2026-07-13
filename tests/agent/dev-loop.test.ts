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

import {
  runDevLoop,
  makeShellVerifier,
  parseVerifierCriterionResults,
  type DevLoopAgent,
  type DevLoopVerifier,
} from '../../src/agent/dev-loop/dev-loop.js';
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
  it('records verification and final decision as proof-carrying loop events', async () => {
    judgeMock.mockResolvedValue({ verdict: 'done', reason: 'verified', parseFailed: false });
    const append = vi.fn(() => null);

    const result = await runDevLoop(fakeAgent(['work']), 'court objectif', {
      maxTurns: 2,
      verify: async () => ({ verdict: 'CONFIRMED', evidence: 'focused test: 1 passed' }),
      proofRecorder: { append },
      currentCostUsd: zeroCost,
      noPlan: true,
    });

    expect(result.status).toBe('done');
    expect(append).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: 'verification',
      status: 'pass',
      assurance: 'independent',
    }));
    expect(append).toHaveBeenNthCalledWith(2, expect.objectContaining({
      kind: 'decision',
      status: 'pass',
      assurance: 'independent',
    }));
  });

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

describe('makeShellVerifier — deterministic shell gate', () => {
  it('maps exit 0 to CONFIRMED and a non-zero exit to NEEDS REVIEW', async () => {
    const ok = await makeShellVerifier('true')({ agent: fakeAgent(['x']), goal: 'g', evidence: 'e' });
    const bad = await makeShellVerifier('exit 3')({ agent: fakeAgent(['x']), goal: 'g', evidence: 'e' });
    expect(ok.verdict).toBe('CONFIRMED');
    expect(bad.verdict).toBe('NEEDS REVIEW');
    expect(bad.evidence).toContain('exit 3');
  });

  it('gates a judge "done" behind the shell command inside runDevLoop', async () => {
    // Judge always says done; the shell gate fails → the loop never accepts done.
    judgeMock.mockResolvedValue({ verdict: 'done', reason: 'claims done', parseFailed: false });
    const result = await runDevLoop(fakeAgent(['work']), 'court objectif', {
      maxTurns: 2,
      verify: makeShellVerifier('exit 1'),
      currentCostUsd: zeroCost,
      noPlan: true,
    });
    expect(result.status).not.toBe('done');
    expect(result.lastVerifierVerdict).toBe('NEEDS REVIEW');
  });
});

describe('parseVerifierCriterionResults', () => {
  it('accepts only known criterion ids from the machine-readable final line', () => {
    const result = parseVerifierCriterionResults(
      'oracle output\nCRITERIA_JSON: [{"criterionId":"c1","status":"passed","evidence":"exit 0"},{"criterionId":"invented","status":"passed"}]',
      [{ id: 'c1', title: 'focused test exits 0' }],
    );
    expect(result).toEqual([{ criterionId: 'c1', status: 'passed', evidence: 'exit 0' }]);
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

describe('runDevLoop — structural gate (zero-LLM layer)', () => {
  it('overrides the LLM verifier when the turn leaves a structural defect, then reinjects the issues', async () => {
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const { execFileSync } = await import('child_process');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devloop-sg-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });

    judgeMock.mockResolvedValue({ verdict: 'done', reason: 'claims done', parseFailed: false });
    const llmVerify = vi.fn(async () => ({ verdict: 'CONFIRMED' as const, evidence: 'proof' }));

    const prompts: string[] = [];
    let turn = 0;
    const agent: DevLoopAgent = {
      processUserMessage: async (input: string): Promise<ChatEntry[]> => {
        prompts.push(input);
        turn += 1;
        if (turn === 1) {
          // Turn 1 leaves an unparsable JSON in the owned working tree.
          await fs.writeFile(path.join(dir, 'out.json'), '{"broken": ');
        } else {
          // Turn 2 fixes it.
          await fs.writeFile(path.join(dir, 'out.json'), '{"broken": false}');
        }
        return [{ type: 'assistant', content: 'did work' } as ChatEntry];
      },
      getClient: () => ({}) as never,
      executeToolByName: async () => ({ success: true, output: '' }),
    };

    const result = await runDevLoop(agent, 'court objectif', {
      maxTurns: 4,
      cwd: dir,
      verify: llmVerify,
      currentCostUsd: zeroCost,
      noPlan: true,
    });

    // Turn 1: structural defect → NEEDS REVIEW without calling the LLM verifier,
    // judge's "done" is overridden. Turn 2: file fixed → LLM verifier CONFIRMS.
    expect(result.status).toBe('done');
    expect(result.turnsUsed).toBe(2);
    expect(llmVerify).toHaveBeenCalledTimes(1);
    // The turn-2 prompt carries the structural issues (prev-issues reinjection).
    expect(prompts[1]).toContain('NON confirmée');
    expect(prompts[1]).toContain('out.json');
  });

  it('reinjects LLM-verifier evidence into the next turn prompt on NEEDS REVIEW', async () => {
    judgeMock.mockResolvedValue({ verdict: 'continue', reason: 'not there yet', parseFailed: false });
    const verdicts = ['NEEDS REVIEW', 'CONFIRMED'] as const;
    let v = 0;
    const verify: DevLoopVerifier = async () => ({
      verdict: verdicts[Math.min(v++, verdicts.length - 1)] as 'CONFIRMED' | 'NEEDS REVIEW',
      evidence: 'tests still failing: X should equal 2',
    });

    const prompts: string[] = [];
    const agent: DevLoopAgent = {
      processUserMessage: async (input: string): Promise<ChatEntry[]> => {
        prompts.push(input);
        return [{ type: 'assistant', content: 'work' } as ChatEntry];
      },
      getClient: () => ({}) as never,
      executeToolByName: async () => ({ success: true, output: '' }),
    };

    await runDevLoop(agent, 'court objectif', {
      maxTurns: 2,
      verify,
      currentCostUsd: zeroCost,
      noPlan: true,
    });

    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts[1]).toContain('tests still failing: X should equal 2');
  });
});
