/**
 * Deep Research — Phase C (STORM multi-perspective) unit tests.
 *
 * Every boundary (LLM / search / scrape / fingerprint / generatePerspectives /
 * buildOutline / writeSection / mapBatched) is an INJECTED fake, so the whole
 * pipeline runs with ZERO network. Covers:
 *  - N diversified perspectives instantiated with DISTINCT angles (council-derived
 *    default + injected + LLM derivation + fallback on throw)
 *  - per-perspective research: each perspective runs its OWN Phase-A fan-out with
 *    angle-biased queries → its own cited sources
 *  - cross-perspective merge + dedup: the SAME source found by two personas
 *    collapses to ONE (URL and content fingerprint), ids stay contiguous
 *  - outline-first co-writing: a ToC is produced, each section carries [n]
 *    citations, and a single renumbered "## Références" is rendered
 *  - graceful degradation: a perspective that throws is dropped (article written
 *    from the others); an outline that throws degrades to the flat Phase-A synth;
 *    a totally dead pipeline never throws
 *  - unit helpers: perspective seeds / clamp / relevance ranking / ToC
 */
import { describe, it, expect } from 'vitest';

import {
  runStormResearch,
  deriveStormPerspectives,
  defaultStormPerspectives,
  resolveStormPerspectiveCount,
  framePerspectiveQuestion,
  buildResearchOutline,
  fallbackOutline,
  selectRelevantSources,
  renderTableOfContents,
  writeSectionBody,
  stripLeadingSectionHeading,
  type StormBoundaries,
  type StormPerspective,
  type StormStage,
  type ResearchOutline,
} from '../../src/agent/deep-research-storm.js';
import type { CollectedSource, SearchHit } from '../../src/agent/deep-research.js';

// --------------------------------------------------------------------------
// Fake boundary builder
// --------------------------------------------------------------------------

interface StormFakeConfig {
  /** Injected perspectives (skips derivation). */
  perspectives?: StormPerspective[];
  generatePerspectives?: (topic: string, n: number) => Promise<StormPerspective[]>;
  /** Planner queries per perspective label substring (found in the framed question). */
  plannerByLabel?: Record<string, string[]>;
  /** Raw LLM responder (overrides the structured defaults below when provided). */
  llm?: (messages: { role: string; content: string }[]) => Promise<string>;
  searchMap?: Record<string, SearchHit[]>;
  scrapeMap?: Record<string, string>;
  fingerprint?: (text: string) => number[];
  buildOutline?: StormBoundaries['buildOutline'];
  writeSection?: StormBoundaries['writeSection'];
  mapBatched?: StormBoundaries['mapBatched'];
  /** Structured LLM outline JSON (default path, when no buildOutline injected). */
  outlineJson?: string;
  /** Structured LLM section body (default path, when no writeSection injected). */
  sectionText?: string;
  /** Flat-synthesis LLM body (used on the flat fallback path). */
  synthText?: string;
}

function hit(url: string, title = url): SearchHit {
  return { title, url, snippet: '' };
}

function fpFromMap(map: Record<string, number[]>): (t: string) => number[] {
  return (t: string) => map[t] ?? [];
}

function makeStormBoundaries(cfg: StormFakeConfig): StormBoundaries {
  const defaultLlm = async (messages: { role: string; content: string }[]): Promise<string> => {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    if (sys.includes('research query planner')) {
      // Bias queries by the perspective label embedded in the framed question.
      for (const [label, queries] of Object.entries(cfg.plannerByLabel ?? {})) {
        if (user.includes(label)) {
          return JSON.stringify({ subQuestions: [{ subQuestion: label, queries }] });
        }
      }
      return JSON.stringify({ subQuestions: [{ subQuestion: 'generic', queries: ['generic-q'] }] });
    }
    if (sys.includes('diverse panel of perspectives')) {
      return JSON.stringify({
        perspectives: [
          { label: 'LLM Praticien', angle: 'Operational view', focus: ['steps'] },
          { label: 'LLM Sceptique', angle: 'What breaks', focus: ['risks'] },
          { label: 'LLM Historien', angle: 'State of the art', focus: ['timeline'] },
        ],
      });
    }
    if (sys.includes('table of contents')) {
      return cfg.outlineJson ?? JSON.stringify({ title: 'Article', sections: [{ title: 'Background' }, { title: 'Analysis' }] });
    }
    if (sys.includes('ONE section')) {
      return cfg.sectionText ?? 'Grounded prose citing [1] and [2].';
    }
    if (sys.includes('objective research synthesizer')) {
      return cfg.synthText ?? '## TL;DR\n\nFlat synthesis citing [1].';
    }
    return '';
  };

  const b: StormBoundaries = {
    llm: cfg.llm ?? defaultLlm,
    search: async (q: string, k: number) => (cfg.searchMap?.[q] ?? []).slice(0, k),
    scrape: async (url: string) => cfg.scrapeMap?.[url] ?? '',
    fingerprint: cfg.fingerprint,
  };
  if (cfg.generatePerspectives) b.generatePerspectives = cfg.generatePerspectives;
  else if (cfg.perspectives) b.generatePerspectives = async () => cfg.perspectives!;
  if (cfg.buildOutline) b.buildOutline = cfg.buildOutline;
  if (cfg.writeSection) b.writeSection = cfg.writeSection;
  if (cfg.mapBatched) b.mapBatched = cfg.mapBatched;
  return b;
}

const P_PRAC: StormPerspective = { id: 'practitioner', label: 'Practitioner', angle: 'Operational', focus: ['steps'] };
const P_SKEP: StormPerspective = { id: 'skeptic', label: 'Skeptic', angle: 'What breaks', focus: ['risks'] };

// ==========================================================================
// 1. Perspective instantiation
// ==========================================================================

describe('perspective instantiation', () => {
  it('defaultStormPerspectives derives N DISTINCT council-anchored angles + a historian', () => {
    const four = defaultStormPerspectives(4);
    expect(four).toHaveLength(4);
    // distinct labels and distinct angles (genuine diversity)
    expect(new Set(four.map((p) => p.label)).size).toBe(4);
    expect(new Set(four.map((p) => p.angle)).size).toBe(4);
    // STORM's signature encyclopedic angle is present in the default set
    expect(four.some((p) => p.id === 'historian')).toBe(true);
    // council provenance: practitioner + skeptic angles are surfaced early
    expect(four.map((p) => p.id)).toContain('practitioner');
    expect(four.map((p) => p.id)).toContain('skeptic');
  });

  it('resolveStormPerspectiveCount clamps to [2, 6]', () => {
    expect(resolveStormPerspectiveCount(undefined)).toBe(4);
    expect(resolveStormPerspectiveCount(0)).toBe(2);
    expect(resolveStormPerspectiveCount(1)).toBe(2);
    expect(resolveStormPerspectiveCount(3)).toBe(3);
    expect(resolveStormPerspectiveCount(999)).toBe(6);
  });

  it('uses an injected generatePerspectives boundary when present', async () => {
    const custom: StormPerspective[] = [P_PRAC, P_SKEP];
    const boundaries = makeStormBoundaries({ generatePerspectives: async () => custom });
    const out = await deriveStormPerspectives('topic', 4, boundaries);
    expect(out.map((p) => p.label)).toEqual(['Practitioner', 'Skeptic']);
  });

  it('falls back to the deterministic seeds when the injected boundary throws', async () => {
    const boundaries = makeStormBoundaries({
      generatePerspectives: async () => {
        throw new Error('derivation down');
      },
    });
    const out = await deriveStormPerspectives('topic', 3, boundaries);
    expect(out).toHaveLength(3);
    expect(out.some((p) => p.id === 'historian')).toBe(true);
  });

  it('derives topic-specific perspectives via the LLM when no boundary is injected', async () => {
    const boundaries = makeStormBoundaries({}); // no generatePerspectives ⇒ LLM path
    const out = await deriveStormPerspectives('topic', 3, boundaries);
    expect(out.map((p) => p.label)).toEqual(['LLM Praticien', 'LLM Sceptique', 'LLM Historien']);
  });

  it('falls back to the deterministic seeds when the LLM derivation is unparseable', async () => {
    const boundaries = makeStormBoundaries({ llm: async () => 'sorry, no JSON here' });
    const out = await deriveStormPerspectives('topic', 4, boundaries);
    expect(out).toHaveLength(4);
    expect(out.some((p) => p.id === 'historian')).toBe(true);
  });
});

// ==========================================================================
// 2. Per-perspective research (each does its own angle-biased fan-out)
// ==========================================================================

describe('per-perspective research', () => {
  it('each perspective runs its OWN fan-out and contributes DISTINCT sources', async () => {
    const searchCalls: string[] = [];
    const boundaries = makeStormBoundaries({
      perspectives: [P_PRAC, P_SKEP],
      plannerByLabel: { Practitioner: ['prac-q'], Skeptic: ['skep-q'] },
      searchMap: {
        'prac-q': [hit('https://prac.com', 'Prac')],
        'skep-q': [hit('https://skep.com', 'Skep')],
      },
      scrapeMap: { 'https://prac.com': 'practical content', 'https://skep.com': 'skeptical content' },
      fingerprint: fpFromMap({ 'practical content': [1], 'skeptical content': [2] }),
    });
    boundaries.search = async (q: string, k: number) => {
      searchCalls.push(q);
      const map: Record<string, SearchHit[]> = {
        'prac-q': [hit('https://prac.com', 'Prac')],
        'skep-q': [hit('https://skep.com', 'Skep')],
      };
      return (map[q] ?? []).slice(0, k);
    };

    const result = await runStormResearch('Topic', boundaries, { perspectives: 2 });

    // both perspectives ran their own query
    expect(searchCalls.sort()).toEqual(['prac-q', 'skep-q']);
    // each contributed one distinct source; ids contiguous across the shared registry
    expect(result.sources.map((s) => s.url).sort()).toEqual(['https://prac.com', 'https://skep.com']);
    expect(result.sources.map((s) => s.id)).toEqual([1, 2]);
    expect(result.perspectives).toHaveLength(2);
    expect(result.perspectives.every((p) => p.sourceCount === 1 && !p.failed)).toBe(true);
  });

  it('frames the topic through the perspective angle so the planner can bias queries', () => {
    const framed = framePerspectiveQuestion('Quantum computing', P_SKEP);
    expect(framed).toContain('Quantum computing');
    expect(framed).toContain('Skeptic');
    expect(framed).toContain('What breaks');
    expect(framed).toContain('risks');
  });
});

// ==========================================================================
// 3. Cross-perspective merge + dedup
// ==========================================================================

describe('cross-perspective merge + dedup', () => {
  it('the SAME url found by two personas collapses to one source (contiguous ids)', async () => {
    const boundaries = makeStormBoundaries({
      perspectives: [P_PRAC, P_SKEP],
      plannerByLabel: { Practitioner: ['prac-q'], Skeptic: ['skep-q'] },
      searchMap: {
        'prac-q': [hit('https://shared.com', 'Shared'), hit('https://a.com', 'A')],
        'skep-q': [hit('https://shared.com', 'Shared again'), hit('https://b.com', 'B')],
      },
      scrapeMap: {
        'https://shared.com': 'shared content',
        'https://a.com': 'content a',
        'https://b.com': 'content b',
      },
      fingerprint: fpFromMap({ 'shared content': [1], 'content a': [2], 'content b': [3] }),
    });

    const result = await runStormResearch('Topic', boundaries, { perspectives: 2 });

    // shared.com kept once; a + b added; ids 1..3 contiguous.
    expect(result.sources.map((s) => s.url)).toEqual(['https://shared.com', 'https://a.com', 'https://b.com']);
    expect(result.sources.map((s) => s.id)).toEqual([1, 2, 3]);
    // one cross-perspective duplicate dropped (the second persona's re-find of shared).
    expect(result.duplicatesDropped).toBeGreaterThanOrEqual(1);
  });

  it('a near-duplicate CONTENT under a different url is dropped cross-perspective (fingerprint)', async () => {
    const boundaries = makeStormBoundaries({
      perspectives: [P_PRAC, P_SKEP],
      plannerByLabel: { Practitioner: ['prac-q'], Skeptic: ['skep-q'] },
      searchMap: {
        'prac-q': [hit('https://one.com', 'One')],
        'skep-q': [hit('https://dup.com', 'Dup')],
      },
      scrapeMap: { 'https://one.com': 'body', 'https://dup.com': 'body copy' },
      // identical fingerprint ⇒ Jaccard 1 ⇒ dropped across perspectives.
      fingerprint: fpFromMap({ body: [7, 8, 9], 'body copy': [7, 8, 9] }),
    });

    const result = await runStormResearch('Topic', boundaries, { perspectives: 2 });
    expect(result.sources.map((s) => s.url)).toEqual(['https://one.com']);
    expect(result.duplicatesDropped).toBeGreaterThanOrEqual(1);
  });
});

// ==========================================================================
// 4. Outline-first co-writing
// ==========================================================================

describe('outline-first co-writing', () => {
  function twoSourceBoundaries(extra: Partial<StormFakeConfig> = {}): StormBoundaries {
    return makeStormBoundaries({
      perspectives: [P_PRAC, P_SKEP],
      plannerByLabel: { Practitioner: ['prac-q'], Skeptic: ['skep-q'] },
      searchMap: {
        'prac-q': [hit('https://a.com', 'Alpha')],
        'skep-q': [hit('https://b.com', 'Beta')],
      },
      scrapeMap: { 'https://a.com': 'alpha content', 'https://b.com': 'beta content' },
      fingerprint: fpFromMap({ 'alpha content': [1], 'beta content': [2] }),
      ...extra,
    });
  }

  it('produces a ToC, per-section [n] citations and a single renumbered References (LLM defaults)', async () => {
    const stages: string[] = [];
    const result = await runStormResearch('Topic', twoSourceBoundaries(), { perspectives: 2 }, (s: StormStage) =>
      stages.push(s.stage),
    );

    // table of contents + the outline sections
    expect(result.report).toContain('## Table des matières');
    expect(result.report).toContain('## Background');
    expect(result.report).toContain('## Analysis');
    // per-section citation markers present
    expect(result.report).toContain('[1]');
    // exactly one references block, renumbered coherently from the shared registry
    expect(result.report.match(/## Références/g)).toHaveLength(1);
    expect(result.report).toContain('[1] Alpha — https://a.com');
    expect(result.report).toContain('[2] Beta — https://b.com');
    // outline-first metadata
    expect(result.outline.sections.map((x) => x.title)).toEqual(['Background', 'Analysis']);
    expect(result.outlineLlmUsed).toBe(true);
    expect(result.coWritten).toBe(true);
    expect(result.synthesisLlmUsed).toBe(true);
    // progress covered the storm-specific stages
    expect(stages).toContain('perspectives');
    expect(stages).toContain('merged-perspectives');
    expect(stages).toContain('outlined');
    expect(stages).toContain('written');
    expect(stages).toContain('storm-done');
  });

  it('honours an injected outline + section writers (each section grounded)', async () => {
    const sectionCalls: string[] = [];
    const boundaries = twoSourceBoundaries({
      buildOutline: async () => ({
        title: 'Custom Article',
        sections: [{ title: 'History' }, { title: 'Practice', subsections: ['How-to'] }],
      }),
      writeSection: async ({ section, relevant }) => {
        sectionCalls.push(section.title);
        const ids = relevant.map((r) => `[${r.id}]`).join(' ');
        return `${section.title} body grounded in ${ids || '(no sources)'}.`;
      },
    });

    const result = await runStormResearch('Topic', boundaries, { perspectives: 2 });

    expect(result.outline.title).toBe('Custom Article');
    expect(sectionCalls).toEqual(['History', 'Practice']);
    expect(result.report).toContain('# Custom Article');
    expect(result.report).toContain('## History');
    expect(result.report).toContain('## Practice');
    expect(result.report).toContain('## Références');
    expect(result.coWritten).toBe(true);
  });

  it('a source in the shared registry is renderable even if it is never cited', async () => {
    // section writer cites nothing; the registry still renders both sources.
    const boundaries = twoSourceBoundaries({ writeSection: async () => 'Prose with no citation markers.' });
    const result = await runStormResearch('Topic', boundaries, { perspectives: 2 });
    expect(result.report).toContain('[1] Alpha — https://a.com');
    expect(result.report).toContain('[2] Beta — https://b.com');
  });

  it('strips a PHANTOM [n] a section writer emits beyond the shared registry', async () => {
    // Only 2 sources are in the shared registry ([1] Alpha, [2] Beta) → renderReferences lists
    // [1..2]. A section that cites [7] would leave an unresolvable phantom in the delivered article.
    const boundaries = twoSourceBoundaries({
      writeSection: async () => 'Grounded in [1] and also, wrongly, [7].',
    });
    const result = await runStormResearch('Topic', boundaries, { perspectives: 2 });
    expect(result.coWritten).toBe(true);
    // the phantom marker is gone from the co-written body...
    expect(result.report).not.toContain('[7]');
    // ...while the resolvable marker survives and the References stay coherent
    expect(result.report).toContain('[1]');
    expect(result.report.match(/## Références/g)).toHaveLength(1);
    expect(result.report).toContain('[1] Alpha — https://a.com');
    expect(result.report).toContain('[2] Beta — https://b.com');
  });
});

// ==========================================================================
// 5. Graceful degradation
// ==========================================================================

describe('graceful degradation', () => {
  it('a perspective that THROWS is dropped; the article is written from the others', async () => {
    // Scrape-infra failure: the injected mapBatched throws for the failing
    // perspective's scrape targets (url-shaped items), forcing its research to
    // reject → the perspective is dropped. Perspective-level batches (no url)
    // and the other perspective's targets are untouched.
    const throwingMapBatched = async <T, R>(
      items: T[],
      size: number,
      fn: (item: T) => Promise<R>,
    ): Promise<R[]> => {
      const hasFailUrl = items.some((it) => {
        if (it && typeof it === 'object' && 'url' in it) {
          const u = (it as { url: unknown }).url;
          return typeof u === 'string' && u.includes('FAILHARD');
        }
        return false;
      });
      if (hasFailUrl) throw new Error('scrape infra down');
      const out: R[] = [];
      const step = Math.max(1, size);
      for (let i = 0; i < items.length; i += step) {
        out.push(...(await Promise.all(items.slice(i, i + step).map(fn))));
      }
      return out;
    };

    const P_FAIL: StormPerspective = { id: 'faulty', label: 'Faulty', angle: 'Breaks hard', focus: [] };
    const boundaries = makeStormBoundaries({
      perspectives: [P_PRAC, P_FAIL],
      plannerByLabel: { Practitioner: ['prac-q'], Faulty: ['fail-q'] },
      searchMap: {
        'prac-q': [hit('https://prac.com', 'Prac')],
        'fail-q': [hit('https://FAILHARD.com', 'Boom')],
      },
      scrapeMap: { 'https://prac.com': 'good content' },
      fingerprint: fpFromMap({ 'good content': [1] }),
      mapBatched: throwingMapBatched,
    });

    const result = await runStormResearch('Topic', boundaries, { perspectives: 2 });

    const faulty = result.perspectives.find((p) => p.perspective.id === 'faulty');
    const good = result.perspectives.find((p) => p.perspective.id === 'practitioner');
    expect(faulty?.failed).toBe(true);
    expect(faulty?.sourceCount).toBe(0);
    expect(good?.failed).toBe(false);
    // Article still produced from the surviving perspective's single source.
    expect(result.sources.map((s) => s.url)).toEqual(['https://prac.com']);
    expect(result.report).toContain('## Références');
    expect(result.report).toContain('[1] Prac — https://prac.com');
  });

  it('a perspective that finds nothing contributes zero; the others carry the article', async () => {
    const boundaries = makeStormBoundaries({
      perspectives: [P_PRAC, P_SKEP],
      plannerByLabel: { Practitioner: ['prac-q'], Skeptic: ['skep-q'] },
      searchMap: {
        'prac-q': [hit('https://prac.com', 'Prac')],
        // Skeptic finds nothing.
        'skep-q': [],
      },
      scrapeMap: { 'https://prac.com': 'content' },
      fingerprint: fpFromMap({ content: [1] }),
    });

    const result = await runStormResearch('Topic', boundaries, { perspectives: 2 });
    const skeptic = result.perspectives.find((p) => p.perspective.id === 'skeptic');
    expect(skeptic?.sourceCount).toBe(0);
    expect(result.sources.map((s) => s.url)).toEqual(['https://prac.com']);
    expect(result.report).toContain('[1] Prac — https://prac.com');
  });

  it('an outline that THROWS degrades to the FLAT Phase-A synthesis (no ToC)', async () => {
    const boundaries = makeStormBoundaries({
      perspectives: [P_PRAC, P_SKEP],
      plannerByLabel: { Practitioner: ['prac-q'], Skeptic: ['skep-q'] },
      searchMap: { 'prac-q': [hit('https://a.com', 'Alpha')], 'skep-q': [hit('https://b.com', 'Beta')] },
      scrapeMap: { 'https://a.com': 'alpha content', 'https://b.com': 'beta content' },
      fingerprint: fpFromMap({ 'alpha content': [1], 'beta content': [2] }),
      buildOutline: async () => {
        throw new Error('outline model down');
      },
      synthText: '## TL;DR\n\nFlat cited synthesis [1][2].',
    });

    const result = await runStormResearch('Topic', boundaries, { perspectives: 2 });

    // Flat fallback: no table of contents, but still a cited report.
    expect(result.coWritten).toBe(false);
    expect(result.report).not.toContain('## Table des matières');
    expect(result.report).toContain('## TL;DR');
    expect(result.report).toContain('## Références');
    expect(result.report).toContain('[1] Alpha — https://a.com');
    expect(result.report).toContain('[2] Beta — https://b.com');
  });

  it('a totally dead pipeline (no llm, no search) never throws and yields an honest report', async () => {
    const boundaries: StormBoundaries = {
      llm: async () => {
        throw new Error('down');
      },
      search: async () => [],
      scrape: async () => '',
    };
    await expect(runStormResearch('Nothing findable', boundaries, { perspectives: 3 })).resolves.toBeDefined();
    const result = await runStormResearch('Nothing findable', boundaries, { perspectives: 3 });
    expect(result.sources).toEqual([]);
    expect(result.report).toContain('## Références');
    expect(result.coWritten).toBe(false);
    // still a well-formed DeepResearchResult superset
    expect(result.plan.question).toBe('Nothing findable');
    expect(typeof result.durationMs).toBe('number');
    expect(result.perspectives.length).toBeGreaterThanOrEqual(2);
  });

  it('a thrown progress callback never breaks the pipeline', async () => {
    const boundaries = makeStormBoundaries({
      perspectives: [P_PRAC, P_SKEP],
      searchMap: {},
      scrapeMap: {},
    });
    await expect(
      runStormResearch('x', boundaries, { perspectives: 2 }, () => {
        throw new Error('ui blew up');
      }),
    ).resolves.toBeDefined();
  });
});

// ==========================================================================
// 6. Unit helpers
// ==========================================================================

describe('outline + relevance helpers', () => {
  const sources: CollectedSource[] = [
    { id: 1, url: 'https://a', title: 'History of widgets', content: 'timeline and background of widgets', query: 'q' },
    { id: 2, url: 'https://b', title: 'Widget performance', content: 'benchmarks and analysis of widget speed', query: 'q' },
    { id: 3, url: 'https://c', title: 'Widget risks', content: 'safety and failure modes of widgets', query: 'q' },
  ];

  it('fallbackOutline always yields a structured, bounded outline', () => {
    const outline = fallbackOutline('Widgets', [P_PRAC, P_SKEP]);
    expect(outline.title).toBe('Widgets');
    expect(outline.sections[0]!.title).toBe('Overview');
    expect(outline.sections.at(-1)!.title).toBe('Synthesis and outlook');
    expect(outline.sections.length).toBeGreaterThanOrEqual(3);
  });

  it('buildResearchOutline falls back deterministically when the LLM is unparseable', async () => {
    const boundaries = makeStormBoundaries({ llm: async () => 'no json' });
    const { outline, llmUsed } = await buildResearchOutline('Widgets', [P_PRAC, P_SKEP], sources, boundaries);
    expect(llmUsed).toBe(false);
    expect(outline.sections.length).toBeGreaterThan(0);
  });

  it('selectRelevantSources ranks by keyword overlap with the heading', () => {
    const relevant = selectRelevantSources({ title: 'Risks and failures' }, sources);
    // the "Widget risks" source (safety/failure modes) should rank first
    expect(relevant[0]!.id).toBe(3);
  });

  it('selectRelevantSources falls back to the full (bounded) set when nothing overlaps', () => {
    const relevant = selectRelevantSources({ title: 'zzz' }, sources, 2);
    expect(relevant).toHaveLength(2);
  });

  it('renderTableOfContents numbers sections and indents subsections', () => {
    const outline: ResearchOutline = {
      title: 'T',
      sections: [{ title: 'One', subsections: ['a', 'b'] }, { title: 'Two' }],
    };
    const toc = renderTableOfContents(outline);
    expect(toc).toContain('## Table des matières');
    expect(toc).toContain('1. One');
    expect(toc).toContain('   - a');
    expect(toc).toContain('2. Two');
  });

  it('writeSectionBody produces a deterministic cited body when the LLM section fails', async () => {
    const boundaries = makeStormBoundaries({ llm: async () => { throw new Error('section down'); } });
    const { body, llmUsed } = await writeSectionBody(
      'Topic',
      { title: 'Risks' },
      [sources[2]!],
      [{ id: 3, url: 'https://c', title: 'Widget risks' }],
      boundaries,
    );
    expect(llmUsed).toBe(false);
    expect(body).toContain('[3]');
  });

  it('strips a leading heading that repeats the section title (GK33 live)', () => {
    const raw = [
      '# Introduction: Conceptual Foundations of Hystérésis in VAD Systems',
      '',
      'Hysteresis keeps the detector in speech [1].',
    ].join('\n');
    const out = stripLeadingSectionHeading(
      raw,
      'Introduction: Conceptual Foundations of Hystérésis in VAD Systems',
    );
    expect(out).not.toMatch(/^# Introduction/m);
    expect(out).toContain('Hysteresis keeps the detector in speech [1].');
  });
});
