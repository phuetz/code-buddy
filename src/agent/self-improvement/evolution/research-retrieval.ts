/** Article retrieval for DGM: BM25 and semantic ranks fused with reciprocal rank fusion. */
import type { CollectiveKnowledgeGraph, CkgRecallResult } from '../../../memory/collective-knowledge-graph.js';
import { bibliographicIds, samePublication, type BibliographicId } from '../../../catalog/article-links.js';
import { BM25Index } from '../../../search/bm25.js';

export interface RankedResearchHit { hit: CkgRecallResult; score: number }

const RRF_K = 60;

export function isResearchArticle(hit: CkgRecallResult): boolean {
  if (hit.type !== 'discovery') return false;
  const ids = bibliographicIds(hit.name, hit.text);
  return (hit.source === 'arxiv' && Boolean(ids?.arxiv || ids?.doi)) ||
    (hit.source === 'europepmc' && Boolean(ids?.pmid || ids?.doi));
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
  const seenArticles: BibliographicId[] = [];
  const seenNames = new Set<string>();
  const out: RankedResearchHit[] = [];
  for (const row of sorted) {
    const ids = bibliographicIds(row.hit.name, row.hit.text);
    if (ids ? seenArticles.some((previous) => samePublication(previous, ids)) : seenNames.has(row.hit.name)) continue;
    if (ids) seenArticles.push(ids);
    else seenNames.add(row.hit.name);
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
