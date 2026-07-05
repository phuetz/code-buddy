import { describe, expect, it } from 'vitest';

import { planFromGoal, progressOf } from '../src/renderer/utils/autopilot-plan';

describe('planFromGoal', () => {
  it('creates a browser navigation plan', () => {
    const plan = planFromGoal('réserver un créneau');

    expect(plan).toHaveLength(4);
    expect(plan[0]?.label).toContain('réserver un créneau');
    expect(plan.every((step) => step.status === 'pending')).toBe(true);
  });
});

describe('progressOf', () => {
  it('computes completion percentage from done steps', () => {
    expect(
      progressOf([
        { id: 'a', label: 'A', status: 'done' },
        { id: 'b', label: 'B', status: 'running' },
        { id: 'c', label: 'C', status: 'pending' },
        { id: 'd', label: 'D', status: 'failed' },
      ])
    ).toBe(25);
  });

  it('returns zero for empty plans', () => {
    expect(progressOf([])).toBe(0);
  });
});
