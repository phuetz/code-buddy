/**
 * PaperQA2-lite — Phase 4 orchestration helper tests.
 *
 * No-mocks: the REAL corpus→search→answer chain runs, with an injected
 * deterministic pdf-parse boundary, a bag-of-words embedder, and a fake LLM
 * (RCS + synthesis). No filesystem PDFs, no ONNX model, no network.
 *
 * Pins the chaining contract: distinct-docId provenance carried through, honest
 * refusal on irrelevant evidence, and a bounded, provenance-aware rendered view.
 */
import { describe, it, expect } from 'vitest';

import {
  runPaperQa,
  formatPaperQaOutput,
  deriveSourceLabels,
} from '../../../src/research/paper-qa/paper-qa-pipeline.js';
import type { PassageEmbedder } from '../../../src/research/paper-qa/passage-index.js';
import type { PassageLlmMessage, PassageQaLlm } from '../../../src/research/paper-qa/rcs.js';
import type { ParsedPdf, PdfStructureDeps } from '../../../src/research/paper-qa/types.js';

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

function corpusDeps(corpus: Record<string, string[]>): PdfStructureDeps {
  return {
    readFile: async (p: string) => Buffer.from(p, 'utf8'),
    parsePdf: async (data: Uint8Array): Promise<ParsedPdf | null> => {
      const p = Buffer.from(data).toString('utf8');
      const pages = corpus[p];
      if (!pages) return null;
      return { pages: pages.map((text, i) => ({ num: i + 1, text })), total: pages.length };
    },
  };
}

function fakeLlm(keyword: string): PassageQaLlm {
  return async (messages: PassageLlmMessage[]): Promise<string> => {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    if (system.startsWith('You judge')) {
      const passage = user.slice(user.indexOf('Passage:') + 'Passage:'.length);
      return passage.toLowerCase().includes(keyword.toLowerCase())
        ? 'RELEVANCE: 0.9\nSUMMARY: relevant evidence'
        : 'RELEVANCE: 0.1\nSUMMARY: NONE';
    }
    const markers = new Set<number>();
    const re = /^\[(\d+)\]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(user)) !== null) markers.add(Number(m[1]));
    return [...markers].sort((a, b) => a - b).map((n) => `Claim ${n} holds [${n}].`).join(' ');
  };
}

const CORPUS: Record<string, string[]> = {
  '/papers/photosynthesis.pdf': [
    'Photosynthesis converts light energy into chemical energy inside plant chloroplasts every day. ' +
      'Light-dependent reactions split water and release oxygen during photosynthesis.',
  ],
  '/papers/reactor.pdf': [
    'The nuclear reactor sustains a controlled fission chain reaction to generate electricity.',
  ],
};

describe('runPaperQa (chained pipeline)', () => {
  it('produces a grounded answer with page provenance and a References section', async () => {
    const result = await runPaperQa(
      'How does photosynthesis convert light energy?',
      Object.keys(CORPUS),
      fakeLlm('photosynthesis'),
      { embedder: bowEmbedder(), pdfDeps: corpusDeps(CORPUS), topK: 4 },
    );

    expect(result.indexedPassages).toBeGreaterThanOrEqual(2);
    expect(result.pdfPathsConsidered).toBe(2);
    expect(result.retrievedPassages).toBeGreaterThan(0);
    expect(result.indexedDocuments).toBe(2);
    expect(result.answer.sufficient).toBe(true);
    expect(result.answer.citations.length).toBeGreaterThan(0);
    // Semantic retrieval was available on this run (finding E).
    expect(result.semanticAvailable).toBe(true);
    // Every citation resolves to page 1 with a stable (hash) docId provenance.
    for (const c of result.answer.citations) {
      expect(c.page).toBe(1);
      expect(c.docId).toMatch(/^[0-9a-f]{16}$/);
    }

    // The rendered view relabels the hash docId to the readable source filename.
    const rendered = formatPaperQaOutput(result, deriveSourceLabels(Object.keys(CORPUS)));
    expect(rendered).toContain('# Paper QA :');
    expect(rendered).toContain('## Références');
    expect(rendered).toContain('répondu (ancré)');
    expect(rendered).toContain('photosynthesis.pdf');
  });

  it('cites the page a mid-document fact really lives on (page-boundary chunking)', async () => {
    // Three short pages whose combined length is under the default 1000-char
    // target: the pre-fix chunker made ONE cross-page passage and cited page 1
    // for the page-2 "stroma" fact. The fix cuts on page frontiers → page 2.
    const CORPUS3: Record<string, string[]> = {
      '/papers/photosynthesis.pdf': [
        'Introduction\nPhotosynthesis converts light energy into chemical energy in plant chloroplasts.',
        'Methods\nThe Calvin cycle occurs in the stroma of the chloroplast and fixes carbon dioxide into glucose.',
        'Conclusion\nTogether the two stages let plants store solar energy as sugars.',
      ],
    };

    const result = await runPaperQa(
      'Where does the Calvin cycle take place?',
      Object.keys(CORPUS3),
      fakeLlm('stroma'), // only the page-2 passage is judged relevant
      { embedder: bowEmbedder(), pdfDeps: corpusDeps(CORPUS3), topK: 4 },
    );

    expect(result.answer.sufficient).toBe(true);
    expect(result.answer.citations.length).toBeGreaterThan(0);
    // The cited passage resolves to PAGE 2 (where "stroma" lives), not page 1.
    for (const c of result.answer.citations) {
      expect(c.page).toBe(2);
    }
    const rendered = formatPaperQaOutput(result, deriveSourceLabels(Object.keys(CORPUS3)));
    expect(rendered).toContain('p.2');
  });

  it('surfaces a semantic-unavailable warning when the embedder is down (finding E)', async () => {
    const downEmbedder: PassageEmbedder = { embed: async () => Promise.reject(new Error('embedder down')) };
    const result = await runPaperQa(
      'How does photosynthesis convert light energy?',
      Object.keys(CORPUS),
      fakeLlm('photosynthesis'),
      { embedder: downEmbedder, pdfDeps: corpusDeps(CORPUS), topK: 4 },
    );

    // Retrieval still works keyword-only (BM25), so an answer is still possible...
    expect(result.retrievedPassages).toBeGreaterThan(0);
    // ...but the degradation is reported on the result and rendered in the header.
    expect(result.semanticAvailable).toBe(false);
    expect(result.retrievalMode).toBe('bm25-only');
    expect(result.degraded).toBe(true);
    const rendered = formatPaperQaOutput(result, deriveSourceLabels(Object.keys(CORPUS)));
    expect(rendered).toContain('recherche sémantique indisponible');
    expect(rendered).toContain('BM25 seul (MODE DÉGRADÉ)');
  });

  it('refuses honestly when the evidence is irrelevant', async () => {
    const result = await runPaperQa(
      'What is quantum entanglement?',
      Object.keys(CORPUS),
      fakeLlm('quantum'), // nothing in the corpus is judged relevant
      { embedder: bowEmbedder(), pdfDeps: corpusDeps(CORPUS) },
    );
    expect(result.answer.sufficient).toBe(false);
    expect(result.answer.citations).toEqual([]);
    const rendered = formatPaperQaOutput(result);
    expect(rendered).toContain('Preuves insuffisantes');
    expect(rendered).toContain('refus honnête');
  });

  it('reports an empty index for an empty corpus (no crash)', async () => {
    const result = await runPaperQa('anything', [], fakeLlm('x'), { embedder: bowEmbedder() });
    expect(result.indexedPassages).toBe(0);
    expect(result.retrievedPassages).toBe(0);
    expect(result.answer.sufficient).toBe(false);
  });
});
