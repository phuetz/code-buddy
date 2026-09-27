/** Offline DGM retrieval benchmark. Inputs are explicit; the user profile is never opened. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CollectiveKnowledgeGraph } from '../src/memory/collective-knowledge-graph.js';
import { matchScore, type ResearchHit } from '../src/agent/self-improvement/evolution/research-weakness-source.js';
import { CURATED_FEATURES } from '../src/agent/self-improvement/evolution/feature-map.js';
import { buildResearchQuery, createResearchBm25Recall, fuseResearchRanks, isResearchArticle } from '../src/agent/self-improvement/evolution/research-retrieval.js';

interface Query { domain: string; query: string; relevant: string[] }
interface Judgment { source?: string; domaine?: string; besoin?: string; article?: string; annotation_sol_titre?: boolean }
interface Ranked { id: string; score: number; similarity: number; confidence: number; text: string; name: string; source?: string }
interface Scores { precisionAt5: number; recallAt20: number | null; ndcgAt10: number | null; foundAt20: number }

function flag(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Pass ${name} <path>`);
  return process.argv[index + 1]!;
}

const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/dgm-relevance-20.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Query[];
const judgmentFile = flag('--judgments');
const ledgerFile = flag('--ledger');
const judgments = readFileSync(judgmentFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Judgment);
const labels = judgments.filter((row) => row.source === 'sonde pilote Opus' && row.domaine && row.besoin);
if (fixture.length !== 20 || labels.length !== 122) throw new Error('Expected the frozen 20-query, 122-judgment pilot');
for (const q of fixture) {
  const positive = labels.filter((row) => row.domaine === q.domain && row.besoin === q.query && row.annotation_sol_titre)
    .map((row) => row.article);
  if (positive.length !== q.relevant.length || positive.some((id) => !q.relevant.includes(id!))) {
    throw new Error(`Judgment/fixture mismatch for ${q.domain}`);
  }
}

function identity(name: string, text: string): string {
  const found = `${name} ${text}`.match(/arxiv:\s*(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return found ? `arxiv:${found[1]}` : '';
}

function score(items: Ranked[], gold: string[]): Scores {
  const found = (k: number) => items.slice(0, k).filter((item) => gold.includes(item.id)).length;
  const dcg = items.slice(0, 10).reduce((total, item, index) =>
    total + (gold.includes(item.id) ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(10, gold.length) }, (_, index) => 1 / Math.log2(index + 2))
    .reduce((a, b) => a + b, 0);
  return { precisionAt5: found(5) / 5, recallAt20: gold.length ? found(20) / gold.length : null,
    ndcgAt10: ideal ? dcg / ideal : null, foundAt20: found(20) };
}

function summarize(rows: Scores[]): Record<string, { value: number; ci95: [number, number] }> {
  const fields = ['precisionAt5', 'recallAt20', 'ndcgAt10'] as const;
  const mean = (sample: Scores[], field: typeof fields[number]): number => {
    const values = sample.map((row) => row[field]).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  };
  let state = 20260927;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
  const draws: Record<string, number[]> = Object.fromEntries(fields.map((field) => [field, []]));
  for (let b = 0; b < 4000; b++) {
    const sample = Array.from({ length: rows.length }, () => rows[Math.floor(random() * rows.length)]!);
    for (const field of fields) draws[field]!.push(mean(sample, field));
  }
  return Object.fromEntries(fields.map((field) => {
    const sorted = draws[field]!.sort((a, b) => a - b);
    return [field, { value: mean(rows, field),
      ci95: [sorted[100]!, sorted[3899]!] }];
  }));
}

const ckg = new CollectiveKnowledgeGraph({ ledgerPath: ledgerFile });
const results: Array<{ domain: string; query: string; gold: string[]; candidates: Ranked[] }> = [];
function uniqueArticles(hits: Array<{ hit: ResearchHit & { name?: string; source?: string }; score: number }>): Ranked[] {
  const seen = new Set<string>();
  const ranked: Ranked[] = [];
  for (const { hit, score: relevance } of hits) {
    const id = identity(hit.name ?? '', hit.text);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ranked.push({ id, name: hit.name ?? '', text: hit.text, source: hit.source,
      score: relevance, similarity: hit.similarity ?? 0, confidence: hit.confidence });
  }
  return ranked;
}
for (const q of fixture) {
  const hits = await ckg.recallHybrid(q.query, { types: ['discovery'], limit: 20 });
  const ranked = uniqueArticles(hits.map((hit) => ({ hit, score: matchScore(hit as ResearchHit) })));
  results.push({ domain: q.domain, query: q.query, gold: q.relevant, candidates: ranked });
}

const rankings: Record<string, Ranked[][]> = {
  raw: results.map((r) => r.candidates),
  baseline: results.map((r) => r.candidates.filter((hit) => hit.similarity >= 0.32)
    .sort((a, b) => b.score - a.score)),
  noThreshold: results.map((r) => [...r.candidates].sort((a, b) => b.score - a.score)),
};
if (process.argv.includes('--hybrid')) {
  const lexical = createResearchBm25Recall(ckg);
  for (const mode of ['plain', 'description'] as const) {
    const rows: Ranked[][] = [];
    for (const q of fixture) {
      const component = CURATED_FEATURES.find((feature) => feature.id === q.domain);
      const query = mode === 'description' && component ? buildResearchQuery(q.query, component) : q.query;
      const semantic = await ckg.recallHybrid(query, { types: ['discovery'], limit: 100,
        semanticWeight: 1, mmrLambda: 1, inProcess: true });
      const fused = fuseResearchRanks(semantic.filter(isResearchArticle), lexical(query, 100), 100);
      const ranked = uniqueArticles(fused.map(({ hit, score }) => ({ hit, score })));
      rows.push(ranked);
    }
    rankings[`hybrid-${mode}`] = rows;
  }
  if (process.argv.includes('--hyde')) {
    const hypotheses = JSON.parse(readFileSync(flag('--hyde'), 'utf8')) as Array<{
      domain: string; query: string; hypothesis: string; model: string;
    }>;
    if (hypotheses.length !== fixture.length || hypotheses.some((row, index) =>
      row.domain !== fixture[index]!.domain || row.query !== fixture[index]!.query || !row.hypothesis)) {
      throw new Error('HyDE hypotheses must cover the frozen queries in order');
    }
    const rows: Ranked[][] = [];
    for (const [index, q] of fixture.entries()) {
      const semantic = await ckg.recallHybrid(hypotheses[index]!.hypothesis, { types: ['discovery'],
        limit: 100, semanticWeight: 1, mmrLambda: 1, inProcess: true });
      const fused = fuseResearchRanks(semantic.filter(isResearchArticle), lexical(q.query, 100), 100);
      rows.push(uniqueArticles(fused.map(({ hit, score }) => ({ hit, score }))));
    }
    rankings['hybrid-hyde'] = rows;
  }
}
const variants = Object.fromEntries(Object.entries(rankings).map(([name, rows]) =>
  [name, rows.map((ranked, index) => score(ranked, fixture[index]!.relevant))])) as Record<string, Scores[]>;
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const output = { schemaVersion: 2, baseCommit: '8a2891851', retrievalEngine: 'CKG TypeScript semantic + BM25',
  ledgerSha256: sha(ledgerFile), judgmentsSha256: sha(judgmentFile), fixtureSha256: sha(fixturePath),
  ...(process.argv.includes('--hyde') ? { hydeSha256: sha(flag('--hyde')) } : {}),
  labelSource: 'annotation_sol_titre (LLM Sol, non humain)',
  queryCount: fixture.length, knownRelevant: fixture.reduce((n, q) => n + q.relevant.length, 0),
  variants: Object.fromEntries(Object.entries(variants).map(([name, rows]) => [name, {
    metrics: summarize(rows), foundAt20: rows.reduce((n, r) => n + r.foundAt20, 0),
    perQuery: rows.map((row, i) => ({ domain: fixture[i]!.domain, ...row })),
  }])), rankings: Object.fromEntries(Object.entries(rankings).map(([name, rows]) => [name,
    rows.map((ranked, index) => ({ domain: fixture[index]!.domain,
      top20: ranked.slice(0, 20).map((item) => ({ id: item.id, score: item.score, similarity: item.similarity })) }))])),
  candidates: results };
const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes('--output')) writeFileSync(flag('--output'), serialized);
else process.stdout.write(serialized);
