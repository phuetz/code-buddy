/**
 * Shared diff-review hook for file-editing tools (create_file/write_file,
 * str_replace, multi_edit) — ONE place for the gate plumbing every editing
 * tool repeats: inlined env check (the off path must not load the review
 * module graph — lazy-loading is load-bearing in this repo; keep in sync
 * with resolveReviewMode() in src/review/review-engine.ts), fail-closed on
 * paths outside the base directory (no ungated escape hatch), and the lazy
 * import of the gate itself.
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

export interface GatedWriteRequest {
  baseDirectory: string;
  resolvedPath: string;
  /** The user-facing path, for error messages. */
  displayPath: string;
  newContent: string;
  intent: string;
  originLabel: string;
}

export type GatedWriteResult =
  | { gated: false }
  | { gated: true; ok: true; summary: string }
  | { gated: true; ok: false; error: string };

export async function maybeReviewGatedWrite(req: GatedWriteRequest): Promise<GatedWriteResult> {
  const mode = (process.env.CODEBUDDY_DIFF_REVIEW ?? 'off').toLowerCase();
  if (mode !== 'static' && mode !== 'full') return { gated: false };

  const rel = path.relative(req.baseDirectory, req.resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      gated: true,
      ok: false,
      error: `review gate: ${req.displayPath} resolves outside the base directory — gated writes only cover project files (fail-closed, nothing written)`,
    };
  }

  const { reviewGatedWrite } = await import('../review/write-gate.js');
  const outcome = await reviewGatedWrite(
    {
      changes: [{ path: rel.split(path.sep).join('/'), newContent: req.newContent }],
      cwd: req.baseDirectory,
      intent: req.intent,
      originLabel: req.originLabel,
    },
    { mode },
  );
  return outcome.ok ? { gated: true, ok: true, summary: outcome.summary } : { gated: true, ok: false, error: outcome.summary };
}
