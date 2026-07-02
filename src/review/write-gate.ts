/**
 * Write gate — the shared review entry for every gated write flow
 * (apply_patch, create_file and its write_file alias).
 *
 * Takes resolved FULL before/after content, routes it through
 * `reviewAndApply` (review → transactional apply → audit ledger) and formats
 * the verdict FOR THE AGENT: a reject/annotate comes back as an actionable
 * message carrying the line-anchored annotations so the proposer can revise —
 * never a silent loss.
 *
 * In `full` mode with no injected client, a default reviewer is resolved from
 * the active-LLM pool (dead models skipped via the scoreboard); none
 * available → the engine fails closed.
 *
 * @module review/write-gate
 */

import { reviewAndApply, type ReviewAndApplyResult } from './review-engine.js';
import { resolveDefaultReviewClient } from './llm-client.js';
import { reviewApplyWithRevisions, type RevisionRound } from './revision-loop.js';
import type { CouncilChatClient } from '../council/types.js';
import type { ApplyMode, ReviewAnnotation, ReviewMode } from './types.js';
import type { ProposedChangeInput } from './diff-model.js';

export interface ReviewGatedWriteInput {
  changes: ProposedChangeInput[];
  cwd: string;
  intent: string;
  /** Producer label journaled in the ledger (default 'agent-write'). */
  originLabel?: string;
}

export interface ReviewGatedWriteDeps {
  mode: Exclude<ReviewMode, 'off'>;
  /** Injected reviewer client; undefined in `full` mode → resolved from the pool; null → fail-closed. */
  client?: CouncilChatClient | null;
  timeoutMs?: number;
  applyMode?: ApplyMode;
  /** Automatic revision loop overrides (default from CODEBUDDY_DIFF_REVIEW_REVISE). */
  revision?: {
    enabled?: boolean;
    maxRounds?: number;
    /** Reviser client; undefined → the reviewer client (or pool default); null → revision skipped. */
    client?: CouncilChatClient | null;
  };
}

/**
 * Env gate for the automatic revision loop (default off — repo convention):
 * CODEBUDDY_DIFF_REVIEW_REVISE=true enables it, CODEBUDDY_DIFF_REVIEW_REVISE_ROUNDS
 * bounds the rounds (default 2).
 */
export function resolveRevisionConfig(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; maxRounds: number } {
  const enabled = env.CODEBUDDY_DIFF_REVIEW_REVISE === 'true';
  const raw = Number(env.CODEBUDDY_DIFF_REVIEW_REVISE_ROUNDS);
  const maxRounds = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 2;
  return { enabled, maxRounds };
}

export interface ReviewGatedWriteOutcome {
  ok: boolean;
  summary: string;
}

export function formatReviewAnnotations(annotations: ReviewAnnotation[]): string {
  return annotations
    .map((a) => {
      const anchor = a.line ? `${a.path}:${a.line}` : a.path;
      const fix = a.suggestedFix ? ` (fix: ${a.suggestedFix})` : '';
      return `  [${a.severity}] ${anchor} — ${a.message}${fix}`;
    })
    .join('\n');
}

export async function reviewGatedWrite(
  input: ReviewGatedWriteInput,
  deps: ReviewGatedWriteDeps,
): Promise<ReviewGatedWriteOutcome> {
  const client =
    deps.mode === 'full' ? (deps.client !== undefined ? deps.client : await resolveDefaultReviewClient()) : null;

  const buildInput = {
    workDir: input.cwd,
    intent: input.intent,
    origin: { kind: 'agent' as const, label: input.originLabel ?? 'agent-write' },
    changes: input.changes,
  };
  const engineDeps = {
    mode: deps.mode,
    client,
    ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
  };
  const applyOpts = { ...(deps.applyMode !== undefined ? { mode: deps.applyMode } : {}) };

  // Automatic revision loop (opt-in): a revisable verdict is handed to a
  // reviser LLM with the annotations, and the revised diff re-enters the SAME
  // gate. No reviser available → plain single-shot review (never a harder
  // failure than the review itself).
  const revisionConfig = resolveRevisionConfig();
  const revisionEnabled = deps.revision?.enabled ?? revisionConfig.enabled;
  let result: ReviewAndApplyResult;
  let rounds: RevisionRound[] | null = null;
  let reviserClient: CouncilChatClient | null = null;
  if (revisionEnabled) {
    reviserClient =
      deps.revision?.client !== undefined
        ? deps.revision.client
        : (client ?? (await resolveDefaultReviewClient()));
  }
  if (revisionEnabled && reviserClient) {
    const loop = await reviewApplyWithRevisions(buildInput, engineDeps, applyOpts, {
      client: reviserClient,
      maxRounds: deps.revision?.maxRounds ?? revisionConfig.maxRounds,
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    });
    result = loop.final;
    rounds = loop.revised ? loop.rounds : null;
  } else {
    result = await reviewAndApply(buildInput, engineDeps, applyOpts);
  }

  const { verdict, apply } = result;
  const reviewers = verdict.reviewers.map((r) => r.reviewer).join(', ');
  const revisionCount = rounds ? rounds.length - 1 : 0;
  const revisionSuffix = revisionCount > 0 ? ` after ${revisionCount} revision round${revisionCount > 1 ? 's' : ''}` : '';
  const revisionNotes =
    rounds
      ?.filter((r) => r.reviserNote)
      .map((r, i) => `  revision ${i + 1}: ${r.reviserNote}`)
      .join('\n') ?? '';

  if (verdict.decision === 'accept' && apply?.applied) {
    const lines = [
      `review accepted${revisionSuffix} (${verdict.mode}: ${reviewers}) — applied: ${apply.appliedFiles.join(', ')}`,
    ];
    if (revisionNotes) lines.push(revisionNotes);
    const suggestions = verdict.annotations.filter((a) => a.severity === 'suggestion');
    if (suggestions.length > 0) {
      lines.push('non-blocking suggestions:', formatReviewAnnotations(suggestions));
    }
    return { ok: true, summary: lines.join('\n') };
  }

  if (verdict.decision === 'accept' && apply && !apply.applied) {
    // Accepted but the transaction refused (apply-time conflict) or failed (rolled back).
    const lines = [
      `review accepted${revisionSuffix} but apply ${apply.rolledBack ? 'failed and was rolled back' : 'aborted'}:`,
      ...apply.errors.map((e) => `  ${e}`),
      ...apply.conflicts.map((c) => `  [conflict] ${c.path}: ${c.kind} — ${c.detail}`),
      'Nothing was left half-applied. Re-read the files and re-propose against the current base.',
    ];
    return { ok: false, summary: lines.join('\n') };
  }

  const header = verdict.failClosed
    ? `review UNAVAILABLE (${verdict.mode}) — fail-closed, nothing applied. Retry later or run with CODEBUDDY_DIFF_REVIEW=static.`
    : verdict.decision === 'reject'
      ? `review REJECTED the change${revisionSuffix} (${verdict.mode}: ${reviewers}) — nothing applied.`
      : `review requests changes${revisionSuffix} (${verdict.mode}: ${reviewers}) — nothing applied. Revise to address the annotations, then retry.`;

  return {
    ok: false,
    summary: [header, revisionNotes, formatReviewAnnotations(verdict.annotations)].filter(Boolean).join('\n'),
  };
}
