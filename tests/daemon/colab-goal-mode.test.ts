import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetColabStore } from '../../src/fleet/colab-store';
import { FleetAutonomousLoop, type TaskExecutor } from '../../src/daemon/autonomous-loop';
import {
  buildColabGoalContinuationPrompt,
  goalTextForTask,
  type ColabGoalJudge,
} from '../../src/daemon/colab-goal';
import type { ModelTierConfig } from '../../src/agent/model-tier';

const TIER: ModelTierConfig = {
  localModel: 'qwen2.5:7b-instruct',
  localBaseUrl: 'http://localhost:11434/v1',
  escalationModel: 'claude-opus-4-8',
};

describe('colab goal-mode (Hermes kanban goal-mode parity)', () => {
  let dir: string;
  let store: FleetColabStore;

  function seedTasks(tasks: unknown[]): void {
    writeFileSync(join(dir, 'colab-tasks.json'), JSON.stringify({ version: '0.1', tasks }, null, 2));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'colab-goal-'));
    store = new FleetColabStore({ dir, agentId: 'host/repo', now: () => 1_000, generateId: (p) => `${p}-x` });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function makeLoop(executor: TaskExecutor, goalJudge?: ColabGoalJudge): FleetAutonomousLoop {
    return new FleetAutonomousLoop({
      store,
      tierConfig: TIER,
      executor,
      ...(goalJudge ? { goalJudge } : {}),
    });
  }

  const okExecutor: TaskExecutor = async () => ({ ok: true, summary: 'attempt done', output: 'I did some work.' });

  it('completes a goal-mode task when the judge says done', async () => {
    seedTasks([{ id: 'g1', title: 'ship it', status: 'open', priority: 'medium', claimedBy: null, goalMode: true, goalMaxTurns: 3 }]);
    const judge: ColabGoalJudge = vi.fn(async () => ({ verdict: 'done' as const, reason: 'all criteria met', parseFailed: false }));

    const result = await makeLoop(okExecutor, judge).tick();
    expect(result.outcome).toBe('completed');
    expect(store.getTask('g1')?.status).toBe('completed');
    expect(judge).toHaveBeenCalledOnce();
  });

  it('releases with goal_continue and persists the turn when the judge says continue', async () => {
    seedTasks([{ id: 'g1', title: 'ship it', status: 'open', priority: 'medium', claimedBy: null, goalMode: true, goalMaxTurns: 3 }]);
    const judge: ColabGoalJudge = async () => ({ verdict: 'continue', reason: 'tests missing', parseFailed: false });

    const result = await makeLoop(okExecutor, judge).tick();
    expect(result.outcome).toBe('goal_continue');
    expect(result.detail).toBe('tests missing');

    const task = store.getTask('g1');
    expect(task?.status).toBe('open');
    expect(task?.goalTurnsUsed).toBe(1);
    expect(task?.goalLastReason).toBe('tests missing');
    expect(store.listWorklog()[0]?.summary).toContain('Goal-mode turn 1/3');
  });

  it('normalizes legacy invalid goal counters before applying the goal budget', async () => {
    seedTasks([{
      id: 'g1',
      title: 'ship it',
      status: 'open',
      priority: 'medium',
      claimedBy: null,
      goalMode: true,
      goalMaxTurns: 0,
      goalTurnsUsed: '1',
    }]);
    const judge: ColabGoalJudge = async () => ({ verdict: 'continue', reason: 'tests missing', parseFailed: false });

    const result = await makeLoop(okExecutor, judge).tick();
    expect(result.outcome).toBe('goal_continue');
    const task = store.getTask('g1');
    expect(task?.status).toBe('open');
    expect(task?.goalTurnsUsed).toBe(1);
    expect(store.listWorklog()[0]?.summary).toContain('Goal-mode turn 1/5');
  });

  it('blocks the task for human review when the goal budget is exhausted', async () => {
    seedTasks([{
      id: 'g1', title: 'ship it', status: 'open', priority: 'medium', claimedBy: null,
      goalMode: true, goalMaxTurns: 2, goalTurnsUsed: 1, goalLastReason: 'still failing',
    }]);
    const judge: ColabGoalJudge = async () => ({ verdict: 'continue', reason: 'still failing', parseFailed: false });

    const result = await makeLoop(okExecutor, judge).tick();
    expect(result.outcome).toBe('goal_blocked');

    const task = store.getTask('g1');
    expect(task?.status).toBe('blocked');
    expect(task?.blockedReason).toContain('goal budget exhausted (2/2)');
    expect(task?.goalTurnsUsed).toBe(2);
    expect(task?.goalLastReason).toBe('still failing');
    expect(store.listWorklog()[0]?.nextSteps[0]).toContain('human review');
  });

  it('judge continue does NOT escalate the model ladder (not an executor failure)', async () => {
    seedTasks([{ id: 'g1', title: 'ship it', status: 'open', priority: 'medium', claimedBy: null, goalMode: true, goalMaxTurns: 5 }]);
    const judge: ColabGoalJudge = async () => ({ verdict: 'continue', reason: 'not yet', parseFailed: false });
    const models: string[] = [];
    const executor: TaskExecutor = async (_task, model) => {
      models.push(model.tier);
      return { ok: true, summary: 'attempt', output: 'work' };
    };

    const loop = makeLoop(executor, judge);
    await loop.tick();
    await loop.tick();
    expect(models).toEqual(['local', 'local']);
  });

  it('fail-open: a throwing judge lets the task complete', async () => {
    seedTasks([{ id: 'g1', title: 'ship it', status: 'open', priority: 'medium', claimedBy: null, goalMode: true }]);
    const judge: ColabGoalJudge = async () => {
      throw new Error('judge down');
    };
    const result = await makeLoop(okExecutor, judge).tick();
    expect(result.outcome).toBe('completed');
    expect(store.getTask('g1')?.status).toBe('completed');
  });

  it('ignores goal-mode when no judge is wired (plain completion)', async () => {
    seedTasks([{ id: 'g1', title: 'ship it', status: 'open', priority: 'medium', claimedBy: null, goalMode: true }]);
    const result = await makeLoop(okExecutor).tick();
    expect(result.outcome).toBe('completed');
  });

  it('non-goal tasks never touch the judge', async () => {
    seedTasks([{ id: 't1', title: 'plain', status: 'open', priority: 'medium', claimedBy: null }]);
    const judge = vi.fn();
    const result = await makeLoop(okExecutor, judge as unknown as ColabGoalJudge).tick();
    expect(result.outcome).toBe('completed');
    expect(judge).not.toHaveBeenCalled();
  });

  describe('store goal-mode fields', () => {
    it('addTask persists goalMode and goalMaxTurns; recordGoalTurn increments', () => {
      const task = store.addTask({ title: 'goal task', goalMode: true, goalMaxTurns: 7 });
      expect(task.goalMode).toBe(true);
      expect(task.goalMaxTurns).toBe(7);

      const updated = store.recordGoalTurn(task.id, 'needs more work');
      expect(updated.goalTurnsUsed).toBe(1);
      expect(updated.goalLastReason).toBe('needs more work');
      expect(store.getTask(task.id)?.goalTurnsUsed).toBe(1);
    });
  });

  describe('continuation prompt', () => {
    it('includes task text, criteria and the last judge reason', () => {
      const prompt = buildColabGoalContinuationPrompt({
        id: 'g1', title: 'Implement login', description: 'JWT-based', status: 'open', priority: 'medium',
        acceptanceCriteria: ['signup works', 'reset works'],
        goalMode: true, goalTurnsUsed: 1, goalLastReason: 'reset flow untested',
      });
      expect(prompt).toContain('[Continuing toward this fleet task');
      expect(prompt).toContain('Implement login');
      expect(prompt).toContain('- 1. signup works');
      expect(prompt).toContain('- 2. reset works');
      expect(prompt).toContain("Judge's last verdict: reset flow untested");
    });

    it('goalTextForTask joins title and description', () => {
      expect(goalTextForTask({ title: 'A', description: 'B' })).toBe('A\n\nB');
      expect(goalTextForTask({ title: 'A' })).toBe('A');
    });
  });
});
