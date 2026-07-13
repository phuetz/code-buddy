import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_TURNS,
  buildContinuationPrompt,
  createGoalState,
  formatGoalStatusLine,
  getGoalJudgeCriteria,
  normalizeGoalState,
  renderSubgoalsBlock,
  truncateText,
} from '../../src/goals/goal-state.js';

describe('goal-state', () => {
  describe('createGoalState', () => {
    it('rejects invalid turn budgets', () => {
      expect(() => createGoalState('g', 0)).toThrow('maxTurns must be a positive integer');
      expect(() => createGoalState('g', -1)).toThrow('maxTurns must be a positive integer');
      expect(() => createGoalState('g', 1.5)).toThrow('maxTurns must be a positive integer');
      expect(() => createGoalState('g', Number.MAX_SAFE_INTEGER + 1)).toThrow(
        'maxTurns must be a positive integer'
      );
    });
  });

  describe('normalizeGoalState', () => {
    it('round-trips a freshly created state', () => {
      const state = createGoalState('ship the feature', 10);
      const restored = normalizeGoalState(JSON.parse(JSON.stringify(state)));
      expect(restored).toEqual(state);
    });

    it('loads legacy payloads without subgoals', () => {
      const restored = normalizeGoalState({
        goal: 'fix tests',
        status: 'paused',
        turnsUsed: 5,
        maxTurns: 20,
        createdAt: 123,
        lastTurnAt: 456,
        consecutiveParseFailures: 1,
        pausedReason: 'turn budget exhausted (20/20)',
      });
      expect(restored).not.toBeNull();
      expect(restored!.subgoals).toEqual([]);
      expect(restored!.status).toBe('paused');
      expect(restored!.pausedReason).toBe('turn budget exhausted (20/20)');
      expect(restored!.goalId).toMatch(/^goal-legacy-/);
      expect(normalizeGoalState({
        goal: 'fix tests',
        createdAt: 123,
      })!.goalId).toBe(restored!.goalId);
    });

    it('rejects payloads without goal text', () => {
      expect(normalizeGoalState({ status: 'active' })).toBeNull();
      expect(normalizeGoalState(null)).toBeNull();
      expect(normalizeGoalState('not an object')).toBeNull();
    });

    it('coerces bad numbers and unknown statuses to defaults', () => {
      const restored = normalizeGoalState({
        goal: 'g',
        status: 'bogus',
        turnsUsed: 'NaN?',
        maxTurns: 0,
        subgoals: ['  a  ', '', 42],
      });
      expect(restored!.status).toBe('active');
      expect(restored!.turnsUsed).toBe(0);
      expect(restored!.maxTurns).toBe(DEFAULT_MAX_TURNS);
      expect(restored!.subgoals).toEqual(['a', '42']);
    });

    it('does not truncate persisted decimal or negative counters', () => {
      const restored = normalizeGoalState({
        goal: 'g',
        turnsUsed: 1.5,
        maxTurns: 2.5,
        consecutiveParseFailures: -1,
      });
      expect(restored!.turnsUsed).toBe(0);
      expect(restored!.maxTurns).toBe(DEFAULT_MAX_TURNS);
      expect(restored!.consecutiveParseFailures).toBe(0);
    });

    it('does not restore unsafe integer counters', () => {
      const restored = normalizeGoalState({
        goal: 'g',
        turnsUsed: '9007199254740992',
        maxTurns: '9007199254740992',
        consecutiveParseFailures: '9007199254740992',
      });
      expect(restored!.turnsUsed).toBe(0);
      expect(restored!.maxTurns).toBe(DEFAULT_MAX_TURNS);
      expect(restored!.consecutiveParseFailures).toBe(0);
    });

    it('loads decimal string counters but does not coerce other JS values', () => {
      const restored = normalizeGoalState({
        goal: 'g',
        turnsUsed: '2',
        maxTurns: '5',
        consecutiveParseFailures: '1',
      });
      expect(restored!.turnsUsed).toBe(2);
      expect(restored!.maxTurns).toBe(5);
      expect(restored!.consecutiveParseFailures).toBe(1);

      const coerced = normalizeGoalState({
        goal: 'g',
        turnsUsed: true,
        maxTurns: [6],
        consecutiveParseFailures: { valueOf: () => 1 },
      });
      expect(coerced!.turnsUsed).toBe(0);
      expect(coerced!.maxTurns).toBe(DEFAULT_MAX_TURNS);
      expect(coerced!.consecutiveParseFailures).toBe(0);
    });

    it('normalizes persisted goal plans without requiring them on old states', () => {
      const restored = normalizeGoalState({
        goal: 'ship it',
        goalPlanAttempted: true,
        goalPlan: {
          summary: 'Plan',
          tasks: [
            {
              id: 'T1',
              title: 'Implement',
              acceptanceCriteria: ['diff exists'],
              subtasks: [{ id: 'T1.1', title: 'Patch', acceptanceCriteria: ['file changed'] }],
            },
          ],
        },
      });

      expect(restored!.goalPlanAttempted).toBe(true);
      expect(restored!.goalPlan?.tasks[0]!.subtasks[0]!.id).toBe('T1.1');
      expect(getGoalJudgeCriteria(restored!)).toEqual([
        'T1 Implement: diff exists',
        'T1.1 Implement / Patch: file changed',
      ]);
    });

    it('preserves the independent proof gate across process restarts', () => {
      const state = createGoalState('ship with proof');
      state.verifyGated = true;

      expect(normalizeGoalState(JSON.parse(JSON.stringify(state)))).toMatchObject({
        goalId: state.goalId,
        verifyGated: true,
      });
    });
  });

  describe('formatGoalStatusLine', () => {
    it('formats the no-goal case', () => {
      expect(formatGoalStatusLine(null)).toBe('No active goal. Set one with /goal <text>.');
      const cleared = { ...createGoalState('g'), status: 'cleared' as const };
      expect(formatGoalStatusLine(cleared)).toBe('No active goal. Set one with /goal <text>.');
    });

    it('formats active goals with turn counter and subgoal count', () => {
      const state = createGoalState('Fix every failing test', 20);
      state.turnsUsed = 3;
      expect(formatGoalStatusLine(state)).toBe('⊙ Goal (active, 3/20 turns): Fix every failing test');
      state.subgoals = ['include a regression test', 'run lint'];
      expect(formatGoalStatusLine(state)).toBe(
        '⊙ Goal (active, 3/20 turns, 2 subgoals): Fix every failing test'
      );
      state.subgoals = ['one'];
      expect(formatGoalStatusLine(state)).toBe(
        '⊙ Goal (active, 3/20 turns, 1 subgoal): Fix every failing test'
      );
      state.goalPlan = {
        summary: 'Plan',
        tasks: [
          {
            id: 'T1',
            title: 'Fix',
            acceptanceCriteria: ['diff exists'],
            dependsOn: [],
            subtasks: [],
          },
        ],
      };
      expect(formatGoalStatusLine(state)).toBe(
        '⊙ Goal (active, 3/20 turns, 1 subgoal, plan 1 task): Fix every failing test'
      );
    });

    it('formats paused goals with reason', () => {
      const state = createGoalState('g', 20);
      state.status = 'paused';
      state.turnsUsed = 20;
      state.pausedReason = 'turn budget exhausted (20/20)';
      expect(formatGoalStatusLine(state)).toBe(
        '⏸ Goal (paused, 20/20 turns — turn budget exhausted (20/20)): g'
      );
    });

    it('formats done goals', () => {
      const state = createGoalState('g', 20);
      state.status = 'done';
      state.turnsUsed = 10;
      expect(formatGoalStatusLine(state)).toBe('✓ Goal done (10/20 turns): g');
    });
  });

  describe('renderSubgoalsBlock', () => {
    it('renders a 1-based numbered list', () => {
      expect(renderSubgoalsBlock(['a', 'b'])).toBe('- 1. a\n- 2. b');
      expect(renderSubgoalsBlock([])).toBe('');
    });
  });

  describe('buildContinuationPrompt', () => {
    it('uses the plain template without subgoals', () => {
      const prompt = buildContinuationPrompt(createGoalState('ship it'));
      expect(prompt).toContain('[Continuing toward your standing goal]');
      expect(prompt).toContain('Goal: ship it');
      expect(prompt).toContain('Take the next concrete step.');
      expect(prompt).not.toContain('Additional criteria');
    });

    it('lists subgoals in the with-subgoals template', () => {
      const state = createGoalState('ship it');
      state.subgoals = ['include a regression test'];
      const prompt = buildContinuationPrompt(state);
      expect(prompt).toContain('Additional criteria the user added mid-loop:');
      expect(prompt).toContain('- 1. include a regression test');
      expect(prompt).toContain('goal AND all additional criteria');
    });

    it('includes the decomposition plan when one is attached', () => {
      const state = createGoalState('ship it');
      state.goalPlan = {
        summary: 'Two lanes',
        tasks: [
          {
            id: 'T1',
            title: 'Implement',
            acceptanceCriteria: ['diff exists'],
            dependsOn: [],
            subtasks: [
              {
                id: 'T1.1',
                title: 'Patch code',
                acceptanceCriteria: ['file changed'],
              },
            ],
          },
          {
            id: 'T2',
            title: 'Verify',
            acceptanceCriteria: ['test passes'],
            dependsOn: ['T1'],
            subtasks: [],
          },
        ],
      };
      state.subgoals = ['mention exact command'];

      const prompt = buildContinuationPrompt(state);

      expect(prompt).toContain('Decomposition plan:');
      expect(prompt).toContain('- T1: Implement');
      expect(prompt).toContain('- T1.1: Patch code');
      expect(prompt).toContain('depends on: T1');
      expect(prompt).toContain('Additional user criteria:');
      expect(prompt).toContain('- 1. mention exact command');
    });
  });

  describe('truncateText', () => {
    it('truncates long text with a marker', () => {
      expect(truncateText('abcdef', 3)).toBe('abc… [truncated]');
      expect(truncateText('abc', 3)).toBe('abc');
      expect(truncateText('', 3)).toBe('');
    });
  });
});
