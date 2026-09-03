/**
 * GK2 — 5 search hits must not vanish into a 0-source report.
 *
 * The historical loss: collectSources dropped every hit whose scrape returned
 * empty, then the pipeline synthesized a "successful" empty report. Snippets
 * from the search provider are citable content and must be kept.
 */
import { describe, expect, it } from 'vitest';

import {
  collectSources,
  formatZeroSourceFailure,
  runDeepResearchPipeline,
  resolveDeepResearchOptions,
  type DeepResearchBoundaries,
  type DeepResearchResult,
  type SearchHit,
} from '../../src/agent/deep-research.js';

function fiveHits(): SearchHit[] {
  return [1, 2, 3, 4, 5].map((i) => ({
    title: `Result ${i}`,
    url: `https://s${i}.example/page`,
    snippet: `Citable snippet ${i} about the research topic with enough unique words to survive fingerprinting.`,
  }));
}

function makeBoundaries(over: Partial<DeepResearchBoundaries> = {}): DeepResearchBoundaries {
  return {
    llm: async () => {
      throw new Error('no llm');
    },
    search: async () => fiveHits(),
    scrape: async () => '',
    ...over,
  };
}

describe('collectSources — 5 search hits must not all disappear', () => {
  const plan = {
    question: 'Q',
    subQuestions: [{ subQuestion: 'SQ', queries: ['q1'] }],
  };

  it('keeps snippet content when scrape returns empty for every URL', async () => {
    const sources = await collectSources(
      plan,
      makeBoundaries(),
      resolveDeepResearchOptions({ resultsPerQuery: 5, maxSources: 12 }),
    );
    expect(sources).toHaveLength(5);
    expect(sources.map((s) => s.url)).toEqual([
      'https://s1.example/page',
      'https://s2.example/page',
      'https://s3.example/page',
      'https://s4.example/page',
      'https://s5.example/page',
    ]);
    expect(sources.every((s) => s.content.includes('Citable snippet'))).toBe(true);
  });

  it('records a stage trace when 5 URL hits have neither scrape nor snippet', async () => {
    const hits: SearchHit[] = [1, 2, 3, 4, 5].map((i) => ({
      title: `Result ${i}`,
      url: `https://empty${i}.example/page`,
      snippet: '',
    }));
    const sources = await collectSources(
      plan,
      makeBoundaries({ search: async () => hits, scrape: async () => '' }),
      resolveDeepResearchOptions({ resultsPerQuery: 5 }),
    );
    expect(sources).toHaveLength(0);
  });
});

describe('runDeepResearchPipeline — 5 hits / empty scrape', () => {
  it('produces 5 cited sources from snippets instead of a 0-source report', async () => {
    const result = await runDeepResearchPipeline(
      'Explain the topic',
      makeBoundaries(),
      { maxSubQuestions: 1, queriesPerSubQuestion: 1, resultsPerQuery: 5 },
    );
    expect(result.sources).toHaveLength(5);
    expect(result.report).toContain('[1] Result 1 — https://s1.example/page');
    expect(result.report).toContain('[5] Result 5 — https://s5.example/page');
    expect(result.trace?.searchHits).toBe(5);
    expect(result.trace?.snippetFallbacks).toBe(5);
    expect(result.trace?.emptyDropped).toBe(0);
  });

  it('fills a per-stage trace when every scrape and snippet is empty', async () => {
    const hits: SearchHit[] = [1, 2, 3, 4, 5].map((i) => ({
      title: `Bare ${i}`,
      url: `https://bare${i}.example/page`,
      snippet: '',
    }));
    const result = await runDeepResearchPipeline(
      'Nothing scrapable',
      makeBoundaries({ search: async () => hits, scrape: async () => '' }),
      { maxSubQuestions: 1, queriesPerSubQuestion: 1, resultsPerQuery: 5 },
    );
    expect(result.sources).toHaveLength(0);
    expect(result.trace?.searchHits).toBe(5);
    expect(result.trace?.hitsWithUrl).toBe(5);
    expect(result.trace?.uniqueUrls).toBe(5);
    expect(result.trace?.scrapeAttempted).toBe(5);
    expect(result.trace?.scrapeNonEmpty).toBe(0);
    expect(result.trace?.emptyDropped).toBe(5);
  });
});

describe('formatZeroSourceFailure — does not dump mixed parallel attempts', () => {
  it('clips and dedupes searchErrors so a 0-source CLI report stays readable', () => {
    const repeated =
      'Vitest TypeScript: no usable URLs (searxng: 0/0 urls; duckduckgo: DuckDuckGo returned a CAPTCHA challenge (bot detection). Add a BRAVE_API_KEY or SERPER_API_KEY environment variable to enable reliable web search.)';
    const result: DeepResearchResult = {
      question: 'Q',
      plan: { question: 'Q', subQuestions: [] },
      sources: [],
      report: 'empty',
      durationMs: 1,
      plannerLlmUsed: false,
      synthesisLlmUsed: false,
      duplicatesDropped: 0,
      trace: {
        queries: 12,
        searchHits: 0,
        hitsWithUrl: 0,
        uniqueUrls: 0,
        scrapeAttempted: 0,
        scrapeNonEmpty: 0,
        snippetFallbacks: 0,
        emptyDropped: 0,
        dedupKept: 0,
        dedupDropped: 0,
        searchErrors: Array.from({ length: 12 }, () => repeated),
        scrapeErrors: [],
        providerNotes: Array.from({ length: 12 }, (_, i) => `query "q${i}": search failed (${repeated})`),
      },
    };
    const msg = formatZeroSourceFailure(result);
    expect(msg).toContain('refusing to report success');
    expect(msg.length).toBeLessThan(4_000);
    const captchaHits = msg.split('CAPTCHA').length - 1;
    expect(captchaHits).toBeLessThanOrEqual(8);
    expect(captchaHits).toBeGreaterThan(0);
  });
});
