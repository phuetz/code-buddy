/**
 * AI-Scientist-lite Phase 1 — experiment variant store tests.
 *
 * Append-only round-trip: record a scored variant (with its metric + parentId
 * lineage) and read it back. The store writes to an INJECTED tmp path (never the
 * default `.codebuddy/` path), and the timestamp is INJECTED by the caller (the
 * store never calls Date.now()).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import {
  ExperimentVariantStore,
  type ExperimentVariantRecord,
} from '../../../src/agent/science/experiment-variant-store.js';

function makeRecord(over: Partial<ExperimentVariantRecord> = {}): ExperimentVariantRecord {
  return {
    id: 'v1',
    hypothesis: 'focal loss improves minority recall',
    code: 'print("recall=0.80")',
    language: 'python',
    executionResult: {
      ok: true,
      exitCode: 0,
      timedOut: false,
      runId: 'run-1',
      runDir: '/experiments/exp-1',
      durationMs: 1200,
    },
    metric: { name: 'recall', value: 0.8, score: 0.8, detail: 'recall=0.8' },
    score: 0.8,
    passedAll: true,
    regressions: [],
    kept: false,
    createdAt: '2026-07-04T10:00:00.000Z',
    ...over,
  };
}

describe('ExperimentVariantStore', () => {
  let dir: string;
  let storePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exp-variant-store-'));
    storePath = join(dir, 'nested', 'experiment-variants.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('records and reads back a variant with its metric', () => {
    const store = new ExperimentVariantStore(storePath);
    expect(store.list()).toEqual([]);

    store.record(makeRecord());
    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe('v1');
    expect(all[0]!.metric.name).toBe('recall');
    expect(all[0]!.metric.value).toBeCloseTo(0.8);
    expect(all[0]!.executionResult.runDir).toBe('/experiments/exp-1');
    expect(all[0]!.createdAt).toBe('2026-07-04T10:00:00.000Z');
  });

  it('is append-only and preserves parentId lineage', () => {
    const store = new ExperimentVariantStore(storePath);
    store.record(makeRecord({ id: 'root', createdAt: '2026-07-04T10:00:00.000Z' }));
    store.record(
      makeRecord({ id: 'child', parentId: 'root', score: 0.9, createdAt: '2026-07-04T11:00:00.000Z' }),
    );

    const all = store.list();
    expect(all.map((v) => v.id)).toEqual(['root', 'child']);
    const child = store.get('child');
    expect(child?.parentId).toBe('root');
    expect(store.get('missing')).toBeNull();
  });

  it('best() picks the highest passing, no-regression variant above baseline', () => {
    const store = new ExperimentVariantStore(storePath);
    store.record(makeRecord({ id: 'a', score: 0.6 }));
    store.record(makeRecord({ id: 'b', score: 0.85 }));
    store.record(makeRecord({ id: 'c', score: 0.95, regressions: ['metric'] })); // rejected: regressed
    store.record(makeRecord({ id: 'd', score: 0.9, passedAll: false })); // rejected: not passedAll

    const best = store.best({ baselineScore: 0.7 });
    expect(best?.id).toBe('b');
  });

  it('best({ requireKept }) only considers kept variants', () => {
    const store = new ExperimentVariantStore(storePath);
    store.record(makeRecord({ id: 'a', score: 0.9, kept: false }));
    store.record(makeRecord({ id: 'b', score: 0.8, kept: true }));
    expect(store.best({ requireKept: true })?.id).toBe('b');
    expect(store.best({ requireKept: false })?.id).toBe('a');
  });

  it('survives a corrupt store file (never throws, returns [])', () => {
    const store = new ExperimentVariantStore(storePath);
    store.record(makeRecord());
    // Corrupt it.
    writeFileSync(storePath, '{ not valid json');
    expect(store.list()).toEqual([]);
  });

  // ── F7: record() is a TRUE append (JSONL), not a full read-modify-write ───────
  it('appends without rewriting prior records (no concurrent clobber)', () => {
    const store = new ExperimentVariantStore(storePath);
    store.record(makeRecord({ id: 'a', createdAt: '2026-07-04T10:00:00.000Z' }));
    const after1 = readFileSync(storePath, 'utf8');
    store.record(makeRecord({ id: 'b', createdAt: '2026-07-04T11:00:00.000Z' }));
    const after2 = readFileSync(storePath, 'utf8');

    // Append-only: the second write STRICTLY appends — the first record's bytes
    // are untouched. A full rewrite (JSON.stringify(…,2)) would move them.
    expect(after2.startsWith(after1)).toBe(true);
    expect(after1.trimEnd().split('\n')).toHaveLength(1); // one JSON line per record
    expect(after2.trimEnd().split('\n')).toHaveLength(2);

    // Two independent store instances on the same path both see both records —
    // the last writer cannot erase the other's variant.
    expect(new ExperimentVariantStore(storePath).list().map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('reads back a legacy single-object store and migrates it to JSONL on append', () => {
    // Simulate a pre-existing store written by the OLD full-rewrite implementation.
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(
      storePath,
      JSON.stringify({ schemaVersion: 1, variants: [makeRecord({ id: 'legacy' })] }, null, 2),
    );
    const store = new ExperimentVariantStore(storePath);
    expect(store.list().map((v) => v.id)).toEqual(['legacy']); // legacy still readable

    store.record(makeRecord({ id: 'fresh', createdAt: '2026-07-04T12:00:00.000Z' }));
    // The legacy variant is preserved (migrated, not stranded) and the new one added.
    expect(store.list().map((v) => v.id)).toEqual(['legacy', 'fresh']);
    // Post-migration the file is JSONL (one line each), so further appends are pure.
    expect(readFileSync(storePath, 'utf8').trimEnd().split('\n')).toHaveLength(2);
  });
});
