/** Article retrieval for DGM: BM25 and semantic ranks fused with reciprocal rank fusion. */
import type { CollectiveKnowledgeGraph, CkgRecallResult } from '../../../memory/collective-knowledge-graph.js';
import { BM25Index } from '../../../search/bm25.js';

export interface RankedResearchHit { hit: CkgRecallResult; score: number }

const RRF_K = 60;

export function isResearchArticle(hit: CkgRecallResult): boolean {
  return (hit.source === 'arxiv' && /^arxiv:\d{4}\.\d{4,5}/i.test(hit.name)) ||
    (hit.source === 'europepmc' && /^(?:pmid|doi|europepmc):/i.test(hit.name));
}

/** The same CKG entity receives credit from each leg only once. */
export function fuseResearchRanks(
  semantic: CkgRecallResult[], lexical: CkgRecallResult[], limit: number,
): RankedResearchHit[] {
  const byId = new Map<string, RankedResearchHit>();
  for (const list of [semantic, lexical]) {
    const seen = new Set<string>();
    list.forEach((hit, index) => {
      if (seen.has(hit.id)) return;
      seen.add(hit.id);
      const previous = byId.get(hit.id);
      if (previous) previous.score += 1 / (RRF_K + index + 1);
      else byId.set(hit.id, { hit, score: 1 / (RRF_K + index + 1) });
    });
  }
  const sorted = [...byId.values()].sort((a, b) => b.score - a.score || a.hit.id.localeCompare(b.hit.id));
  const seenArticles = new Set<string>();
  const out: RankedResearchHit[] = [];
  for (const row of sorted) {
    const key = row.hit.name.toLowerCase().replace(/^(arxiv:\d{4}\.\d{4,5})v\d+$/, '$1');
    if (seenArticles.has(key)) continue;
    seenArticles.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** Build once per research-goal batch, from current discovery nodes only. */
export function createResearchBm25Recall(ckg: CollectiveKnowledgeGraph):
  (query: string, limit: number) => CkgRecallResult[] {
  const index = new BM25Index();
  const hits = new Map<string, CkgRecallResult>();
  const docs: Array<{ id: string; content: string }> = [];
  for (const row of ckg.listEntities({ type: 'discovery' })) {
    const entity = ckg.getEntity(row.id).entity;
    if (!entity || !isResearchArticle(entity)) continue;
    hits.set(row.id, entity);
    docs.push({ id: row.id, content: `${entity.name} ${entity.text}` });
  }
  index.addDocuments(docs);
  return (query, limit) => index.search(query, limit).map((row) => hits.get(row.id)!).filter(Boolean);
}

/** The retrieval need includes the component's concrete role and files. */
export function buildResearchQuery(need: string, component: { name: string; description: string; paths: string[] }): string {
  return `${need}\nComponent: ${component.name}. ${component.description}\nImplementation: ${component.paths.join(', ')}`;
}
