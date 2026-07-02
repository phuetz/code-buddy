/**
 * Automatic revision loop — closes the review cycle: a diff that comes back
 * `annotate` (or rejected on MERIT with actionable blockers) is handed to a
 * reviser LLM together with the annotations; the revised diff goes through
 * the SAME gate again, up to a bounded number of rounds.
 *
 * Fail-closed at every link: a reviser that times out, answers prose, or
 * whose output cannot be constrained stops the loop — the caller gets the
 * last honest verdict, never an unreviewed write. Not revisable by design:
 * `failClosed` verdicts (nothing to revise from — the review itself was
 * unavailable) and conflicts (a stale base needs re-proposal against the
 * current tree, not annotation-fixing).
 *
 * Guard rails on the reviser output: it may only touch the ORIGINAL diff's
 * paths (extra paths are dropped and reported — a revision must narrow, not
 * expand, the blast radius), and every round is journaled to the audit
 * ledger by the underlying reviewAndApply.
 *
 * @module review/revision-loop
 */

import { withTimeout } from '../council/with-timeout.js';
import type { CouncilChatClient } from '../council/types.js';
import { reviewAndApply, type ReviewAndApplyResult } from './review-engine.js';
import type { BuildProposedDiffInput, ProposedChangeInput } from './diff-model.js';
import type { ApplyOptions } from './apply-transaction.js';
import type {
  ProposedDiff,
  ReviewAnnotation,
  ReviewDecision,
  ReviewEngineDeps,
  ReviewVerdict,
} from './types.js';

const DEFAULT_MAX_ROUNDS = 2;
const DEFAULT_REVISER_TIMEOUT_MS = 90_000;
/** Beyond this per-file size the reviser must return full content — skip revision instead of truncating. */
const MAX_REVISABLE_FILE_CHARS = 20_000;

interface ReviserJson {
  files?: Array<{ path?: string; newContent?: string | null }>;
  note?: string;
}

/** Two-stage strict-JSON parse (same discipline as judge/reviewers). */
function extractReviserJson(text: string): ReviserJson | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as ReviserJson;
  } catch {
    /* not pure JSON */
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]) as ReviserJson;
    } catch {
      /* salvage failed */
    }
  }
  return null;
}

export function buildRevisionPrompt(diff: ProposedDiff, verdict: ReviewVerdict): { system: string; user: string } {
  const system =
    'You are the reviser of Code Buddy\'s diff-review gate. A proposed file modification was ' +
    'reviewed and came back with annotations; produce a REVISED version that addresses every ' +
    'blocker and warning while still achieving the original intent. ' +
    'Rules: change ONLY what the annotations require; keep the rest of each file byte-identical; ' +
    'you may only touch the files listed below (never add new ones); if an annotation asks to drop ' +
    'a file from the change, return it with "newContent": "KEEP-BASE". ' +
    'Return STRICT JSON and nothing else: ' +
    '{"files":[{"path":"<one of the listed paths>","newContent":"full revised file content, or null to delete, or KEEP-BASE to withdraw the change"}],"note":"one sentence on what you changed"}. ' +
    'Every listed file must appear in your output.';

  const annotations = verdict.annotations
    .filter((a) => a.severity !== 'suggestion')
    .map((a) => {
      const anchor = a.line ? `${a.path}:${a.line}` : a.path;
      const fix = a.suggestedFix ? ` | suggested fix: ${a.suggestedFix}` : '';
      return `- [${a.severity}] ${anchor} — ${a.message}${fix}`;
    })
    .join('\n');

  const files = diff.files
    .map((f) => {
      if (f.newContent === null) return `### ${f.path} (proposed action: DELETE the file)`;
      return `### ${f.path} (${f.action}) — full proposed content:\n\`\`\`\n${f.newContent}\n\`\`\``;
    })
    .join('\n\n');

  const user =
    `ORIGINAL INTENT:\n${diff.intent}\n\nREVIEW ANNOTATIONS TO ADDRESS:\n${annotations}\n\n` +
    `PROPOSED FILES:\n${files}\n\nReturn the revised JSON now.`;
  return { system, user };
}

export interface RevisionAttempt {
  changes: ProposedChangeInput[];
  note: string;
  /** Paths the reviser tried to add outside the original set (dropped). */
  droppedPaths: string[];
}

/**
 * Ask the reviser for a corrected change set. Returns null (fail-closed) on
 * timeout / non-JSON / empty usable output — the loop stops honestly.
 */
export async function reviseProposedDiff(
  client: CouncilChatClient,
  diff: ProposedDiff,
  verdict: ReviewVerdict,
  timeoutMs: number = DEFAULT_REVISER_TIMEOUT_MS,
): Promise<RevisionAttempt | null> {
  if (diff.files.some((f) => (f.newContent?.length ?? 0) > MAX_REVISABLE_FILE_CHARS)) {
    return null; // full-content revision would risk truncation — fail closed
  }
  const prompt = buildRevisionPrompt(diff, verdict);
  let content: string;
  try {
    const resp = await withTimeout(
      client.chat([
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ]),
      timeoutMs,
      'reviser',
    );
    content = resp.content;
  } catch {
    return null;
  }

  const json = extractReviserJson(content);
  if (!json || !Array.isArray(json.files)) return null;

  const allowed = new Map(diff.files.map((f) => [f.path, f]));
  const changes: ProposedChangeInput[] = [];
  const droppedPaths: string[] = [];
  const seen = new Set<string>();

  for (const file of json.files) {
    if (typeof file?.path !== 'string' || seen.has(file.path)) continue;
    const original = allowed.get(file.path);
    if (!original) {
      droppedPaths.push(String(file.path));
      continue;
    }
    seen.add(file.path);
    if (file.newContent === 'KEEP-BASE') continue; // change withdrawn for this file
    if (file.newContent === null) {
      changes.push({ path: file.path, newContent: null });
    } else if (typeof file.newContent === 'string') {
      changes.push({ path: file.path, newContent: file.newContent });
    }
  }
  // Files the reviser forgot are carried over unchanged — a partial answer
  // must not silently drop part of the proposal.
  for (const original of diff.files) {
    if (!seen.has(original.path)) {
      changes.push({ path: original.path, newContent: original.newContent });
    }
  }

  if (changes.length === 0) return null; // everything withdrawn — nothing to re-review
  return { changes, note: typeof json.note === 'string' ? json.note.trim() : '', droppedPaths };
}

// --- the loop ---

export interface RevisionRound {
  diffId: string;
  decision: ReviewDecision;
  failClosed: boolean;
  annotations: ReviewAnnotation[];
  /** Set when this round's verdict triggered a revision that produced the next round. */
  reviserNote?: string;
}

export interface ReviewApplyWithRevisionsResult {
  /** One entry per review round, in order (≥ 1). */
  rounds: RevisionRound[];
  /** The last round's full result (its `apply` reflects the final decision). */
  final: ReviewAndApplyResult;
  /** True when at least one revision was attempted. */
  revised: boolean;
}

export interface RevisionLoopOptions {
  client: CouncilChatClient;
  maxRounds?: number;
  timeoutMs?: number;
}

function isRevisable(verdict: ReviewVerdict): boolean {
  if (verdict.failClosed || verdict.conflicts.length > 0) return false;
  return verdict.decision === 'annotate' || verdict.decision === 'reject';
}

/**
 * reviewAndApply with a bounded automatic revision loop. Every round is
 * journaled by the underlying gate; the revised intent carries the lineage
 * (`… (revision N of <original diff id>)`) so the ledger tells the story.
 */
export async function reviewApplyWithRevisions(
  input: BuildProposedDiffInput,
  engineDeps: ReviewEngineDeps,
  applyOpts: ApplyOptions,
  revision: RevisionLoopOptions,
): Promise<ReviewApplyWithRevisionsResult> {
  const maxRounds = Math.max(1, revision.maxRounds ?? DEFAULT_MAX_ROUNDS);
  const rounds: RevisionRound[] = [];
  let currentInput = input;
  let result = await reviewAndApply(currentInput, engineDeps, applyOpts);
  let originalId: string | null = null;
  let revised = false;

  for (let round = 1; ; round++) {
    const roundRecord: RevisionRound = {
      diffId: result.diff.id,
      decision: result.verdict.decision,
      failClosed: result.verdict.failClosed,
      annotations: result.verdict.annotations,
    };
    rounds.push(roundRecord);
    originalId = originalId ?? result.diff.id;

    const done = result.verdict.decision === 'accept' || round >= maxRounds || !isRevisable(result.verdict);
    if (done) break;

    const attempt = await reviseProposedDiff(revision.client, result.diff, result.verdict, revision.timeoutMs);
    if (!attempt) break; // reviser failed — stop with the honest verdict

    revised = true;
    roundRecord.reviserNote = attempt.note || '(no note)';
    currentInput = {
      ...input,
      intent: `${input.intent} (revision ${round} of ${originalId})`,
      changes: attempt.changes,
    };
    result = await reviewAndApply(currentInput, engineDeps, applyOpts);
  }

  return { rounds, final: result, revised };
}
