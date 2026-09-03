/**
 * GK2 — Deep Research must never announce success with zero cited sources.
 *
 * Reproduces the RECH3 loss: a provider returns hits, the pipeline still
 * delivers `sources: []`, and the CLI used to print "✅ Deep Research complete
 * (0 cited source(s))" plus a "Mode: deep" report without Status: failed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runDeepResearchCli,
  type DeepOrchestratorLike,
} from '../../../src/commands/research/deep.js';
import type { DeepResearchResult, DeepResearchProgress } from '../../../src/agent/wide-research.js';

function emptySourceResult(): DeepResearchResult {
  return {
    question: 'Q',
    plan: { question: 'Q', subQuestions: [{ subQuestion: 'SQ', queries: ['q1'] }] },
    sources: [],
    report:
      "# Deep Research: Q\n\n## TL;DR\n\nAucune source exploitable n'a pu être collectée.\n\n## Références\n\n_Aucune source citable n'a pu être collectée._",
    durationMs: 42,
    plannerLlmUsed: false,
    synthesisLlmUsed: false,
    duplicatesDropped: 0,
  };
}

function orchestratorWith(result: DeepResearchResult): DeepOrchestratorLike {
  let listener: ((e: DeepResearchProgress) => void) | undefined;
  return {
    on: (_event, l) => {
      listener = l as (e: DeepResearchProgress) => void;
      return undefined;
    },
    deepResearch: async () => {
      listener?.({ type: 'deep', stage: 'planning' });
      listener?.({ type: 'deep', stage: 'planned', subQuestions: 1, queries: 1, llmUsed: false });
      listener?.({ type: 'deep', stage: 'collecting', urls: 5 });
      listener?.({ type: 'deep', stage: 'collected', scraped: 0 });
      listener?.({ type: 'deep', stage: 'deduped', kept: 0, dropped: 0 });
      listener?.({ type: 'deep', stage: 'done', sources: result.sources.length });
      return result;
    },
  };
}

describe('runDeepResearchCli — zero cited sources is a failure', () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('does not announce a successful report when the pipeline returns 0 sources', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const written: Array<{ file: string; content: string }> = [];

    await runDeepResearchCli(
      'Q',
      'key',
      { model: 'm' },
      { deep: true, reportPath: 'out/zero.md', providerLabel: 'Fake' },
      {
        log: (m) => logs.push(m),
        errorLog: (m) => errors.push(m),
        makeOrchestrator: () => orchestratorWith(emptySourceResult()),
        writeFile: async (file, content) => {
          written.push({ file, content });
        },
      },
    );

    const all = [...logs, ...errors].join('\n');
    expect(process.exitCode).toBe(1);
    expect(written).toHaveLength(1);
    expect(written[0]!.content).toContain('Status: failed');
    expect(all).not.toMatch(/✅\s*Deep Research complete \(0 cited source/);
    expect(all).toMatch(/0 cited source/);
    expect(errors.join('\n')).toMatch(/Deep Research failed/);
  });

  it('includes per-stage reasons in the failure report (search vs scrape vs dedup)', async () => {
    const written: Array<{ file: string; content: string }> = [];
    const errors: string[] = [];
    const result = emptySourceResult();
    result.trace = {
      queries: 3,
      searchHits: 5,
      hitsWithUrl: 5,
      uniqueUrls: 5,
      scrapeAttempted: 5,
      scrapeNonEmpty: 0,
      snippetFallbacks: 0,
      emptyDropped: 5,
      dedupKept: 0,
      dedupDropped: 0,
      searchErrors: [],
      scrapeErrors: ['https://s1.example: empty'],
      providerNotes: ['duckduckgo: 5 raw / 5 with URL'],
    };

    await runDeepResearchCli(
      'Q',
      'key',
      {},
      { deep: true, reportPath: 'out/zero.md' },
      {
        log: () => undefined,
        errorLog: (m) => errors.push(m),
        makeOrchestrator: () => orchestratorWith(result),
        writeFile: async (file, content) => {
          written.push({ file, content });
        },
      },
    );

    expect(process.exitCode).toBe(1);
    const body = `${written[0]!.content}\n${errors.join('\n')}`;
    expect(body).toMatch(/searchHits=5/);
    expect(body).toMatch(/emptyDropped=5/);
    expect(body).toMatch(/scrapeNonEmpty=0/);
    expect(body).toMatch(/duckduckgo/);
  });
});
