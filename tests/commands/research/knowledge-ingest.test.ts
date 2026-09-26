import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  runIngest,
  runRecall,
  runIngestCode,
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
    rememberFact: () => ({ verdict: { kind: 'new' }, stored: { mentions: 1 } }),
    recallFacts: () => [],
    exportFactMirror: () => ({ files: [], factCount: 0 }),
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
    expect(res).toEqual({ ingested: 0, linksCreated: 0, supports: 0, contradicts: 0 });
  });

  it('forwards GitHub filters while keeping both as the scientific default', async () => {
    const calls: unknown[] = [];
    const { deps } = stubDeps({
      fetchPublications: async (_topic, options) => {
        calls.push(options);
        return [];
      },
    });
    await runIngest('agents', { source: 'github', minStars: '750', pushedSince: '2026-09-01', sort: 'recent' }, deps);
    await runIngest('agents', {}, deps);
    expect(calls).toEqual([
      { source: 'github', limit: 6, minStars: 750, pushedSince: '2026-09-01', sort: 'recent' },
      { source: 'both', limit: 6 },
    ]);
  });

  it('forwards the blog feed file through the ingest command', async () => {
    const calls: unknown[] = [];
    const { deps } = stubDeps({ fetchPublications: async (_topic, options) => {
      calls.push(options);
      return [];
    } });
    const cmd = new Command('research');
    cmd.exitOverride();
    addKnowledgeSubcommands(cmd, async () => deps);
    await cmd.parseAsync(['node', 'research', 'ingest', 'agent memory', '--source', 'blogs', '--feeds-file', 'feeds.json']);
    expect(calls).toEqual([{ source: 'blogs', limit: 6, feedsFile: 'feeds.json' }]);
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

  it('runIngestCode ingests Code Explorer insights as discoveries', async () => {
    const { deps } = stubDeps({
      fetchCodeInsights: async () => [
        { id: 'codeexplorer:hotspots', title: 'Analyse de code — hotspots', abstract: 'foo.ts risky', source: 'code-explorer' },
        { id: 'codeexplorer:find_cycles', title: 'Analyse de code — find_cycles', abstract: 'A→B→A', source: 'code-explorer' },
      ],
    });
    const r = await runIngestCode({}, deps);
    expect(r.ingested).toBe(2);
  });

  it('runIngestCode is graceful when Code Explorer yields nothing', async () => {
    const { deps } = stubDeps({ fetchCodeInsights: async () => [] });
    expect(await runIngestCode({}, deps)).toEqual({ ingested: 0, linksCreated: 0 });
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

  it('routes `research sync <peer> --dry-run` without invoking wide research', async () => {
    const calls: Array<{ peerId: string; dryRun?: boolean }> = [];
    const { deps, logs } = stubDeps({
      syncFromPeer: async (peerId, opts) => {
        calls.push({ peerId, ...opts });
        return {
          peerId,
          dryRun: opts.dryRun === true,
          fetched: 1,
          ingested: 0,
          skipped: 0,
          wouldIngest: 1,
          maxTs: 1000,
          entries: [{
            v: 1,
            kind: 'entity',
            recordedAt: '2026-07-15T10:00:00.000Z',
            agentId: 'source/local',
            contentHash: 'hash',
            id: 'fact:collective:preview',
            type: 'fact',
            name: 'preview',
            text: 'preview text',
          }],
        };
      },
    });
    const { cmd, wide } = buildResearchLike(deps);

    await cmd.parseAsync(['node', 'research', 'sync', 'alpha', '--dry-run']);

    expect(wide.topic).toBeNull();
    expect(calls).toEqual([{ peerId: 'alpha', dryRun: true }]);
    expect(logs.join('\n')).toContain('1 entrée(s) seraient ingérées');
  });

  it('still runs Wide Research for `research "<free topic>"`', async () => {
    const { deps } = stubDeps();
    const { cmd, wide } = buildResearchLike(deps);
    await cmd.parseAsync(['node', 'research', 'quantum computing']);
    expect(wide.topic).toBe('quantum computing');
  });
});

describe('research fact — structured facts (reconciliation) routing', () => {
  it('routes `research fact add` to rememberFact with the category and prints the verdict', async () => {
    const calls: unknown[] = [];
    const { deps, logs } = stubDeps({
      rememberFact: (input) => {
        calls.push(input);
        return { verdict: { kind: 'new' }, stored: { mentions: 1 } };
      },
    });
    const wide = { topic: null as string | null };
    const cmd = new Command('research');
    cmd.exitOverride();
    cmd.argument('<topic>').action((t: string) => {
      wide.topic = t;
    });
    addKnowledgeSubcommands(cmd, async () => deps);
    await cmd.parseAsync(['node', 'research', 'fact', 'add', 'barth', 'targets', 'marathon sub-3h', '-c', 'goal']);
    expect(wide.topic).toBeNull();
    expect(calls[0]).toMatchObject({ subject: 'barth', predicate: 'targets', object: 'marathon sub-3h', category: 'goal' });
    expect(logs.join('\n')).toContain('Nouveau fait');
  });

  it('prints the quarantine reasons for an out-of-vocab fact', async () => {
    const { deps, logs } = stubDeps({
      rememberFact: () => ({ verdict: { kind: 'quarantine', reasons: ['predicate "enjoys" not in closed vocabulary'] }, stored: null }),
    });
    const cmd = new Command('research');
    cmd.exitOverride();
    cmd.argument('<topic>').action(() => {});
    addKnowledgeSubcommands(cmd, async () => deps);
    await cmd.parseAsync(['node', 'research', 'fact', 'add', 'barth', 'enjoys', 'hiking', '-c', 'hobby']);
    expect(logs.join('\n')).toContain('quarantaine');
    expect(logs.join('\n')).toContain('enjoys');
  });

  it('routes `research fact recall` and prints retention', async () => {
    const { deps, logs } = stubDeps({
      recallFacts: () => [{ text: 'marathon sub-3h', name: 'barth|targets|goal', category: 'goal', retention: 0.87, mentions: 3 }],
    });
    const cmd = new Command('research');
    cmd.exitOverride();
    cmd.argument('<topic>').action(() => {});
    addKnowledgeSubcommands(cmd, async () => deps);
    await cmd.parseAsync(['node', 'research', 'fact', 'recall', 'marathon']);
    expect(logs.join('\n')).toContain('rétention 0.87');
    expect(logs.join('\n')).toContain('[goal]');
  });
});

describe('research mirror — read-only Markdown export routing', () => {
  it('routes `research mirror` to exportFactMirror and reports the count', async () => {
    const { deps, logs } = stubDeps({
      exportFactMirror: () => ({ files: ['/x/identity.md', '/x/tool.md'], factCount: 5 }),
    });
    const cmd = new Command('research');
    cmd.exitOverride();
    cmd.argument('<topic>').action(() => {});
    addKnowledgeSubcommands(cmd, async () => deps);
    await cmd.parseAsync(['node', 'research', 'mirror', '--dir', '/x']);
    expect(logs.join('\n')).toContain('2 fichier(s) pour 5 fait(s)');
    expect(logs.join('\n')).toContain('Unidirectionnel');
  });

  it('nudges to add facts when the graph has none', async () => {
    const { deps, logs } = stubDeps({ exportFactMirror: () => ({ files: [], factCount: 0 }) });
    const cmd = new Command('research');
    cmd.exitOverride();
    cmd.argument('<topic>').action(() => {});
    addKnowledgeSubcommands(cmd, async () => deps);
    await cmd.parseAsync(['node', 'research', 'mirror']);
    expect(logs.join('\n')).toContain('Aucun fait structuré');
  });
});
