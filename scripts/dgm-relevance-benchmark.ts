/** Offline evaluation against an explicit COPY of a CKG ledger. Never opens the default profile. */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CollectiveKnowledgeGraph } from '../src/memory/collective-knowledge-graph.js';
import { articleIdentity, bibliographicIds } from '../src/catalog/article-links.js';
import { filterResearchHits, matchScore, type FeatureMatch, type ResearchHit } from '../src/agent/self-improvement/evolution/research-weakness-source.js';

interface Query { domain: string; query: string; relevant: string[] }
const ledgerFlag = process.argv.indexOf('--ledger');
if (ledgerFlag < 0 || !process.argv[ledgerFlag + 1]) throw new Error('Pass --ledger <copied-ckg-ledger.jsonl>');
const ledger = realpathSync(process.argv[ledgerFlag + 1]!);
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/dgm-relevance-20.json');
const queries = JSON.parse(readFileSync(fixture, 'utf8')) as Query[];
if (queries.length < 20) throw new Error('The annotated bench needs at least 20 queries');
const ckg = new CollectiveKnowledgeGraph({ ledgerPath: ledger, persistentEmbeddingCache: false });

function identity(hit: ResearchHit): string {
  const ids = bibliographicIds(hit.name ?? '', hit.text);
  return ids ? articleIdentity(ids) : '';
}

function metrics(rows: FeatureMatch[], gold: Set<string>): { relevant: number; returned: number; precisionAt5: number; precisionReturned: number; noiseRate: number } {
  const top = rows.slice(0, 5);
  const relevant = top.filter((item) => gold.has(identity(item.hit))).length;
  return { relevant, returned: top.length, precisionAt5: relevant / 5,
    precisionReturned: top.length ? relevant / top.length : 0,
    noiseRate: top.length ? 1 - relevant / top.length : 0 };
}

const details = [];
for (const query of queries) {
  const hits = await ckg.recallHybrid(query.query, { types: ['discovery'], limit: 20 });
  const feature = { id: query.domain, name: query.domain, description: query.query, paths: [] };
  const candidates: FeatureMatch[] = hits.map((hit) => ({
    feature, hit: { id: hit.id, name: hit.name, type: hit.type, text: hit.text, source: hit.source,
      similarity: hit.similarity, confidence: hit.confidence, corroborations: hit.corroborations, relations: hit.relations },
    score: matchScore(hit),
  }));
  const gold = new Set(query.relevant);
  const after = filterResearchHits(candidates, { limit: 5 });
  details.push({ domain: query.domain, query: query.query, before: metrics(candidates, gold), after: metrics(after, gold),
    beforeIds: candidates.slice(0, 5).map((item) => identity(item.hit) || item.hit.name || item.hit.id || 'unknown'),
    afterIds: after.map((item) => identity(item.hit)), abstained: after.length === 0 });
}
const mean = (key: 'before' | 'after', field: 'precisionAt5' | 'precisionReturned' | 'noiseRate'): number =>
  details.reduce((sum, detail) => sum + detail[key][field], 0) / details.length;
process.stdout.write(`${JSON.stringify({ ledger, queryCount: details.length,
  before: { precisionAt5: mean('before', 'precisionAt5'), precisionReturned: mean('before', 'precisionReturned'), noiseRate: mean('before', 'noiseRate') },
  after: { precisionAt5: mean('after', 'precisionAt5'), precisionReturned: mean('after', 'precisionReturned'), noiseRate: mean('after', 'noiseRate') },
  details }, null, 2)}\n`);
