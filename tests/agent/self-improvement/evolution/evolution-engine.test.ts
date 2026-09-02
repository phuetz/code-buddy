import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  beatsBaseline,
  gatherInspirations,
  chooseBranchBase,
  runEvolutionCycle,
  formatEvolveRoundSummary,
} from '../../../../src/agent/self-improvement/evolution/evolution-engine.js';
import type { EvolutionCycleResult } from '../../../../src/agent/self-improvement/evolution/evolution-engine.js';
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

describe('chooseBranchBase (compounding, guarded)', () => {
  it('branches off the elite when reachable', () => {
    expect(chooseBranchBase('main', 'codebuddy/evolve/e1', () => true)).toBe('codebuddy/evolve/e1');
  });
  it('falls back to baseline when the elite is unreachable (pruned)', () => {
    expect(chooseBranchBase('main', 'codebuddy/evolve/e1', () => false)).toBe('main');
  });
  it('uses baseline when no compound ref given', () => {
    expect(chooseBranchBase('main', undefined, () => true)).toBe('main');
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
      // distinct niches so MAP-Elites keeps both (diversity); e2 higher → first.
      store.record(vr({ id: 'e1', score: 0.9, behavior: 'src/a:single' }));
      store.record(vr({ id: 'e2', score: 0.95, behavior: 'src/b:single' }));
      store.record(vr({ id: 'e3', score: 0.99, passedAll: false, behavior: 'src/c:single' })); // failed → excluded
      store.record(vr({ id: 'e4', score: 0.6, behavior: 'src/d:single' })); // below baseline → excluded
      store.record(vr({ id: 'e5', score: 0.92, regressions: ['unit-tests'], behavior: 'src/e:single' })); // regressed → excluded
      // branches don't exist here → diffs come back empty, but SELECTION must be correct.
      const insp = gatherInspirations(store, 'HEAD', process.cwd(), 2, 0.7);
      expect(insp.map((i) => i.id)).toEqual(['e2', 'e1']);
      expect(insp.every((i) => typeof i.diff === 'string')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('k=0 disables inspirations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'insp0-'));
    try {
      const store = new CodeVariantStore(join(dir, 'v.json'));
      store.record(vr({ id: 'e1', score: 0.9 }));
      expect(gatherInspirations(store, 'HEAD', process.cwd(), 0, 0)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

function gitInitRepo(dir: string): void {
  const run = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init', '-q']);
  run(['config', 'user.email', 'test@codebuddy']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'feature.txt'), 'v0\n');
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'init']);
}

describe('runEvolutionCycle — no-change mutator is not an evaluated variant', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'evo-noop-'));
    gitInitRepo(dir);
    originalCwd = process.cwd();
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('does not record a baseline-SHA variant when the mutator produced no change', async () => {
    const store = new CodeVariantStore(join(dir, 'variants.json'));
    const result = await runEvolutionCycle({
      baselineRef: 'HEAD',
      basePath: dir,
      weakness: { id: 'w', goal: 'improve wording', kind: 'manual' },
      variantId: 'v-noop',
      components: [],
      planner: async () => null,
      store,
      mutate: async () => ({ changed: false, detail: 'agent run complete (changes detected by git)' }),
    });

    expect(result.mutated).toBe(false);
    expect(store.list()).toHaveLength(0);
    expect(result.kept).toBe(false);
  });
});

describe('formatEvolveRoundSummary', () => {
  function cycle(over: Partial<EvolutionCycleResult>): EvolutionCycleResult {
    return {
      variantId: 'v',
      branch: 'codebuddy/evolve/v',
      mutated: true,
      report: { score: 0.5, passedAll: true, regressions: [], components: [] },
      beatsBaseline: false,
      kept: false,
      ...over,
    };
  }

  it('says no variant was produced when every candidate is a no-op', () => {
    expect(formatEvolveRoundSummary([cycle({ mutated: false })])).toBe('Aucune variante produite.');
    expect(formatEvolveRoundSummary([])).toBe('Aucune variante produite.');
  });

  it('keeps the baseline message when variants exist but none win', () => {
    expect(formatEvolveRoundSummary([cycle({ mutated: true, beatsBaseline: false })])).toMatch(
      /No candidate beat the baseline/,
    );
  });
});
