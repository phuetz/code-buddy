/**
 * PaperQA2-lite — corpus indexing (Phase 2) tests.
 *
 * No-mocks: real parser + real index, with an injected deterministic pdf-parse
 * boundary (per-path page content) and a deterministic bag-of-words embedder.
 * No filesystem PDFs, no ONNX model, no network.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { buildCorpusIndex } from '../../../src/research/paper-qa/corpus.js';
import type { PassageEmbedder } from '../../../src/research/paper-qa/passage-index.js';
import type { ParsedPdf, PdfStructureDeps } from '../../../src/research/paper-qa/types.js';

/** Deterministic bag-of-words embedder (shared vocabulary → higher cosine). */
function bowEmbedder(dim = 64): PassageEmbedder {
  const embed = async (text: string): Promise<{ embedding: Float32Array }> => {
    const v = new Float32Array(dim);
    const toks = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
    for (const tok of toks) {
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
 * PDF deps that resolve each path to its own page content. `readFile` returns
 * the path bytes; `parsePdf` looks the path up in the corpus map. An unknown
 * path resolves to `null` (unreadable → skipped by the corpus builder).
 */
function corpusDeps(corpus: Record<string, string[]>): PdfStructureDeps {
  return {
    readFile: async (path: string) => Buffer.from(path, 'utf8'),
    parsePdf: async (data: Uint8Array): Promise<ParsedPdf | null> => {
      const path = Buffer.from(data).toString('utf8');
      const pages = corpus[path];
      if (!pages) return null;
      return { pages: pages.map((text, i) => ({ num: i + 1, text })), total: pages.length };
    },
  };
}

describe('buildCorpusIndex', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('indexes ≥2 documents and preserves distinct docId provenance', async () => {
    const corpus: Record<string, string[]> = {
      '/papers/photosynthesis.pdf': [
        'Photosynthesis converts light energy into chemical energy inside plant chloroplasts daily.',
      ],
      '/papers/reactor.pdf': [
        'The nuclear reactor sustains a controlled fission chain reaction to generate electricity.',
      ],
    };
    const index = await buildCorpusIndex(Object.keys(corpus), {
      embedder: bowEmbedder(),
      pdfDeps: corpusDeps(corpus),
      chunkOptions: { targetChars: 20, overlapChars: 0 },
    });

    expect(index.size()).toBe(2);

    // A question about one paper cites that paper's provenance (distinct docId).
    const photo = await index.search('how does photosynthesis convert light energy', { topN: 1 });
    expect(photo[0]!.passage.text.toLowerCase()).toContain('photosynthesis');
    const photoDocId = photo[0]!.provenance.docId;

    const reactor = await index.search('nuclear fission chain reaction electricity', { topN: 1 });
    expect(reactor[0]!.passage.text.toLowerCase()).toContain('reactor');
    const reactorDocId = reactor[0]!.provenance.docId;

    // Provenance keeps the two papers separable.
    expect(photoDocId).not.toBe(reactorDocId);
  });

  it('skips unreadable/absent PDFs without crashing', async () => {
    const corpus: Record<string, string[]> = {
      '/papers/good.pdf': [
        'A perfectly readable page of prose describing gradient descent optimization steps clearly.',
      ],
      // '/papers/missing.pdf' intentionally absent → parsePdf returns null.
    };
    const index = await buildCorpusIndex(['/papers/good.pdf', '/papers/missing.pdf'], {
      embedder: bowEmbedder(),
      pdfDeps: corpusDeps(corpus),
      chunkOptions: { targetChars: 20, overlapChars: 0 },
    });

    // Only the readable PDF is indexed; the missing one is silently skipped.
    expect(index.size()).toBeGreaterThanOrEqual(1);
    const results = await index.search('gradient descent optimization');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns an empty, searchable index for an empty corpus', async () => {
    const index = await buildCorpusIndex([], { embedder: bowEmbedder() });
    expect(index.size()).toBe(0);
    expect(await index.search('anything')).toEqual([]);
  });

  it('respects the maxDocs cap', async () => {
    const corpus: Record<string, string[]> = {
      '/p/a.pdf': ['Alpha document content about apples and orchards in the countryside.'],
      '/p/b.pdf': ['Beta document content about bicycles and mountain trails at altitude.'],
      '/p/c.pdf': ['Gamma document content about cameras and long exposure photography techniques.'],
    };
    const index = await buildCorpusIndex(Object.keys(corpus), {
      embedder: bowEmbedder(),
      pdfDeps: corpusDeps(corpus),
      chunkOptions: { targetChars: 20, overlapChars: 0 },
      maxDocs: 2,
    });
    // Only the first 2 of 3 documents were parsed → exactly 2 passages.
    expect(index.size()).toBe(2);
  });

  it('persists document shards and reparses only PDFs whose content hash changed', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'paper-qa-index-'));
    temporaryDirectories.push(directory);
    const corpus: Record<string, string> = {
      '/papers/a.pdf': 'Alpha paper describes dopamine neuron signalling in detail.',
      '/papers/b.pdf': 'Beta paper describes gait measurements in a longitudinal cohort.',
    };
    let parseCalls = 0;
    let embedCalls = 0;
    const deps: PdfStructureDeps = {
      readFile: async (pdfPath) => Buffer.from(corpus[pdfPath] ?? '', 'utf8'),
      parsePdf: async (data) => {
        parseCalls += 1;
        const text = Buffer.from(data).toString('utf8');
        return { pages: [{ num: 1, text }], total: 1 };
      },
    };
    const embedder: PassageEmbedder = {
      embed: async (text) => {
        embedCalls += 1;
        return bowEmbedder().embed(text);
      },
    };
    const options = {
      embedder,
      pdfDeps: deps,
      persistentIndex: true,
      persistentIndexDirectory: directory,
      persistentEmbeddingCache: true,
      chunkOptions: { targetChars: 5000, overlapChars: 0 },
    } as const;

    const first = await buildCorpusIndex(Object.keys(corpus), options);
    expect(first.size()).toBe(2);
    expect(parseCalls).toBe(2);
    expect(embedCalls).toBe(2);

    const second = await buildCorpusIndex(Object.keys(corpus), options);
    expect(second.size()).toBe(2);
    expect(parseCalls).toBe(2);
    expect(embedCalls).toBe(2);

    corpus['/papers/b.pdf'] =
      'Beta revision reports altered gait cadence after the protocol amendment.';
    const third = await buildCorpusIndex(Object.keys(corpus), options);
    expect(third.size()).toBe(2);
    expect(parseCalls).toBe(3);
    expect(embedCalls).toBe(3);
    const hits = await third.search('altered gait cadence protocol', { topN: 1 });
    expect(hits[0]!.passage.text).toContain('altered gait cadence');
  });
});
