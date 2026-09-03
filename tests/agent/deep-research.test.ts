/**
 * Deep Research (Phase A) — pure pipeline unit tests.
 *
 * All boundaries (LLM / search / scrape / fingerprint) are INJECTED fakes, so
 * every test runs with ZERO network. Covers: planner (LLM parse + deterministic
 * fallback), deterministic fan-out (search → top-K → parallel scrape, URL dedup,
 * global cap), content dedup (near-duplicate → one kept), end-to-end citation
 * tracing (registry + inline [n] + "## Références"), and graceful degradation
 * (scrape fails → source dropped; planner/synth LLM fails → fallback).
 */
import { describe, it, expect } from 'vitest';

import {
  planQueries,
  fallbackPlan,
  collectSources,
  dedupSources,
  synthesize,
  contentFingerprint,
  fingerprintSimilarity,
  renderReferences,
  stripInvalidCitationMarkers,
  runDeepResearchPipeline,
  resolveDeepResearchOptions,
  type DeepResearchBoundaries,
  type DeepQueryPlan,
  type SearchHit,
} from '../../src/agent/deep-research.js';

// --------------------------------------------------------------------------
// Fake boundary builder
// --------------------------------------------------------------------------

interface FakeConfig {
  llm?: (messages: { role: string; content: string }[]) => Promise<string>;
  searchMap?: Record<string, SearchHit[]>;
  searchImpl?: (query: string, k: number) => Promise<SearchHit[]>;
  scrapeMap?: Record<string, string>;
  scrapeImpl?: (url: string) => Promise<string>;
  fingerprint?: (text: string) => number[];
}

function makeBoundaries(cfg: FakeConfig): DeepResearchBoundaries {
  return {
    llm: cfg.llm ?? (async () => { throw new Error('no llm'); }),
    search:
      cfg.searchImpl ??
      (async (q: string, k: number) => (cfg.searchMap?.[q] ?? []).slice(0, k)),
    scrape:
      cfg.scrapeImpl ??
      (async (url: string) => cfg.scrapeMap?.[url] ?? ''),
    fingerprint: cfg.fingerprint,
  };
}

const OPTS = resolveDeepResearchOptions();

// ==========================================================================
// 1. Planner
// ==========================================================================

describe('planQueries', () => {
  it('parses concrete sub-questions + queries from a valid LLM JSON response', async () => {
    const boundaries = makeBoundaries({
      llm: async () =>
        JSON.stringify({
          subQuestions: [
            { subQuestion: 'What is X?', queries: ['what is X', 'X definition', 'X explained'] },
            { subQuestion: 'X vs Y?', queries: ['X vs Y comparison', 'X or Y'] },
          ],
        }),
    });
    const { plan, llmUsed } = await planQueries('Explain X', boundaries, OPTS);
    expect(llmUsed).toBe(true);
    expect(plan.subQuestions).toHaveLength(2);
    expect(plan.subQuestions[0]!.queries).toEqual(['what is X', 'X definition', 'X explained']);
    expect(plan.subQuestions[1]!.subQuestion).toBe('X vs Y?');
  });

  it('bounds sub-questions and queries per the resolved options', async () => {
    const tight = resolveDeepResearchOptions({ maxSubQuestions: 1, queriesPerSubQuestion: 2 });
    const boundaries = makeBoundaries({
      llm: async () =>
        JSON.stringify({
          subQuestions: [
            { subQuestion: 'A', queries: ['a1', 'a2', 'a3', 'a4'] },
            { subQuestion: 'B', queries: ['b1'] },
          ],
        }),
    });
    const { plan } = await planQueries('Q', boundaries, tight);
    expect(plan.subQuestions).toHaveLength(1);
    expect(plan.subQuestions[0]!.queries).toEqual(['a1', 'a2']);
  });

  it('falls back deterministically when the LLM throws', async () => {
    const boundaries = makeBoundaries({ llm: async () => { throw new Error('boom'); } });
    const { plan, llmUsed } = await planQueries('Quantum error correction', boundaries, OPTS);
    expect(llmUsed).toBe(false);
    expect(plan.subQuestions).toHaveLength(1);
    expect(plan.subQuestions[0]!.queries[0]).toBe('Quantum error correction');
    expect(plan.subQuestions[0]!.queries.length).toBe(OPTS.queriesPerSubQuestion);
  });

  it('falls back deterministically when the LLM returns unparseable content', async () => {
    const boundaries = makeBoundaries({ llm: async () => 'sorry, I cannot help with that' });
    const { plan, llmUsed } = await planQueries('Topic', boundaries, OPTS);
    expect(llmUsed).toBe(false);
    expect(plan.subQuestions[0]!.subQuestion).toBe('Topic');
  });

  it('fallbackPlan produces bounded, de-duplicated query variants', () => {
    const plan = fallbackPlan('AI safety', resolveDeepResearchOptions({ queriesPerSubQuestion: 4 }));
    expect(plan.subQuestions).toHaveLength(1);
    expect(plan.subQuestions[0]!.queries).toHaveLength(4);
    expect(new Set(plan.subQuestions[0]!.queries).size).toBe(4);
  });
});

// ==========================================================================
// 2. Deterministic fan-out
// ==========================================================================

describe('collectSources (deterministic fan-out)', () => {
  const plan: DeepQueryPlan = {
    question: 'Q',
    subQuestions: [
      { subQuestion: 'SQ1', queries: ['q1', 'q2'] },
      { subQuestion: 'SQ2', queries: ['q3'] },
    ],
  };

  it('searches top-K, scrapes unique URLs in parallel, preserves deterministic order', async () => {
    const searchCalls: Array<{ q: string; k: number }> = [];
    const boundaries = makeBoundaries({
      searchImpl: async (q, k) => {
        searchCalls.push({ q, k });
        const map: Record<string, SearchHit[]> = {
          q1: [{ title: 'A', url: 'https://a.com', snippet: '' }, { title: 'B', url: 'https://b.com', snippet: '' }],
          q2: [{ title: 'B2', url: 'https://b.com', snippet: '' }], // duplicate URL — scraped once
          q3: [{ title: 'C', url: 'https://c.com', snippet: '' }],
        };
        return (map[q] ?? []).slice(0, k);
      },
      scrapeMap: {
        'https://a.com': 'content A',
        'https://b.com': 'content B',
        'https://c.com': 'content C',
      },
    });

    const sources = await collectSources(plan, boundaries, resolveDeepResearchOptions({ resultsPerQuery: 5 }));
    expect(sources.map((s) => s.url)).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    // top-K forwarded
    expect(searchCalls.every((c) => c.k === 5)).toBe(true);
    // each query searched
    expect(searchCalls.map((c) => c.q).sort()).toEqual(['q1', 'q2', 'q3']);
  });

  it('enforces the global maxSources cap before scraping', async () => {
    const scraped: string[] = [];
    const boundaries = makeBoundaries({
      searchImpl: async (q) => {
        const map: Record<string, SearchHit[]> = {
          q1: [{ title: 'A', url: 'https://a.com', snippet: '' }, { title: 'B', url: 'https://b.com', snippet: '' }],
          q2: [{ title: 'D', url: 'https://d.com', snippet: '' }],
          q3: [{ title: 'C', url: 'https://c.com', snippet: '' }],
        };
        return map[q] ?? [];
      },
      scrapeImpl: async (url) => { scraped.push(url); return `content ${url}`; },
    });

    const sources = await collectSources(plan, boundaries, resolveDeepResearchOptions({ maxSources: 2 }));
    expect(sources).toHaveLength(2);
    expect(scraped).toHaveLength(2); // cap applied BEFORE scraping
  });

  it('drops a source whose scrape fails or returns empty (never throws)', async () => {
    const boundaries = makeBoundaries({
      searchImpl: async (q) => {
        const map: Record<string, SearchHit[]> = {
          q1: [{ title: 'A', url: 'https://a.com', snippet: '' }, { title: 'B', url: 'https://b.com', snippet: '' }],
          q2: [],
          q3: [{ title: 'C', url: 'https://c.com', snippet: '' }],
        };
        return map[q] ?? [];
      },
      scrapeImpl: async (url) => {
        if (url === 'https://b.com') throw new Error('scrape failed');
        if (url === 'https://c.com') return '   '; // empty-ish
        return 'content A';
      },
    });

    const sources = await collectSources(plan, boundaries, OPTS);
    expect(sources.map((s) => s.url)).toEqual(['https://a.com']);
  });

  it('a failing search for one query does not sink the others', async () => {
    const boundaries = makeBoundaries({
      searchImpl: async (q) => {
        if (q === 'q1') throw new Error('provider down');
        const map: Record<string, SearchHit[]> = {
          q2: [{ title: 'D', url: 'https://d.com', snippet: '' }],
          q3: [{ title: 'C', url: 'https://c.com', snippet: '' }],
        };
        return map[q] ?? [];
      },
      scrapeImpl: async (url) => `content ${url}`,
    });

    const sources = await collectSources(plan, boundaries, OPTS);
    expect(sources.map((s) => s.url).sort()).toEqual(['https://c.com', 'https://d.com']);
  });
});

// ==========================================================================
// 3. Content dedup
// ==========================================================================

describe('content dedup', () => {
  it('real fingerprint scores near-duplicates high and distinct sources low', () => {
    const a =
      'The quick brown fox jumps over the lazy dog near the river bank every morning at dawn while the birds sing in the tall trees above the quiet sleepy village square';
    const b = a + ' and afterwards it rested calmly.'; // near-superset
    const c =
      'Superconducting qubits and quantum error correction remain central challenges for scalable fault tolerant quantum computers built in modern research laboratories worldwide';

    const fa = contentFingerprint(a);
    const fb = contentFingerprint(b);
    const fc = contentFingerprint(c);
    expect(fingerprintSimilarity(fa, fb)).toBeGreaterThan(0.7);
    expect(fingerprintSimilarity(fa, fc)).toBeLessThan(0.2);
  });

  it('empty content ⇒ empty fingerprint ⇒ similarity 0 (fail-open, kept)', () => {
    expect(contentFingerprint('')).toEqual([]);
    expect(contentFingerprint('   ')).toEqual([]);
    expect(fingerprintSimilarity([], [1, 2, 3])).toBe(0);
  });

  it('dedupSources keeps the first of a near-identical pair, keeps distinct ones', () => {
    // Injected fingerprint: same array ⇒ Jaccard 1 ⇒ duplicate.
    const fp: Record<string, number[]> = {
      dupA: [1, 2, 3, 4],
      dupB: [1, 2, 3, 4], // identical → dropped
      distinct: [90, 91, 92],
    };
    const boundaries = makeBoundaries({ fingerprint: (t) => fp[t] ?? [] });
    const sources = [
      { url: 'https://a', title: 'A', content: 'dupA', query: 'q' },
      { url: 'https://b', title: 'B', content: 'dupB', query: 'q' },
      { url: 'https://c', title: 'C', content: 'distinct', query: 'q' },
    ];
    const { kept, dropped } = dedupSources(sources, boundaries, resolveDeepResearchOptions({ dedupThreshold: 0.8 }));
    expect(dropped).toBe(1);
    expect(kept.map((s) => s.url)).toEqual(['https://a', 'https://c']);
    // stable ids assigned 1..M on the kept set
    expect(kept.map((s) => s.id)).toEqual([1, 2]);
  });

  it('keeps everything when threshold is unreachable', () => {
    const fp: Record<string, number[]> = { x: [1, 2], y: [3, 4] };
    const boundaries = makeBoundaries({ fingerprint: (t) => fp[t] ?? [] });
    const { kept, dropped } = dedupSources(
      [
        { url: 'https://x', title: 'X', content: 'x', query: 'q' },
        { url: 'https://y', title: 'Y', content: 'y', query: 'q' },
      ],
      boundaries,
      OPTS,
    );
    expect(dropped).toBe(0);
    expect(kept).toHaveLength(2);
  });
});

// ==========================================================================
// 4. Citation tracing + synthesis
// ==========================================================================

describe('citation tracing + synthesis', () => {
  it('renderReferences emits a deterministic numbered section', () => {
    const out = renderReferences([
      { id: 1, url: 'https://a.com', title: 'A' },
      { id: 2, url: 'https://b.com', title: 'B' },
    ]);
    expect(out).toContain('## Références');
    expect(out).toContain('[1] A — https://a.com');
    expect(out).toContain('[2] B — https://b.com');
  });

  it('synthesis appends our References even if the LLM omits them; strips an LLM-added one', async () => {
    const boundaries = makeBoundaries({
      llm: async () => '## TL;DR\n\nFoo is bar [1].\n\n## References\n\n[1] hallucinated',
    });
    const sources = [{ id: 1, url: 'https://a.com', title: 'A', content: 'foo', query: 'q' }];
    const { report, llmUsed } = await synthesize('Q', { question: 'Q', subQuestions: [] }, sources, boundaries, OPTS);
    expect(llmUsed).toBe(true);
    // exactly one references section, and it is ours (real URL)
    expect(report.match(/## Références/g)).toHaveLength(1);
    expect(report).not.toContain('hallucinated');
    expect(report).toContain('[1] A — https://a.com');
  });

  it('synthesis falls back to a deterministic cited body when the LLM throws', async () => {
    const boundaries = makeBoundaries({ llm: async () => { throw new Error('down'); } });
    const plan: DeepQueryPlan = { question: 'Q', subQuestions: [{ subQuestion: 'SQ1', queries: ['q1'] }] };
    const sources = [{ id: 1, url: 'https://a.com', title: 'A', content: 'important finding about the topic', query: 'q1' }];
    const { report, llmUsed } = await synthesize('Q', plan, sources, boundaries, OPTS);
    expect(llmUsed).toBe(false);
    expect(report).toContain('## TL;DR');
    expect(report).toContain('[1]'); // inline marker preserved deterministically
    expect(report).toContain('[1] A — https://a.com'); // references
  });

  it('synthesis with zero sources yields an honest non-conclusive report + empty references', async () => {
    const boundaries = makeBoundaries({});
    const { report, llmUsed } = await synthesize('Q', { question: 'Q', subQuestions: [] }, [], boundaries, OPTS);
    expect(llmUsed).toBe(false);
    expect(report).toContain('## Références');
    expect(report).toContain('Aucune source');
  });

  it('stripInvalidCitationMarkers drops fabricated markers beyond the source count', () => {
    // 5 real sources → [1..5] resolvable; [7] and [0] are phantom → removed; text kept.
    const out = stripInvalidCitationMarkers('Alpha [3]. Beta [7]. Gamma [0]. Delta [5].', 5);
    expect(out).toBe('Alpha [3]. Beta . Gamma . Delta [5].');
    // validCount 0/negative/non-integer strips everything (no resolvable marker exists)
    expect(stripInvalidCitationMarkers('x [1] y', 0)).toBe('x  y');
    // never-throws on a non-string
    expect(stripInvalidCitationMarkers(undefined as unknown as string, 3)).toBe('');
  });

  it('synthesis removes a PHANTOM [n] the LLM cited beyond the real source count', async () => {
    // The LLM invents a [7] though only 5 sources exist → renderReferences lists only [1..5],
    // so [7] would be an unresolvable phantom citation in the delivered report.
    const boundaries = makeBoundaries({
      llm: async () => '## TL;DR\n\nAlpha finding [3]. Beta claim [7]. Gamma detail [2].',
    });
    const sources = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      url: `https://s${i + 1}.com`,
      title: `S${i + 1}`,
      content: `content ${i + 1}`,
      query: 'q',
    }));
    const { report, llmUsed } = await synthesize('Q', { question: 'Q', subQuestions: [] }, sources, boundaries, OPTS);
    expect(llmUsed).toBe(true);
    // the phantom marker is gone from the body...
    expect(report).not.toContain('[7]');
    // ...while the resolvable markers survive
    expect(report).toContain('[3]');
    expect(report).toContain('[2]');
    // and the References remain coherent (only real, resolvable ids 1..5)
    expect(report.match(/## Références/g)).toHaveLength(1);
    expect(report).toContain('[5] S5 — https://s5.com');
    expect(report).not.toContain('[6]');
  });
});

// ==========================================================================
// 5. End-to-end pipeline
// ==========================================================================

describe('runDeepResearchPipeline (end-to-end, injected boundaries)', () => {
  it('produces a cited report with a maintained source registry and emits progress', async () => {
    const stages: string[] = [];
    const boundaries = makeBoundaries({
      llm: async (messages) => {
        const isPlanner = messages.some((m) => m.content.includes('research query planner') || m.role === 'system' && m.content.includes('query planner'));
        if (isPlanner) {
          return JSON.stringify({
            subQuestions: [{ subQuestion: 'What is Z?', queries: ['what is Z', 'Z overview'] }],
          });
        }
        return '## TL;DR\n\nZ is a thing [1][2].\n\n## What is Z?\n\nEvidence [1] and more [2].';
      },
      searchImpl: async (q) => {
        const map: Record<string, SearchHit[]> = {
          'what is Z': [{ title: 'Zed One', url: 'https://one.com', snippet: '' }],
          'Z overview': [{ title: 'Zed Two', url: 'https://two.com', snippet: '' }],
        };
        return map[q] ?? [];
      },
      scrapeMap: {
        'https://one.com': 'Z is defined as the first thing in the alphabet backwards.',
        'https://two.com': 'A completely separate overview describing Z from another angle entirely.',
      },
    });

    const result = await runDeepResearchPipeline('Explain Z', boundaries, {}, (s) => stages.push(s.stage));

    expect(result.sources.map((s) => s.id)).toEqual([1, 2]);
    expect(result.sources[0]).toMatchObject({ id: 1, url: 'https://one.com' });
    expect(result.report).toContain('## Références');
    expect(result.report).toContain('[1] Zed One — https://one.com');
    expect(result.report).toContain('[2] Zed Two — https://two.com');
    expect(result.plannerLlmUsed).toBe(true);
    expect(result.synthesisLlmUsed).toBe(true);
    expect(stages).toEqual([
      'planning',
      'planned',
      'collecting',
      'searched',
      'collected',
      'deduped',
      'synthesizing',
      'done',
    ]);
  });

  it('degrades to a full deterministic path (no LLM, no sources) without throwing', async () => {
    const boundaries = makeBoundaries({}); // llm throws, search empty, scrape empty
    const result = await runDeepResearchPipeline('Nothing findable', boundaries, {});
    expect(result.plannerLlmUsed).toBe(false);
    expect(result.synthesisLlmUsed).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.report).toContain('## Références');
  });

  it('a thrown progress callback never breaks the pipeline', async () => {
    const boundaries = makeBoundaries({});
    await expect(
      runDeepResearchPipeline('x', boundaries, {}, () => { throw new Error('ui blew up'); }),
    ).resolves.toBeDefined();
  });
});
