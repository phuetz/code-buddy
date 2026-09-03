import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chooseCkgEngine,
  isCkgSnapshotLoadable,
  snapshotPathFor,
} from '../../src/memory/ckg-engine-policy.js';

const work = join(process.cwd(), '.gk6-work', 'ckg-engine-policy');

describe('CKG engine default policy (Phase 4)', () => {
  mkdirSync(work, { recursive: true });

  it('maps ledger path to the rust snapshot filename', () => {
    expect(snapshotPathFor('/x/ckg-ledger.jsonl')).toBe('/x/ckg-ledger.jsonl.snap');
  });

  it('treats a missing snapshot as loadable', () => {
    expect(isCkgSnapshotLoadable(join(work, 'no-such.snap'))).toBe(true);
  });

  it('accepts v1 and v2 snapshots and rejects corrupt or unknown versions', () => {
    const v2 = join(work, 'v2.snap');
    const v1 = join(work, 'v1.snap');
    const bad = join(work, 'bad.snap');
    const v9 = join(work, 'v9.snap');
    writeFileSync(v2, JSON.stringify({ version: 2, offset: 12, current: {} }));
    writeFileSync(v1, JSON.stringify({ version: 1, offset: 0 }));
    writeFileSync(bad, '{not-json');
    writeFileSync(v9, JSON.stringify({ version: 9, offset: 0 }));
    expect(isCkgSnapshotLoadable(v2)).toBe(true);
    expect(isCkgSnapshotLoadable(v1)).toBe(true);
    expect(isCkgSnapshotLoadable(bad)).toBe(false);
    expect(isCkgSnapshotLoadable(v9)).toBe(false);
  });

  it('defaults to rust only when the binary exists and the snapshot is loadable', () => {
    expect(chooseCkgEngine({ env: undefined, binaryPath: '/bin/buddy-memory', snapshotLoadable: true })).toBe('rust');
    expect(chooseCkgEngine({ env: 'auto', binaryPath: '/bin/buddy-memory', snapshotLoadable: true })).toBe('rust');
    expect(chooseCkgEngine({ env: '', binaryPath: '/bin/buddy-memory', snapshotLoadable: true })).toBe('rust');
    expect(chooseCkgEngine({ env: undefined, binaryPath: null, snapshotLoadable: true })).toBe('ts');
    expect(chooseCkgEngine({ env: 'auto', binaryPath: '/bin/buddy-memory', snapshotLoadable: false })).toBe('ts');
  });

  it('honours explicit rust/ts and still lets the caller fall back on error', () => {
    expect(chooseCkgEngine({ env: 'rust', binaryPath: null, snapshotLoadable: false })).toBe('rust');
    expect(chooseCkgEngine({ env: 'TS', binaryPath: '/bin/buddy-memory', snapshotLoadable: true })).toBe('ts');
    expect(chooseCkgEngine({ env: 'off', binaryPath: '/bin/buddy-memory', snapshotLoadable: true })).toBe('ts');
    expect(chooseCkgEngine({ env: 'false', binaryPath: '/bin/buddy-memory', snapshotLoadable: true })).toBe('ts');
  });
});
