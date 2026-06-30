/**
 * `buddy research ingest|recall|stats` — feed and query the Collective Knowledge Graph (CKG)
 * with real scientific publications. This is the practical entry point of Patrice's vision:
 * study a database of scientific publications, auto-link each discovery to its neighbours, and
 * make the whole thing queryable (cross-lingual) — domain-agnostic (AI, physics, medicine…).
 *
 * Subcommands are attached to the existing `research` command. Handlers are injectable
 * (`deps`) so routing + flow are testable without the network or a model.
 *
 * @module commands/research/knowledge-ingest
 */

import type { Command } from 'commander';
import type { Publication, PublicationSource } from '../../research/publication-sources.js';

export interface KnowledgeIngestDeps {
  fetchPublications: (topic: string, opts: { source?: PublicationSource; limit?: number }) => Promise<Publication[]>;
  ingestPublication: (pub: Publication) => Promise<{ relations: Array<{ predicate: string }> } | null>;
  recallHybrid: (query: string, opts: { limit?: number }) => Promise<Array<{ text: string; similarity?: number; relations: Array<{ predicate: string }> }>>;
  getStats: () => { entities: number; relations: number; ledgerPath: string };
  log: (msg: string) => void;
}

async function defaultDeps(): Promise<KnowledgeIngestDeps> {
  const { fetchPublications } = await import('../../research/publication-sources.js');
  const { getCollectiveKnowledgeGraph } = await import('../../memory/collective-knowledge-graph.js');
  const ckg = getCollectiveKnowledgeGraph();
  return {
    fetchPublications,
    ingestPublication: (pub) => ckg.ingestPublication(pub),
    recallHybrid: (query, opts) => ckg.recallHybrid(query, opts),
    getStats: () => ckg.getStats(),
    log: (msg) => console.log(msg),
  };
}

function clampInt(value: string | undefined, def: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : def));
}

/** Ingest publications on a topic into the CKG (auto-linked). Returns counts (for tests). */
export async function runIngest(
  topic: string,
  opts: { limit?: string; source?: string },
  deps: KnowledgeIngestDeps,
): Promise<{ ingested: number; linksCreated: number }> {
  const limit = clampInt(opts.limit, 6, 1, 50);
  const source = (['arxiv', 'europepmc', 'both'].includes(opts.source ?? '') ? opts.source : 'both') as PublicationSource;
  deps.log(`🔎 Publications sur « ${topic} » (${source}, max ${limit}/source)…`);
  const pubs = await deps.fetchPublications(topic, { source, limit });
  if (pubs.length === 0) {
    deps.log('Aucune publication récupérée (source injoignable, ou aucun résultat).');
    return { ingested: 0, linksCreated: 0 };
  }
  deps.log(`📚 ${pubs.length} publications → ingestion + auto-liage…\n`);
  let linksCreated = 0;
  let ingested = 0;
  for (const p of pubs) {
    const r = await deps.ingestPublication(p);
    if (!r) continue;
    ingested++;
    const links = r.relations.filter((x) => x.predicate === 'related_to').length;
    linksCreated += links;
    deps.log(`  • ${p.title.slice(0, 78)}${links ? `  ↔ ${links} lien(s)` : ''}`);
  }
  const s = deps.getStats();
  deps.log(`\n✅ Graphe : ${s.entities} découvertes, ${s.relations} liens.`);
  deps.log('   Interroge-le : buddy research recall "<question>"');
  return { ingested, linksCreated };
}

/** Hybrid query the CKG. Returns the hit count (for tests). */
export async function runRecall(
  query: string,
  opts: { limit?: string },
  deps: KnowledgeIngestDeps,
): Promise<number> {
  const limit = clampInt(opts.limit, 5, 1, 20);
  const hits = await deps.recallHybrid(query, { limit });
  if (hits.length === 0) {
    deps.log('Rien trouvé. Ingère d’abord des publications : buddy research ingest "<sujet>"');
    return 0;
  }
  for (const h of hits) {
    const sim = h.similarity !== undefined ? `[${h.similarity.toFixed(2)}] ` : '';
    deps.log(`${sim}${h.text.slice(0, 160)}`);
    const links = h.relations.filter((r) => r.predicate === 'related_to').length;
    if (links) deps.log(`        ↔ ${links} découverte(s) reliée(s)`);
  }
  return hits.length;
}

/** Attach ingest/recall/stats subcommands to the `research` command. */
export function addKnowledgeSubcommands(cmd: Command, depsFactory: () => Promise<KnowledgeIngestDeps> = defaultDeps): void {
  cmd
    .command('ingest <topic>')
    .description('Fetch scientific publications on a topic and ingest them into the collective knowledge graph (auto-linked)')
    .option('-n, --limit <n>', 'Max publications per source', '6')
    .option('-s, --source <src>', 'Source: arxiv | europepmc | both', 'both')
    .action(async (topic: string, opts: { limit?: string; source?: string }) => {
      await runIngest(topic, opts, await depsFactory());
    });

  cmd
    .command('recall <query>')
    .description('Query the collective knowledge base (hybrid semantic search, cross-lingual)')
    .option('-n, --limit <n>', 'Max results', '5')
    .action(async (query: string, opts: { limit?: string }) => {
      await runRecall(query, opts, await depsFactory());
    });

  cmd
    .command('stats')
    .description('Show the collective knowledge graph size')
    .action(async () => {
      const deps = await depsFactory();
      const s = deps.getStats();
      deps.log(`Graphe de connaissances collectif : ${s.entities} découvertes, ${s.relations} liens.`);
      deps.log(`Ledger : ${s.ledgerPath}`);
    });
}
