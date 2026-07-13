import { describe, it, expect } from 'vitest';
import { runAutoResearchIngest, readResearchTopics } from '../../src/research/auto-ingest.js';
import type { Publication } from '../../src/research/publication-sources.js';

const PUB: Publication = { id: 'arxiv:1', title: 'A paper', abstract: 'Findings.', source: 'arxiv' };

describe('auto-ingest — autonomous research into the CKG', () => {
  it('no topics → no-op', async () => {
    const r = await runAutoResearchIngest({
      topics: [],
      fetchPublications: async () => [PUB],
      ingestPublication: async () => ({}),
      pickIndex: () => 0,
    });
    expect(r.applied).toBe(false);
  });

  it('ingests one topic and reports how many', async () => {
    const ingested: Publication[] = [];
    const r = await runAutoResearchIngest({
      topics: ['ai agents', 'transformers'],
      fetchPublications: async () => [PUB, { ...PUB, id: 'arxiv:2' }],
      ingestPublication: async (p) => {
        ingested.push(p);
        return {};
      },
      pickIndex: () => 0,
    });
    expect(r.applied).toBe(true);
    expect(r.detail).toContain('ai agents'); // index 0 → first topic
    expect(ingested).toHaveLength(2);
  });

  it('reports no new publications when the whole batch is already known', async () => {
    const r = await runAutoResearchIngest({
      topics: ['ai agents'],
      fetchPublications: async () => [PUB, { ...PUB, id: 'arxiv:2' }],
      ingestPublication: async () => null,
      pickIndex: () => 0,
    });

    expect(r).toEqual({
      applied: false,
      detail: 'no new publications for "ai agents"',
    });
  });

  it('round-robins across cycles via pickIndex', async () => {
    const seen: string[] = [];
    const deps = {
      topics: ['a', 'b', 'c'],
      fetchPublications: async (topic: string) => {
        seen.push(topic);
        return [PUB];
      },
      ingestPublication: async () => ({}),
    };
    let i = 0;
    const pick = () => i++;
    await runAutoResearchIngest({ ...deps, pickIndex: pick });
    await runAutoResearchIngest({ ...deps, pickIndex: pick });
    await runAutoResearchIngest({ ...deps, pickIndex: pick });
    await runAutoResearchIngest({ ...deps, pickIndex: pick });
    expect(seen).toEqual(['a', 'b', 'c', 'a']); // wraps around
  });

  it('forwards the relationClassifier to ingestPublication when set (autonomous supports/contradicts)', async () => {
    const seenOpts: Array<unknown> = [];
    const classifier = async () => 'contradicts' as const;
    const r = await runAutoResearchIngest({
      topics: ['x'],
      fetchPublications: async () => [PUB],
      ingestPublication: async (_p, opts) => {
        seenOpts.push(opts);
        return {};
      },
      pickIndex: () => 0,
      relationClassifier: classifier,
    });
    expect(r.applied).toBe(true);
    expect(seenOpts[0]).toEqual({ relationClassifier: classifier });
  });

  it('passes no classifier opts when relationClassifier is absent', async () => {
    let receivedOpts: unknown = 'unset';
    await runAutoResearchIngest({
      topics: ['x'],
      fetchPublications: async () => [PUB],
      ingestPublication: async (_p, opts) => {
        receivedOpts = opts;
        return {};
      },
      pickIndex: () => 0,
    });
    expect(receivedOpts).toBeUndefined();
  });

  it('never-throws when the source fails', async () => {
    const r = await runAutoResearchIngest({
      topics: ['x'],
      fetchPublications: async () => {
        throw new Error('network down');
      },
      ingestPublication: async () => ({}),
      pickIndex: () => 0,
    });
    expect(r.applied).toBe(false);
    expect(r.detail).toContain('failed');
  });

  it('readResearchTopics parses the csv env', () => {
    expect(readResearchTopics({ CODEBUDDY_RESEARCH_TOPICS: 'ai agents, transformers ,, rl' } as NodeJS.ProcessEnv))
      .toEqual(['ai agents', 'transformers', 'rl']);
    expect(readResearchTopics({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});
