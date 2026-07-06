import { describe, expect, it, vi } from 'vitest';
import type { CodeBuddyClient } from '../../src/codebuddy/client.js';
import {
  decomposeGoal,
  formatGoalPlan,
  goalPlanToCriteria,
  parseGoalPlan,
  repairPlanCriteria,
  shouldAutoDecomposeGoal,
  weakCriteriaItems,
} from '../../src/goals/goal-decomposer.js';

function mockClient(content: string): CodeBuddyClient {
  return {
    chat: vi.fn(async () => ({
      choices: [
        {
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
    })),
  } as unknown as CodeBuddyClient;
}

describe('goal-decomposer', () => {
  it('detects complex goals worth planning', () => {
    expect(shouldAutoDecomposeGoal('fix auth then add tests')).toBe(true);
    expect(shouldAutoDecomposeGoal('ship it')).toBe(false);
  });

  it('parses and sanitizes a Hermes-style task graph', () => {
    const plan = parseGoalPlan(
      JSON.stringify({
        summary: 'Build in lanes',
        tasks: [
          {
            id: 'T1',
            title: 'Research current flow',
            acceptanceCriteria: ['notes cite the current files'],
            subtasks: [
              {
                id: 'T1.1',
                title: 'Trace entry point',
                acceptanceCriteria: ['entry point path is named'],
              },
            ],
          },
          {
            id: 'T2',
            title: 'Implement and test',
            dependsOn: ['T1', 'missing', 'T2'],
            criteria: ['focused test passes'],
          },
        ],
        notes: ['T2 waits for T1'],
      })
    );

    expect(plan).not.toBeNull();
    expect(plan!.tasks).toHaveLength(2);
    expect(plan!.tasks[1]!.dependsOn).toEqual(['T1']);
    expect(plan!.tasks[0]!.subtasks[0]!.id).toBe('T1.1');
    expect(goalPlanToCriteria(plan!)).toEqual([
      'T1 Research current flow: notes cite the current files',
      'T1.1 Research current flow / Trace entry point: entry point path is named',
      'T2 Implement and test after T1: focused test passes',
    ]);
    expect(formatGoalPlan(plan!)).toContain('depends on: T1');
  });

  it('calls the LLM with a graph prompt and returns the parsed plan', async () => {
    const client = mockClient(
      JSON.stringify({
        summary: 'Two-stage plan',
        tasks: [
          { id: 'T1', title: 'Implement', acceptanceCriteria: ['diff exists'] },
          { id: 'T2', title: 'Verify', dependsOn: ['T1'], acceptanceCriteria: ['test passes'] },
        ],
      })
    );

    const plan = await decomposeGoal('implement then verify', client);

    expect(plan?.summary).toBe('Two-stage plan');
    expect(plan?.tasks[1]!.dependsOn).toEqual(['T1']);
    expect(client.chat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ content: expect.stringContaining('sub-subtasks') }),
      ]),
      [],
      expect.objectContaining({ temperature: 0, maxTokens: 4096 })
    );
  });
});

describe('goal-decomposer — critères vérifiables obligatoires', () => {
  it('marks auto-filled (tautological) criteria with criteriaAutoFilled', () => {
    const plan = parseGoalPlan(
      JSON.stringify({
        summary: 'p',
        tasks: [
          { id: 'T1', title: 'No criteria here', subtasks: [{ id: 'T1.1', title: 'Nested none' }] },
          { id: 'T2', title: 'Has criteria', acceptanceCriteria: ['npm test exits 0'] },
        ],
      })
    );
    expect(plan!.tasks[0]!.criteriaAutoFilled).toBe(true);
    expect(plan!.tasks[0]!.subtasks[0]!.criteriaAutoFilled).toBe(true);
    expect(plan!.tasks[1]!.criteriaAutoFilled).toBeUndefined();
    expect(weakCriteriaItems(plan!).map((w) => w.id)).toEqual(['T1', 'T1.1']);
  });

  it('repairPlanCriteria merges verifiable criteria for weak items only (fail-open otherwise)', async () => {
    const plan = parseGoalPlan(
      JSON.stringify({
        summary: 'p',
        tasks: [
          { id: 'T1', title: 'Weak task' },
          { id: 'T2', title: 'Strong task', acceptanceCriteria: ['grep finds the export'] },
        ],
      })
    )!;
    const client = mockClient(
      JSON.stringify({ criteria: { T1: ['`npm test -- x.test.ts` exits 0'], T2: ['must be ignored'], T9: ['unknown id'] } })
    );

    const repaired = await repairPlanCriteria('goal', plan, client);

    expect(repaired.tasks[0]!.acceptanceCriteria).toEqual(['`npm test -- x.test.ts` exits 0']);
    expect(repaired.tasks[0]!.criteriaAutoFilled).toBeUndefined();
    // T2 n'était pas faible : la réponse du LLM le concernant est ignorée.
    expect(repaired.tasks[1]!.acceptanceCriteria).toEqual(['grep finds the export']);
  });

  it('repairPlanCriteria is fail-open on garbage LLM output', async () => {
    const plan = parseGoalPlan(
      JSON.stringify({ summary: 'p', tasks: [{ id: 'T1', title: 'Weak task' }] })
    )!;
    const repaired = await repairPlanCriteria('goal', plan, mockClient('not json at all'));
    expect(repaired.tasks[0]!.criteriaAutoFilled).toBe(true);
    expect(repaired.tasks[0]!.acceptanceCriteria[0]).toContain('Evidence shows');
  });

  it('decomposeGoal chains the repair pass when the plan has weak criteria', async () => {
    const planJson = JSON.stringify({
      summary: 'p',
      tasks: [{ id: 'T1', title: 'Weak task' }],
    });
    const repairJson = JSON.stringify({ criteria: { T1: ['file src/x.ts exists and exports x'] } });
    let call = 0;
    const client = {
      chat: vi.fn(async () => ({
        choices: [
          { message: { role: 'assistant', content: call++ === 0 ? planJson : repairJson }, finish_reason: 'stop' },
        ],
      })),
    } as unknown as CodeBuddyClient;

    const plan = await decomposeGoal('implement then verify', client);

    expect(client.chat).toHaveBeenCalledTimes(2);
    expect(plan!.tasks[0]!.acceptanceCriteria).toEqual(['file src/x.ts exists and exports x']);
    expect(plan!.tasks[0]!.criteriaAutoFilled).toBeUndefined();
  });
});
