import { describe, expect, it } from 'vitest';
import {
  applyEvidenceGate,
  evidenceSatisfiesDone,
  extractGoalEvidence,
  isGoalEvidenceRequired,
} from '../../src/goals/goal-evidence-gate.js';

describe('goal evidence gate', () => {
  it('is off by default', () => {
    expect(isGoalEvidenceRequired(false, {})).toBe(false);
    expect(isGoalEvidenceRequired(true, {})).toBe(true);
    expect(isGoalEvidenceRequired(false, { CODEBUDDY_GOAL_EVIDENCE: 'true' })).toBe(true);
  });

  it('extracts evidence fields from a judge object', () => {
    const fields = extractGoalEvidence({
      done: true,
      reason: 'tests green',
      evidence: 'npm test exit 0',
      artifacts: ['coverage/lcov.info'],
      criteria: [{ id: 'tests', status: 'passed', evidence: 'exit 0' }],
    });
    expect(evidenceSatisfiesDone(fields)).toBe(true);
    expect(fields.artifacts).toEqual(['coverage/lcov.info']);
  });

  it('downgrades done when the gate is on and evidence is missing', () => {
    const gated = applyEvidenceGate(
      { verdict: 'done', reason: 'I finished', parseFailed: false },
      { env: { CODEBUDDY_GOAL_EVIDENCE: 'true' } },
    );
    expect(gated.verdict).toBe('continue');
    expect(gated.reason).toMatch(/evidence required/);
  });

  it('keeps done when evidence is present', () => {
    const gated = applyEvidenceGate(
      {
        verdict: 'done',
        reason: 'tests green',
        parseFailed: false,
        evidence: 'vitest 12 passed',
      },
      { verifyGated: true },
    );
    expect(gated.verdict).toBe('done');
  });
});
