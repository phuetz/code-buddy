import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { articleIdentity, auditArticleLinks, bibliographicIds, exportArticleLinks, readArticleLinks, upsertArticleLinks, type ArticleLink } from '../../src/catalog/article-links.js';
import { registerCatalogCommand } from '../../src/commands/cli/catalog-command.js';
import { excludeHumanRejected, fetchResearchGoals, filterResearchHits, selectMatches, type FeatureMatch } from '../../src/agent/self-improvement/evolution/research-weakness-source.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const tempFile = (): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dgm-article-links-'));
  roots.push(root);
  return path.join(root, 'links.jsonl');
};
const row = (over: Partial<ArticleLink> = {}): ArticleLink => ({
  schemaVersion: 1, featureId: 'context-rag', catalogIds: ['tool:context_expand'],
  article: { arxiv: '2605.01664', ckgId: 'ckg-1', source: 'arxiv', title: 'Hybrid retrieval and reranking' },
  query: 'context retrieval', method: 'ckg-recall-hybrid+dgm-relevance-v1',
  scores: { similarity: 0.72, confidence: 0.8, aggregate: 0.576 }, capturedAt: '2026-09-25T00:00:00.000Z',
  provenance: { ckgId: 'ckg-1', source: 'arxiv' }, justification: 'Publication pertinente.',
  humanStatus: 'unreviewed', ...over,
});

describe('persisted DGM article links', () => {
  it('normalizes arXiv versions and reads an atomic JSONL snapshot', () => {
    const file = tempFile();
    expect(articleIdentity(bibliographicIds('arxiv:2605.01664v2')!)).toBe('arxiv:2605.01664');
    expect(articleIdentity(bibliographicIds('MED:42363493')!)).toBe('pmid:42363493');
    upsertArticleLinks([row()], file);
    expect(readArticleLinks(file)).toEqual([row()]);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('deduplicates a shared DOI across arXiv and Europe PMC and preserves human review and first capture date', () => {
    const file = tempFile();
    upsertArticleLinks([row({ humanStatus: 'approved', article: {
      arxiv: '2605.01664', doi: '10.1234/shared', ckgId: 'ckg-1', source: 'arxiv', title: 'Hybrid retrieval and reranking',
    } })], file);
    const second = row({
      article: { pmid: '42363493', doi: '10.1234/shared', ckgId: 'ckg-2', source: 'europepmc', title: 'Hybrid retrieval and reranking' },
      capturedAt: '2026-09-26T00:00:00.000Z', humanStatus: 'unreviewed',
    });
    upsertArticleLinks([second], file);
    const links = readArticleLinks(file);
    expect(links).toHaveLength(1);
    expect(links[0]!.article.arxiv).toBe('2605.01664');
    expect(links[0]!.article.pmid).toBe('42363493');
    expect(links[0]!.humanStatus).toBe('approved');
    expect(links[0]!.capturedAt).toBe('2026-09-25T00:00:00.000Z');
    const snapshot = readFileSync(file, 'utf8');
    upsertArticleLinks([second], file);
    expect(readFileSync(file, 'utf8')).toBe(snapshot);
  });

  it('keeps distinct publications with the same title and feature separate', () => {
    const file = tempFile();
    const other = row({ article: { arxiv: '2607.05441', ckgId: 'ckg-2', source: 'arxiv', title: 'Hybrid retrieval and reranking' } });
    upsertArticleLinks([row({ humanStatus: 'rejected' }), other], file);
    expect(readArticleLinks(file).map((link) => [articleIdentity(link.article), link.humanStatus])).toEqual([
      ['arxiv:2605.01664', 'rejected'], ['arxiv:2607.05441', 'unreviewed'],
    ]);
  });

  it('exports stable JSON, quoted CSV and escaped Markdown', () => {
    const rows = [row({ justification: 'validé, "revu" | humain' })];
    expect(JSON.parse(exportArticleLinks(rows, 'json'))).toEqual(rows);
    expect(exportArticleLinks(rows, 'csv')).toContain('"validé, ""revu"" | humain"');
    expect(exportArticleLinks(rows, 'md')).toContain('validé, "revu" \\| humain');
  });

  it('reports unknown links, stale records and catalogue coverage', () => {
    const audit = auditArticleLinks([row({ catalogIds: ['tool:context_expand', 'tool:removed'],
      capturedAt: '2025-01-01T00:00:00.000Z' })], ['tool:context_expand', 'tool:other'],
    ['different-feature'], new Date('2026-09-25T00:00:00.000Z'));
    expect(audit.unknownFeatures).toEqual(['context-rag']);
    expect(audit.unknownCatalogIds).toEqual(['tool:removed']);
    expect(audit.stale).toBe(1);
    expect(audit.catalogCoveragePercent).toBe(50);
  });

  it('catalog articles only reads its JSONL source', async () => {
    const file = tempFile();
    upsertArticleLinks([row()], file);
    const before = readFileSync(file, 'utf8');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const command = new Command();
      registerCatalogCommand(command);
      await command.parseAsync(['catalog', 'articles', '--json', '--file', file], { from: 'user' });
      expect(stdout).toHaveBeenCalled();
      expect(readFileSync(file, 'utf8')).toBe(before);
    } finally { stdout.mockRestore(); }
  });
});

describe('research relevance guard', () => {
  const feature = { id: 'context-rag', name: 'Context RAG', description: 'retrieval', paths: [] };
  const candidate = (name: string, source: string, similarity: number, score: number): FeatureMatch => ({
    feature,
    hit: { name, source, type: 'discovery', text: 'Hybrid retrieval and reranking.', similarity, confidence: 0.8 }, score,
  });

  it('filters video, unknown identity, weak score and contradictions before synthesis', async () => {
    const candidates = [candidate('arxiv:2605.01664v1', 'youtube:vision-ia', 0.9, 0.9),
      candidate('anonymous', 'arxiv', 0.9, 0.9), candidate('arxiv:2605.01664v2', 'arxiv', 0.4, 0.35),
      { ...candidate('arxiv:2605.01664v3', 'arxiv', 0.8, 0.7), hit: {
        ...candidate('arxiv:2605.01664v3', 'arxiv', 0.8, 0.7).hit,
        relations: [{ predicate: 'contradicts', target: 'other' }],
      } }];
    expect(selectMatches(candidates)).toEqual([]);
    const chat = vi.fn(async () => 'Applique le résultat au code.');
    const goals = await fetchResearchGoals({ features: [feature], recall: async () => candidates.map((item) => item.hit),
      chat, persistLinks: false });
    expect(goals).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it('ranks by aggregate score and keeps one article across domains and versions', () => {
    const second = { ...feature, id: 'tool-selection' };
    const first = candidate('arxiv:2605.01664v1', 'arxiv', 0.8, 0.6);
    const duplicate = { ...candidate('arxiv:2605.01664v2', 'arxiv', 0.9, 0.7), feature: second };
    const other = { ...candidate('MED:42363493', 'europepmc', 0.7, 0.5), feature };
    other.hit.text = 'A distinct publication about trustworthy memory.';
    expect(selectMatches([first, duplicate, other]).map((item) => item.score)).toEqual([0.7, 0.5]);
  });

  it('does not turn a human-rejected article into a new goal', () => {
    const file = tempFile();
    upsertArticleLinks([row({ humanStatus: 'rejected' })], file);
    const match = candidate('arxiv:2605.01664v4', 'arxiv', 0.9, 0.72);
    match.hit.text = 'Hybrid retrieval and reranking. A new abstract.';
    expect(excludeHumanRejected([match], file)).toEqual([]);
  });

  it('does not apply a human rejection to a different publication with the same title', () => {
    const file = tempFile();
    upsertArticleLinks([row({ humanStatus: 'rejected' })], file);
    const distinct = candidate('arxiv:2607.05441', 'arxiv', 0.9, 0.72);
    expect(excludeHumanRejected([distinct], file)).toEqual([distinct]);
  });

  it('does not collapse different publications with the same title in recall', () => {
    const first = candidate('arxiv:2605.01664', 'arxiv', 0.9, 0.72);
    const second = candidate('arxiv:2607.05441', 'arxiv', 0.8, 0.64);
    expect(filterResearchHits([first, second])).toEqual([first, second]);
  });
});
