/**
 * PaperQA2-lite — Phases 1–2.
 *
 * Phase 1: `PDF → StructuredDoc → Passage[]` with REAL page/section/offset
 * provenance. Phase 2: a passage-grain hybrid index (BM25 + local embeddings +
 * MMR) whose `search(question)` returns the best passages as CITED evidence
 * (each with page/section provenance and per-leg scores). No LLM, no network.
 * The grounded, cited answer (Phase 3) and a prose reranker (Phase 4) build on
 * the ranked evidence produced here.
 */

export { parsePdfStructure, defaultParsePdf } from './pdf-structure.js';
export { chunkDocument } from './prose-chunker.js';
export { findPageNo, findSectionTitle } from './provenance.js';
export { PassageIndex, InMemoryEmbeddingCache } from './passage-index.js';
export { buildCorpusIndex } from './corpus.js';
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
