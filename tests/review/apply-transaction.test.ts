/**
 * Transactional apply — all-or-nothing with checkpoint rollback, TOCTOU
 * re-check at apply time, per-file partial apply on annotate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { buildProposedDiff } from '../../src/review/diff-model.js';
import { applyReviewedDiff, rollbackAppliedDiff } from '../../src/review/apply-transaction.js';
import { getCheckpointManager, resetCheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import type { ProposedDiff, ReviewVerdict } from '../../src/review/types.js';

let workDir: string;

beforeEach(() => {
  resetCheckpointManager();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-tx-'));
});

afterEach(() => {
  resetCheckpointManager();
  fs.rmSync(workDir, { recursive: true, force: true });
});

const ORIGIN = { kind: 'agent' as const, label: 't' };

function write(rel: string, content: string): void {
  const abs = path.join(workDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function read(rel: string): string {
  return fs.readFileSync(path.join(workDir, rel), 'utf-8');
}

function verdict(diff: ProposedDiff, over: Partial<ReviewVerdict> = {}): ReviewVerdict {
  return {
    diffId: diff.id,
    decision: 'accept',
    annotations: [],
    reviewers: [],
    conflicts: [],
    failClosed: false,
    mode: 'static',
    reviewedAt: '2026-07-02T00:00:00.000Z',
    ...over,
  };
}

describe('applyReviewedDiff', () => {
  it('applies an accepted diff (modify + create + delete) and reports a checkpoint', () => {
    write('a.ts', 'v1\n');
    write('dead.ts', 'obsolete\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [
        { path: 'a.ts', newContent: 'v2\n' },
        { path: 'sub/new.ts', newContent: 'fresh\n' },
        { path: 'dead.ts', newContent: null },
      ],
    });

    const report = applyReviewedDiff(diff, verdict(diff));

    expect(report.applied).toBe(true);
    expect(report.appliedFiles.sort()).toEqual(['a.ts', 'dead.ts', 'sub/new.ts']);
    expect(report.checkpointId).toBeTruthy();
    expect(read('a.ts')).toBe('v2\n');
    expect(read('sub/new.ts')).toBe('fresh\n');
    expect(fs.existsSync(path.join(workDir, 'dead.ts'))).toBe(false);
  });

  it('refuses a rejected verdict and an annotate verdict in atomic mode', () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [{ path: 'a.ts', newContent: 'v2\n' }],
    });

    const rejected = applyReviewedDiff(diff, verdict(diff, { decision: 'reject' }));
    expect(rejected.applied).toBe(false);
    expect(read('a.ts')).toBe('v1\n');

    const annotated = applyReviewedDiff(diff, verdict(diff, { decision: 'annotate' }));
    expect(annotated.applied).toBe(false);
    expect(annotated.errors[0]).toMatch(/annotate/);
    expect(read('a.ts')).toBe('v1\n');
  });

  it('per-file mode under annotate applies only the un-annotated files (partial review)', () => {
    write('clean.ts', 'v1\n');
    write('dirty.ts', 'v1\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [
        { path: 'clean.ts', newContent: 'v2\n' },
        { path: 'dirty.ts', newContent: 'v2\n' },
      ],
    });
    const v = verdict(diff, {
      decision: 'annotate',
      annotations: [{ path: 'dirty.ts', severity: 'warning', message: 'needs a revision' }],
    });

    const report = applyReviewedDiff(diff, v, { mode: 'per-file' });

    expect(report.applied).toBe(true);
    expect(report.appliedFiles).toEqual(['clean.ts']);
    expect(report.skippedFiles).toEqual(['dirty.ts']);
    expect(read('clean.ts')).toBe('v2\n');
    expect(read('dirty.ts')).toBe('v1\n');
  });

  it('re-checks conflicts at apply time (TOCTOU) — a stale base aborts atomically', () => {
    write('a.ts', 'v1\n');
    write('b.ts', 'v1\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [
        { path: 'a.ts', newContent: 'v2\n' },
        { path: 'b.ts', newContent: 'v2\n' },
      ],
    });
    // Someone else wins the race between review and apply.
    write('b.ts', 'raced\n');

    const report = applyReviewedDiff(diff, verdict(diff));

    expect(report.applied).toBe(false);
    expect(report.conflicts[0]!.kind).toBe('stale-base');
    expect(read('a.ts')).toBe('v1\n'); // nothing touched
    expect(read('b.ts')).toBe('raced\n');
  });

  it('rolls back EVERYTHING when a write fails mid-apply', () => {
    write('a.ts', 'v1\n');
    // `sub` is a regular FILE: creating sub/blocked.ts fails (ENOTDIR/ENOENT) on
    // every OS — unlike a chmod 0o555 directory, inert on Windows — and it is
    // NOT detectable as a conflict beforehand (the file is absent).
    write('sub', 'not a directory\n');
    {
      const diff = buildProposedDiff({
        workDir,
        intent: 'x',
        origin: ORIGIN,
        changes: [
          { path: 'a.ts', newContent: 'v2\n' },
          { path: 'sub/blocked.ts', newContent: 'boom\n' },
        ],
      });

      const report = applyReviewedDiff(diff, verdict(diff));

      expect(report.applied).toBe(false);
      expect(report.rolledBack).toBe(true);
      expect(report.errors[0]).toMatch(/rolled back cleanly/);
      expect(read('a.ts')).toBe('v1\n'); // the first write was undone
    }
  });

  it('rollbackAppliedDiff restores the pre-apply state (including created files)', () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [
        { path: 'a.ts', newContent: 'v2\n' },
        { path: 'new.ts', newContent: 'fresh\n' },
      ],
    });
    const report = applyReviewedDiff(diff, verdict(diff));
    expect(report.applied).toBe(true);

    const rollback = rollbackAppliedDiff(report.checkpointId!, getCheckpointManager());

    expect(rollback.success).toBe(true);
    expect(read('a.ts')).toBe('v1\n');
    expect(fs.existsSync(path.join(workDir, 'new.ts'))).toBe(false); // created file removed
  });

  it('throws on a verdict/diff id mismatch (caller contract)', () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [{ path: 'a.ts', newContent: 'v2\n' }],
    });
    const wrong = { ...verdict(diff), diffId: 'diff-other' };
    expect(() => applyReviewedDiff(diff, wrong)).toThrow(/does not match/);
  });
});
