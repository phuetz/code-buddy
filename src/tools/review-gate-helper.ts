/**
 * Shared speculative-validation and diff-review hook for file-editing tools.
 * Both feature module graphs are lazy: with their env gates off this helper
 * preserves the legacy path without instantiating or importing either gate.
 *
 * Contract: call AFTER the tool's own user confirmation (the review
 * complements the human gate, never replaces it) with the FULL resulting
 * content. `gated: false` → the tool performs its legacy write itself;
 * `gated: true` → the review transaction already wrote (or refused) —
 * the tool must NOT write again.
 *
 * @module tools/review-gate-helper
 */

import * as path from 'path';
import { logger } from '../utils/logger.js';

interface GatedWriteRequestBase {
  baseDirectory: string;
  intent: string;
  originLabel: string;
}

interface SingleGatedWriteRequest extends GatedWriteRequestBase {
  resolvedPath: string;
  /** The user-facing path, for error messages. */
  displayPath: string;
  newContent: string;
}

interface BatchGatedWriteRequest extends GatedWriteRequestBase {
  changes: Array<{ path: string; newContent: string | null }>;
}

export type GatedWriteRequest = SingleGatedWriteRequest | BatchGatedWriteRequest;

export type GatedWriteResult =
  | { gated: false }
  | { gated: true; ok: true; summary: string }
  | { gated: true; ok: false; error: string };

export async function maybeReviewGatedWrite(req: GatedWriteRequest): Promise<GatedWriteResult> {
  const mode = (process.env.CODEBUDDY_DIFF_REVIEW ?? 'off').toLowerCase();
  const reviewEnabled = mode === 'static' || mode === 'full';
  const shadowEnabled = process.env.CODEBUDDY_SHADOW_WORKSPACE === 'true';
  if (!reviewEnabled && !shadowEnabled) return { gated: false };

  const changes = 'changes' in req
    ? req.changes
    : [{ path: path.relative(req.baseDirectory, req.resolvedPath), newContent: req.newContent }];
  const normalizedChanges: Array<{ path: string; newContent: string | null }> = [];
  for (const change of changes) {
    const resolved = path.resolve(req.baseDirectory, change.path);
    const rel = path.relative(path.resolve(req.baseDirectory), resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      const displayPath = 'displayPath' in req ? req.displayPath : change.path;
      return {
        gated: true,
        ok: false,
        error: `review gate: ${displayPath} resolves outside the base directory — gated writes only cover project files (fail-closed, nothing written)`,
      };
    }
    normalizedChanges.push({ path: rel.split(path.sep).join('/'), newContent: change.newContent });
  }

  if (shadowEnabled) {
    try {
      // The dynamic import is load-bearing: absent/false must instantiate
      // nothing and leave every legacy write path unchanged.
      const { getShadowWorkspace } = await import('../speculative/shadow-workspace.js');
      const result = await getShadowWorkspace(req.baseDirectory).runSpeculative(
        normalizedChanges.map((change) => ({ path: change.path, content: change.newContent })),
      );
      if (result.unavailable) {
        logger.warn('Shadow validation unavailable; continuing with the real write', {
          cwd: req.baseDirectory,
          detail: result.stdoutTail,
        });
      } else if (!result.ok) {
        const detail = result.stdoutTail || `validation command exited with code ${String(result.exitCode)}`;
        return {
          gated: true,
          ok: false,
          error: `shadow validation failed — nothing applied\n${detail}`,
        };
      }
    } catch (error) {
      // Infrastructure must always fail open. Validation failures are normal
      // results above and remain blocking; only unexpected shadow faults land here.
      logger.warn('Shadow validation crashed; continuing with the real write', {
        cwd: req.baseDirectory,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!reviewEnabled) return { gated: false };

  const { reviewGatedWrite } = await import('../review/write-gate.js');
  const outcome = await reviewGatedWrite(
    {
      changes: normalizedChanges,
      cwd: req.baseDirectory,
      intent: req.intent,
      originLabel: req.originLabel,
    },
    { mode: mode as 'static' | 'full' },
  );
  return outcome.ok ? { gated: true, ok: true, summary: outcome.summary } : { gated: true, ok: false, error: outcome.summary };
}
