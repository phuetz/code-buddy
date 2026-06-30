import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beatsBaseline, gatherInspirations } from '../../../../src/agent/self-improvement/evolution/evolution-engine.js';
import { CodeVariantStore, type VariantRecord } from '../../../../src/agent/self-improvement/evolution/code-variant-store.js';
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

describe('gatherInspirations (AlphaEvolve-style elites)', () => {
  function vr(over: Partial<VariantRecord>): VariantRecord {
    return {
      id: 'x', branch: 'codebuddy/evolve/none', sha: '', score: 0, passedAll: true, regressions: [],
      createdAt: '2026-01-01T00:00:00.000Z', ...over,
    };
  }

  it('returns top-k passing, no-regression, above-baseline variants, sorted by score desc', () => {
    const dir = mkdtempSync(join(tmpdir(), 'insp-'));
    try {
      const store = new CodeVariantStore(join(dir, 'v.json'));
      store.record(vr({ id: 'e1', score: 0.9 }));
      store.record(vr({ id: 'e2', score: 0.95 }));
      store.record(vr({ id: 'e3', score: 0.99, passedAll: false })); // failed → excluded
      store.record(vr({ id: 'e4', score: 0.6 })); // below baseline → excluded
      store.record(vr({ id: 'e5', score: 0.92, regressions: ['unit-tests'] })); // regressed → excluded
      // branches don't exist here → diffs come back empty, but SELECTION must be correct.
      const insp = gatherInspirations(store, 'HEAD', process.cwd(), 2, 0.7);
      expect(insp.map((i) => i.id)).toEqual(['e2', 'e1']);
      expect(insp.every((i) => typeof i.diff === 'string')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('k=0 disables inspirations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'insp0-'));
    try {
      const store = new CodeVariantStore(join(dir, 'v.json'));
      store.record(vr({ id: 'e1', score: 0.9 }));
      expect(gatherInspirations(store, 'HEAD', process.cwd(), 0, 0)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
