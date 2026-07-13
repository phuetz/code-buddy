import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleGoal, handleSubgoal } from '../../src/commands/handlers/goal-handler.js';
import { resetGoalManagers } from '../../src/goals/goal-manager.js';
import { GoalStore } from '../../src/goals/goal-store.js';

describe('/goal and /subgoal handlers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-handler-test-'));
    resetGoalManagers(new GoalStore({ storeDir: tmpDir }));
  });

  afterEach(() => {
    resetGoalManagers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('handleGoal', () => {
    it('shows the no-goal status on bare /goal', async () => {
      const result = await handleGoal([]);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('No active goal');
      expect(result.passToAI).toBeUndefined();
    });

    it('sets a goal and kicks off the first turn via passToAI', async () => {
      const result = await handleGoal(['Fix', 'every', 'failing', 'test']);
      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('⊙ Goal set (20-turn budget): Fix every failing test');
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toBe('Fix every failing test');
    });

    it('attaches a planner graph when a complex goal is set with an LLM client', async () => {
      const planner = vi.fn(async () => ({
        summary: 'Fix then verify',
        tasks: [
          {
            id: 'T1',
            title: 'Fix',
            acceptanceCriteria: ['diff exists'],
            dependsOn: [],
            subtasks: [
              {
                id: 'T1.1',
                title: 'Patch',
                acceptanceCriteria: ['file changed'],
              },
            ],
          },
        ],
      }));

      const result = await handleGoal(
        ['Fix', 'the', 'parser', 'then', 'verify', 'with', 'tests'],
        { client: {} as never, planner }
      );

      expect(planner).toHaveBeenCalled();
      expect(result.entry?.content).toContain('Hermes-style task graph attached');
      expect(result.entry?.content).toContain('T1.1');
      expect((await handleGoal(['status'])).entry?.content).toContain('plan 1 task');
    });

    it('reports status of an active goal', async () => {
      await handleGoal(['ship', 'it']);
      const result = await handleGoal(['status']);
      expect(result.entry?.content).toBe('⊙ Goal (active, 0/20 turns): ship it');
      expect(result.passToAI).toBeUndefined();
    });

    it('pauses and resumes the goal', async () => {
      await handleGoal(['ship', 'it']);
      const paused = await handleGoal(['pause']);
      expect(paused.entry?.content).toBe('⏸ Goal paused: ship it');

      const resumed = await handleGoal(['resume']);
      expect(resumed.entry?.content).toContain('▶ Goal resumed: ship it');
    });

    it('handles pause/resume without a goal', async () => {
      expect((await handleGoal(['pause'])).entry?.content).toBe('No goal set.');
      expect((await handleGoal(['resume'])).entry?.content).toBe('No goal to resume.');
    });

    it('clears the goal, including via stop/done aliases', async () => {
      for (const alias of ['clear', 'stop', 'done']) {
        await handleGoal(['ship', 'it']);
        const result = await handleGoal([alias]);
        expect(result.entry?.content).toBe('✓ Goal cleared.');
      }
      const again = await handleGoal(['clear']);
      expect(again.entry?.content).toBe('No active goal.');
    });
  });

  describe('handleSubgoal', () => {
    it('guards when no goal is active', async () => {
      const result = await handleSubgoal(['be', 'fast']);
      expect(result.entry?.content).toBe('No active goal. Set one with /goal <text>.');
    });

    it('adds, lists, removes and clears subgoals', async () => {
      await handleGoal(['ship', 'it']);

      const added = await handleSubgoal(['include', 'a', 'regression', 'test']);
      expect(added.entry?.content).toBe('✓ Added subgoal 1: include a regression test');

      await handleSubgoal(['run', 'lint']);
      const listed = await handleSubgoal([]);
      expect(listed.entry?.content).toContain('2 subgoals');
      expect(listed.entry?.content).toContain('- 1. include a regression test');
      expect(listed.entry?.content).toContain('- 2. run lint');

      const removed = await handleSubgoal(['remove', '1']);
      expect(removed.entry?.content).toBe('✓ Removed subgoal 1: include a regression test');

      const cleared = await handleSubgoal(['clear']);
      expect(cleared.entry?.content).toBe('✓ Cleared 1 subgoal.');
      expect((await handleSubgoal(['clear'])).entry?.content).toBe('No subgoals to clear.');
    });

    it('validates the remove index', async () => {
      await handleGoal(['ship', 'it']);
      expect((await handleSubgoal(['remove'])).entry?.content).toBe('Usage: /subgoal remove <n>');
      expect((await handleSubgoal(['remove', 'abc'])).entry?.content).toContain(
        'must be a positive integer'
      );
      expect((await handleSubgoal(['remove', '1.5'])).entry?.content).toContain(
        'must be a positive integer'
      );
      expect((await handleSubgoal(['remove', '1e0'])).entry?.content).toContain(
        'must be a positive integer'
      );
      expect((await handleSubgoal(['remove', '0x1'])).entry?.content).toContain(
        'must be a positive integer'
      );
      expect((await handleSubgoal(['remove', '7'])).entry?.content).toContain('index out of range');
    });
  });

  describe('slash wiring', () => {
    it('registers /goal and /subgoal builtins routed to dispatched tokens', async () => {
      const { builtinCommands } = await import('../../src/commands/slash/builtin-commands.js');
      const goal = builtinCommands.find(c => c.name === 'goal');
      const subgoal = builtinCommands.find(c => c.name === 'subgoal');
      expect(goal?.prompt).toBe('__GOAL__');
      expect(subgoal?.prompt).toBe('__SUBGOAL__');

      const { getEnhancedCommandHandler, resetEnhancedCommandHandler } = await import(
        '../../src/commands/enhanced-command-handler.js'
      );
      resetEnhancedCommandHandler();
      const tokens = getEnhancedCommandHandler().getRegisteredTokens();
      expect(tokens).toContain('__GOAL__');
      expect(tokens).toContain('__SUBGOAL__');
    // Importing the complete slash-command catalog is intentionally broad and
    // can contend with the full fork pool on loaded CI workers.
    }, 30000);
  });
});
