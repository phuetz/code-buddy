import { describe, it, expect } from 'vitest';
import { beatsBaseline } from '../../../../src/agent/self-improvement/evolution/evolution-engine.js';
import type { FitnessReport } from '../../../../src/agent/self-improvement/evolution/variant-fitness.js';

function report(over: Partial<FitnessReport>): FitnessReport {
  return { score: 1, passedAll: true, regressions: [], components: [], ...over };
}

describe('evolution-engine beatsBaseline', () => {
  it('wins when passedAll, no regressions, and strictly above baseline', () => {
    expect(beatsBaseline(report({ score: 0.9 }), report({ score: 0.8 }))).toBe(true);
  });
  it('loses on a tie (must strictly beat)', () => {
    expect(beatsBaseline(report({ score: 0.8 }), report({ score: 0.8 }))).toBe(false);
  });
  it('loses on any regression even if score is higher', () => {
    expect(beatsBaseline(report({ score: 0.99, regressions: ['unit-tests'] }), report({ score: 0.8 }))).toBe(false);
  });
  it('loses when not all components passed', () => {
    expect(beatsBaseline(report({ score: 0.99, passedAll: false }), report({ score: 0.8 }))).toBe(false);
  });
  it('with no baseline, wins iff passedAll and no regressions', () => {
    expect(beatsBaseline(report({ score: 0.5 }))).toBe(true);
    expect(beatsBaseline(report({ passedAll: false }))).toBe(false);
  });
});
