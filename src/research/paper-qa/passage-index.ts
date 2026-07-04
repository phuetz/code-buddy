/**
 * PaperQA2-lite — passage-grain index + evidence search (Phase 2).
 *
 * Consumes the Phase 1 provenance backbone (`StructuredDoc` → `Passage[]`) and
 * builds a queryable index at the PASSAGE grain. `search(question)` returns the
 * best-ranked passages, each carrying its EXACT page/section/offset provenance —
 * this is PaperQA2's "evidence gathering" step (retrieval only, NO LLM).
 *
 * Retrieval reuses the existing bricks unchanged:
 *   - {@link BM25Index}         — keyword (lexical) leg.
 *   - {@link EmbeddingProvider} — local, $0 dense (semantic) leg (injectable).
 *   - {@link hybridMmrRank}     — weighted-RRF fusion + MMR rerank.
 * It mirrors the CKG's `recallHybrid` assembly, re-applied over passages instead
 * of graph nodes.
 *
 * Contracts: never-throws (a failing/absent embedder degrades to keyword-only,
 * exactly like `recallHybrid`), bounded (caps on indexed passages / top-N /
 * embed input length), and fully injectable (embedder + embedding cache) so CI
 * runs on deterministic fake embeddings with no ONNX model / network.
 *
 * The LLM-side pieces — per-passage RCS summaries and the grounded, cited answer
 * — are Phase 3; a prose cross-encoder reranker is Phase 4. This module stays at
 * pure retrieval.
 */

import { createHash } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { BM25Index } from '../../search/bm25.js';
import { cosineSimilarityF32, hybridMmrRank } from '../../memory/hybrid-mmr.js';
import type { HybridCandidate } from '../../memory/hybrid-mmr.js';
import { EmbeddingProvider } from '../../embeddings/embedding-provider.js';
import { chunkDocument } from './prose-chunker.js';
import type { ChunkOptions, Passage, StructuredDoc } from './types.js';

// ============================================================================
// Public surface
// ============================================================================

/**
 * Minimal embedder surface the index needs — the project's `EmbeddingProvider`
 * satisfies it (same shape as the CKG's `CkgEmbedder`). `embedBatch` is optional
 * and, when present, is preferred at index time for throughput.
 */
export interface PassageEmbedder {
  embed(text: string): Promise<{ embedding: Float32Array }>;
  embedBatch?(texts: string[]): Promise<{ embeddings: Float32Array[] }>;
}

/**
 * A pluggable, bounded embedding cache keyed by a content fingerprint. Lets a
 * caller persist vectors across runs so unchanged passages are never re-embedded.
 * The default is an in-memory bounded map; a disk-backed implementation can be
 * injected without touching this module.
 *
 * TODO(phase-2+): ship an on-disk fingerprint→vector cache (e.g. under
 * `~/.codebuddy/paper-qa/embeddings/`) so a large corpus survives process
 * restarts. Left injectable + bounded here on purpose.
 */
export interface EmbeddingCache {
  get(fingerprint: string): Float32Array | undefined;
  set(fingerprint: string, vector: Float32Array): void;
}

/** Provenance a search hit cites — the page/section/offset trace of the passage. */
export interface PassageProvenance {
  docId: string;
  page: number;
  section?: string;
  charStart: number;
  charEnd: number;
}

/** Per-leg + fused scores attached to a search hit. */
export interface PassageScores {
  /** Cosine similarity to the query (0..1), or `null` when semantic is unavailable. */
  dense: number | null;
  /** Raw BM25 keyword score (0 when the passage matched no query term). */
  keyword: number;
  /** Fused relevance the ranker produced (weighted-RRF × prior, post-MMR). */
  final: number;
}

/** A ranked passage with full provenance and per-leg scores. */
export interface ScoredPassage {
  passage: Passage;
  provenance: PassageProvenance;
  scores: PassageScores;
}

/** Bounded knobs for {@link PassageIndex}. */
export interface PassageIndexOptions {
  /** Injected embedder (tests / alternative engines). Default: a lazy multilingual `EmbeddingProvider`. */
  embedder?: PassageEmbedder;
  /** Multilingual embedding model for the default embedder. */
  embeddingModel?: string;
  /** Injected embedding cache. Default: an in-memory bounded cache. */
  embeddingCache?: EmbeddingCache;
  /** Chunker knobs passed through to `chunkDocument`. */
  chunkOptions?: ChunkOptions;
  /** Hard cap on total indexed passages across all documents (default 20000). */
  maxPassages?: number;
  /** Truncate passage/question text to this many chars before embedding (default 2000). */
  embedCharLimit?: number;
}

/** Bounded knobs for {@link PassageIndex.search}. */
export interface PassageSearchOptions {
  /** Number of passages to return (default 8, clamped 1..500). */
  topN?: number;
  /** Weight of the semantic leg in the weighted RRF (0..1, default from hybrid-mmr). */
  semanticWeight?: number;
  /** MMR balance: 1 = pure relevance, 0 = pure diversity (default from hybrid-mmr). */
  mmrLambda?: number;
}

// ============================================================================
// Defaults / bounds
// ============================================================================

const DEFAULT_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const DEFAULT_MAX_PASSAGES = 20000;
const MAX_PASSAGES_CAP = 200000;
const DEFAULT_TOP_N = 8;
const MAX_TOP_N = 500;
const DEFAULT_EMBED_CHAR_LIMIT = 2000;

/** One stored passage: its provenance + (optional) embedding + BM25 id. */
interface IndexedPassage {
  /** Collision-free id used as the BM25 document id and the hybrid candidate id. */
  id: string;
  passage: Passage;
  embedding: Float32Array | null;
}

/**
 * In-memory, bounded embedding cache (insertion-order eviction). The default so
 * an index never re-embeds an identical passage within a run without letting the
 * cache grow without bound.
 */
export class InMemoryEmbeddingCache implements EmbeddingCache {
  private readonly map = new Map<string, Float32Array>();
  constructor(private readonly maxEntries: number = DEFAULT_MAX_PASSAGES) {}

  get(fingerprint: string): Float32Array | undefined {
    return this.map.get(fingerprint);
  }

  set(fingerprint: string, vector: Float32Array): void {
    if (this.map.has(fingerprint)) return;
    if (this.map.size >= this.maxEntries) {
      // Evict the oldest inserted key (Map preserves insertion order).
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(fingerprint, vector);
  }
}

// ============================================================================
// PassageIndex
// ============================================================================

/**
 * A passage-grain, hybrid-searchable index over one or more structured docs.
 *
 * Add documents with {@link addDocument} (chunk → embed → index), then query
 * with {@link search}. Bounded, never-throws, degrades to keyword-only when the
 * embedder is unavailable.
 */
export class PassageIndex {
  private readonly bm25 = new BM25Index();
  private readonly passages: IndexedPassage[] = [];
  private readonly embeddingCache: EmbeddingCache;
  private readonly embeddingModel: string;
  private readonly chunkOptions: ChunkOptions;
  private readonly maxPassages: number;
  private readonly embedCharLimit: number;
  private embedder: PassageEmbedder | null;
  private seq = 0;

  constructor(options: PassageIndexOptions = {}) {
    this.embedder = options.embedder ?? null;
    this.embeddingModel = options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.chunkOptions = options.chunkOptions ?? {};
    this.maxPassages = clampInt(options.maxPassages, DEFAULT_MAX_PASSAGES, 1, MAX_PASSAGES_CAP);
    this.embedCharLimit = clampInt(options.embedCharLimit, DEFAULT_EMBED_CHAR_LIMIT, 1, 1_000_000);
    this.embeddingCache = options.embeddingCache ?? new InMemoryEmbeddingCache(this.maxPassages);
  }

  /** Number of indexed passages. */
  size(): number {
    return this.passages.length;
  }

  /**
   * Chunk a structured document, embed each passage, and add them to the index.
   *
   * Never throws: a failing embedder leaves the affected passages without a
   * vector (they remain keyword-searchable). Respects the global passage cap.
   */
  async addDocument(doc: StructuredDoc): Promise<void> {
    let chunks: Passage[];
    try {
      chunks = chunkDocument(doc, this.chunkOptions);
    } catch (err) {
      logger.debug(`[paper-qa] chunkDocument failed, skipping doc: ${errText(err)}`);
      return;
    }
    if (chunks.length === 0) return;

    const remaining = this.maxPassages - this.passages.length;
    if (remaining <= 0) return;
    const accepted = chunks.length > remaining ? chunks.slice(0, remaining) : chunks;

    const vectors = await this.embedPassages(accepted);

    for (let i = 0; i < accepted.length; i++) {
      const passage = accepted[i]!;
      const id = `p${this.seq++}`;
      this.bm25.addDocument({ id, content: passage.text });
      this.passages.push({ id, passage, embedding: vectors[i] ?? null });
    }
  }

  /**
   * Evidence search: embed the question, fuse the keyword (BM25) and dense
   * (cosine) legs with weighted RRF, rerank with MMR, and return the top-N
   * passages with full provenance and per-leg scores.
   *
   * Never throws. Empty index → `[]`. Embedder unavailable → keyword-only
   * (BM25 ordering), exactly like the CKG's `recallHybrid` degradation.
   */
  async search(question: string, opts: PassageSearchOptions = {}): Promise<ScoredPassage[]> {
    if (this.passages.length === 0) return [];
    if (typeof question !== 'string' || question.trim().length === 0) return [];

    const topN = clampInt(opts.topN, DEFAULT_TOP_N, 1, MAX_TOP_N);

    // Dense leg: embed the query. On any failure, qVec stays null and the whole
    // pass degrades to keyword-only (semanticScore null on every candidate).
    let qVec: Float32Array | null = null;
    try {
      qVec = await this.embedOne(question);
    } catch (err) {
      logger.debug(`[paper-qa] query embedding unavailable, keyword-only: ${errText(err)}`);
    }

    // Lexical leg: BM25 over every indexed passage (raw scores, only ranks fused).
    const lexScores = new Map(
      this.bm25.search(question, this.passages.length).map((r) => [r.id, r.score]),
    );

    const semById = new Map<string, number>();
    const candidates: HybridCandidate[] = this.passages.map((entry) => {
      const vec = entry.embedding;
      const sem = vec && qVec ? Math.max(0, cosineSimilarityF32(qVec, vec)) : null;
      if (sem !== null) semById.set(entry.id, sem);
      return {
        id: entry.id,
        lexicalScore: lexScores.get(entry.id) ?? 0,
        semanticScore: sem,
        vector: vec,
      };
    });

    const ranked = hybridMmrRank(candidates, {
      k: topN,
      ...(opts.mmrLambda !== undefined ? { lambda: opts.mmrLambda } : {}),
      ...(opts.semanticWeight !== undefined ? { semanticWeight: opts.semanticWeight } : {}),
    });

    const byId = new Map(this.passages.map((e) => [e.id, e]));
    const results: ScoredPassage[] = [];
    for (const r of ranked) {
      const entry = byId.get(r.id);
      if (!entry) continue;
      results.push({
        passage: entry.passage,
        provenance: toProvenance(entry.passage),
        scores: {
          dense: semById.has(entry.id) ? semById.get(entry.id)! : null,
          keyword: lexScores.get(entry.id) ?? 0,
          final: r.relevance,
        },
      });
    }
    return results;
  }

  // --------------------------------------------------------------------------
  // Embedding internals
  // --------------------------------------------------------------------------

  /**
   * Embed a batch of passages, honoring the cache. Returns one vector per
   * passage (or `null` where embedding was unavailable). Never throws.
   */
  private async embedPassages(passages: Passage[]): Promise<(Float32Array | null)[]> {
    const out: (Float32Array | null)[] = new Array(passages.length).fill(null);
    const fingerprints = passages.map((p) => this.fingerprint(p.text));

    // Serve cache hits first; collect the misses to embed.
    const missIdx: number[] = [];
    for (let i = 0; i < passages.length; i++) {
      const cached = this.embeddingCache.get(fingerprints[i]!);
      if (cached) out[i] = cached;
      else missIdx.push(i);
    }
    if (missIdx.length === 0) return out;

    const embedder = this.resolveEmbedder();
    if (!embedder) return out; // no embedder → keyword-only

    const texts = missIdx.map((i) => truncate(passages[i]!.text, this.embedCharLimit));
    try {
      const vectors = await this.embedMany(embedder, texts);
      for (let j = 0; j < missIdx.length; j++) {
        const vec = vectors[j];
        if (!vec) continue;
        const idx = missIdx[j]!;
        out[idx] = vec;
        this.embeddingCache.set(fingerprints[idx]!, vec);
      }
    } catch (err) {
      // Degrade: leave misses as null (keyword-only for those passages).
      logger.debug(`[paper-qa] passage embedding unavailable, keyword-only: ${errText(err)}`);
    }
    return out;
  }

  /** Embed a single string (query path), honoring truncation. */
  private async embedOne(text: string): Promise<Float32Array | null> {
    const embedder = this.resolveEmbedder();
    if (!embedder) return null;
    const res = await embedder.embed(truncate(text, this.embedCharLimit));
    return res.embedding;
  }

  /** Prefer `embedBatch` when the embedder exposes it; else sequential `embed`. */
  private async embedMany(embedder: PassageEmbedder, texts: string[]): Promise<Float32Array[]> {
    if (typeof embedder.embedBatch === 'function') {
      const res = await embedder.embedBatch(texts);
      return res.embeddings;
    }
    const out: Float32Array[] = [];
    for (const t of texts) {
      out.push((await embedder.embed(t)).embedding);
    }
    return out;
  }

  /**
   * Lazily build the default multilingual embedder if none was injected.
   * `EmbeddingProvider` itself dynamically imports `@xenova/transformers` only on
   * first use, so constructing it here is cheap and keeps the model off the hot
   * path when a fake embedder was injected (tests / degraded runs).
   */
  private resolveEmbedder(): PassageEmbedder | null {
    if (this.embedder) return this.embedder;
    try {
      this.embedder = new EmbeddingProvider({ provider: 'local', modelName: this.embeddingModel });
      return this.embedder;
    } catch (err) {
      logger.debug(`[paper-qa] default embedder unavailable: ${errText(err)}`);
      return null;
    }
  }

  /** Content fingerprint (model-scoped) for the embedding cache. */
  private fingerprint(text: string): string {
    return createHash('sha1').update(`${this.embeddingModel}\n${text}`).digest('hex');
  }
}

// ============================================================================
// Helpers
// ============================================================================

function toProvenance(p: Passage): PassageProvenance {
  const prov: PassageProvenance = {
    docId: p.docId,
    page: p.page,
    charStart: p.charStart,
    charEnd: p.charEnd,
  };
  if (p.section !== undefined) prov.section = p.section;
  return prov;
}

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
