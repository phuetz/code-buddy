/**
 * PaperQA2-lite — mock-embedding guard (integration regression).
 *
 * Locks the fix landed in 0650ac13 ("fiabiliser les index scientifiques") for
 * the 2026-07-27 audit finding: before that commit, `EmbeddingProvider` would
 * SILENTLY switch itself to the `mock` provider when the local model failed to
 * load (e.g. no network on the very first HuggingFace download), feeding
 * hash-derived pseudo-random vectors into the dense leg of the passage search —
 * semantic ranking became random and the BM25-only warning never fired, because
 * it only fired when `embed()` THREW.
 *
 * Unlike the unit tests (provider alone) and the passage-index tests (fake
 * injected embedders), this file wires the REAL `EmbeddingProvider` into the
 * REAL `PassageIndex` and proves the cross-module property end to end: a
 * mock/pseudo-random embedding can never silently reach a semantic score. The
 * failure must be LOUD (visible `logger.warn`) and OBSERVABLE
 * (`scores.dense === null` on every hit, `lastSemanticAvailable === false`).
 *
 * Against the pre-fix provider these tests fail: every hit carried a non-null
 * hash-derived dense score and no degradation warning was emitted.
 */

import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The provider dynamically imports @xenova/transformers on first use; mock it
// so "local model" behavior is fully controlled (no ONNX model, no network).
const pipelineMock = vi.hoisted(() => vi.fn());
vi.mock('@xenova/transformers', () => ({ pipeline: pipelineMock }));

import { EmbeddingProvider } from '../../../src/embeddings/embedding-provider.js';
import { PassageIndex } from '../../../src/research/paper-qa/passage-index.js';
import { parsePdfStructure } from '../../../src/research/paper-qa/pdf-structure.js';
import { logger } from '../../../src/utils/logger.js';
import type { ParsedPdf, StructuredDoc } from '../../../src/research/paper-qa/types.js';

// ---------------------------------------------------------------------------
// Fixtures
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

/** A two-page medical corpus where the answer lives on page 2 (keyword-findable). */
function corpusPages(): string[] {
  return [
    'Introduction\nLevodopa remains the reference treatment for the motor symptoms of Parkinson disease.',
    'Results\nDeep brain stimulation of the subthalamic nucleus reduces motor fluctuations in advanced patients.',
  ];
}

const QUESTION = 'which intervention reduces motor fluctuations';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PaperQA — a simulated embedding can never silently feed the semantic ranking', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pipelineMock.mockReset();
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('local model load failure (offline first download): loud, observable BM25-only degradation — never pseudo-random vectors', async () => {
    // The audit scenario: transformers resolves but the model download fails.
    pipelineMock.mockRejectedValue(new Error('offline: first model download failed'));
    const previousTransformersCache = process.env.TRANSFORMERS_CACHE;
    try {
      const embedder = new EmbeddingProvider({ provider: 'local', cacheDir: os.tmpdir() });
      const index = new PassageIndex({
        embedder,
        chunkOptions: { targetChars: 30, overlapChars: 0 },
      });

      // Never-throws contract holds end to end.
      await expect(index.addDocument(await docFromPages(corpusPages()))).resolves.toBeUndefined();
      const hits = await index.search(QUESTION);

      // The keyword leg still answers (fail-loud, not fail-dead)...
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.passage.text.toLowerCase()).toContain('motor fluctuations');

      // ...but NO hit may carry a dense score. With the pre-fix silent mock
      // fallback, every hit carried a non-null hash-derived cosine here.
      for (const hit of hits) {
        expect(hit.scores.dense).toBeNull();
      }

      // The degradation is observable by the caller (pipeline → `degraded: true`)…
      expect(index.lastSemanticAvailable).toBe(false);
      // …and loud: the explicit BM25-only warning fired. Pre-fix, `embed()`
      // resolved with mock vectors, so this warning never triggered.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('explicitly degraded to BM25-only'),
        expect.objectContaining({ reason: expect.any(String) }),
      );
    } finally {
      if (previousTransformersCache === undefined) delete process.env.TRANSFORMERS_CACHE;
      else process.env.TRANSFORMERS_CACHE = previousTransformersCache;
    }
  });

  it("a 'mock'-configured provider outside the test runtime is rejected: search stays BM25-only and warns", async () => {
    const doc = await docFromPages(corpusPages());
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const embedder = new EmbeddingProvider({ provider: 'mock' });
      const index = new PassageIndex({
        embedder,
        chunkOptions: { targetChars: 30, overlapChars: 0 },
      });

      await expect(index.addDocument(doc)).resolves.toBeUndefined();
      const hits = await index.search(QUESTION);

      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit.scores.dense).toBeNull();
      }
      expect(index.lastSemanticAvailable).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('explicitly degraded to BM25-only'),
        expect.objectContaining({ error: expect.stringContaining('test-only') }),
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('control: under the test runtime the mock provider DOES feed the dense leg — the assertions above discriminate', async () => {
    // NODE_ENV is 'test' under Vitest: mock embeddings are allowed. This is the
    // pre-fix behavior surface — if either guard above regressed, dense scores
    // would look exactly like this and the two tests above would fail.
    const embedder = new EmbeddingProvider({ provider: 'mock' });
    const index = new PassageIndex({
      embedder,
      chunkOptions: { targetChars: 30, overlapChars: 0 },
    });

    await index.addDocument(await docFromPages(corpusPages()));
    const hits = await index.search(QUESTION);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.scores.dense !== null)).toBe(true);
    expect(index.lastSemanticAvailable).toBe(true);
  });
});
