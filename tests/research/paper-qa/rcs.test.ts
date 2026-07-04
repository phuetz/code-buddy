/**
 * PaperQA2-lite — RCS (relevance-contextual summarization) tests, Phase 3.
 *
 * No-mocks: a deterministic fake LLM is INJECTED as the boundary (no real
 * LLM/network). The fake scores relevance from a keyword rule the test controls
 * and can be told to throw on a specific passage to exercise degradation.
 */

import { describe, it, expect } from 'vitest';
import { summarizePassage, summarizePassages } from '../../../src/research/paper-qa/rcs.js';
import type { PassageLlmMessage, PassageQaLlm } from '../../../src/research/paper-qa/rcs.js';
import type { ScoredPassage } from '../../../src/research/paper-qa/passage-index.js';

// --- Fixtures ---------------------------------------------------------------

let charCursor = 0;
function mkScored(text: string, over: Partial<ScoredPassage['provenance']> = {}): ScoredPassage {
  const charStart = charCursor;
  const charEnd = charStart + text.length;
  charCursor = charEnd + 1;
  const provenance = {
    docId: over.docId ?? 'doc-1',
    page: over.page ?? 1,
    charStart,
    charEnd,
    ...(over.section !== undefined ? { section: over.section } : {}),
  };
  return {
    passage: {
      docId: provenance.docId,
      page: provenance.page,
      charStart,
      charEnd,
      text,
      index: 0,
      ...(provenance.section !== undefined ? { section: provenance.section } : {}),
    },
    provenance,
    scores: { dense: 0.5, keyword: 1, final: 0.5 },
  };
}

/**
 * Fake RCS LLM: relevance = 0.9 when the passage mentions `keyword`, else 0.1.
 * Throws when the passage contains `POISON` (exercises per-passage degradation).
 */
function keywordRcsLlm(keyword: string): PassageQaLlm {
  return async (messages: PassageLlmMessage[]): Promise<string> => {
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    // Inspect ONLY the passage portion (not the question, which may name the keyword).
    const passage = user.slice(user.indexOf('Passage:') + 'Passage:'.length);
    if (passage.includes('POISON')) throw new Error('LLM boom on this passage');
    const relevant = passage.toLowerCase().includes(keyword.toLowerCase());
    const relevance = relevant ? 0.9 : 0.1;
    const summary = relevant ? `Discusses ${keyword} directly.` : 'NONE';
    return `RELEVANCE: ${relevance}\nSUMMARY: ${summary}`;
  };
}

// --- summarizePassage (single) ---------------------------------------------

describe('summarizePassage', () => {
  it('parses relevance + summary for a relevant passage', async () => {
    const scored = mkScored('Mitochondria are the powerhouse of the cell.');
    const res = await summarizePassage(scored, 'what do mitochondria do', keywordRcsLlm('mitochondria'));
    expect(res).not.toBeNull();
    expect(res!.relevance).toBeCloseTo(0.9);
    expect(res!.summary).toContain('mitochondria');
    // Provenance is carried through untouched.
    expect(res!.scored.provenance).toBe(scored.provenance);
  });

  it('returns null when the LLM throws on the passage (discarded, no crash)', async () => {
    const scored = mkScored('POISON passage that makes the LLM boom.');
    const res = await summarizePassage(scored, 'anything', keywordRcsLlm('anything'));
    expect(res).toBeNull();
  });

  it('returns null when the output has no parseable relevance', async () => {
    const scored = mkScored('Some text.');
    const noRel: PassageQaLlm = async () => 'just a free-form summary with no relevance line';
    expect(await summarizePassage(scored, 'q', noRel)).toBeNull();
  });

  it('forces relevance 0 when the summary is NONE (parseable but useless)', async () => {
    const scored = mkScored('An unrelated aside about the weather.');
    const res = await summarizePassage(scored, 'quantum computing', keywordRcsLlm('quantum'));
    expect(res).not.toBeNull();
    expect(res!.relevance).toBe(0);
    expect(res!.summary).toBe('');
  });

  it('tolerates a 0..100 / percent relevance scale', async () => {
    const scored = mkScored('Relevant enough.');
    const pct: PassageQaLlm = async () => 'RELEVANCE: 80%\nSUMMARY: yes';
    const hundred: PassageQaLlm = async () => 'RELEVANCE: 80\nSUMMARY: yes';
    expect((await summarizePassage(scored, 'q', pct))!.relevance).toBeCloseTo(0.8);
    expect((await summarizePassage(scored, 'q', hundred))!.relevance).toBeCloseTo(0.8);
  });
});

// --- summarizePassages (the filter) ----------------------------------------

describe('summarizePassages', () => {
  it('keeps relevant passages and discards low-relevance ones', async () => {
    const passages = [
      mkScored('Mitochondria generate ATP through oxidative phosphorylation.'),
      mkScored('The restaurant served an excellent seafood paella on the terrace.'),
      mkScored('Cellular respiration in mitochondria consumes oxygen.'),
    ];
    const retained = await summarizePassages(passages, 'how do mitochondria make energy', keywordRcsLlm('mitochondria'));
    expect(retained).toHaveLength(2);
    for (const r of retained) {
      expect(r.scored.passage.text.toLowerCase()).toContain('mitochondria');
      expect(r.relevance).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('discards a passage whose LLM call throws, without crashing the batch', async () => {
    const passages = [
      mkScored('Mitochondria produce energy for the cell.'),
      mkScored('POISON passage — the LLM will throw on this one.'),
      mkScored('More about mitochondria and metabolism.'),
    ];
    const retained = await summarizePassages(passages, 'mitochondria energy', keywordRcsLlm('mitochondria'));
    // The poison passage is dropped; the two good ones survive.
    expect(retained).toHaveLength(2);
    expect(retained.every((r) => !r.scored.passage.text.includes('POISON'))).toBe(true);
  });

  it('returns [] when nothing clears the relevance threshold', async () => {
    const passages = [mkScored('Completely off topic.'), mkScored('Also unrelated content here.')];
    const retained = await summarizePassages(passages, 'photosynthesis', keywordRcsLlm('photosynthesis'));
    expect(retained).toEqual([]);
  });

  it('respects the maxPassages cap (bounded LLM calls)', async () => {
    let calls = 0;
    const counting: PassageQaLlm = async () => {
      calls++;
      return 'RELEVANCE: 0.9\nSUMMARY: relevant';
    };
    const passages = Array.from({ length: 10 }, (_, i) => mkScored(`Relevant passage number ${i}.`));
    const retained = await summarizePassages(passages, 'q', counting, { maxPassages: 3 });
    expect(calls).toBe(3);
    expect(retained).toHaveLength(3);
  });

  it('sorts retained passages by relevance descending', async () => {
    const passages = [mkScored('low relevance text'), mkScored('high relevance text')];
    const graded: PassageQaLlm = async (messages) => {
      const user = messages.find((m) => m.role === 'user')?.content ?? '';
      const rel = user.includes('high') ? 0.95 : 0.6;
      return `RELEVANCE: ${rel}\nSUMMARY: ok`;
    };
    const retained = await summarizePassages(passages, 'q', graded);
    expect(retained.map((r) => r.relevance)).toEqual([0.95, 0.6]);
  });
});
