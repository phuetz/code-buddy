import { describe, expect, it } from 'vitest';
import { buildIntentGraph, formatIntentGraph, intentCriterionIds } from '../../src/goals/intent-graph.js';
import { createGoalState } from '../../src/goals/goal-state.js';

describe('Intent Graph', () => {
  it('derives objective, dependency, subtask and criterion nodes from durable goal state', () => {
    const state = createGoalState('Ship a verified parser fix', 5);
    state.goalId = 'goal-test';
    state.createdAt = 1_700_000_000_000;
    state.lastTurnAt = 1_700_000_001_000;
    state.subgoals = ['Report the exact verification command'];
    state.goalPlan = {
      summary: 'Fix then verify',
      tasks: [
        {
          id: 'T1',
          title: 'Patch parser',
          acceptanceCriteria: ['Parser diff exists'],
          dependsOn: [],
          subtasks: [
            {
              id: 'T1.1',
              title: 'Cover edge case',
              acceptanceCriteria: ['Regression test exists'],
            },
          ],
        },
        {
          id: 'T2',
          title: 'Verify',
          acceptanceCriteria: ['Focused test exits 0'],
          dependsOn: ['T1'],
          subtasks: [],
        },
      ],
    };

    const graph = buildIntentGraph(state);

    expect(graph.rootNodeId).toBe('goal-test:objective');
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'goal-test:task:T1', kind: 'task' }),
        expect.objectContaining({ id: 'goal-test:task:T1.1', kind: 'task' }),
        expect.objectContaining({ manual: true, criterion: 'Report the exact verification command' }),
      ]),
    );
    expect(graph.edges).toContainEqual({
      from: 'goal-test:task:T2',
      to: 'goal-test:task:T1',
      kind: 'depends_on',
    });
    expect(intentCriterionIds(graph)).toHaveLength(4);
    expect(formatIntentGraph(graph)).toContain('3 task(s)');
  });

  it('changes revision and satisfies every node when the goal becomes done', () => {
    const state = createGoalState('Ship it');
    state.goalId = 'goal-revision';
    state.subgoals = ['Test passes'];
    const before = buildIntentGraph(state);

    state.status = 'done';
    state.turnsUsed = 2;
    const after = buildIntentGraph(state);

    expect(after.contractRevision).toBe(before.contractRevision);
    expect(after.revision).not.toBe(before.revision);
    expect(after.nodes.every((node) => node.status === 'satisfied')).toBe(true);
  });
});
