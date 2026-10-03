/**
 * Transactional apply — an ACCEPTED diff lands all-or-nothing.
 *
 * Reuses the primary CheckpointManager (two-phase atomic `rewindTo`): every
 * touched path is snapshotted BEFORE the first write; any write failure rolls
 * the whole batch back (in per-file mode too — a partially-applied invocation
 * is never left on disk). Conflicts are re-checked at apply time (TOCTOU):
 * a base that changed between review and apply aborts before any write.
 *
 * Verdict contract:
 *  - `accept`   → apply everything.
 *  - `annotate` → atomic mode applies NOTHING; per-file mode applies only the
 *                 files carrying no blocker/warning annotation (partial apply,
 *                 explicit and reported).
 *  - `reject`   → applies nothing, ever.
 *
 * @module review/apply-transaction
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import { assertCreationWithinBase, createFileExclusive } from '../services/vfs/exclusive-create.js';
import { getCheckpointManager, type Checkpoint } from '../checkpoints/checkpoint-manager.js';
import { detectConflicts } from './diff-model.js';
import type { ApplyMode, ApplyReport, ProposedDiff, ReviewVerdict } from './types.js';

/** Structural slice of CheckpointManager the transaction needs — injectable in tests. */
export interface ApplyCheckpointHost {
  createCheckpoint(description: string, files?: string[]): Checkpoint;
  rewindTo(checkpointId: string): { success: boolean; restored: string[]; errors: string[] };
}

export interface ApplyOptions {
  mode?: ApplyMode;
  checkpoints?: ApplyCheckpointHost;
}

export function applyReviewedDiff(
  diff: ProposedDiff,
  verdict: ReviewVerdict,
  opts: ApplyOptions = {},
): ApplyReport {
  if (verdict.diffId !== diff.id) {
    throw new Error(`verdict ${verdict.diffId} does not match diff ${diff.id}`);
  }
  const mode = opts.mode ?? 'atomic';
  const report: ApplyReport = {
    diffId: diff.id,
    applied: false,
    appliedFiles: [],
    skippedFiles: [],
    checkpointId: null,
    rolledBack: false,
    conflicts: [],
    errors: [],
  };

  if (verdict.decision === 'reject') {
    report.errors.push('verdict is reject — nothing applied');
    report.skippedFiles = diff.files.map((f) => f.path);
    return report;
  }

  // Which files may land under this verdict?
  const annotatedPaths = new Set(
    verdict.annotations.filter((a) => a.severity !== 'suggestion').map((a) => a.path),
  );
  let candidates = diff.files;
  if (verdict.decision === 'annotate') {
    if (mode === 'atomic') {
      report.errors.push('verdict is annotate — atomic mode applies nothing until the diff is revised');
      report.skippedFiles = diff.files.map((f) => f.path);
      return report;
    }
    candidates = diff.files.filter((f) => !annotatedPaths.has(f.path));
    report.skippedFiles = diff.files.filter((f) => annotatedPaths.has(f.path)).map((f) => f.path);
    if (candidates.length === 0) {
      report.errors.push('every file carries blocking annotations — nothing to apply');
      return report;
    }
  }

  // TOCTOU: the tree may have moved since the review — re-check now.
  const conflicts = detectConflicts({ ...diff, files: candidates });
  if (conflicts.length > 0) {
    if (mode === 'atomic') {
      report.conflicts = conflicts;
      report.errors.push('conflicts detected at apply time — nothing applied (re-propose on the current base)');
      report.skippedFiles = diff.files.map((f) => f.path);
      return report;
    }
    const conflicted = new Set(conflicts.map((c) => c.path));
    report.conflicts = conflicts;
    report.skippedFiles.push(...candidates.filter((f) => conflicted.has(f.path)).map((f) => f.path));
    candidates = candidates.filter((f) => !conflicted.has(f.path));
    if (candidates.length === 0) {
      report.errors.push('every remaining file conflicts — nothing applied');
      return report;
    }
  }

  // Snapshot BEFORE the first write, then all-or-nothing.
  const checkpoints = opts.checkpoints ?? getCheckpointManager();
  const absolutePaths = candidates.filter(f => f.action !== 'create').map((f) => path.join(diff.workDir, f.path));
  const checkpoint = checkpoints.createCheckpoint(`diff-review apply ${diff.id}`, absolutePaths);
  report.checkpointId = checkpoint.id;

  // Do not snapshot creations: an entry racing the snapshot must never be
  // read (possibly a credential link) or restored over the concurrent writer.
  const created = new Map<string, { dev: number; ino: number }>();
  try {
    for (const file of candidates) {
      const abs = path.join(diff.workDir, file.path);
      if (file.newContent === null) {
        fs.rmSync(abs);
      } else {
        if (file.action === 'create') assertCreationWithinBase(abs, diff.workDir);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (file.action === 'create') {
          const identity = createFileExclusive(abs, file.newContent, 'utf8', () => {
            assertCreationWithinBase(abs, diff.workDir);
            const validation = UnifiedVfsRouter.Instance.resolvePath(abs, diff.workDir, 'write');
            if (!validation.valid) throw new Error(validation.error ?? 'Creation path refused');
          });
          created.set(abs, identity);
          checkpoint.files.push({ path: abs, content: '', existed: false });
        } else {
          fs.writeFileSync(abs, file.newContent, 'utf-8');
        }
      }
      report.appliedFiles.push(file.path);
    }
    report.applied = true;
    return report;
  } catch (err) {
    // A failed exclusive publication never owns the competing entry. Only
    // successful creations still pointing at our inode may be rolled back.
    checkpoint.files = checkpoint.files.filter(snapshot => {
      const identity = created.get(snapshot.path);
      if (!identity) return true;
      try {
        const current = fs.lstatSync(snapshot.path);
        return current.dev === identity.dev && current.ino === identity.ino;
      } catch { return false; }
    });
    const rollback = checkpoints.rewindTo(checkpoint.id);
    report.rolledBack = rollback.success;
    report.applied = false;
    report.appliedFiles = [];
    report.skippedFiles = diff.files.map((f) => f.path);
    report.errors.push(
      `apply failed (${err instanceof Error ? err.message : String(err)}) — ` +
        (rollback.success ? 'rolled back cleanly' : `ROLLBACK INCOMPLETE: ${rollback.errors.join('; ')}`),
    );
    return report;
  }
}

/** Undo a previously applied diff (two-phase atomic restore via the checkpoint). */
export function rollbackAppliedDiff(
  checkpointId: string,
  checkpoints: ApplyCheckpointHost = getCheckpointManager(),
): { success: boolean; restored: string[]; errors: string[] } {
  return checkpoints.rewindTo(checkpointId);
}
