/**
 * LLM reviewers — lens-specialised structured review of a proposed diff.
 *
 * Same discipline as the council judge: strict-JSON verdict, two-stage parse
 * (pure JSON then salvage), and FAIL-CLOSED on anything unreliable — a
 * reviewer that times out, errors or answers prose yields a `reject` report
 * flagged `failClosed`, never a silent pass. Lenses run one after another
 * (a local runtime cannot overlap generations) and are deliberately diverse
 * (correctness vs security) — diversity catches failure modes redundancy can't.
 *
 * @module review/llm-reviewer
 */

import { withTimeout } from '../council/with-timeout.js';
import type { CouncilChatClient } from '../council/types.js';
import { extractJsonObject } from '../utils/json-salvage.js';
import { renderUnifiedPreview } from './diff-model.js';
import type {
  AnnotationSeverity,
  ProposedDiff,
  ReviewAnnotation,
  ReviewDecision,
  ReviewLens,
  ReviewerReport,
} from './types.js';

export const DEFAULT_REVIEW_LENSES: ReviewLens[] = [
  {
    id: 'correctness',
    label: 'Correctness reviewer',
    focus:
      'bugs, logic errors, broken invariants and contracts, regressions vs the stated intent, missing edge cases the diff itself introduces',
  },
  {
    id: 'security',
    label: 'Security reviewer',
    focus:
      'injection (shell/SQL/path), path traversal, unsafe exec/eval, secrets or credentials, data exfiltration, permission widening',
  },
];

const MAX_PREVIEW_CHARS_PER_FILE = 6000;
const VALID_DECISIONS: ReadonlySet<string> = new Set(['accept', 'reject', 'annotate']);
const VALID_SEVERITIES: ReadonlySet<string> = new Set(['blocker', 'warning', 'suggestion']);

interface ReviewerJson {
  decision?: string;
  annotations?: Array<{
    path?: string;
    line?: number;
    severity?: string;
    message?: string;
    suggestedFix?: string;
  }>;
  why?: string;
}

/** Two-stage strict-JSON parse (shared with the council judge). */
function extractReviewerJson(text: string): ReviewerJson | null {
  return extractJsonObject<ReviewerJson>(text);
}

function truncatePreview(text: string): string {
  if (text.length <= MAX_PREVIEW_CHARS_PER_FILE) return text;
  return `${text.slice(0, MAX_PREVIEW_CHARS_PER_FILE)}\n...[truncated for review]`;
}

function buildReviewPrompt(lens: ReviewLens, diff: ProposedDiff): { system: string; user: string } {
  const system =
    `You are the ${lens.label} of Code Buddy's diff-review gate. An agent proposes ` +
    'a file modification; you decide whether it may be APPLIED. Hunt specifically for: ' +
    `${lens.focus}. ` +
    'Rules: judge ONLY what this diff changes (not pre-existing flaws in untouched code); ' +
    'severity discipline — "blocker" means MUST NOT be applied, "warning" means the ' +
    'proposer must revise first, "suggestion" never blocks; style nits are suggestions at most; ' +
    'decision mapping — any blocker → "reject", warnings but no blocker → "annotate", else "accept". ' +
    'If you cannot review reliably, return decision "reject" with one blocker explaining why. ' +
    'Respond with STRICT JSON and nothing else: ' +
    '{"decision":"accept|reject|annotate","annotations":[{"path":"file","line":1,"severity":"blocker|warning|suggestion","message":"...","suggestedFix":"..."}],"why":"one short sentence"}';

  const previews = diff.files
    .map((f) => `### ${f.path} (${f.action})\n${truncatePreview(renderUnifiedPreview(f))}`)
    .join('\n\n');
  const user = `INTENT of the proposer:\n${diff.intent}\n\nPROPOSED DIFF:\n${previews}\n\nReturn the JSON now.`;
  return { system, user };
}

function normalizeAnnotations(raw: ReviewerJson['annotations'], knownPaths: Set<string>): ReviewAnnotation[] {
  const out: ReviewAnnotation[] = [];
  for (const a of raw ?? []) {
    if (!a || typeof a.message !== 'string' || !a.message.trim()) continue;
    const severity = VALID_SEVERITIES.has(String(a.severity)) ? (a.severity as AnnotationSeverity) : 'warning';
    const path = typeof a.path === 'string' && knownPaths.has(a.path) ? a.path : [...knownPaths][0]!;
    out.push({
      path,
      ...(Number.isFinite(a.line) && (a.line as number) > 0 ? { line: Math.floor(a.line as number) } : {}),
      severity,
      message: a.message.trim(),
      ...(typeof a.suggestedFix === 'string' && a.suggestedFix.trim() ? { suggestedFix: a.suggestedFix.trim() } : {}),
    });
  }
  return out;
}

/** Consistency guard: the decision can never be laxer than the annotations. */
function reconcileDecision(decision: ReviewDecision, annotations: ReviewAnnotation[]): ReviewDecision {
  if (annotations.some((a) => a.severity === 'blocker')) return 'reject';
  if (decision === 'accept' && annotations.some((a) => a.severity === 'warning')) return 'annotate';
  return decision;
}

export async function reviewWithLens(
  client: CouncilChatClient,
  lens: ReviewLens,
  diff: ProposedDiff,
  timeoutMs: number,
): Promise<ReviewerReport> {
  const failClosed = (reason: string): ReviewerReport => ({
    reviewer: lens.id,
    decision: 'reject',
    annotations: [
      {
        path: diff.files[0]!.path,
        severity: 'blocker',
        message: `review unavailable (${lens.id}): ${reason} — fail-closed, the diff was NOT applied`,
      },
    ],
    failClosed: true,
  });

  const prompt = buildReviewPrompt(lens, diff);
  let content: string;
  try {
    const resp = await withTimeout(
      client.chat([
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ]),
      timeoutMs,
      `review:${lens.id}`,
    );
    content = resp.content;
  } catch (err) {
    return failClosed(err instanceof Error ? err.message : String(err));
  }

  const json = extractReviewerJson(content);
  if (!json || !VALID_DECISIONS.has(String(json.decision))) {
    return failClosed('non-JSON or invalid verdict');
  }

  const knownPaths = new Set(diff.files.map((f) => f.path));
  const annotations = normalizeAnnotations(json.annotations, knownPaths);
  const decision = reconcileDecision(json.decision as ReviewDecision, annotations);

  return { reviewer: lens.id, decision, annotations };
}
