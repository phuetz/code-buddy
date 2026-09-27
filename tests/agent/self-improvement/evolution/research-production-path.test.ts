import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollectiveKnowledgeGraph } from '../../../../src/memory/collective-knowledge-graph.js';
import { readArticleLinks } from '../../../../src/catalog/article-links.js';
import { fetchResearchGoals, retrieveResearchMatches, type ResearchHit } from '../../../../src/agent/self-improvement/evolution/research-weakness-source.js';
import type { FeatureArea } from '../../../../src/agent/self-improvement/evolution/feature-map.js';

const feature: FeatureArea = { id: 'voice-loop', name: 'Voice loop',
  description: 'Streaming speech turn taking for spoken assistants', paths: ['src/sensory/voice-loop.ts'] };
const low: ResearchHit = { name: 'arxiv:2501.01234v1', type: 'discovery', source: 'arxiv',
  text: 'Low similarity study', similarity: 0.4, confidence: 1 };

afterEach(() => vi.unstubAllEnvs());

describe('production research selection', () => {
  it('uses hybrid retrieval with the main similarity and quality guards by default', async () => {
    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_RETRIEVAL', '');
    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_FILTER', '');
    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_QUERY', '');
    const seen: Array<{ query: string; limit: number | undefined }> = [];
    const matches = await retrieveResearchMatches({ features: [feature], recall: async (query, opts) => {
      seen.push({ query, limit: opts.limit });
      return [low];
    } });
    expect(seen).toEqual([{ query: feature.description, limit: 20 }]);
    expect(matches).toEqual([]);
    expect(await retrieveResearchMatches({ features: [feature], filterMode: 'none',
      recall: async () => [low] })).toHaveLength(1);
  });

  it('uses the real CKG, BM25, semantic recall and goal path with one shared query', async () => {
    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_RETRIEVAL', '');
    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_FILTER', '');
    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_QUERY', '');
    const dir = mkdtempSync(join(tmpdir(), 'dgm-research-'));
    try {
      const ckg = new CollectiveKnowledgeGraph({ ledgerPath: join(dir, 'ledger.jsonl'),
        persistentEmbeddingCache: false,
        embedder: { embed: async (text) => ({ embedding: Float32Array.from(
          /speech|voice|turn/i.test(text) ? [1, 0] : [0, 1]) }) } });
      ckg.remember({ type: 'discovery', source: 'arxiv', name: 'arxiv:2501.00001v1',
        text: 'Streaming speech turn taking with an adaptive voice activity detector.' });
      ckg.remember({ type: 'discovery', source: 'arxiv', name: 'arxiv:2501.00002v1',
        text: 'Graph database indexing for large archives.' });
      const linksPath = join(dir, 'links.jsonl');
      const selected = await retrieveResearchMatches({ features: [feature], ckg, linksPath });
      expect(selected).toHaveLength(1);
      expect(selected[0]!.hit.name).toBe('arxiv:2501.00001v1');
      const links = readArticleLinks(linksPath);
      expect(links.some((link) => link.featureId === feature.id && link.article.arxiv === '2501.00001')).toBe(true);
      expect(links.find((link) => link.article.arxiv === '2501.00001')?.method).toContain('rrf');
      writeFileSync(linksPath, links.map((link) => JSON.stringify(link.article.arxiv === '2501.00001'
        ? { ...link, humanStatus: 'rejected' } : link)).join('\n') + '\n');
      expect(await retrieveResearchMatches({ features: [feature], ckg, linksPath })).toEqual([]);
      const goals = await fetchResearchGoals({ features: [feature], persistLinks: false,
        recall: async (query) => {
          expect(query).toBe(feature.description);
          return selected.map((match) => match.hit);
        },
        chat: async () => 'Améliore la prise de parole en utilisant une détection vocale adaptative.' });
      expect(goals).toHaveLength(1);
      expect(goals[0]!.kind).toBe('research');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restores the original limit, query and floor through the legacy switches', async () => {
    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_RETRIEVAL', 'legacy');
    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_FILTER', 'legacy');
    const observed: Array<{ query: string; limit: number | undefined }> = [];
    const original = await retrieveResearchMatches({ features: [feature], recall: async (query, opts) => {
      observed.push({ query, limit: opts.limit });
      return [low];
    } });
    expect(original).toEqual([]);
    expect(observed).toEqual([{ query: feature.description, limit: 3 }]);

    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_FILTER', 'none');
    expect(await retrieveResearchMatches({ features: [feature], recall: async () => [low] })).toHaveLength(1);

    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_RETRIEVAL', 'hybrid');
    vi.stubEnv('CODEBUDDY_DGM_RESEARCH_QUERY', 'component');
    const augmented: string[] = [];
    await retrieveResearchMatches({ features: [feature], recall: async (query, opts) => {
      augmented.push(query);
      expect(opts.limit).toBe(20);
      return [low];
    } });
    expect(augmented[0]).toContain(`Component: ${feature.name}. ${feature.description}`);
  });
});
