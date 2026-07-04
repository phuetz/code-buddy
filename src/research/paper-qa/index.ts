/**
 * PaperQA2-lite — Phases 1–2.
 *
 * Phase 1: `PDF → StructuredDoc → Passage[]` with REAL page/section/offset
 * provenance. Phase 2: a passage-grain hybrid index (BM25 + local embeddings +
 * MMR) whose `search(question)` returns the best passages as CITED evidence
 * (each with page/section provenance and per-leg scores). No LLM, no network.
 * Phase 3: RCS (relevance-contextual summarization) + the grounded, cited answer
 * — `answerFromPassages` filters evidence by question-relevance then synthesizes
 * an answer that cites page/section exactly, or REFUSES honestly when the corpus
 * does not support one (injectable LLM, never-throws). A prose reranker is
 * Phase 4.
 */

export { parsePdfStructure, defaultParsePdf } from './pdf-structure.js';
export { chunkDocument } from './prose-chunker.js';
export { findPageNo, findSectionTitle } from './provenance.js';
export { PassageIndex, InMemoryEmbeddingCache } from './passage-index.js';
export { buildCorpusIndex } from './corpus.js';
export { summarizePassage, summarizePassages } from './rcs.js';
export { answerFromPassages } from './answer.js';
export type {
  StructuredDoc,
  PageSpan,
  SectionSpan,
  Passage,
  ParsedPdf,
  ParsedPdfPage,
  PdfParseFn,
  PdfStructureDeps,
  ParsePdfStructureOptions,
  ChunkOptions,
} from './types.js';
export type {
  PassageEmbedder,
  EmbeddingCache,
  PassageProvenance,
  PassageScores,
  ScoredPassage,
  PassageIndexOptions,
  PassageSearchOptions,
} from './passage-index.js';
export type { BuildCorpusOptions } from './corpus.js';
export type { PassageLlmMessage, PassageQaLlm, PassageSummary, RcsOptions } from './rcs.js';
export type {
  PassageCitation,
  GroundedAnswer,
  GroundedAnswerReason,
  AnswerOptions,
} from './answer.js';
