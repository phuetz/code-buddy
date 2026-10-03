/**
 * Diff model — build a ProposedDiff from full before/after content, hash the
 * base for staleness detection, and detect conflicts against the CURRENT
 * working tree (the same check runs at review time AND again at apply time,
 * so a file modified between the two is caught — TOCTOU).
 *
 * The producer supplies FULL resulting content per file (never fragments):
 * fragment-level edits (str_replace) must be resolved to full content by the
 * tool that owns the matching cascade before proposing — this module never
 * guesses what a fragment means.
 *
 * @module review/diff-model
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  generateCreationDiff,
  generateDeletionDiff,
  generateDiffFromStrings,
} from '../utils/diff-generator.js';
import type { DiffConflict, ProposedDiff, ProposedFileChange } from './types.js';

/** Repo-wide convention: sha256 hex, first 16 chars. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export interface ProposedChangeInput {
  /** Path relative to workDir. */
  path: string;
  /** Full resulting content; null/undefined means DELETE the file. */
  newContent: string | null;
  /** Creation cannot become a modification when another writer wins the race. */
  createOnly?: boolean;
}

export interface BuildProposedDiffInput {
  workDir: string;
  intent: string;
  origin: ProposedDiff['origin'];
  changes: ProposedChangeInput[];
  /** Injectable clock (id + createdAt) for deterministic tests. */
  now?: () => Date;
}

/** Reject absolute paths and workDir escapes — contract violation, throws. */
function normalizeRelativePath(workDir: string, p: string): string {
  if (path.isAbsolute(p)) {
    throw new Error(`diff path must be relative to workDir: ${p}`);
  }
  const resolved = path.resolve(workDir, p);
  const rel = path.relative(path.resolve(workDir), resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`diff path escapes workDir: ${p}`);
  }
  return rel.split(path.sep).join('/');
}

export function buildProposedDiff(input: BuildProposedDiffInput): ProposedDiff {
  if (!input.changes.length) {
    throw new Error('a proposed diff needs at least one file change');
  }
  const at = (input.now?.() ?? new Date()).toISOString();
  const files: ProposedFileChange[] = input.changes.map((change) => {
    const rel = normalizeRelativePath(input.workDir, change.path);
    const abs = path.join(input.workDir, rel);
    if (change.createOnly && change.newContent === null) {
      throw new Error(`creation-only diff cannot delete: ${rel}`);
    }
    const exists = !change.createOnly && fs.existsSync(abs);
    const baseContent = exists ? fs.readFileSync(abs, 'utf-8') : null;
    const newContent = change.newContent ?? null;
    const action: ProposedFileChange['action'] =
      newContent === null ? 'delete' : exists ? 'modify' : 'create';
    return {
      path: rel,
      action,
      baseContent,
      baseHash: baseContent !== null ? hashContent(baseContent) : null,
      newContent,
    };
  });

  const seed = files.map((f) => `${f.path}:${f.baseHash ?? '∅'}:${f.newContent !== null ? hashContent(f.newContent) : '∅'}`).join('|');
  return {
    id: `diff-${hashContent(`${at}|${input.intent}|${seed}`)}`,
    createdAt: at,
    workDir: path.resolve(input.workDir),
    origin: input.origin,
    intent: input.intent,
    files,
  };
}

/**
 * Compare the diff's captured base against the CURRENT working tree.
 * Run at review time and re-run at apply time (staleness can appear between
 * the two — e.g. another agent wrote the same file meanwhile).
 */
export function detectConflicts(diff: ProposedDiff): DiffConflict[] {
  const conflicts: DiffConflict[] = [];
  const seen = new Set<string>();

  for (const file of diff.files) {
    if (seen.has(file.path)) {
      conflicts.push({
        path: file.path,
        kind: 'duplicate-path',
        detail: 'the same path appears more than once in this diff',
      });
      continue;
    }
    seen.add(file.path);

    const abs = path.join(diff.workDir, file.path);
    let exists = false;
    try { fs.lstatSync(abs); exists = true; } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }

    if (file.action === 'create') {
      if (exists) {
        conflicts.push({
          path: file.path,
          kind: 'unexpected-existing',
          detail: 'file was created by someone else since the diff was proposed',
        });
      }
      continue;
    }

    // modify / delete need the base to still be there and unchanged.
    if (!exists) {
      conflicts.push({
        path: file.path,
        kind: 'missing-file',
        detail: 'base file disappeared since the diff was proposed',
      });
      continue;
    }
    const currentHash = hashContent(fs.readFileSync(abs, 'utf-8'));
    if (file.baseHash !== null && currentHash !== file.baseHash) {
      conflicts.push({
        path: file.path,
        kind: 'stale-base',
        detail: `base changed since proposal (expected ${file.baseHash}, found ${currentHash})`,
      });
    }
  }
  return conflicts;
}

/** Human/LLM-readable unified preview of one change (reviewers see this). */
export function renderUnifiedPreview(change: ProposedFileChange): string {
  if (change.action === 'create') {
    return generateCreationDiff(change.newContent ?? '', change.path);
  }
  if (change.action === 'delete') {
    return generateDeletionDiff(change.baseContent ?? '', change.path);
  }
  return generateDiffFromStrings(change.baseContent ?? '', change.newContent ?? '', change.path);
}
