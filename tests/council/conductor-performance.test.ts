import { describe, expect, it, vi } from 'vitest';
import { assignCouncilRolesToCandidates } from '../../src/council/conductor.js';
import type { CouncilRole, RankedCandidate } from '../../src/council/types.js';

function candidate(index: number): RankedCandidate {
  return {
    c: {
      provider: `provider-${index}`,
      model: `model-${index}`,
      apiKey: 'test-key',
      costInputUsdPerMtok: 0,
    },
    strengths: ['reasoning'],
    score: 1,
    hist: 0,
  };
}

function role(index: number): CouncilRole {
  return {
    id: `role-${index}`,
    label: `Role ${index}`,
    mission: 'Test role assignment.',
    focus: ['correctness'],
  };
}

describe('council conductor role assignment performance', () => {
  it('precomputes each role/model score before exploring six-seat permutations', () => {
    const picked = Array.from({ length: 6 }, (_, index) => candidate(index));
    const roles = Array.from({ length: 6 }, (_, index) => role(index));
    const roleScore = vi.fn((_taskType: string, roleId: string, model: string): number => {
      const roleIndex = Number(roleId.slice('role-'.length));
      const modelIndex = Number(model.slice('model-'.length));
      return modelIndex === 5 - roleIndex ? 1 : 0;
    });

    const assigned = assignCouncilRolesToCandidates(picked, roles, 'code', { roleScore });

    expect(assigned.map((entry) => entry.c.model)).toEqual([
      'model-5',
      'model-4',
      'model-3',
      'model-2',
      'model-1',
      'model-0',
    ]);
    expect(roleScore).toHaveBeenCalledTimes(roles.length * picked.length);
  });
});
