/** Offline measurements through the DGM's article-selection function. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CollectiveKnowledgeGraph } from '../src/memory/collective-knowledge-graph.js';
import { CURATED_FEATURES, type FeatureArea } from '../src/agent/self-improvement/evolution/feature-map.js';
import { researchQueryForFeature, retrieveResearchMatches, type FetchResearchGoalsArgs } from '../src/agent/self-improvement/evolution/research-weakness-source.js';

interface Gold { domain: string; relevant: string[] }
interface Split { development: string[]; heldOut: string[] }
interface Judgment { source?: string; domaine?: string; article?: string; annotation_sol_titre?: boolean }
type Mode = Pick<FetchResearchGoalsArgs, 'retrievalMode' | 'filterMode' | 'queryMode'>;
type Metric = 'precisionAt5' | 'recallAt20' | 'ndcgAt10';
interface Row { domain: string; query: string; article: string | null; score: number | null;
  globalRank: number | null; relevant: boolean; precisionAt5: number; recallAt20: number; ndcgAt10: number }

const modes: Record<string, Mode> = {
  original: { retrievalMode: 'legacy', filterMode: 'legacy', queryMode: 'plain' },
  withoutThreshold: { retrievalMode: 'legacy', filterMode: 'none', queryMode: 'plain' },
  hybrid: { retrievalMode: 'hybrid', filterMode: 'none', queryMode: 'plain' },
  hybridWithThreshold: { retrievalMode: 'hybrid', filterMode: 'legacy', queryMode: 'plain' },
  hybridWithComponent: { retrievalMode: 'hybrid', filterMode: 'none', queryMode: 'component' },
};

function flag(name: string): string {
  const at = process.argv.indexOf(name);
  if (at < 0 || !process.argv[at + 1]) throw new Error(`Pass ${name} <value>`);
  return process.argv[at + 1]!;
}
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureFile = path.join(root, 'tests/fixtures/dgm-production-gold.json');
const splitFile = path.join(root, 'tests/fixtures/dgm-production-split.json');
const ledgerFile = flag('--ledger');
const judgmentFile = flag('--judgments');
const outputFile = flag('--output');
const phase = flag('--phase');
if (phase !== 'development' && phase !== 'heldout' && phase !== 'batch-audit') {
  throw new Error('Use --phase development|heldout|batch-audit');
}
if (process.env.CODEBUDDY_CKG_ENGINE !== 'ts') throw new Error('Set CODEBUDDY_CKG_ENGINE=ts for the frozen evaluation');
const gold = JSON.parse(readFileSync(fixtureFile, 'utf8')) as Gold[];
const split = JSON.parse(readFileSync(splitFile, 'utf8')) as Split;
const judgments = readFileSync(judgmentFile, 'utf8').split('\n').filter(Boolean)
  .map((line) => JSON.parse(line) as Judgment)
  .filter((row) => row.source === 'sonde pilote Opus');
if (judgments.length !== 122 || gold.length !== 15) throw new Error('The frozen pilot changed');
const domains = new Set(gold.map((row) => row.domain));
const allSplit = [...split.development, ...split.heldOut];
if (allSplit.length !== gold.length || new Set(allSplit).size !== gold.length ||
    allSplit.some((domain) => !domains.has(domain))) throw new Error('Invalid development/held-out split');
const devIds = new Set(split.development);
for (const row of gold) {
  const positives = judgments.filter((judgment) => judgment.domaine === row.domain && judgment.annotation_sol_titre)
    .map((judgment) => judgment.article);
  if (positives.length !== row.relevant.length || positives.some((article) => !row.relevant.includes(article!))) {
    throw new Error(`Judgment mismatch for ${row.domain}`);
  }
  for (const other of gold) {
    if (devIds.has(row.domain) === devIds.has(other.domain)) continue;
    if (row.relevant.some((article) => other.relevant.includes(article))) throw new Error('Shared positive crosses the split');
  }
}
const evaluatedFeatures = (phase === 'development' ? split.development : phase === 'heldout' ? split.heldOut : allSplit).map((domain) => {
  const feature = CURATED_FEATURES.find((entry) => entry.id === domain);
  if (!feature) throw new Error(`No production feature for ${domain}`);
  return feature;
});
const features = phase === 'batch-audit' ? CURATED_FEATURES : evaluatedFeatures;
const byDomain = new Map(gold.map((row) => [row.domain, row.relevant]));
const graph = new CollectiveKnowledgeGraph({ ledgerPath: ledgerFile });

function articleId(featureMatch: { hit: { name?: string; source?: string } }): string | null {
  if (featureMatch.hit.source !== 'arxiv') return null;
  const id = featureMatch.hit.name?.match(/^arxiv:(\d{4}\.\d{4,5})/i)?.[1];
  return id ? `arxiv:${id}` : null;
}

async function measure(name: string): Promise<Row[]> {
  const mode = modes[name];
  if (!mode) throw new Error(`Unknown variant ${name}`);
  // The batch audit uses all curated production features and the real global limit of three.
  // The development diagnostic raises the limit to expose one choice per evaluated feature.
  const matches = await retrieveResearchMatches({ features, ckg: graph, ...mode,
    ...(phase === 'batch-audit' ? {} : { limit: features.length }) });
  const selected = new Map(matches.map((match) => [match.feature.id, match]));
  const rank = new Map(matches.map((match, index) => [match.feature.id, index + 1]));
  return evaluatedFeatures.map((feature) => {
    const match = selected.get(feature.id);
    const article = match ? articleId(match) : null;
    const relevant = !!article && byDomain.get(feature.id)!.includes(article);
    const goldCount = byDomain.get(feature.id)!.length;
    return { domain: feature.id,
      query: researchQueryForFeature(feature, mode.retrievalMode!, mode.queryMode!),
      article, score: match?.score ?? null, globalRank: rank.get(feature.id) ?? null, relevant,
      precisionAt5: relevant ? 0.2 : 0,
      recallAt20: relevant ? 1 / goldCount : 0,
      ndcgAt10: relevant ? 1 / Array.from({ length: goldCount }, (_, index) => 1 / Math.log2(index + 2))
        .reduce((a, b) => a + b, 0) : 0 };
  });
}

function groups(rows: Row[]): Row[][] {
  const byId = new Map(gold.map((row) => [row.domain, row]));
  const remaining = new Set(rows.map((row) => row.domain));
  const clusters: Row[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value as string;
    const stack = [first];
    const component = new Set<string>();
    while (stack.length) {
      const domain = stack.pop()!;
      if (component.has(domain)) continue;
      component.add(domain);
      for (const other of remaining) {
        if (byId.get(domain)!.relevant.some((article) => byId.get(other)!.relevant.includes(article))) stack.push(other);
      }
    }
    for (const domain of component) remaining.delete(domain);
    clusters.push(rows.filter((row) => component.has(row.domain)));
  }
  return clusters;
}

function summary(rows: Row[]): Record<Metric, { value: number; ci95: [number, number] }> {
  const metrics: Metric[] = ['precisionAt5', 'recallAt20', 'ndcgAt10'];
  const clusters = groups(rows);
  let state = 20260927;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
  const draws = Object.fromEntries(metrics.map((metric) => [metric, [] as number[]])) as Record<Metric, number[]>;
  for (let draw = 0; draw < 4000; draw++) {
    const sample = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]!).flat();
    for (const metric of metrics) draws[metric].push(sample.reduce((sum, row) => sum + row[metric], 0) / sample.length);
  }
  return Object.fromEntries(metrics.map((metric) => {
    const sorted = draws[metric].sort((a, b) => a - b);
    return [metric, { value: rows.reduce((sum, row) => sum + row[metric], 0) / rows.length,
      ci95: [sorted[100]!, sorted[3899]!] }];
  })) as Record<Metric, { value: number; ci95: [number, number] }>;
}

const selectedFromDevelopment = phase === 'heldout' || phase === 'batch-audit'
  ? JSON.parse(readFileSync(flag('--selection'), 'utf8')) as { selected: string; hashes: Record<string, string>; phase: string }
  : null;
const hashes = { ledger: sha(ledgerFile), judgments: sha(judgmentFile), fixture: sha(fixtureFile), split: sha(splitFile) };
if (selectedFromDevelopment && (selectedFromDevelopment.phase !== 'development' ||
    Object.entries(hashes).some(([key, value]) => selectedFromDevelopment.hashes[key] !== value))) {
  throw new Error('Development selection has a different dataset');
}
const names = phase === 'development' ? Object.keys(modes) :
  [...new Set(['original', selectedFromDevelopment!.selected])];
if (phase === 'batch-audit') {
  const audit: Record<string, { development: ReturnType<typeof summary>; heldOut: ReturnType<typeof summary>;
    developmentFound: number; heldOutFound: number; developmentRows: Row[]; heldOutRows: Row[] }> = {};
  for (const name of names) {
    const rows = await measure(name);
    const developmentRows = rows.filter((row) => devIds.has(row.domain));
    const heldOutRows = rows.filter((row) => !devIds.has(row.domain));
    audit[name] = { development: summary(developmentRows), heldOut: summary(heldOutRows),
      developmentFound: developmentRows.filter((row) => row.relevant).length,
      heldOutFound: heldOutRows.filter((row) => row.relevant).length, developmentRows, heldOutRows };
  }
  const selected = selectedFromDevelopment!.selected;
  const baseline = audit.original!.heldOut;
  const candidate = audit[selected]!.heldOut;
  const accepted = selected !== 'original' && candidate.recallAt20.value > baseline.recallAt20.value &&
    candidate.precisionAt5.value >= baseline.precisionAt5.value;
  writeFileSync(outputFile, `${JSON.stringify({ schemaVersion: 1, phase, hashes, selected, accepted,
    source: 'production retrieveResearchMatches; all curated features; global limit 3; CKG TypeScript engine',
    featureCount: features.length, variants: audit }, null, 2)}\n`);
  process.exit(0);
}
const variants: Record<string, { metrics: ReturnType<typeof summary>; found: number; rows: Row[] }> = {};
for (const name of names) {
  const rows = await measure(name);
  variants[name] = { metrics: summary(rows), found: rows.filter((row) => row.relevant).length, rows };
}
let selected = selectedFromDevelopment?.selected ?? 'original';
if (phase === 'development') {
  const baseline = variants.original!.metrics;
  for (const name of names.filter((candidate) => candidate !== 'original')) {
    const candidate = variants[name]!.metrics;
    const best = variants[selected]!.metrics;
    if (candidate.precisionAt5.value < baseline.precisionAt5.value) continue;
    if (candidate.recallAt20.value > best.recallAt20.value ||
      (candidate.recallAt20.value === best.recallAt20.value && candidate.ndcgAt10.value > best.ndcgAt10.value)) selected = name;
  }
}
const accepted = phase === 'heldout' && selected !== 'original' &&
  variants[selected]!.metrics.recallAt20.value > variants.original!.metrics.recallAt20.value &&
  variants[selected]!.metrics.precisionAt5.value >= variants.original!.metrics.precisionAt5.value;
const output = { schemaVersion: 1, phase, hashes, selected, accepted,
  source: 'production retrieveResearchMatches; component diagnostic with raised global limit; CKG TypeScript engine; Sol title labels for older needs',
  domainCount: features.length, positiveCount: features.reduce((n, feature: FeatureArea) => n + byDomain.get(feature.id)!.length, 0),
  variants };
writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
