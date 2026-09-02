import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as settingsHierarchy from '../../src/config/settings-hierarchy.js';
import { GoalJudgeFn, GoalJudgeResult } from '../../src/goals/goal-judge.js';
import { GoalManager, resetGoalManagers, resolveGoalsConfig } from '../../src/goals/goal-manager.js';
import { GoalStore } from '../../src/goals/goal-store.js';
import {
  DEFAULT_JUDGE_MAX_TOKENS,
  DEFAULT_JUDGE_TIMEOUT_MS,
  DEFAULT_MAX_TURNS,
} from '../../src/goals/goal-state.js';

function fakeJudge(...results: GoalJudgeResult[]): GoalJudgeFn {
  const queue = [...results];
  return vi.fn(async () => queue.shift() ?? results[results.length - 1]!);
}

const CONTINUE: GoalJudgeResult = { verdict: 'continue', reason: 'not yet', parseFailed: false };
const DONE: GoalJudgeResult = { verdict: 'done', reason: 'all tests pass', parseFailed: false };
const PARSE_FAIL: GoalJudgeResult = {
  verdict: 'continue',
  reason: 'judge reply was not JSON',
  parseFailed: true,
};

describe('GoalManager', () => {
  let tmpDir: string;
  let store: GoalStore;
  let originalGoalMaxTurnsEnv: string | undefined;
  let originalGoalJudgeModelEnv: string | undefined;
  let originalGoalPlannerModelEnv: string | undefined;
  let originalGoalJudgeTimeoutEnv: string | undefined;

  beforeEach(() => {
    originalGoalMaxTurnsEnv = process.env.CODEBUDDY_GOAL_MAX_TURNS;
    originalGoalJudgeModelEnv = process.env.CODEBUDDY_GOAL_JUDGE_MODEL;
    originalGoalPlannerModelEnv = process.env.CODEBUDDY_GOAL_PLANNER_MODEL;
    originalGoalJudgeTimeoutEnv = process.env.CODEBUDDY_GOAL_JUDGE_TIMEOUT_MS;
    delete process.env.CODEBUDDY_GOAL_MAX_TURNS;
    delete process.env.CODEBUDDY_GOAL_JUDGE_MODEL;
    delete process.env.CODEBUDDY_GOAL_PLANNER_MODEL;
    delete process.env.CODEBUDDY_GOAL_JUDGE_TIMEOUT_MS;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-manager-test-'));
    store = new GoalStore({ storeDir: tmpDir });
    resetGoalManagers(store);
  });

  afterEach(() => {
    if (originalGoalMaxTurnsEnv === undefined) {
      delete process.env.CODEBUDDY_GOAL_MAX_TURNS;
    } else {
      process.env.CODEBUDDY_GOAL_MAX_TURNS = originalGoalMaxTurnsEnv;
    }
    if (originalGoalJudgeModelEnv === undefined) {
      delete process.env.CODEBUDDY_GOAL_JUDGE_MODEL;
    } else {
      process.env.CODEBUDDY_GOAL_JUDGE_MODEL = originalGoalJudgeModelEnv;
    }
    if (originalGoalPlannerModelEnv === undefined) {
      delete process.env.CODEBUDDY_GOAL_PLANNER_MODEL;
    } else {
      process.env.CODEBUDDY_GOAL_PLANNER_MODEL = originalGoalPlannerModelEnv;
    }
    if (originalGoalJudgeTimeoutEnv === undefined) {
      delete process.env.CODEBUDDY_GOAL_JUDGE_TIMEOUT_MS;
    } else {
      process.env.CODEBUDDY_GOAL_JUDGE_TIMEOUT_MS = originalGoalJudgeTimeoutEnv;
    }
    resetGoalManagers();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('set() activates a goal with the default budget and persists it', () => {
    const mgr = new GoalManager('s1', store);
    const state = mgr.set('fix the build');
    expect(state.status).toBe('active');
    expect(state.maxTurns).toBe(20);
    expect(mgr.isActive()).toBe(true);
    expect(store.load('s1')?.goal).toBe('fix the build');
  });

  it('set() rejects empty goal text', () => {
    const mgr = new GoalManager('s1', store);
    expect(() => mgr.set('   ')).toThrow('goal text is empty');
  });

  it('set() rejects invalid turn budgets', () => {
    const mgr = new GoalManager('s1', store);
    expect(() => mgr.set('fix the build', { maxTurns: 0 })).toThrow(
      'maxTurns must be a positive integer'
    );
    expect(() => mgr.set('fix the build', { maxTurns: -1 })).toThrow(
      'maxTurns must be a positive integer'
    );
    expect(() => mgr.set('fix the build', { maxTurns: 1.5 })).toThrow(
      'maxTurns must be a positive integer'
    );
  });

  it('marks done when the judge says done', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    const decision = await mgr.evaluateAfterTurn('Build is green.', { judge: fakeJudge(DONE) });
    expect(decision.status).toBe('done');
    expect(decision.shouldContinue).toBe(false);
    expect(decision.message).toBe('✓ Goal achieved: all tests pass');
    expect(store.load('s1')?.status).toBe('done');
  });

  it('continues under budget with a continuation prompt and ↻ message', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    const decision = await mgr.evaluateAfterTurn('Still failing.', { judge: fakeJudge(CONTINUE) });
    expect(decision.shouldContinue).toBe(true);
    expect(decision.continuationPrompt).toContain('Goal: fix the build');
    expect(decision.message).toBe('↻ Continuing toward goal (1/20): not yet');
  });

  it('includes subgoals in the continuation prompt and judge params', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    mgr.addSubgoal('include a regression test');
    const judge = fakeJudge(CONTINUE);
    const decision = await mgr.evaluateAfterTurn('Working.', { judge });
    expect(decision.continuationPrompt).toContain('- 1. include a regression test');
    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({ subgoals: ['include a regression test'] })
    );
  });

  it('includes planned task criteria in judge params without mutating manual subgoals', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix then verify', {
      goalPlan: {
        summary: 'Plan',
        tasks: [
          {
            id: 'T1',
            title: 'Fix',
            acceptanceCriteria: ['diff exists'],
            dependsOn: [],
            subtasks: [
              {
                id: 'T1.1',
                title: 'Patch parser',
                acceptanceCriteria: ['parser edge case is covered'],
              },
            ],
          },
          {
            id: 'T2',
            title: 'Verify',
            acceptanceCriteria: ['focused test passes'],
            dependsOn: ['T1'],
            subtasks: [],
          },
        ],
      },
      goalPlanAttempted: true,
    });
    mgr.addSubgoal('report the command');
    const judge = fakeJudge(CONTINUE);

    const decision = await mgr.evaluateAfterTurn('Working.', { judge });

    expect(decision.continuationPrompt).toContain('Decomposition plan:');
    expect(mgr.state?.subgoals).toEqual(['report the command']);
    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({
        subgoals: [
          'T1 Fix: diff exists',
          'T1.1 Fix / Patch parser: parser edge case is covered',
          'T2 Verify after T1: focused test passes',
          'report the command',
        ],
      })
    );
  });

  it('auto-pauses when the turn budget is exhausted', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build', { maxTurns: 2 });
    await mgr.evaluateAfterTurn('turn 1', { judge: fakeJudge(CONTINUE) });
    const decision = await mgr.evaluateAfterTurn('turn 2', { judge: fakeJudge(CONTINUE) });
    expect(decision.status).toBe('paused');
    expect(decision.shouldContinue).toBe(false);
    expect(decision.message).toContain('⏸ Goal paused — 2/2 turns used');
    expect(store.load('s1')?.pausedReason).toBe('turn budget exhausted (2/2)');
  });

  it('auto-pauses after 3 consecutive judge parse failures', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    await mgr.evaluateAfterTurn('t1', { judge: fakeJudge(PARSE_FAIL) });
    await mgr.evaluateAfterTurn('t2', { judge: fakeJudge(PARSE_FAIL) });
    const decision = await mgr.evaluateAfterTurn('t3', { judge: fakeJudge(PARSE_FAIL) });
    expect(decision.status).toBe('paused');
    expect(decision.message).toContain("isn't returning the required JSON verdict");
    expect(decision.message).toContain('judgeModel');
  });

  it('resets the parse-failure streak on transport errors (parseFailed=false)', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    await mgr.evaluateAfterTurn('t1', { judge: fakeJudge(PARSE_FAIL) });
    await mgr.evaluateAfterTurn('t2', { judge: fakeJudge(PARSE_FAIL) });
    // Transport error — does NOT count toward the 3-strike auto-pause.
    await mgr.evaluateAfterTurn('t3', {
      judge: fakeJudge({ verdict: 'continue', reason: 'judge error: Error', parseFailed: false }),
    });
    const decision = await mgr.evaluateAfterTurn('t4', { judge: fakeJudge(PARSE_FAIL) });
    expect(decision.status).toBe('active');
    expect(decision.shouldContinue).toBe(true);
  });

  it('pause/resume controls the loop; resume resets the budget', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    await mgr.evaluateAfterTurn('t1', { judge: fakeJudge(CONTINUE) });
    expect(mgr.state?.turnsUsed).toBe(1);

    mgr.pause('user-paused');
    expect(mgr.isActive()).toBe(false);
    expect(mgr.hasGoal()).toBe(true);

    const inactive = await mgr.evaluateAfterTurn('t2', { judge: fakeJudge(DONE) });
    expect(inactive.verdict).toBe('inactive');

    const resumed = mgr.resume();
    expect(resumed?.status).toBe('active');
    expect(resumed?.turnsUsed).toBe(0);
    expect(resumed?.pausedReason).toBeUndefined();
  });

  it('does not pause or resume a completed goal', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    await mgr.evaluateAfterTurn('done', { judge: fakeJudge(DONE) });

    expect(mgr.state?.status).toBe('done');
    expect(mgr.pause('user-paused')).toBeNull();
    expect(mgr.resume()).toBeNull();
    expect(mgr.state).toMatchObject({
      status: 'done',
      turnsUsed: 1,
      lastVerdict: 'done',
      lastReason: 'all tests pass',
    });
    expect(store.load('s1')).toMatchObject({
      status: 'done',
      turnsUsed: 1,
      lastVerdict: 'done',
      lastReason: 'all tests pass',
    });
  });

  it('resume clears stale judge failure bookkeeping after an auto-pause', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    await mgr.evaluateAfterTurn('t1', { judge: fakeJudge(PARSE_FAIL) });
    await mgr.evaluateAfterTurn('t2', { judge: fakeJudge(PARSE_FAIL) });
    const paused = await mgr.evaluateAfterTurn('t3', { judge: fakeJudge(PARSE_FAIL) });
    expect(paused.status).toBe('paused');
    expect(mgr.state).toMatchObject({
      consecutiveParseFailures: 3,
      lastVerdict: 'continue',
      lastReason: 'judge reply was not JSON',
    });

    const resumed = mgr.resume();
    expect(resumed).toMatchObject({
      status: 'active',
      turnsUsed: 0,
      consecutiveParseFailures: 0,
    });
    expect(resumed?.pausedReason).toBeUndefined();
    expect(resumed?.lastVerdict).toBeUndefined();
    expect(resumed?.lastReason).toBeUndefined();
    expect(store.load('s1')).toMatchObject({
      status: 'active',
      turnsUsed: 0,
      consecutiveParseFailures: 0,
    });
  });

  it('clear() leaves a tombstone on disk and drops the in-memory goal', () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    mgr.clear();
    expect(mgr.hasGoal()).toBe(false);
    expect(mgr.statusLine()).toContain('No active goal');
    // Tombstone preserved for audit, but a new manager reads it as no goal.
    const files = fs.readdirSync(tmpDir).filter((name) => name.endsWith('.json'));
    expect(files).toHaveLength(1);
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, files[0]!), 'utf-8'));
    expect(raw.status).toBe('cleared');
    expect(new GoalManager('s1', store).hasGoal()).toBe(false);
  });

  it('persists across manager instances on the same store (resume semantics)', async () => {
    const first = new GoalManager('s1', store);
    first.set('fix the build');
    first.addSubgoal('run lint');
    await first.evaluateAfterTurn('t1', { judge: fakeJudge(CONTINUE) });

    const second = new GoalManager('s1', store);
    expect(second.isActive()).toBe(true);
    expect(second.state?.turnsUsed).toBe(1);
    expect(second.state?.subgoals).toEqual(['run lint']);
  });

  it('manages subgoals: add, remove (1-based), clear, guards', () => {
    const mgr = new GoalManager('s1', store);
    expect(() => mgr.addSubgoal('x')).toThrow('no active goal');
    mgr.set('fix the build');
    mgr.addSubgoal('a');
    mgr.addSubgoal('b');
    expect(mgr.renderSubgoals()).toBe('- 1. a\n- 2. b');
    expect(() => mgr.removeSubgoal(1.5)).toThrow('index must be a positive integer');
    expect(() => mgr.removeSubgoal(0)).toThrow('index must be a positive integer');
    expect(() => mgr.removeSubgoal(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      'index must be a positive integer'
    );
    expect(mgr.renderSubgoals()).toBe('- 1. a\n- 2. b');
    expect(mgr.removeSubgoal(1)).toBe('a');
    expect(() => mgr.removeSubgoal(5)).toThrow('index out of range (1..1)');
    expect(mgr.clearSubgoals()).toBe(1);
    expect(mgr.renderSubgoals()).toContain('no subgoals');
  });

  it('statusLine reflects the live state', () => {
    const mgr = new GoalManager('s1', store);
    expect(mgr.statusLine()).toBe('No active goal. Set one with /goal <text>.');
    mgr.set('fix the build');
    expect(mgr.statusLine()).toBe('⊙ Goal (active, 0/20 turns): fix the build');
  });

  it('honours CODEBUDDY_GOAL_JUDGE_TIMEOUT_MS over the 30s default', () => {
    process.env.CODEBUDDY_GOAL_JUDGE_TIMEOUT_MS = '180000';
    expect(resolveGoalsConfig().judgeTimeoutMs).toBe(180000);
  });

  it('does not truncate decimal CODEBUDDY_GOAL_MAX_TURNS values', () => {
    process.env.CODEBUDDY_GOAL_MAX_TURNS = '1.5';
    expect(resolveGoalsConfig().maxTurns).toBe(DEFAULT_MAX_TURNS);

    process.env.CODEBUDDY_GOAL_MAX_TURNS = '9007199254740992';
    expect(resolveGoalsConfig().maxTurns).toBe(DEFAULT_MAX_TURNS);

    process.env.CODEBUDDY_GOAL_MAX_TURNS = '6';
    expect(resolveGoalsConfig().maxTurns).toBe(6);
  });

  it('does not coerce non-numeric goal settings into integer config values', () => {
    const spy = vi.spyOn(settingsHierarchy, 'getSettingsHierarchy').mockReturnValue({
      getAllSettings: () => ({
        goals: {
          maxTurns: true,
          judgeMaxTokens: [1024],
          judgeTimeoutMs: { valueOf: () => 1234 },
        },
      }),
    } as never);
    try {
      const config = resolveGoalsConfig();
      expect(config.maxTurns).toBe(DEFAULT_MAX_TURNS);
      expect(config.judgeMaxTokens).toBe(DEFAULT_JUDGE_MAX_TOKENS);
      expect(config.judgeTimeoutMs).toBe(DEFAULT_JUDGE_TIMEOUT_MS);
    } finally {
      spy.mockRestore();
    }
  });

  it('loads goal settings from the current project settings file', () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-config-project-'));
    const originalCwd = process.cwd();
    fs.mkdirSync(path.join(projectDir, '.codebuddy'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.codebuddy', 'settings.json'),
      JSON.stringify({
        goals: {
          maxTurns: 7,
          judgeModel: 'gpt-5.5',
          judgeMaxTokens: 777,
          judgeTimeoutMs: 17000,
        },
      })
    );

    try {
      settingsHierarchy.resetSettingsHierarchy();
      process.chdir(projectDir);

      expect(resolveGoalsConfig()).toEqual({
        maxTurns: 7,
        judgeModel: 'gpt-5.5',
        plannerModel: '',
        judgeMaxTokens: 777,
        judgeTimeoutMs: 17000,
      });
    } finally {
      process.chdir(originalCwd);
      settingsHierarchy.resetSettingsHierarchy();
      fs.rmSync(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('ignores blank or non-string judge model config values', () => {
    const spy = vi.spyOn(settingsHierarchy, 'getSettingsHierarchy').mockReturnValue({
      getAllSettings: () => ({
        goals: {
          judgeModel: true,
        },
      }),
    } as never);
    try {
      process.env.CODEBUDDY_GOAL_JUDGE_MODEL = '   ';
      expect(resolveGoalsConfig().judgeModel).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  it('trims the judge model env var and falls back to settings when env is blank', () => {
    const spy = vi.spyOn(settingsHierarchy, 'getSettingsHierarchy').mockReturnValue({
      getAllSettings: () => ({
        goals: {
          judgeModel: ' qwen3:8b ',
        },
      }),
    } as never);
    try {
      process.env.CODEBUDDY_GOAL_JUDGE_MODEL = ' gpt-5.5 ';
      expect(resolveGoalsConfig().judgeModel).toBe('gpt-5.5');

      process.env.CODEBUDDY_GOAL_JUDGE_MODEL = '   ';
      expect(resolveGoalsConfig().judgeModel).toBe('qwen3:8b');
    } finally {
      spy.mockRestore();
    }
  });
});
