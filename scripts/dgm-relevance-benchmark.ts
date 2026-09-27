/** Offline measurements through the DGM's article-selection function. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CollectiveKnowledgeGraph } from '../src/memory/collective-knowledge-graph.js';
import { articleIdentity, bibliographicIds, samePublication } from '../src/catalog/article-links.js';
import { getFeatureMap, type FeatureArea } from '../src/agent/self-improvement/evolution/feature-map.js';
import { researchQueryForFeature, retrieveResearchMatches, type FetchResearchGoalsArgs } from '../src/agent/self-improvement/evolution/research-weakness-source.js';

interface Gold { domain: string; relevant: string[] }
interface Split { development: string[]; heldOut: string[] }
interface Judgment { source?: string; domaine?: string; article?: string; annotation_sol_titre?: boolean }
type Mode = Pick<FetchResearchGoalsArgs, 'retrievalMode' | 'filterMode' | 'queryMode'>;
type Metric = 'precisionAt5' | 'recallAt20' | 'ndcgAt10';
interface Row { domain: string; query: string; article: string | null; score: number | null;
  globalRank: number | null; relevant: boolean; precisionAt5: number; recallAt20: number; ndcgAt10: number }

const modes: Record<string, Mode> = {
  main: { retrievalMode: 'legacy', filterMode: 'legacy', queryMode: 'plain' },
  hybridFloor: { retrievalMode: 'hybrid', filterMode: 'legacy', queryMode: 'plain' },
  hybridNoFloor: { retrievalMode: 'hybrid', filterMode: 'none', queryMode: 'plain' },
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
const productionFeatures = await getFeatureMap({ enrich: async () => [], catalog: 'generate' });
const evaluatedFeatures = (phase === 'development' ? split.development : phase === 'heldout' ? split.heldOut : allSplit).map((domain) => {
  const feature = productionFeatures.find((entry) => entry.id === domain);
  if (!feature) throw new Error(`No production feature for ${domain}`);
  return feature;
});
const features = phase === 'batch-audit' ? productionFeatures : evaluatedFeatures;
const byDomain = new Map(gold.map((row) => [row.domain, row.relevant]));
const graph = new CollectiveKnowledgeGraph({ ledgerPath: ledgerFile });

function articleId(featureMatch: { hit: { name?: string; text: string } }): string | null {
  const ids = bibliographicIds(featureMatch.hit.name ?? '', featureMatch.hit.text);
  return ids ? articleIdentity(ids) : null;
}

async function measure(name: string): Promise<Row[]> {
  const mode = modes[name];
  if (!mode) throw new Error(`Unknown variant ${name}`);
  // The batch audit uses all curated production features and the real global limit of three.
  // The development diagnostic raises the limit to expose one choice per evaluated feature.
  const matches = await retrieveResearchMatches({ features, ckg: graph, persistLinks: false, ...mode,
    ...(phase === 'batch-audit' ? {} : { limit: features.length }) });
  const selected = new Map(matches.map((match) => [match.feature.id, match]));
  const rank = new Map(matches.map((match, index) => [match.feature.id, index + 1]));
  return evaluatedFeatures.map((feature) => {
    const match = selected.get(feature.id);
    const article = match ? articleId(match) : null;
    const foundIds = match ? bibliographicIds(match.hit.name ?? '', match.hit.text) : null;
    const relevant = !!foundIds && byDomain.get(feature.id)!.some((goldId) => {
      const expectedIds = bibliographicIds(goldId);
      return !!expectedIds && samePublication(foundIds, expectedIds);
    });
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
  ? JSON.parse(readFileSync(flag('--selection'), 'utf8')) as {
    schemaVersion: number; selected: string; hashes: Record<string, string>; phase: string }
  : null;
const hashes = { ledger: sha(ledgerFile), judgments: sha(judgmentFile), fixture: sha(fixtureFile), split: sha(splitFile),
  selector: sha(path.join(root, 'src/agent/self-improvement/evolution/research-weakness-source.ts')),
  retrieval: sha(path.join(root, 'src/agent/self-improvement/evolution/research-retrieval.ts')),
  featureMap: sha(path.join(root, 'src/agent/self-improvement/evolution/feature-map.ts')) };
if (selectedFromDevelopment && (selectedFromDevelopment.schemaVersion !== 2 ||
    selectedFromDevelopment.phase !== 'development' || !modes[selectedFromDevelopment.selected] ||
    Object.entries(hashes).some(([key, value]) => selectedFromDevelopment.hashes[key] !== value))) {
  throw new Error('Development selection has a different dataset');
}
const names = Object.keys(modes);

function controlDecision(get: (name: string) => ReturnType<typeof summary>, developmentSelected: string):
  { selected: string; floorHarms: boolean; accepted: boolean } {
  const baseline = get('main');
  const floor = get('hybridFloor');
  const noFloor = get('hybridNoFloor');
  const floorHarms = noFloor.recallAt20.value > floor.recallAt20.value &&
    noFloor.precisionAt5.value >= floor.precisionAt5.value;
  const candidateName = developmentSelected === 'hybridNoFloor' && floorHarms ? 'hybridNoFloor' : 'hybridFloor';
  const candidate = get(candidateName);
  const accepted = developmentSelected !== 'main' && candidate.recallAt20.value > baseline.recallAt20.value &&
    candidate.precisionAt5.value >= baseline.precisionAt5.value;
  return { selected: accepted ? candidateName : 'main', floorHarms, accepted };
}

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
  const decision = controlDecision((name) => audit[name]!.heldOut, selectedFromDevelopment!.selected);
  writeFileSync(outputFile, `${JSON.stringify({ schemaVersion: 2, phase, hashes,
    developmentSelected: selectedFromDevelopment!.selected, ...decision,
    source: 'production retrieveResearchMatches; full curated feature map with catalog IDs; global limit 3; CKG TypeScript; article links disabled on frozen ledger',
    featureCount: features.length, variants: audit }, null, 2)}\n`);
  process.exit(0);
}
const variants: Record<string, { metrics: ReturnType<typeof summary>; found: number; rows: Row[] }> = {};
for (const name of names) {
  const rows = await measure(name);
  variants[name] = { metrics: summary(rows), found: rows.filter((row) => row.relevant).length, rows };
}
let selected = 'main';
if (phase === 'development') {
  const baseline = variants.main!.metrics;
  for (const name of names.filter((candidate) => candidate !== 'main')) {
    const candidate = variants[name]!.metrics;
    const best = variants[selected]!.metrics;
    if (candidate.precisionAt5.value < baseline.precisionAt5.value) continue;
    if (candidate.recallAt20.value > best.recallAt20.value ||
      (candidate.recallAt20.value === best.recallAt20.value && candidate.ndcgAt10.value > best.ndcgAt10.value)) selected = name;
  }
}
const decision = phase === 'heldout'
  ? controlDecision((name) => variants[name]!.metrics, selectedFromDevelopment!.selected)
  : { selected, floorHarms: false, accepted: false };
const output = { schemaVersion: 2, phase, hashes,
  ...(phase === 'heldout' ? { developmentSelected: selectedFromDevelopment!.selected } : {}), ...decision,
  source: 'production retrieveResearchMatches; component diagnostic with raised global limit; CKG TypeScript; article links disabled on frozen ledger',
  domainCount: features.length, positiveCount: evaluatedFeatures.reduce((n, feature: FeatureArea) => n + byDomain.get(feature.id)!.length, 0),
  variants };
writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
