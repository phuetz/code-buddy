/**
 * PaperQA2-lite — grounded, cited answer (Phase 3).
 *
 * The anti-hallucination payoff. Given a question and the passages Phase 2
 * retrieved, this:
 *   1. runs RCS ({@link summarizePassages}) to keep ONLY passages independently
 *      judged relevant to the question;
 *   2. asks the LLM to answer using ONLY those retained passages, citing each
 *      claim with `[n]` markers that index the retained set;
 *   3. renders the "## Références" section FROM CODE (never the LLM) out of the
 *      retained passages' real page/section/offset provenance, so every `[n]`
 *      the answer carries is guaranteed to resolve to a real passage;
 *   4. REFUSES honestly — `{ sufficient: false, citations: [] }` — when no
 *      relevant passage survives RCS, when the LLM declares the evidence
 *      insufficient, when it cites nothing valid, or when the LLM is unavailable.
 *
 * This transposes deep-research's synthesis contract (`SYNTH_SYSTEM`, the
 * refuse-on-zero-source guard, and the deterministic `renderReferences`) down to
 * the passage/page/section grain. Injectable LLM, bounded, never-throws.
 */

import { logger } from '../../utils/logger.js';
import type { ScoredPassage } from './passage-index.js';
import type { PassageQaLlm, PassageSummary, RcsOptions } from './rcs.js';
import { summarizePassages } from './rcs.js';

// ============================================================================
// Public surface
// ============================================================================

/**
 * One citation the answer carries — a `[marker]` in the body resolved to a REAL
 * passage's provenance. Rendered by code; never produced by the LLM.
 */
export interface PassageCitation {
  /** The `[n]` marker as it appears in the answer body. */
  marker: number;
  docId: string;
  page: number;
  section?: string;
  charStart: number;
  charEnd: number;
  /** Deterministic extract of the cited passage's REAL text (proof of grounding). */
  excerpt: string;
}

/** Why the answer turned out the way it did — machine-readable for callers/Phase 4. */
export type GroundedAnswerReason =
  | 'answered'
  | 'no_passages'
  | 'no_relevant_passages'
  | 'insufficient_evidence'
  | 'synthesis_unavailable';

/** The grounded answer (or honest refusal). */
export interface GroundedAnswer {
  /** The answer body (with inline `[n]` markers + code-rendered "## Références"), or the refusal text. */
  answer: string;
  /** Citations rendered by code from retained passages; `[]` on any refusal. */
  citations: PassageCitation[];
  /** False = honest refusal (insufficient evidence / LLM unavailable). */
  sufficient: boolean;
  /** How many passages survived RCS filtering. */
  retainedCount: number;
  /** True when the synthesis LLM produced the answer body. */
  llmUsed: boolean;
  /** Machine-readable outcome. */
  reason: GroundedAnswerReason;
}

/** Bounded knobs for {@link answerFromPassages}. */
export interface AnswerOptions {
  /** RCS knobs (relevance threshold, caps) forwarded to `summarizePassages`. */
  rcs?: RcsOptions;
  /** Truncate each passage's evidence text in the synthesis prompt (default 900). */
  evidenceCharLimit?: number;
  /** Truncate the produced answer body to this many chars (default 4000). */
  answerCharLimit?: number;
  /** Excerpt length in the rendered References (default 200). */
  excerptChars?: number;
}

// ============================================================================
// Defaults / bounds
// ============================================================================

const DEFAULT_EVIDENCE_CHAR_LIMIT = 900;
const DEFAULT_ANSWER_CHAR_LIMIT = 4000;
const DEFAULT_EXCERPT_CHARS = 200;

/** French refusals — mirror deep-research's honest "non concluant" stance. */
const REFUSAL_INSUFFICIENT = 'Preuves insuffisantes dans le corpus pour répondre.';
const REFUSAL_SYNTHESIS_DOWN =
  'Impossible de synthétiser une réponse : le modèle de synthèse est indisponible.';

/** The sentinel the synthesizer emits when the retained passages do not support an answer. */
const INSUFFICIENT_SENTINEL = 'INSUFFICIENT';

const SYNTH_SYSTEM = [
  'You answer a question using ONLY the numbered passages provided. Requirements:',
  '- Use ONLY facts stated in the passages. Do NOT use outside knowledge. Do NOT invent facts or sources.',
  '- Cite every non-trivial claim with inline markers like [1], [2] using ONLY the given passage numbers.',
  '- Do NOT cite a number that is not in the list. Do NOT write your own references/sources section — it is appended for you.',
  `- If the passages do not contain enough information to answer, reply with EXACTLY this single word: ${INSUFFICIENT_SENTINEL}`,
  '- Be concise and factual; no meta-commentary.',
].join('\n');

// ============================================================================
// answerFromPassages
// ============================================================================

/**
 * Produce a grounded, cited answer from retrieved passages — or an honest
 * refusal. See the module header for the full contract. Never throws.
 *
 * Cost is bounded: N retained passages ⇒ N RCS calls + 1 synthesis call.
 */
export async function answerFromPassages(
  question: string,
  scoredPassages: ScoredPassage[],
  llm: PassageQaLlm,
  opts: AnswerOptions = {},
): Promise<GroundedAnswer> {
  const q = typeof question === 'string' ? question.trim() : '';

  // 0. Nothing retrieved → refuse (deep-research's refuse-on-zero-source, at the passage grain).
  if (q.length === 0 || !Array.isArray(scoredPassages) || scoredPassages.length === 0) {
    return refuse('no_passages', 0);
  }

  // 1. RCS: keep only passages independently judged relevant to the question.
  let retained: PassageSummary[];
  try {
    retained = await summarizePassages(scoredPassages, q, llm, opts.rcs ?? {});
  } catch (err) {
    // summarizePassages is itself never-throws, but guard defensively.
    logger.debug(`[paper-qa] RCS pass failed, treating as no evidence: ${errText(err)}`);
    retained = [];
  }
  if (retained.length === 0) {
    return refuse('no_relevant_passages', 0);
  }

  // 2. Synthesize an answer that cites ONLY the retained passages ([1..N]).
  const evidenceCharLimit = clampInt(opts.evidenceCharLimit, DEFAULT_EVIDENCE_CHAR_LIMIT, 1, 100_000);
  const userPrompt = buildSynthPrompt(q, retained, evidenceCharLimit);

  let raw: string;
  try {
    raw = await llm([
      { role: 'system', content: SYNTH_SYSTEM },
      { role: 'user', content: userPrompt },
    ]);
  } catch (err) {
    logger.debug(`[paper-qa] synthesis LLM failed, refusing: ${errText(err)}`);
    return refuse('synthesis_unavailable', retained.length);
  }

  const body = stripTrailingReferences(typeof raw === 'string' ? raw.trim() : '');
  if (body.length === 0) {
    return refuse('synthesis_unavailable', retained.length);
  }
  if (isInsufficient(body)) {
    return refuse('insufficient_evidence', retained.length, true);
  }

  // 3. Enforce grounding: strip any citation number outside the retained set so
  //    every surviving [n] resolves to a real passage, then read back the markers.
  const sanitized = stripInvalidMarkers(body, retained.length);
  const usedMarkers = extractMarkers(sanitized).filter((n) => n >= 1 && n <= retained.length);
  if (usedMarkers.length === 0) {
    // A body that cites no valid passage is not a grounded answer → refuse.
    return refuse('insufficient_evidence', retained.length, true);
  }

  // 4. Build citations + the DETERMINISTIC References section from CODE.
  const excerptChars = clampInt(opts.excerptChars, DEFAULT_EXCERPT_CHARS, 1, 5000);
  const answerCharLimit = clampInt(opts.answerCharLimit, DEFAULT_ANSWER_CHAR_LIMIT, 1, 1_000_000);

  const citations = usedMarkers
    .sort((a, b) => a - b)
    .map((marker) => toCitation(marker, retained[marker - 1]!, excerptChars));

  const answerBody = truncate(sanitized, answerCharLimit).trimEnd();
  const answer = `${answerBody}\n\n${renderReferences(citations)}`;

  return {
    answer,
    citations,
    sufficient: true,
    retainedCount: retained.length,
    llmUsed: true,
    reason: 'answered',
  };
}

// ============================================================================
// Prompt + refusal construction
// ============================================================================

function buildSynthPrompt(question: string, retained: PassageSummary[], evidenceCharLimit: number): string {
  const evidence = retained
    .map((r, i) => {
      const loc = locLabel(r);
      const text = truncate((r.summary || r.scored.passage.text).replace(/\s+/g, ' ').trim(), evidenceCharLimit);
      return `[${i + 1}] (${loc}) ${text}`;
    })
    .join('\n\n');

  return [`Question: ${question}`, '', 'Passages (cite by the bracketed number):', '', evidence].join('\n');
}

/** A refusal result. `llmUsed` is true only when the LLM itself declared insufficiency. */
function refuse(
  reason: Exclude<GroundedAnswerReason, 'answered'>,
  retainedCount: number,
  llmDeclared = false,
): GroundedAnswer {
  const answer = reason === 'synthesis_unavailable' ? REFUSAL_SYNTHESIS_DOWN : REFUSAL_INSUFFICIENT;
  return { answer, citations: [], sufficient: false, retainedCount, llmUsed: llmDeclared, reason };
}

// ============================================================================
// Citation + References rendering (CODE-owned — the anti-hallucination anchor)
// ============================================================================

/** Map a `[marker]` to its retained passage's REAL provenance + a code-derived excerpt. */
function toCitation(marker: number, retained: PassageSummary, excerptChars: number): PassageCitation {
  const { provenance } = retained.scored;
  const citation: PassageCitation = {
    marker,
    docId: provenance.docId,
    page: provenance.page,
    charStart: provenance.charStart,
    charEnd: provenance.charEnd,
    excerpt: excerptOf(retained.scored.passage.text, excerptChars),
  };
  if (provenance.section !== undefined) citation.section = provenance.section;
  return citation;
}

/** Deterministic "## Références" — rendered by code from the citations, never the LLM. */
function renderReferences(citations: PassageCitation[]): string {
  const lines = ['## Références', ''];
  for (const c of citations) {
    const loc = c.section ? `p.${c.page}, ${c.section}` : `p.${c.page}`;
    lines.push(`[${c.marker}] ${c.docId} (${loc}) — « ${c.excerpt} »`);
  }
  return lines.join('\n');
}

function locLabel(r: PassageSummary): string {
  const { page, section } = r.scored.provenance;
  return section ? `p.${page}, ${section}` : `p.${page}`;
}

function excerptOf(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

// ============================================================================
// Body sanitation
// ============================================================================

/** Remove `[k]` markers whose number is outside 1..validCount (fabricated citations). */
function stripInvalidMarkers(body: string, validCount: number): string {
  return body.replace(/\[(\d{1,5})\]/g, (full, num: string) => {
    const n = Number(num);
    return Number.isInteger(n) && n >= 1 && n <= validCount ? full : '';
  });
}

/** All distinct integer `[n]` markers present in `body`. */
function extractMarkers(body: string): number[] {
  const set = new Set<number>();
  const re = /\[(\d{1,5})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1]);
    if (Number.isInteger(n)) set.add(n);
  }
  return [...set];
}

/** True when the synthesizer emitted the insufficiency sentinel (tolerant of punctuation/case). */
function isInsufficient(body: string): boolean {
  const normalized = body.replace(/[^a-z]/gi, '').toUpperCase();
  return normalized === INSUFFICIENT_SENTINEL || /^INSUFFICIENT\b/i.test(body.trim());
}

/** Strip a references/sources heading the LLM may have added — we own that section. */
function stripTrailingReferences(body: string): string {
  return body
    .replace(/\n+#{1,6}\s*(références|references|sources|bibliographie)\b[\s\S]*$/i, '')
    .trimEnd();
}

// ============================================================================
// Helpers
// ============================================================================

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
