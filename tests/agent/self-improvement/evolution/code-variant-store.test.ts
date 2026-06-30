import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CodeVariantStore,
  behaviorDescriptor,
  diverseElites,
  type VariantRecord,
} from '../../../../src/agent/self-improvement/evolution/code-variant-store.js';

function rec(over: Partial<VariantRecord>): VariantRecord {
  return {
    id: 'v', branch: 'b', sha: 'deadbeef', score: 1, passedAll: true, regressions: [],
    createdAt: '2026-06-30T00:00:00.000Z', ...over,
  };
}

describe('CodeVariantStore', () => {
  let dir: string;
  let store: CodeVariantStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cvs-'));
    store = new CodeVariantStore(join(dir, 'variants.json'));
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('records and lists round-trip', () => {
    expect(store.list()).toEqual([]);
    store.record(rec({ id: 'v1', score: 0.9 }));
    store.record(rec({ id: 'v2', score: 0.95 }));
    expect(store.list().map((v) => v.id)).toEqual(['v1', 'v2']);
  });

  it('best() picks highest passing, no-regression, above-baseline variant', () => {
    store.record(rec({ id: 'good-lo', score: 0.85 }));
    store.record(rec({ id: 'good-hi', score: 0.95 }));
    store.record(rec({ id: 'failed', score: 0.99, passedAll: false }));
    store.record(rec({ id: 'regressed', score: 0.99, regressions: ['unit-tests'] }));
    store.record(rec({ id: 'below', score: 0.70 }));
    const best = store.best({ baselineScore: 0.8 });
    expect(best?.id).toBe('good-hi');
  });

  it('best() returns null when nothing beats the baseline', () => {
    store.record(rec({ id: 'a', score: 0.5 }));
    expect(store.best({ baselineScore: 0.9 })).toBeNull();
  });

  it('best() breaks ties by most recent', () => {
    store.record(rec({ id: 'older', score: 0.9, createdAt: '2026-06-01T00:00:00.000Z' }));
    store.record(rec({ id: 'newer', score: 0.9, createdAt: '2026-06-29T00:00:00.000Z' }));
    expect(store.best()?.id).toBe('newer');
  });

  it('best() rejects a failed/regressed even if highest score', () => {
    store.record(rec({ id: 'top-but-failed', score: 1.0, passedAll: false }));
    store.record(rec({ id: 'clean', score: 0.6 }));
    expect(store.best()?.id).toBe('clean');
  });
});

describe('behaviorDescriptor (MAP-Elites niche)', () => {
  it('derives dominant area + breadth bucket', () => {
    expect(behaviorDescriptor(['src/agent/x.ts'])).toBe('src/agent:single');
    expect(behaviorDescriptor(['src/agent/x.ts', 'src/agent/y.ts'])).toBe('src/agent:small');
    expect(behaviorDescriptor(['src/agent/a.ts', 'src/agent/b.ts', 'src/tools/c.ts'])).toBe('src/agent:small');
    expect(behaviorDescriptor(['a.ts', 'b.ts', 'c.ts', 'd.ts'])).toContain(':broad');
    expect(behaviorDescriptor([])).toBe('none');
  });
});

describe('diverseElites (one best per niche → diversity)', () => {
  it('keeps the best per niche, top-k niches, respecting eligibility', () => {
    const recs: VariantRecord[] = [
      rec({ id: 'agent-lo', score: 0.9, behavior: 'src/agent:single' }),
      rec({ id: 'agent-hi', score: 0.95, behavior: 'src/agent:single' }), // same niche, higher → wins niche
      rec({ id: 'tools', score: 0.8, behavior: 'src/tools:single' }),
      rec({ id: 'ui-failed', score: 0.99, passedAll: false, behavior: 'src/ui:broad' }), // excluded
      rec({ id: 'below', score: 0.4, behavior: 'src/db:single' }), // below baseline
    ];
    const elites = diverseElites(recs, 3, 0.5);
    expect(elites.map((e) => e.id)).toEqual(['agent-hi', 'tools']); // 2 distinct eligible niches
  });

  it('caps at k niches by score', () => {
    const recs: VariantRecord[] = [
      rec({ id: 'a', score: 0.9, behavior: 'src/a:single' }),
      rec({ id: 'b', score: 0.8, behavior: 'src/b:single' }),
      rec({ id: 'c', score: 0.7, behavior: 'src/c:single' }),
    ];
    expect(diverseElites(recs, 2).map((e) => e.id)).toEqual(['a', 'b']);
  });
});
