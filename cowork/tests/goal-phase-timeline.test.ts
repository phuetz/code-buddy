/**
 * Store-level proof that the goal-loop phases accumulate turn-by-turn so the
 * GoalBanner can render the steps "unfolding one by one". No electron — just the
 * zustand store reducer (setGoalStatus / clearGoalStatus).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getVersion: () => '0.0.0' },
  ipcRenderer: { on: vi.fn(), send: vi.fn(), invoke: vi.fn() },
}));

import { useAppStore } from '../src/renderer/store';

const S = 'sess-goal';

describe('goal phase timeline accumulation', () => {
  beforeEach(() => {
    useAppStore.getState().clearGoalStatus(S);
  });

  it('appends one phase per judged turn, replaces a re-fired turn, and clears', () => {
    const set = useAppStore.getState().setGoalStatus;
    set(S, { goal: 'G', status: 'active', turnsUsed: 0, maxTurns: 3 });
    set(S, { goal: 'G', status: 'active', turnsUsed: 1, maxTurns: 3, lastVerdict: 'continue', lastReason: 'r1' });
    // same turn re-fires → replace, not duplicate
    set(S, { goal: 'G', status: 'active', turnsUsed: 1, maxTurns: 3, lastVerdict: 'continue', lastReason: 'r1b' });
    set(S, { goal: 'G', status: 'done', turnsUsed: 2, maxTurns: 3, lastVerdict: 'done' });

    const phases = useAppStore.getState().goalPhasesBySession[S];
    expect(phases.map((p) => p.turnsUsed)).toEqual([0, 1, 2]);
    expect(phases[1].lastReason).toBe('r1b'); // replaced in place
    expect(phases[2].status).toBe('done');

    useAppStore.getState().clearGoalStatus(S);
    expect(useAppStore.getState().goalPhasesBySession[S]).toBeUndefined();
    expect(useAppStore.getState().goalStatesBySession[S]).toBeUndefined();
  });
});
