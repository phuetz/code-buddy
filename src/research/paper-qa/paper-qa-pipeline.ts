/**
 * PaperQA2-lite — Phase 4 orchestration helper.
 *
 * Chains the three shipped bricks into ONE bounded, never-throws call:
 *   1. {@link buildCorpusIndex} — parse + index a set of PDF paths (Phase 1+2).
 *   2. {@link PassageIndex.search} — retrieve the best-ranked passages with
 *      exact page/section/offset provenance (Phase 2, no LLM).
 *   3. {@link answerFromPassages} — RCS-filter the evidence and synthesize a
 *      grounded, cited answer, or refuse honestly (Phase 3, injectable LLM).
 *
 * This module owns NO business logic of its own — it only wires the existing
 * pieces and renders a bounded human/agent-readable view. Both the agent tool
 * (`src/tools/paper-qa-tool.ts`) and the CLI (`buddy papers ask`) call it, so
 * the corpus→search→answer flow lives in exactly one place.
 *
 * Contracts (inherited from the bricks): never-throws, bounded (cap PDFs via
 * `maxDocs`, cap passages, cap retrieved top-K, truncate the rendered output),
 * injectable (embedder + LLM + pdf-parse boundary) so CI runs with zero ONNX
 * model and zero network.
 *
 * @module research/paper-qa/paper-qa-pipeline
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildCorpusIndex } from './corpus.js';
import { answerFromPassages } from './answer.js';
import type { BuildCorpusOptions } from './corpus.js';
import type { AnswerOptions, GroundedAnswer } from './answer.js';
import type { PassageQaLlm } from './rcs.js';
import type {
  PassageEmbedder,
  PassageSearchOptions,
} from './passage-index.js';
import type {
  ChunkOptions,
  ParsePdfStructureOptions,
  PdfStructureDeps,
} from './types.js';

// ============================================================================
// Public surface
// ============================================================================

/** Bounded knobs for {@link runPaperQa}. All optional; defaults come from the bricks. */
export interface PaperQaPipelineOptions {
  /** Passages returned by the retrieval step (default 8, clamped 1..500 by the index). */
  topK?: number;
  /** Hard cap on PDFs parsed (default 2000, forwarded to `buildCorpusIndex`). */
  maxDocs?: number;
  /** Hard cap on total indexed passages (forwarded to the index). */
  maxPassages?: number;
  /** Persist and incrementally reuse unchanged document shards (default for real PDFs). */
  persistentIndex?: boolean;
  /** Override the persistent corpus directory under `.codebuddy/`. */
  persistentIndexDirectory?: string;
  /** Injected embedder (tests / alternative engines). Default: lazy local `EmbeddingProvider`. */
  embedder?: PassageEmbedder;
  /** Injectable PDF-parse / file-read boundaries (tests inject deterministic fakes). */
  pdfDeps?: PdfStructureDeps;
  /** Bounded knobs forwarded to the Phase 1 parser. */
  parseOptions?: ParsePdfStructureOptions;
  /** Chunker knobs forwarded to `chunkDocument`. */
  chunkOptions?: ChunkOptions;
  /** Extra retrieval knobs (semantic weight, MMR lambda). */
  searchOptions?: Omit<PassageSearchOptions, 'topN'>;
  /** RCS + synthesis knobs forwarded to `answerFromPassages`. */
  answerOptions?: AnswerOptions;
}

/** The structured result of one paper-QA run (never partial — always defined). */
export interface PaperQaResult {
  /** The trimmed question that was asked. */
  question: string;
  /** The grounded answer (or the honest refusal) from Phase 3. */
  answer: GroundedAnswer;
  /** How many PDF paths were handed to the corpus builder. */
  pdfPathsConsidered: number;
  /** How many passages the corpus index actually holds (0 ⇒ nothing readable). */
  indexedPassages: number;
  /** How many passages the retrieval step surfaced before RCS filtering. */
  retrievedPassages: number;
  /**
   * False when retrieval's semantic (dense) leg was unavailable — the embedder
   * failed and the search silently degraded to BM25 keyword-only (finding E).
   * `true` when semantic ranking applied (or when nothing was searched).
   */
  semanticAvailable: boolean;
  /** Retrieval mode actually used for this answer. */
  retrievalMode: 'hybrid' | 'bm25-only';
  /** True when a declared fallback reduced retrieval capability. */
  degraded: boolean;
}

// ============================================================================
// Defaults / bounds
// ============================================================================

/** Final guard on the rendered output size (the model re-reads it). */
const MAX_OUTPUT_CHARS = 16_000;

// ============================================================================
// runPaperQa — the chained pipeline
// ============================================================================

/**
 * Parse+index `pdfPaths`, retrieve the top passages for `question`, and produce a
 * grounded, cited answer (or an honest refusal). Never throws — every brick is
 * itself never-throws and this only forwards bounded options between them.
 *
 * Cost is bounded: at most `maxDocs` PDFs parsed, `maxPassages` passages indexed,
 * `topK` passages retrieved, and (in Phase 3) N RCS calls + 1 synthesis call.
 */
export async function runPaperQa(
  question: string,
  pdfPaths: string[],
  llm: PassageQaLlm,
  options: PaperQaPipelineOptions = {},
): Promise<PaperQaResult> {
  const q = typeof question === 'string' ? question.trim() : '';
  const paths = Array.isArray(pdfPaths) ? pdfPaths : [];

  // 1. Corpus → passage index (Phase 1+2). Bounded, never-throws.
  const buildOptions: BuildCorpusOptions = {};
  if (options.embedder) buildOptions.embedder = options.embedder;
  if (options.maxDocs !== undefined) buildOptions.maxDocs = options.maxDocs;
  if (options.maxPassages !== undefined) buildOptions.maxPassages = options.maxPassages;
  if (options.persistentIndex !== undefined) buildOptions.persistentIndex = options.persistentIndex;
  if (options.persistentIndexDirectory !== undefined) {
    buildOptions.persistentIndexDirectory = options.persistentIndexDirectory;
  }
  if (options.pdfDeps) buildOptions.pdfDeps = options.pdfDeps;
  if (options.parseOptions) buildOptions.parseOptions = options.parseOptions;
  if (options.chunkOptions) buildOptions.chunkOptions = options.chunkOptions;

  const index = await buildCorpusIndex(paths, buildOptions);
  const indexedPassages = index.size();

  // 2. Retrieval (Phase 2). Empty question / empty index ⇒ [].
  const searchOptions: PassageSearchOptions = { ...(options.searchOptions ?? {}) };
  if (options.topK !== undefined) searchOptions.topN = options.topK;
  const hits = q.length === 0 ? [] : await index.search(q, searchOptions);

  // 3. Grounded, cited answer or honest refusal (Phase 3). Never-throws.
  const answer = await answerFromPassages(q, hits, llm, options.answerOptions ?? {});

  const semanticAvailable = index.lastSemanticAvailable;
  return {
    question: q,
    answer,
    pdfPathsConsidered: paths.length,
    indexedPassages,
    retrievedPassages: hits.length,
    // `lastSemanticAvailable` defaults to true when no search ran (empty index /
    // empty question), so those cases correctly report "not degraded".
    semanticAvailable,
    retrievalMode: semanticAvailable ? 'hybrid' : 'bm25-only',
    degraded: !semanticAvailable,
  };
}

// ============================================================================
// Source labelling (docId → human filename, for readable citations)
// ============================================================================

/**
 * Map each corpus docId to a human-readable label (the PDF basename), so the
 * rendered "## Références" cite the source BY NAME rather than the opaque
 * `sha1(path)[:16]` docId the Phase-1 parser derives.
 *
 * This deliberately REPLICATES Phase 1's `deriveDocId` (sha1 of the exact path
 * string handed to `buildCorpusIndex`, first 16 hex chars) rather than importing
 * a private helper, keeping this Phase-4 code strictly additive (it touches no
 * Phase 1–3 file). If Phase 1 ever changes its derivation, a stale label simply
 * fails to match and the raw docId is shown — the answer's grounding is never
 * affected, only its cosmetic label.
 */
export function deriveSourceLabels(pdfPaths: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!Array.isArray(pdfPaths)) return labels;
  for (const p of pdfPaths) {
    if (typeof p !== 'string' || p.length === 0) continue;
    const docId = createHash('sha1').update(p).digest('hex').slice(0, 16);
    labels[docId] = path.basename(p);
  }
  return labels;
}

// ============================================================================
// Rendering (bounded — shared by the tool output and the CLI report)
// ============================================================================

/**
 * Render a {@link PaperQaResult} as a bounded Markdown block: a provenance-aware
 * header + the grounded answer body (which already carries inline `[n]` markers
 * and a code-rendered "## Références" section) or the honest refusal text.
 *
 * `sourceLabels` (docId → filename, from {@link deriveSourceLabels}) is applied
 * to the References so sources read by name; unknown docIds are left untouched.
 */
export function formatPaperQaOutput(
  result: PaperQaResult,
  sourceLabels: Record<string, string> = {},
): string {
  const a = result.answer;
  const header = [
    `# Paper QA : ${result.question}`,
    '',
    `Corpus : ${result.indexedPassages} passage(s) indexé(s) depuis ${result.pdfPathsConsidered} PDF | ` +
      `récupérés : ${result.retrievedPassages} | retenus (RCS) : ${a.retainedCount}`,
    `Recherche : ${result.retrievalMode === 'hybrid' ? 'hybride (BM25 + sémantique)' : 'BM25 seul (MODE DÉGRADÉ)'}`,
    `Synthèse : ${a.llmUsed ? 'LLM' : 'indisponible'} | ` +
      `Statut : ${a.sufficient ? 'répondu (ancré)' : 'refus honnête'} (${a.reason})`,
  ];
  if (!result.semanticAvailable) {
    // The dense leg was down — retrieval ran keyword-only. Tell the user so a
    // possibly-degraded ranking isn't mistaken for a full semantic search.
    header.push(
      'Note : recherche sémantique indisponible (embeddings) — repli BM25 (mots-clés) seul, pertinence possiblement dégradée.',
    );
  }
  header.push('', '---', '');
  const body = relabelSources(a.answer, sourceLabels);
  return truncate(`${header.join('\n')}${body}`);
}

/** Replace each known docId token with its human label (References read by name). */
function relabelSources(text: string, labels: Record<string, string>): string {
  let out = text;
  for (const [docId, label] of Object.entries(labels)) {
    if (!docId || !label || docId === label) continue;
    out = out.split(docId).join(label);
  }
  return out;
}

/** Truncate cleanly, appending a note so the model knows content was elided. */
function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n… [réponse tronquée à ${MAX_OUTPUT_CHARS} caractères — relancer avec une question plus ciblée]`;
}
