import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  runIngest,
  runRecall,
  addKnowledgeSubcommands,
  type KnowledgeIngestDeps,
} from '../../../src/commands/research/knowledge-ingest.js';

function stubDeps(over: Partial<KnowledgeIngestDeps> = {}): { deps: KnowledgeIngestDeps; logs: string[] } {
  const logs: string[] = [];
  const deps: KnowledgeIngestDeps = {
    fetchPublications: async () => [
      { id: 'arxiv:1', title: 'Attention is all you need', abstract: 'Transformers.', source: 'arxiv' },
      { id: 'arxiv:2', title: 'A second paper on attention', abstract: 'More transformers.', source: 'arxiv' },
    ],
    ingestPublication: async () => ({ relations: [{ predicate: 'related_to' }] }),
    recallHybrid: async () => [{ text: 'Transformers use attention.', similarity: 0.8, relations: [{ predicate: 'related_to' }] }],
    getStats: () => ({ entities: 2, relations: 1, ledgerPath: '/tmp/x' }),
    log: (m) => logs.push(m),
    ...over,
  };
  return { deps, logs };
}

describe('research knowledge-ingest — handlers', () => {
  it('runIngest fetches, ingests, counts links', async () => {
    const { deps, logs } = stubDeps();
    const res = await runIngest('attention', { limit: '6', source: 'arxiv' }, deps);
    expect(res.ingested).toBe(2);
    expect(res.linksCreated).toBe(2); // one related_to each
    expect(logs.join('\n')).toContain('2 découvertes');
  });

  it('runIngest handles no results gracefully', async () => {
    const { deps } = stubDeps({ fetchPublications: async () => [] });
    const res = await runIngest('nothing', {}, deps);
    expect(res).toEqual({ ingested: 0, linksCreated: 0 });
  });

  it('runRecall returns hit count and prints', async () => {
    const { deps, logs } = stubDeps();
    const n = await runRecall('comment marche l attention', { limit: '3' }, deps);
    expect(n).toBe(1);
    expect(logs.join('\n')).toContain('attention');
  });

  it('runRecall on empty store nudges to ingest', async () => {
    const { deps, logs } = stubDeps({ recallHybrid: async () => [] });
    expect(await runRecall('x', {}, deps)).toBe(0);
    expect(logs.join('\n')).toContain('ingest');
  });
});

describe('research knowledge-ingest — Commander routing (subcommand vs <topic> action)', () => {
  function buildResearchLike(deps: KnowledgeIngestDeps): { cmd: Command; wide: { topic: string | null } } {
    const wide = { topic: null as string | null };
    const cmd = new Command('research');
    cmd.exitOverride();
    cmd.argument('<topic>', 'wide research topic').action((topic: string) => {
      wide.topic = topic;
    });
    addKnowledgeSubcommands(cmd, async () => deps);
    return { cmd, wide };
  }

  it('routes `research ingest <topic>` to the ingest subcommand, not wide research', async () => {
    const { deps, logs } = stubDeps();
    const { cmd, wide } = buildResearchLike(deps);
    await cmd.parseAsync(['node', 'research', 'ingest', 'transformers']);
    expect(wide.topic).toBeNull(); // parent action NOT triggered
    expect(logs.join('\n')).toContain('découvertes'); // ingest ran
  });

  it('routes `research stats` to the stats subcommand', async () => {
    const { deps, logs } = stubDeps();
    const { cmd, wide } = buildResearchLike(deps);
    await cmd.parseAsync(['node', 'research', 'stats']);
    expect(wide.topic).toBeNull();
    expect(logs.join('\n')).toContain('Graphe de connaissances collectif');
  });

  it('still runs Wide Research for `research "<free topic>"`', async () => {
    const { deps } = stubDeps();
    const { cmd, wide } = buildResearchLike(deps);
    await cmd.parseAsync(['node', 'research', 'quantum computing']);
    expect(wide.topic).toBe('quantum computing');
  });
});
