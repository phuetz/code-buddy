/**
 * PaperQA2-lite — passage index (Phase 2) tests.
 *
 * No-mocks: real chunker + real BM25 + real hybrid-MMR ranker, driven by a
 * DETERMINISTIC injected embedder (no ONNX model, no network). Two fake
 * embedders are used:
 *   - `bowEmbedder`    — bag-of-words (shared vocabulary → higher cosine), for
 *                        the general retrieval / provenance path.
 *   - `markerEmbedder` — assigns a vector purely from a BM25-INVISIBLE marker
 *                        (`⟦n⟧`), which fully DECOUPLES the dense leg from the
 *                        keyword leg so the hybrid fusion and MMR diversity can
 *                        be proven independently.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import {
  InMemoryEmbeddingCache,
  PassageIndex,
} from '../../../src/research/paper-qa/passage-index.js';
import { logger } from '../../../src/utils/logger.js';
import type { PassageEmbedder } from '../../../src/research/paper-qa/passage-index.js';
import { parsePdfStructure } from '../../../src/research/paper-qa/pdf-structure.js';
import type { ParsedPdf, StructuredDoc } from '../../../src/research/paper-qa/types.js';

// ---------------------------------------------------------------------------
// Fixtures & fake embedders
// ---------------------------------------------------------------------------

/** Build a real StructuredDoc through the Phase 1 parser with injected pages. */
async function docFromPages(pages: string[], docId?: string): Promise<StructuredDoc> {
  const parsed: ParsedPdf = {
    pages: pages.map((text, i) => ({ num: i + 1, text })),
    total: pages.length,
  };
  const doc = await parsePdfStructure(
    '/virtual/doc.pdf',
    { readFile: async () => Buffer.from('x'), parsePdf: async () => parsed },
    docId !== undefined ? { docId } : {},
  );
  return doc as StructuredDoc;
}

/** Lowercased word tokens (mirrors the intent of BM25's tokenizer for the fake). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Bag-of-words hashing embedder: shared vocabulary → higher cosine. Deterministic. */
function bowEmbedder(dim = 64): PassageEmbedder {
  const embed = async (text: string): Promise<{ embedding: Float32Array }> => {
    const v = new Float32Array(dim);
    for (const tok of words(text)) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
      v[h % dim] = (v[h % dim] ?? 0) + 1;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += (v[i] ?? 0) * (v[i] ?? 0);
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / norm;
    return { embedding: v };
  };
  return { embed };
}

/**
 * Marker embedder: the vector is a one-hot axis chosen by a `⟦n⟧` marker that
 * BM25 IGNORES (⟦⟧ are stripped, the bare digit is length-1 → dropped). This
 * decouples the semantic leg from the keyword leg. No marker → zero vector.
 */
function markerEmbedder(dim = 8): PassageEmbedder {
  const embed = async (text: string): Promise<{ embedding: Float32Array }> => {
    const v = new Float32Array(dim);
    const m = text.match(/⟦(\d+)⟧/);
    if (m && m[1] !== undefined) v[Number(m[1]) % dim] = 1;
    return { embedding: v };
  };
  return { embed };
}

/** An embedder that always rejects — exercises the keyword-only degradation. */
function throwingEmbedder(): PassageEmbedder {
  return { embed: async () => Promise.reject(new Error('embedder down')) };
}

// ---------------------------------------------------------------------------
// Core: index → search → provenance
// ---------------------------------------------------------------------------

describe('PassageIndex — index, search, provenance', () => {
  it('finds the passage answering a targeted question with correct page/section provenance', async () => {
    const doc = await docFromPages([
      'Introduction\nProvenance lets a reader trace a claim back to its exact page in the document.',
      'Methods\nWe measured the boiling point of water at sea level and recorded one hundred degrees celsius.',
    ]);

    const index = new PassageIndex({
      embedder: bowEmbedder(),
      chunkOptions: { targetChars: 30, overlapChars: 0 },
    });
    await index.addDocument(doc);
    expect(index.size()).toBeGreaterThanOrEqual(2);

    const results = await index.search('what is the boiling point of water in celsius');
    expect(results.length).toBeGreaterThan(0);

    const top = results[0]!;
    expect(top.passage.text).toContain('boiling point');
    // Full provenance is carried through to the citation shape.
    expect(top.provenance.docId).toBe(doc.docId);
    expect(top.provenance.page).toBe(2);
    expect(top.provenance.section).toBe('Methods');
    expect(top.provenance.charEnd).toBeGreaterThan(top.provenance.charStart);
    // Provenance slice invariant survives indexing.
    expect(doc.fullText.slice(top.provenance.charStart, top.provenance.charEnd)).toBe(top.passage.text);
    // Both legs scored the hit.
    expect(top.scores.dense).not.toBeNull();
    expect(top.scores.keyword).toBeGreaterThan(0);
    expect(top.scores.final).toBeGreaterThan(0);
    // The dense leg WAS available on this search (finding E).
    expect(index.lastSemanticAvailable).toBe(true);
  });

  it('BM25 keyword: an exact rare term in one passage surfaces that passage', async () => {
    const doc = await docFromPages([
      'The quick brown fox jumps over the lazy dog near the river bank at dawn.',
      'Mitochondria are the powerhouse organelles found inside eukaryotic cells today.',
      'The committee approved the annual budget after a long and detailed discussion.',
    ]);

    const index = new PassageIndex({
      embedder: bowEmbedder(),
      chunkOptions: { targetChars: 20, overlapChars: 0 },
    });
    await index.addDocument(doc);

    const results = await index.search('mitochondria organelles');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.passage.text.toLowerCase()).toContain('mitochondria');
    expect(results[0]!.scores.keyword).toBeGreaterThan(0);
  });

  it('hybrid fusion: keyword-only vs dense-only pick DIFFERENT winners (both legs wired)', async () => {
    // A matches the query keywords (dense-far); B matches the query dense axis
    // (keyword-empty). The marker ⟦n⟧ is BM25-invisible, so the legs are decoupled.
    const doc = await docFromPages([
      'the quantum entanglement of paired particles was observed carefully ⟦0⟧',
      'photosynthesis slowly converts sunlight into stored chemical energy ⟦1⟧',
      'the afternoon weather stayed mild pleasant and calm throughout ⟦2⟧',
    ]);
    const index = new PassageIndex({
      embedder: markerEmbedder(),
      chunkOptions: { targetChars: 20, overlapChars: 0 },
    });
    await index.addDocument(doc);

    const query = 'quantum entanglement ⟦1⟧';

    const keywordOnly = await index.search(query, { semanticWeight: 0 });
    expect(keywordOnly[0]!.passage.text).toContain('quantum entanglement');

    const denseOnly = await index.search(query, { semanticWeight: 1 });
    expect(denseOnly[0]!.passage.text).toContain('photosynthesis');

    // Different winners ⇒ the two legs are genuinely fused, not one dominating.
    expect(keywordOnly[0]!.passage.text).not.toBe(denseOnly[0]!.passage.text);
  });

  it('MMR: default λ diversifies near-duplicates; λ=1 (pure relevance) does not', async () => {
    // Three near-duplicate passages (dense axis 0) + one distinct-but-relevant
    // passage (dense axis 1). All share the keyword "reactor" so all are relevant.
    const doc = await docFromPages([
      'the reactor core temperature is reported as nominal ⟦0⟧',
      'the reactor core temperature stays reported as nominal ⟦0⟧',
      'the reactor core temperature reads reported as nominal ⟦0⟧',
      'the reactor safety valve was recently inspected onsite ⟦1⟧',
    ]);
    const index = new PassageIndex({
      embedder: markerEmbedder(),
      chunkOptions: { targetChars: 20, overlapChars: 0 },
    });
    await index.addDocument(doc);

    const query = 'reactor status ⟦0⟧';

    const diverse = await index.search(query, { topN: 2 });
    expect(diverse.length).toBe(2);
    const diverseTexts = diverse.map((r) => r.passage.text);
    // The distinct passage is pulled into the top-2 for coverage...
    expect(diverseTexts.some((t) => t.includes('safety valve'))).toBe(true);
    // ...and the near-duplicate cluster is not repeated.
    const dupCount = diverseTexts.filter((t) => t.includes('nominal')).length;
    expect(dupCount).toBe(1);

    // Pure relevance (λ=1) has no diversity pressure → top-2 are two duplicates.
    const greedy = await index.search(query, { topN: 2, mmrLambda: 1 });
    const greedyDupCount = greedy.filter((r) => r.passage.text.includes('nominal')).length;
    expect(greedyDupCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Degradation & bounds
// ---------------------------------------------------------------------------

describe('PassageIndex — degradation and bounds', () => {
  it('degrades to keyword-only when the embedder throws (never crashes)', async () => {
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const doc = await docFromPages([
      'The heron stood motionless at the edge of the reed bed waiting patiently.',
      'Neural networks learn representations from data through gradient descent optimization.',
    ]);
    const index = new PassageIndex({
      embedder: throwingEmbedder(),
      chunkOptions: { targetChars: 20, overlapChars: 0 },
    });

    // addDocument must not throw even though embedding fails.
    await expect(index.addDocument(doc)).resolves.toBeUndefined();
    expect(index.size()).toBeGreaterThanOrEqual(2);

    const results = await index.search('neural networks gradient descent');
    expect(results.length).toBeGreaterThan(0);
    // Keyword leg still ranks the right passage...
    expect(results[0]!.passage.text.toLowerCase()).toContain('neural networks');
    // ...and the dense score is honestly null (no embeddings available).
    for (const r of results) {
      expect(r.scores.dense).toBeNull();
      expect(r.scores.keyword).toBeGreaterThanOrEqual(0);
    }
    // The degradation is now VISIBLE to callers (finding E): the last search
    // reports its semantic leg was unavailable.
    expect(index.lastSemanticAvailable).toBe(false);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('explicitly degraded to BM25-only'),
      expect.objectContaining({ reason: expect.any(String) }),
    );
    warning.mockRestore();
  });

  it('returns [] for an empty index and an empty question', async () => {
    const index = new PassageIndex({ embedder: bowEmbedder() });
    expect(await index.search('anything at all')).toEqual([]);

    const doc = await docFromPages(['A single page with some ordinary prose to index here.']);
    await index.addDocument(doc);
    expect(await index.search('')).toEqual([]);
    expect(await index.search('   ')).toEqual([]);
  });

  it('respects the top-N cap', async () => {
    const pages = Array.from(
      { length: 12 },
      (_, i) => `Passage number ${i} discusses distributed systems and consensus protocols in depth.`,
    );
    const doc = await docFromPages(pages);
    const index = new PassageIndex({
      embedder: bowEmbedder(),
      chunkOptions: { targetChars: 20, overlapChars: 0 },
    });
    await index.addDocument(doc);
    expect(index.size()).toBeGreaterThan(3);

    const results = await index.search('distributed consensus protocols', { topN: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('respects the maxPassages cap across the index', async () => {
    const pages = Array.from(
      { length: 20 },
      (_, i) => `Bounded passage ${i} full of filler prose that should be indexed only up to the cap.`,
    );
    const doc = await docFromPages(pages);
    const index = new PassageIndex({
      embedder: bowEmbedder(),
      chunkOptions: { targetChars: 20, overlapChars: 0 },
      maxPassages: 5,
    });
    await index.addDocument(doc);
    expect(index.size()).toBe(5);
  });

  it('caches embeddings by fingerprint (identical passage embedded once)', async () => {
    let calls = 0;
    const counting: PassageEmbedder = {
      embed: async (text: string) => {
        calls++;
        return bowEmbedder().embed(text);
      },
    };
    const index = new PassageIndex({ embedder: counting, chunkOptions: { targetChars: 5000 } });

    const text = 'One identical single-passage page reused across two distinct documents entirely.';
    const doc1 = await docFromPages([text], 'docA');
    const doc2 = await docFromPages([text], 'docB');

    await index.addDocument(doc1);
    const afterFirst = calls;
    expect(afterFirst).toBe(1); // one passage embedded
    await index.addDocument(doc2);
    // Same passage text → served from cache, no new embed call.
    expect(calls).toBe(afterFirst);
    // But both provenance rows are indexed under their distinct docIds.
    expect(index.size()).toBe(2);
    const results = await index.search('identical single passage documents');
    const docIds = new Set(results.map((r) => r.provenance.docId));
    expect(docIds.has('docA')).toBe(true);
    expect(docIds.has('docB')).toBe(true);
  });

  it('never reuses vectors from the pre-fix cache namespace that could contain mock data', async () => {
    const model = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
    const text = 'A traceable passage about dopamine transport and neuronal signalling.';
    const cache = new InMemoryEmbeddingCache(10);
    const legacyFingerprint = createHash('sha1').update(`${model}\n${text}`).digest('hex');
    cache.set(legacyFingerprint, new Float32Array([0.123, 0.456]));
    let calls = 0;
    const embedder: PassageEmbedder = {
      embed: async (value) => {
        calls += 1;
        return bowEmbedder().embed(value);
      },
    };
    const index = new PassageIndex({
      embedder,
      embeddingModel: model,
      embeddingCache: cache,
      chunkOptions: { targetChars: 5000, overlapChars: 0 },
    });

    await index.addDocument(await docFromPages([text], 'legacy-cache-proof'));

    expect(calls).toBe(1);
  });
});
