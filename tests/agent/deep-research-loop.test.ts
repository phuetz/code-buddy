/**
 * Deep Research — Phase B (iterative gap loop) unit tests.
 *
 * Every boundary (LLM / search / scrape / fingerprint / analyzeGaps) is an
 * INJECTED fake, so the whole loop runs with ZERO network. Covers:
 *  - round 1 → gap analysis → round 2 merges NEW sources
 *  - cross-round dedup (a URL / content already seen in round 1 is NOT re-counted)
 *  - convergence ("no significant gaps" ⇒ stop BEFORE the round cap)
 *  - round cap respected (gaps every round ⇒ bounded, no infinite loop)
 *  - citation registry continuity ([n] stay coherent, References renumbered)
 *  - graceful degradation (gap analysis throws ⇒ clean stop with the current draft)
 *  - DEFAULT (1 round) is Phase-A BYTE-IDENTICAL (the loop delegates; the
 *    gap-analysis boundary is never touched)
 *  - mergeSources / parseGapAnalysis / resolveLoopRounds units
 *  - orchestrator wire-through (`deepResearch({ rounds })`)
 */
import { describe, it, expect, vi } from 'vitest';

import {
  runDeepResearchLoop,
  runDeepResearchPipeline,
  mergeSources,
  parseGapAnalysis,
  resolveLoopRounds,
  resolveDeepResearchOptions,
  contentFingerprint,
  type DeepResearchBoundaries,
  type GapAnalysis,
  type GapAnalysisInput,
  type CollectedSource,
  type SearchHit,
} from '../../src/agent/deep-research.js';
import { WideResearchOrchestrator } from '../../src/agent/wide-research.js';

// --------------------------------------------------------------------------
// Fake boundary builder
// --------------------------------------------------------------------------

interface LoopFakeConfig {
  /** Planner JSON (default: single sub-question with query 'q1'). */
  planJson?: string;
  /** Synthesizer text (default: a tiny cited draft). */
  synthText?: string;
  /** LLM response for the DEFAULT gap path (system prompt contains "gap analyst"). */
  gapLlm?: string;
  /** Injected gap-analysis boundary (bypasses the LLM gap path entirely). */
  analyzeGaps?: (input: GapAnalysisInput) => Promise<GapAnalysis>;
  searchMap?: Record<string, SearchHit[]>;
  scrapeMap?: Record<string, string>;
  fingerprint?: (text: string) => number[];
}

function hit(url: string, title = url): SearchHit {
  return { title, url, snippet: '' };
}

function makeBoundaries(cfg: LoopFakeConfig): DeepResearchBoundaries {
  const planJson =
    cfg.planJson ?? JSON.stringify({ subQuestions: [{ subQuestion: 'SQ1', queries: ['q1'] }] });
  const synthText = cfg.synthText ?? '## TL;DR\n\nDraft body citing the collected sources.';
  const b: DeepResearchBoundaries = {
    llm: async (messages) => {
      const sys = messages.find((m) => m.role === 'system')?.content ?? '';
      if (sys.includes('query planner')) return planJson;
      if (sys.includes('gap analyst')) return cfg.gapLlm ?? '{"sufficient": true, "gaps": [], "queries": []}';
      return synthText; // synthesizer
    },
    search: async (q: string, k: number) => (cfg.searchMap?.[q] ?? []).slice(0, k),
    scrape: async (url: string) => cfg.scrapeMap?.[url] ?? '',
    fingerprint: cfg.fingerprint,
  };
  if (cfg.analyzeGaps) b.analyzeGaps = cfg.analyzeGaps;
  return b;
}

/** Injected fingerprint from a content→array map (distinct arrays ⇒ not duplicates). */
function fpFromMap(map: Record<string, number[]>): (t: string) => number[] {
  return (t: string) => map[t] ?? [];
}

// ==========================================================================
// 1. round 1 → gap analysis → round 2 merges NEW sources
// ==========================================================================

describe('runDeepResearchLoop — gap round adds new sources', () => {
  it('round 1 collects, gap analysis fires, round 2 merges a NEW source with a continuing id', async () => {
    const analyzeGaps = vi.fn(async (): Promise<GapAnalysis> => ({
      sufficient: false,
      gaps: ['round-1 draft misses the second angle'],
      queries: ['q2'],
    }));
    const boundaries = makeBoundaries({
      analyzeGaps,
      searchMap: { q1: [hit('https://one.com', 'One')], q2: [hit('https://two.com', 'Two')] },
      scrapeMap: { 'https://one.com': 'content one', 'https://two.com': 'content two' },
      fingerprint: fpFromMap({ 'content one': [1, 2], 'content two': [3, 4] }),
    });

    const result = await runDeepResearchLoop('Explain it', boundaries, { rounds: 2 });

    // Two sources, ids continue 1,2 across rounds.
    expect(result.sources.map((s) => s.id)).toEqual([1, 2]);
    expect(result.sources.map((s) => s.url)).toEqual(['https://one.com', 'https://two.com']);
    expect(result.report).toContain('[1] One — https://one.com');
    expect(result.report).toContain('[2] Two — https://two.com');
    // Gap analysis ran exactly once (for round 2).
    expect(analyzeGaps).toHaveBeenCalledTimes(1);
    // Ran 2 rounds, stopped on the round cap (not convergence).
    expect(result.rounds).toBe(2);
    expect(result.converged).toBe(false);
    expect(result.roundInfos.map((r) => r.newSources)).toEqual([1, 1]);
    expect(result.roundInfos[1]!.gapQueries).toEqual(['q2']);
  });
});

// ==========================================================================
// 2. cross-round dedup
// ==========================================================================

describe('runDeepResearchLoop — cross-round dedup', () => {
  it('a URL already collected in round 1 is dropped (not re-counted) in round 2', async () => {
    const boundaries = makeBoundaries({
      analyzeGaps: async () => ({ sufficient: false, gaps: ['more'], queries: ['q2'] }),
      searchMap: {
        q1: [hit('https://one.com', 'One')],
        // round 2 re-surfaces the SAME url1 AND a brand-new url3
        q2: [hit('https://one.com', 'One again'), hit('https://three.com', 'Three')],
      },
      scrapeMap: {
        'https://one.com': 'content one',
        'https://three.com': 'content three',
      },
      fingerprint: fpFromMap({ 'content one': [1, 2], 'content three': [5, 6] }),
    });

    const result = await runDeepResearchLoop('Q', boundaries, { rounds: 2 });

    // url1 collected once (round 1), url3 added (round 2). url1's re-surface is dropped.
    expect(result.sources.map((s) => s.url)).toEqual(['https://one.com', 'https://three.com']);
    expect(result.sources.map((s) => s.id)).toEqual([1, 2]);
    expect(result.roundInfos[1]!.newSources).toBe(1);
    expect(result.roundInfos[1]!.duplicatesDropped).toBeGreaterThanOrEqual(1);
  });

  it('a near-duplicate CONTENT under a different URL is dropped cross-round (fingerprint)', async () => {
    const boundaries = makeBoundaries({
      analyzeGaps: async () => ({ sufficient: false, gaps: ['more'], queries: ['q2'] }),
      searchMap: {
        q1: [hit('https://one.com', 'One')],
        q2: [hit('https://dup.com', 'Dup of one')],
      },
      scrapeMap: {
        'https://one.com': 'body A',
        'https://dup.com': 'body A copy', // different URL, same fingerprint below
      },
      // Same fingerprint ⇒ Jaccard 1 ⇒ near-duplicate ⇒ dropped.
      fingerprint: fpFromMap({ 'body A': [7, 8, 9], 'body A copy': [7, 8, 9] }),
    });

    const result = await runDeepResearchLoop('Q', boundaries, { rounds: 2 });
    expect(result.sources.map((s) => s.url)).toEqual(['https://one.com']);
    expect(result.roundInfos[1]!.newSources).toBe(0);
    // No new sources ⇒ converged (no marginal gain).
    expect(result.converged).toBe(true);
  });
});

// ==========================================================================
// 3. convergence (before the round cap)
// ==========================================================================

describe('runDeepResearchLoop — convergence', () => {
  it('stops BEFORE the cap when gap analysis reports the draft is sufficient', async () => {
    const analyzeGaps = vi.fn(async (): Promise<GapAnalysis> => ({
      sufficient: true,
      gaps: [],
      queries: [],
    }));
    const searchSpy = vi.fn(async (q: string) => (q === 'q1' ? [hit('https://one.com', 'One')] : []));
    const boundaries: DeepResearchBoundaries = {
      ...makeBoundaries({ scrapeMap: { 'https://one.com': 'content one' }, fingerprint: fpFromMap({ 'content one': [1, 2] }) }),
      search: searchSpy,
      analyzeGaps,
    };

    const result = await runDeepResearchLoop('Q', boundaries, { rounds: 3 });

    expect(result.converged).toBe(true);
    // Only round 1 actually collected; the gap round short-circuited on convergence.
    expect(result.rounds).toBe(1);
    expect(result.sources.map((s) => s.id)).toEqual([1]);
    expect(analyzeGaps).toHaveBeenCalledTimes(1);
    // No round-2 searches happened (q1 only).
    expect(searchSpy.mock.calls.every((c) => c[0] === 'q1')).toBe(true);
  });
});

// ==========================================================================
// 4. round cap respected (no infinite loop)
// ==========================================================================

describe('runDeepResearchLoop — bounded round cap', () => {
  it('stops at the cap when gap analysis always finds gaps (no infinite loop)', async () => {
    let call = 0;
    const analyzeGaps = vi.fn(async (): Promise<GapAnalysis> => {
      call++;
      // Fresh unique query + it maps to a fresh unique URL/content each round,
      // so merge always ADDS ⇒ the loop can only stop on the round cap.
      return { sufficient: false, gaps: [`gap ${call}`], queries: [`gapq${call}`] };
    });
    const boundaries = makeBoundaries({
      analyzeGaps,
      searchMap: {
        q1: [hit('https://r1.com', 'R1')],
        gapq1: [hit('https://r2.com', 'R2')],
        gapq2: [hit('https://r3.com', 'R3')],
        gapq3: [hit('https://r4.com', 'R4')],
      },
      scrapeMap: {
        'https://r1.com': 'c1',
        'https://r2.com': 'c2',
        'https://r3.com': 'c3',
        'https://r4.com': 'c4',
      },
      fingerprint: fpFromMap({ c1: [1], c2: [2], c3: [3], c4: [4] }),
    });

    const result = await runDeepResearchLoop('Q', boundaries, { rounds: 3 });

    // 3 rounds ran (round cap), no more.
    expect(result.rounds).toBe(3);
    expect(result.converged).toBe(false);
    expect(result.sources.map((s) => s.id)).toEqual([1, 2, 3]);
    // Gap analysis fired exactly (rounds - 1) times: rounds 2 and 3.
    expect(analyzeGaps).toHaveBeenCalledTimes(2);
  });

  it('the requested rounds are hard-clamped to a bounded maximum', () => {
    expect(resolveLoopRounds(undefined)).toBe(1);
    expect(resolveLoopRounds(0)).toBe(1);
    expect(resolveLoopRounds(2)).toBe(2);
    expect(resolveLoopRounds(999)).toBe(5); // hard cap
  });
});

// ==========================================================================
// 5. citation registry continuity across rounds
// ==========================================================================

describe('runDeepResearchLoop — citation continuity', () => {
  it('assigns coherent, contiguous [n] ids across 3 rounds and renders one References block', async () => {
    let call = 0;
    const boundaries = makeBoundaries({
      analyzeGaps: async () => {
        call++;
        return { sufficient: false, gaps: [`g${call}`], queries: [`gapq${call}`] };
      },
      searchMap: {
        q1: [hit('https://a.com', 'Alpha')],
        gapq1: [hit('https://b.com', 'Beta')],
        gapq2: [hit('https://c.com', 'Gamma')],
      },
      scrapeMap: { 'https://a.com': 'ca', 'https://b.com': 'cb', 'https://c.com': 'cc' },
      fingerprint: fpFromMap({ ca: [10], cb: [20], cc: [30] }),
    });

    const result = await runDeepResearchLoop('Q', boundaries, { rounds: 3 });

    expect(result.sources.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(result.report.match(/## Références/g)).toHaveLength(1);
    expect(result.report).toContain('[1] Alpha — https://a.com');
    expect(result.report).toContain('[2] Beta — https://b.com');
    expect(result.report).toContain('[3] Gamma — https://c.com');
    // The accumulated plan gained one follow-up sub-question per gap round.
    expect(result.plan.subQuestions.length).toBe(3);
  });
});

// ==========================================================================
// 6. graceful degradation (gap analysis throws)
// ==========================================================================

describe('runDeepResearchLoop — degradation', () => {
  it('a throwing gap analysis stops cleanly with the current draft (never throws)', async () => {
    const boundaries = makeBoundaries({
      analyzeGaps: async () => {
        throw new Error('gap LLM exploded');
      },
      searchMap: { q1: [hit('https://one.com', 'One')] },
      scrapeMap: { 'https://one.com': 'content one' },
      fingerprint: fpFromMap({ 'content one': [1, 2] }),
    });

    const result = await runDeepResearchLoop('Q', boundaries, { rounds: 3 });

    // Round 1 draft is preserved; loop did not throw and did not converge.
    expect(result.sources.map((s) => s.id)).toEqual([1]);
    expect(result.rounds).toBe(1);
    expect(result.converged).toBe(false);
    expect(result.report).toContain('## Références');
    expect(result.report).toContain('[1] One — https://one.com');
  });

  it('a totally dead loop (no llm, no search) degrades without throwing', async () => {
    const boundaries: DeepResearchBoundaries = {
      llm: async () => {
        throw new Error('down');
      },
      search: async () => [],
      scrape: async () => '',
    };
    await expect(runDeepResearchLoop('Nothing', boundaries, { rounds: 3 })).resolves.toBeDefined();
    const result = await runDeepResearchLoop('Nothing', boundaries, { rounds: 3 });
    expect(result.sources).toEqual([]);
    expect(result.report).toContain('## Références');
  });
});

// ==========================================================================
// 7. DEFAULT (1 round) = Phase A BYTE-IDENTICAL
// ==========================================================================

describe('runDeepResearchLoop — default is Phase-A byte-identical', () => {
  function deterministicBoundaries(analyzeSpy: ReturnType<typeof vi.fn>): DeepResearchBoundaries {
    return {
      ...makeBoundaries({
        planJson: JSON.stringify({
          subQuestions: [{ subQuestion: 'What is Z?', queries: ['what is Z', 'Z overview'] }],
        }),
        synthText: '## TL;DR\n\nZ is a thing [1][2].',
        searchMap: {
          'what is Z': [hit('https://one.com', 'Zed One')],
          'Z overview': [hit('https://two.com', 'Zed Two')],
        },
        scrapeMap: {
          'https://one.com': 'Z is defined as the first thing.',
          'https://two.com': 'A separate overview of Z entirely.',
        },
        fingerprint: fpFromMap({
          'Z is defined as the first thing.': [1, 2, 3],
          'A separate overview of Z entirely.': [7, 8, 9],
        }),
      }),
      analyzeGaps: analyzeSpy as unknown as DeepResearchBoundaries['analyzeGaps'],
    };
  }

  it('rounds absent ⇒ identical report/sources/plan to runDeepResearchPipeline; gap boundary untouched', async () => {
    const analyzeSpy = vi.fn(async (): Promise<GapAnalysis> => ({ sufficient: false, gaps: ['x'], queries: ['y'] }));
    const boundaries = deterministicBoundaries(analyzeSpy);

    const loop = await runDeepResearchLoop('Explain Z', boundaries, {}); // no rounds
    const pipe = await runDeepResearchPipeline('Explain Z', boundaries, {});

    expect(loop.report).toBe(pipe.report);
    expect(loop.sources).toEqual(pipe.sources);
    expect(loop.plan).toEqual(pipe.plan);
    expect(loop.plannerLlmUsed).toBe(pipe.plannerLlmUsed);
    expect(loop.synthesisLlmUsed).toBe(pipe.synthesisLlmUsed);
    expect(loop.duplicatesDropped).toBe(pipe.duplicatesDropped);

    // The loop delegated: it ran exactly one round, converged, and NEVER touched
    // the gap-analysis boundary.
    expect(loop.rounds).toBe(1);
    expect(loop.converged).toBe(true);
    expect(analyzeSpy).not.toHaveBeenCalled();
  });

  it('rounds=1 emits exactly the Phase-A stage sequence', async () => {
    const analyzeSpy = vi.fn();
    const boundaries = deterministicBoundaries(analyzeSpy);
    const stages: string[] = [];
    await runDeepResearchLoop('Explain Z', boundaries, { rounds: 1 }, (s) => stages.push(s.stage));
    expect(stages).toEqual(['planning', 'planned', 'collecting', 'collected', 'deduped', 'synthesizing', 'done']);
    expect(analyzeSpy).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// 8. unit: mergeSources / parseGapAnalysis (default gap path)
// ==========================================================================

describe('mergeSources', () => {
  const OPTS = resolveDeepResearchOptions();
  const boundaries = makeBoundaries({ fingerprint: fpFromMap({ a: [1], b: [2], c: [1], d: [3] }) });

  it('continues ids from the accumulated set and dedups by URL + fingerprint, honouring the cap', () => {
    const accumulated: CollectedSource[] = [{ id: 1, url: 'https://a', title: 'A', content: 'a', query: 'q' }];
    const prints: number[][] = [[1]];
    const incoming = [
      { url: 'https://a', title: 'A2', content: 'a', query: 'q' }, // dup URL → dropped
      { url: 'https://c', title: 'C', content: 'c', query: 'q' }, // fp [1] == A's → dropped
      { url: 'https://b', title: 'B', content: 'b', query: 'q' }, // new → id 2
      { url: 'https://d', title: 'D', content: 'd', query: 'q' }, // would be id 3 but cap=2
    ];
    const { added, dropped } = mergeSources(accumulated, prints, incoming, boundaries, OPTS, 2);
    expect(added).toBe(1);
    expect(dropped).toBe(2); // dup URL + dup fingerprint (D never reached — cap hit)
    expect(accumulated.map((s) => s.id)).toEqual([1, 2]);
    expect(accumulated.map((s) => s.url)).toEqual(['https://a', 'https://b']);
  });

  it('from an empty set behaves like the Phase-A dedup (ids 1..M)', () => {
    const acc: CollectedSource[] = [];
    const prints: number[][] = [];
    const { added } = mergeSources(
      acc,
      prints,
      [
        { url: 'https://x', title: 'X', content: 'a', query: 'q' },
        { url: 'https://y', title: 'Y', content: 'b', query: 'q' },
      ],
      makeBoundaries({ fingerprint: fpFromMap({ a: [1], b: [2] }) }),
      OPTS,
      10,
    );
    expect(added).toBe(2);
    expect(acc.map((s) => s.id)).toEqual([1, 2]);
  });
});

describe('parseGapAnalysis', () => {
  it('parses a valid gap JSON object', () => {
    const g = parseGapAnalysis('{"sufficient": false, "gaps": ["missing X"], "queries": ["q a", "q b"]}');
    expect(g.sufficient).toBe(false);
    expect(g.gaps).toEqual(['missing X']);
    expect(g.queries).toEqual(['q a', 'q b']);
  });

  it('treats unparseable / empty output as convergence (sufficient, no queries)', () => {
    expect(parseGapAnalysis('sorry I cannot')).toEqual({ sufficient: true, gaps: [], queries: [] });
    expect(parseGapAnalysis('{"queries": []}')).toEqual({ sufficient: true, gaps: [], queries: [] });
  });

  it('drives the loop through the DEFAULT gap path (llm boundary, no injected analyzeGaps)', async () => {
    // No analyzeGaps injected ⇒ defaultAnalyzeGaps calls the llm gap branch.
    const boundaries = makeBoundaries({
      gapLlm: '{"sufficient": false, "gaps": ["need round 2"], "queries": ["q2"]}',
      searchMap: { q1: [hit('https://one.com', 'One')], q2: [hit('https://two.com', 'Two')] },
      scrapeMap: { 'https://one.com': 'c1', 'https://two.com': 'c2' },
      fingerprint: fpFromMap({ c1: [1], c2: [2] }),
    });
    const result = await runDeepResearchLoop('Q', boundaries, { rounds: 2 });
    expect(result.sources.map((s) => s.url)).toEqual(['https://one.com', 'https://two.com']);
    expect(result.rounds).toBe(2);
  });
});

// ==========================================================================
// 9. orchestrator wire-through
// ==========================================================================

describe('WideResearchOrchestrator.deepResearch({ rounds })', () => {
  it('threads rounds + injected boundaries through the loop and emits deep progress', async () => {
    const orch = new WideResearchOrchestrator();
    const stages: string[] = [];
    orch.on('progress', (e: { type: string; stage?: string }) => {
      if (e.type === 'deep' && e.stage) stages.push(e.stage);
    });

    const boundaries: Partial<DeepResearchBoundaries> = {
      llm: async (messages) => {
        const sys = messages.find((m) => m.role === 'system')?.content ?? '';
        if (sys.includes('query planner')) return JSON.stringify({ subQuestions: [{ subQuestion: 'S', queries: ['q1'] }] });
        return '## TL;DR\n\nDraft.';
      },
      search: async (q: string) => (q === 'q1' ? [hit('https://one.com', 'One')] : q === 'q2' ? [hit('https://two.com', 'Two')] : []),
      scrape: async (url: string) => (url === 'https://one.com' ? 'c1' : 'c2'),
      fingerprint: fpFromMap({ c1: [1], c2: [2] }),
      analyzeGaps: async () => ({ sufficient: false, gaps: ['more'], queries: ['q2'] }),
    };

    const result = await orch.deepResearch('Explain', 'test-key', {}, { rounds: 2 }, boundaries);

    expect(result.sources.map((s) => s.id)).toEqual([1, 2]);
    expect(result.rounds).toBe(2);
    expect(result.report).toContain('[1] One — https://one.com');
    expect(result.report).toContain('[2] Two — https://two.com');
    expect(stages).toContain('gap-analysis');
    expect(stages).toContain('merged');
    expect(stages).toContain('done');
  });
});

// A tiny sanity check that the REAL fingerprint still discriminates (used when no
// injected fingerprint is supplied by production).
describe('contentFingerprint sanity (real dedup edge)', () => {
  it('distinct contents produce distinct fingerprints', () => {
    const a = contentFingerprint('the alpha source discusses one distinct specific topic in depth');
    const b = contentFingerprint('a completely different beta source about an unrelated separate matter');
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
  });
});
