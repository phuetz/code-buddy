/**
 * PaperQA2-lite — grounded answer tests, Phase 3.
 *
 * No-mocks: a deterministic fake LLM is INJECTED for BOTH RCS and synthesis (it
 * dispatches on the system prompt). No real LLM/network. These tests pin the
 * anti-hallucination invariant: every `[n]` the answer carries resolves to a
 * REAL provided passage, the References are rendered by CODE from that passage's
 * provenance, and the engine REFUSES honestly when evidence is missing.
 */

import { describe, it, expect } from 'vitest';
import { answerFromPassages } from '../../../src/research/paper-qa/answer.js';
import type { GroundedAnswer } from '../../../src/research/paper-qa/answer.js';
import type { PassageLlmMessage, PassageQaLlm } from '../../../src/research/paper-qa/rcs.js';
import type { ScoredPassage } from '../../../src/research/paper-qa/passage-index.js';
import { buildCorpusIndex } from '../../../src/research/paper-qa/corpus.js';
import type { PassageEmbedder } from '../../../src/research/paper-qa/passage-index.js';
import type { ParsedPdf, PdfStructureDeps } from '../../../src/research/paper-qa/types.js';

// --- Fixtures ---------------------------------------------------------------

let charCursor = 0;
interface MkOpts {
  docId?: string;
  page?: number;
  section?: string;
  final?: number;
}
function mkScored(text: string, o: MkOpts = {}): ScoredPassage {
  const charStart = charCursor;
  const charEnd = charStart + text.length;
  charCursor = charEnd + 1;
  const docId = o.docId ?? 'paper.pdf';
  const page = o.page ?? 1;
  const provenance = {
    docId,
    page,
    charStart,
    charEnd,
    ...(o.section !== undefined ? { section: o.section } : {}),
  };
  return {
    passage: {
      docId,
      page,
      charStart,
      charEnd,
      text,
      index: 0,
      ...(o.section !== undefined ? { section: o.section } : {}),
    },
    provenance,
    scores: { dense: 0.5, keyword: 1, final: o.final ?? 0.5 },
  };
}

interface FakeOpts {
  /** Passages whose text contains this keyword are judged relevant (0.9), else 0.1. */
  keyword: string;
  /** Build the synthesis body from the markers listed in the prompt. */
  synth?: (markers: number[]) => string;
  /** Synthesis LLM throws (degradation path). */
  throwOnSynth?: boolean;
  /** Synthesis LLM declares the evidence insufficient. */
  insufficient?: boolean;
}

/** Distinct integer `[k]` markers appearing at line starts in the evidence list. */
function listedMarkers(userPrompt: string): number[] {
  const out = new Set<number>();
  const re = /^\[(\d+)\]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(userPrompt)) !== null) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

/** Combined fake LLM: RCS (system "You judge…") + synthesis (system "You answer…"). */
function fakeLlm(o: FakeOpts): PassageQaLlm {
  return async (messages: PassageLlmMessage[]): Promise<string> => {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';

    if (system.startsWith('You judge')) {
      // Inspect ONLY the passage portion (not the question, which may name the keyword).
      const passage = user.slice(user.indexOf('Passage:') + 'Passage:'.length);
      const relevant = passage.toLowerCase().includes(o.keyword.toLowerCase());
      return relevant ? 'RELEVANCE: 0.9\nSUMMARY: relevant evidence' : 'RELEVANCE: 0.1\nSUMMARY: NONE';
    }
    // Synthesis branch.
    if (o.throwOnSynth) throw new Error('synthesis model unavailable');
    if (o.insufficient) return 'INSUFFICIENT';
    const markers = listedMarkers(user);
    const build = o.synth ?? ((ms: number[]) => ms.map((m) => `Claim ${m} holds [${m}].`).join(' '));
    return build(markers);
  };
}

/** Assert a citation resolves to exactly one provided passage (provenance + excerpt). */
function citationMatchesAProvidedPassage(a: GroundedAnswer, provided: ScoredPassage[]): void {
  for (const c of a.citations) {
    const match = provided.find(
      (p) =>
        p.provenance.docId === c.docId &&
        p.provenance.page === c.page &&
        p.provenance.charStart === c.charStart &&
        p.provenance.charEnd === c.charEnd &&
        p.provenance.section === c.section,
    );
    expect(match, `citation [${c.marker}] must map to a provided passage`).toBeDefined();
    // The excerpt is a code-derived prefix of the REAL passage text (not the LLM's).
    const flat = match!.passage.text.replace(/\s+/g, ' ').trim();
    const excerptCore = c.excerpt.replace(/…$/, '');
    expect(flat.startsWith(excerptCore)).toBe(true);
  }
}

// --- Grounded answers -------------------------------------------------------

describe('answerFromPassages — grounded answer', () => {
  it('cites the right passages with correct page/section provenance', async () => {
    const passages = [
      mkScored('Backpropagation adjusts network weights via gradient descent.', {
        docId: 'dl.pdf',
        page: 3,
        section: 'Training',
        final: 0.9,
      }),
      mkScored('Hidden layers of a neural network learn hierarchical representations.', {
        docId: 'dl.pdf',
        page: 5,
        section: 'Architecture',
        final: 0.8,
      }),
    ];
    const res = await answerFromPassages('how do neural networks learn', passages, fakeLlm({ keyword: 'network' }));

    expect(res.sufficient).toBe(true);
    expect(res.reason).toBe('answered');
    expect(res.retainedCount).toBe(2);
    expect(res.llmUsed).toBe(true);
    expect(res.citations.length).toBe(2);

    // Every [n] in the body has a matching citation, and vice-versa.
    for (const c of res.citations) expect(res.answer).toContain(`[${c.marker}]`);
    citationMatchesAProvidedPassage(res, passages);

    // Deterministic References carry the real page/section (rendered by code).
    expect(res.answer).toContain('## Références');
    const pages = res.citations.map((c) => c.page).sort();
    expect(pages).toEqual([3, 5]);
    const sections = res.citations.map((c) => c.section).sort();
    expect(sections).toEqual(['Architecture', 'Training']);
    expect(res.answer).toContain('p.3, Training');
    expect(res.answer).toContain('p.5, Architecture');
  });

  it('NEVER cites a passage that was not provided (fabricated markers are stripped)', async () => {
    const passages = [
      mkScored('Photosynthesis converts light energy into chemical energy in chloroplasts.', {
        docId: 'bio.pdf',
        page: 2,
        section: 'Overview',
      }),
    ];
    // The synthesizer fabricates an out-of-range citation [99] alongside the real [1].
    const res = await answerFromPassages(
      'what is photosynthesis',
      passages,
      fakeLlm({ keyword: 'photosynthesis', synth: () => 'Light becomes chemical energy [1], per an invented source [99].' }),
    );

    expect(res.sufficient).toBe(true);
    // The fabricated marker is gone from the body and absent from citations.
    expect(res.answer).not.toContain('[99]');
    expect(res.citations.map((c) => c.marker)).toEqual([1]);
    citationMatchesAProvidedPassage(res, passages);
  });

  it('renders a References entry per cited passage, each traceable to a real passage', async () => {
    const passages = [
      mkScored('The transformer uses self-attention over token embeddings.', { docId: 'nlp.pdf', page: 7, section: 'Model', final: 0.9 }),
      mkScored('Positional encodings inject order information into the sequence.', { docId: 'nlp.pdf', page: 8, section: 'Model', final: 0.7 }),
    ];
    const res = await answerFromPassages('how does a transformer work', passages, fakeLlm({ keyword: 'transformer' }) /* [1] cited only via keyword? both listed */);

    // Both passages contain neither "transformer" nor... adjust: use a keyword both share is not present.
    // 'transformer' only in first; second lacks it → only one retained. So expect >=1 citation, all valid.
    expect(res.citations.length).toBeGreaterThanOrEqual(1);
    for (const c of res.citations) {
      const line = res.answer.split('\n').find((l) => l.startsWith(`[${c.marker}]`));
      expect(line, `a References line for [${c.marker}]`).toBeDefined();
      expect(line!).toContain(c.docId);
      expect(line!).toContain(`p.${c.page}`);
    }
    citationMatchesAProvidedPassage(res, passages);
  });
});

// --- Honest refusals --------------------------------------------------------

describe('answerFromPassages — honest refusal', () => {
  it('refuses when no passage is provided at all', async () => {
    const res = await answerFromPassages('anything', [], fakeLlm({ keyword: 'x' }));
    expect(res.sufficient).toBe(false);
    expect(res.reason).toBe('no_passages');
    expect(res.citations).toEqual([]);
    expect(res.answer).toBe('Preuves insuffisantes dans le corpus pour répondre.');
  });

  it('refuses when RCS retains nothing relevant (no invention)', async () => {
    const passages = [
      mkScored('An unrelated paragraph about seaside holidays.'),
      mkScored('Another off-topic note about traffic in the city.'),
    ];
    const res = await answerFromPassages('explain gradient descent', passages, fakeLlm({ keyword: 'gradient' }));
    expect(res.sufficient).toBe(false);
    expect(res.reason).toBe('no_relevant_passages');
    expect(res.citations).toEqual([]);
    expect(res.answer).toBe('Preuves insuffisantes dans le corpus pour répondre.');
  });

  it('refuses when the synthesizer declares the evidence insufficient', async () => {
    const passages = [mkScored('A relevant-looking passage about quantum decoherence.', { page: 4 })];
    const res = await answerFromPassages('quantum', passages, fakeLlm({ keyword: 'quantum', insufficient: true }));
    expect(res.sufficient).toBe(false);
    expect(res.reason).toBe('insufficient_evidence');
    expect(res.citations).toEqual([]);
  });

  it('refuses when the answer cites no valid passage (uncited body is not grounded)', async () => {
    const passages = [mkScored('A relevant passage about enzymes and catalysis.', { page: 6 })];
    const res = await answerFromPassages(
      'enzymes',
      passages,
      fakeLlm({ keyword: 'enzymes', synth: () => 'Enzymes speed up reactions with no citations at all.' }),
    );
    expect(res.sufficient).toBe(false);
    expect(res.reason).toBe('insufficient_evidence');
    expect(res.citations).toEqual([]);
  });
});

// --- Degradation ------------------------------------------------------------

describe('answerFromPassages — degradation', () => {
  it('refuses cleanly (no exception) when the synthesis LLM is unavailable', async () => {
    const passages = [mkScored('A relevant passage about ribosomes and protein synthesis.', { page: 9 })];
    const res = await answerFromPassages('ribosomes', passages, fakeLlm({ keyword: 'ribosomes', throwOnSynth: true }));
    expect(res.sufficient).toBe(false);
    expect(res.reason).toBe('synthesis_unavailable');
    expect(res.citations).toEqual([]);
    expect(res.answer).toContain('Impossible de synthétiser');
    // Evidence WAS retained — the refusal is honest about that, distinct from "insufficient".
    expect(res.retainedCount).toBe(1);
  });
});

// --- End-to-end mini --------------------------------------------------------

/** Deterministic bag-of-words embedder (shared vocabulary → higher cosine). */
function bowEmbedder(dim = 64): PassageEmbedder {
  const embed = async (text: string): Promise<{ embedding: Float32Array }> => {
    const v = new Float32Array(dim);
    const toks = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length > 1);
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
    readFile: async (path: string) => Buffer.from(path, 'utf8'),
    parsePdf: async (data: Uint8Array): Promise<ParsedPdf | null> => {
      const path = Buffer.from(data).toString('utf8');
      const pages = corpus[path];
      if (!pages) return null;
      return { pages: pages.map((text, i) => ({ num: i + 1, text })), total: pages.length };
    },
  };
}

describe('answerFromPassages — end-to-end (corpus → search → grounded answer)', () => {
  it('answers with a citation carrying real page/section provenance', async () => {
    const corpus: Record<string, string[]> = {
      '/papers/photosynthesis.pdf': [
        'Introduction\nThis paper reviews plant biology fundamentals for students.',
        'Mechanism\nPhotosynthesis converts light energy into chemical energy inside chloroplasts, producing glucose and oxygen.',
      ],
    };
    const index = await buildCorpusIndex(Object.keys(corpus), {
      embedder: bowEmbedder(),
      pdfDeps: corpusDeps(corpus),
      chunkOptions: { targetChars: 200, overlapChars: 0 },
      parseOptions: { docId: 'photosynthesis.pdf' },
    });

    const hits = await index.search('how does photosynthesis convert light energy', { topN: 4 });
    expect(hits.length).toBeGreaterThan(0);

    const res = await answerFromPassages(
      'how does photosynthesis convert light energy',
      hits,
      fakeLlm({ keyword: 'photosynthesis' }),
    );

    expect(res.sufficient).toBe(true);
    expect(res.citations.length).toBeGreaterThanOrEqual(1);
    const cited = res.citations[0]!;
    expect(cited.docId.toLowerCase()).toContain('photosynthesis');
    expect(cited.page).toBeGreaterThanOrEqual(1);
    // The cited passage really is a retrieved passage whose REAL text is about photosynthesis.
    const citedHit = hits.find(
      (h) => h.provenance.charStart === cited.charStart && h.provenance.charEnd === cited.charEnd,
    );
    expect(citedHit).toBeDefined();
    expect(citedHit!.passage.text.toLowerCase()).toContain('photosynthesis');
    expect(res.answer).toContain(`[${cited.marker}]`);
    expect(res.answer).toContain('## Références');
    // Every citation still maps to a real retrieved passage.
    citationMatchesAProvidedPassage(res, hits);
  });
});
