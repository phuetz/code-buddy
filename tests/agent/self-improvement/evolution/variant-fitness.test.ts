import { describe, it, expect } from 'vitest';
import {
  computeFitness,
  detectRegressions,
  parseVitestCounts,
  type FitnessComponent,
  type FitnessReport,
} from '../../../../src/agent/self-improvement/evolution/variant-fitness.js';

function fakeComponent(name: string, weight: number, score: number, passed = score >= 1): FitnessComponent {
  return { name, weight, deterministic: true, async run() { return { name, weight, score, passed, detail: 'fake' }; } };
}

describe('variant-fitness aggregation', () => {
  it('weighted-averages component scores into [0,1]', async () => {
    const r = await computeFitness({ checkoutDir: '/x' }, [
      fakeComponent('a', 3, 1.0),
      fakeComponent('b', 1, 0.0),
    ]);
    // (3*1 + 1*0) / 4 = 0.75
    expect(r.score).toBeCloseTo(0.75, 6);
    expect(r.passedAll).toBe(false); // b failed (score 0)
    expect(r.components).toHaveLength(2);
  });

  it('passedAll true only when every component passes', async () => {
    const r = await computeFitness({ checkoutDir: '/x' }, [fakeComponent('a', 1, 1.0), fakeComponent('b', 1, 1.0)]);
    expect(r.passedAll).toBe(true);
    expect(r.score).toBeCloseTo(1.0, 6);
  });

  it('a throwing component scores 0 and fails (never crashes the run)', async () => {
    const boom: FitnessComponent = {
      name: 'boom', weight: 2, deterministic: true, async run() { throw new Error('kaboom'); },
    };
    const r = await computeFitness({ checkoutDir: '/x' }, [fakeComponent('a', 2, 1.0), boom]);
    expect(r.score).toBeCloseTo(0.5, 6); // (2*1 + 2*0)/4
    expect(r.passedAll).toBe(false);
    expect(r.components.find((c) => c.name === 'boom')?.detail).toContain('kaboom');
  });

  it('detects regressions: score drop or pass→fail, never flags improvements', () => {
    const baseline: FitnessReport = {
      score: 1,
      passedAll: true,
      regressions: [],
      components: [
        { name: 'typecheck', weight: 3, score: 1, passed: true, detail: '' },
        { name: 'unit-tests', weight: 4, score: 0.8, passed: true, detail: '' },
        { name: 'eval', weight: 5, score: 0.5, passed: false, detail: '' },
      ],
    };
    const current = [
      { name: 'typecheck', weight: 3, score: 0, passed: false, detail: '' }, // pass→fail → regression
      { name: 'unit-tests', weight: 4, score: 0.6, passed: true, detail: '' }, // score drop → regression
      { name: 'eval', weight: 5, score: 0.9, passed: true, detail: '' }, // improved → NOT a regression
    ];
    expect(detectRegressions(baseline, current).sort()).toEqual(['typecheck', 'unit-tests']);
  });
});

describe('parseVitestCounts', () => {
  it('parses pass-only and mixed summaries', () => {
    expect(parseVitestCounts('Tests  3 passed (3)')).toEqual({ passed: 3, failed: 0 });
    expect(parseVitestCounts('Tests  2 failed | 5 passed (7)')).toEqual({ passed: 5, failed: 2 });
    expect(parseVitestCounts('no summary here')).toEqual({ passed: 0, failed: 0 });
  });
});
