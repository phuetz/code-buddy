import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import {
  CodeVariantStore,
  selectParentWithPenalty,
  type VariantRecord,
} from '../../../../src/agent/self-improvement/evolution/code-variant-store.js';
import { gatherInspirations } from '../../../../src/agent/self-improvement/evolution/evolution-engine.js';

function record(over: Partial<VariantRecord>): VariantRecord {
  return {
    id: 'parent',
    branch: 'branch',
    sha: 'sha',
    score: 1,
    passedAll: true,
    regressions: [],
    createdAt: '2026-09-04T00:00:00.000Z',
    ...over,
  };
}

describe('selectParentWithPenalty', () => {
  let qaDir: string;

  beforeEach(() => {
    mkdirSync(join(process.cwd(), '_qa', 'dgm4'), { recursive: true });
    qaDir = mkdtempSync(join(process.cwd(), '_qa', 'dgm4', 'parent-selection-'));
  });

  afterEach(() => {
    rmSync(qaDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('uses fitness times exp(-lambda * children) and excludes unsafe variants', () => {
    const records = [
      record({ id: 'best', score: 1, childrenCount: 0 }),
      record({ id: 'overused', score: 1, childrenCount: 4 }),
      record({ id: 'failed', score: 2, passedAll: false }),
      record({ id: 'regressed', score: 2, regressions: ['tests'] }),
    ];

    expect(selectParentWithPenalty(records, 0.5, () => 0).id).toBe('best');
    expect(selectParentWithPenalty(records, 0.5, () => 0.99).id).toBe('overused');
  });

  it('makes the penalized path the engine default and leaves max-score selection behind legacy mode', () => {
    const store = new CodeVariantStore(join(qaDir, 'gather.json'));
    store.record(record({ id: 'overused', score: 1, childrenCount: 100, behavior: 'src/a:single' }));
    store.record(record({ id: 'fresh', score: 0.8, childrenCount: 0, behavior: 'src/b:single' }));

    const penalized = gatherInspirations(store, 'HEAD', process.cwd(), 1, undefined, {
      selectionMode: 'penalized',
      lambda: 0.5,
      random: () => 0.000001,
    });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.000001);
    const defaultPath = gatherInspirations(store, 'HEAD', process.cwd(), 1, undefined);
    random.mockRestore();
    const legacy = gatherInspirations(store, 'HEAD', process.cwd(), 1, undefined, { selectionMode: 'legacy' });

    expect(penalized.map((parent) => parent.id)).toEqual(['fresh']);
    expect(defaultPath.map((parent) => parent.id)).toEqual(['fresh']);
    expect(legacy.map((parent) => parent.id)).toEqual(['overused']);
  });

  it('persists child counts and rotates parents over repeated selections', () => {
    mkdirSync(qaDir, { recursive: true });
    const store = new CodeVariantStore(join(qaDir, 'variants.json'));
    store.record(record({ id: 'p1', score: 1 }));
    store.record(record({ id: 'p2', score: 0.9 }));
    store.record(record({ id: 'p3', score: 0.8 }));

    const selected: string[] = [];
    for (let i = 0; i < 100; i++) {
      selected.push(store.selectParentWithPenalty(0.5, () => 0.4)!.id);
    }

    expect(new Set(selected).size).toBeGreaterThan(1);
    expect(store.list().every((parent) => typeof parent.childrenCount === 'number')).toBe(true);
    expect(store.getEvaluationStats().evaluationsAvoided).toBe(0);
  });
});
