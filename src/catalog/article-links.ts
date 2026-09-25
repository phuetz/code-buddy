import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getCodeBuddyHome } from '../utils/codebuddy-home.js';

export interface BibliographicId { doi?: string; arxiv?: string; pmid?: string }
export interface ArticleLink {
  schemaVersion: 1;
  featureId: string;
  catalogIds: string[];
  article: BibliographicId & { ckgId: string; source: 'arxiv' | 'europepmc'; title: string };
  query: string;
  method: string;
  scores: { similarity: number; confidence: number; aggregate: number };
  capturedAt: string;
  provenance: { ckgId: string; source: string };
  justification: string;
  humanStatus: 'unreviewed' | 'approved' | 'rejected';
}

export function defaultArticleLinksPath(): string {
  return path.join(getCodeBuddyHome(), 'self-improvement', 'evolution', 'article-links.jsonl');
}

/** A version suffix is not a second paper. DOI is preferred across feeds. */
export function bibliographicIds(name: string, text = ''): BibliographicId | null {
  const arxiv = name.match(/(?:arxiv[:/]|arxiv\.org\/abs\/)(\d{4}\.\d{4,5})(?:v\d+)?/i);
  const pmid = name.match(/^(?:MED|PMID):?(\d{5,10})$/i);
  const doi = `${name} ${text}`.match(/(?:doi[:/\s]*|doi\.org\/)(10\.\d{4,9}\/[\w.()/:;-]+)/i);
  const ids: BibliographicId = {};
  if (arxiv) ids.arxiv = arxiv[1]!.toLowerCase();
  if (pmid) ids.pmid = pmid[1]!;
  if (doi) ids.doi = doi[1]!.replace(/[.,;)]+$/, '').toLowerCase();
  return Object.keys(ids).length ? ids : null;
}

export function articleIdentity(ids: BibliographicId): string {
  return ids.doi ? `doi:${ids.doi}` : ids.arxiv ? `arxiv:${ids.arxiv}` : ids.pmid ? `pmid:${ids.pmid}` : '';
}

export function readArticleLinks(file = defaultArticleLinksPath()): ArticleLink[] {
  if (!existsSync(file)) return [];
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line, index) => {
    let row: ArticleLink;
    try { row = JSON.parse(line) as ArticleLink; }
    catch { throw new Error(`Invalid article link JSONL line ${index + 1}`); }
    if (!validLink(row)) {
      throw new Error(`Invalid article link record at line ${index + 1}`);
    }
    return row;
  });
  return rows.sort(compareLinks);
}

function validLink(row: ArticleLink): boolean {
  return row?.schemaVersion === 1 && typeof row.featureId === 'string' && Boolean(row.featureId) &&
    Array.isArray(row.catalogIds) && row.catalogIds.every((id) => typeof id === 'string') &&
    Boolean(row.article?.ckgId && row.article.title && articleIdentity(row.article)) &&
    (row.article.source === 'arxiv' || row.article.source === 'europepmc') &&
    typeof row.query === 'string' && typeof row.method === 'string' &&
    Number.isFinite(row.scores?.similarity) && Number.isFinite(row.scores?.confidence) &&
    Number.isFinite(row.scores?.aggregate) && Number.isFinite(Date.parse(row.capturedAt)) &&
    Boolean(row.provenance?.ckgId && row.provenance.source) &&
    typeof row.justification === 'string' &&
    (row.humanStatus === 'unreviewed' || row.humanStatus === 'approved' || row.humanStatus === 'rejected');
}

function compareLinks(a: ArticleLink, b: ArticleLink): number {
  return a.featureId.localeCompare(b.featureId) || articleIdentity(a.article).localeCompare(articleIdentity(b.article));
}

function linkKey(row: ArticleLink): string {
  const title = row.article.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${row.featureId}\0${title || articleIdentity(row.article)}`;
}

/** Atomic snapshot: one current row per domain and publication, preserving human decisions. */
export function upsertArticleLinks(incoming: ArticleLink[], file = defaultArticleLinksPath()): void {
  if (!incoming.length) return;
  const rows = new Map<string, ArticleLink>();
  for (const row of readArticleLinks(file)) rows.set(linkKey(row), row);
  for (const row of incoming) {
    if (!validLink(row)) throw new Error('Article link requires a valid feature, publication and provenance');
    const previous = rows.get(linkKey(row));
    rows.set(linkKey(row), previous ? {
      ...row,
      article: { ...previous.article, ...row.article, doi: row.article.doi ?? previous.article.doi,
        arxiv: row.article.arxiv ?? previous.article.arxiv, pmid: row.article.pmid ?? previous.article.pmid },
      capturedAt: previous.capturedAt,
      humanStatus: previous.humanStatus,
    } : row);
  }
  const sorted = [...rows.values()].sort(compareLinks);
  if (existsSync(file) && readFileSync(file, 'utf8') === sorted.map((row) => JSON.stringify(row)).join('\n') + '\n') return;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, sorted.map((row) => JSON.stringify(row)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { if (existsSync(temp)) unlinkSync(temp); } catch { /* retain original failure */ }
    throw error;
  }
}

export function exportArticleLinks(rows: ArticleLink[], format: 'json' | 'csv' | 'md'): string {
  const sorted = [...rows].sort(compareLinks);
  if (format === 'json') return `${JSON.stringify(sorted, null, 2)}\n`;
  const columns = ['featureId', 'catalogIds', 'articleId', 'source', 'query', 'method', 'similarity', 'confidence', 'aggregate', 'capturedAt', 'provenance', 'justification', 'humanStatus'] as const;
  const fields = (row: ArticleLink): string[] => [row.featureId, row.catalogIds.join(';'), articleIdentity(row.article), row.article.source,
    row.query, row.method, String(row.scores.similarity), String(row.scores.confidence), String(row.scores.aggregate), row.capturedAt,
    row.provenance.ckgId, row.justification, row.humanStatus];
  if (format === 'csv') {
    const cell = (value: string): string => `"${value.replace(/"/g, '""')}"`;
    return [columns.map(cell).join(','), ...sorted.map((row) => fields(row).map(cell).join(','))].join('\n') + '\n';
  }
  const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`,
    ...sorted.map((row) => `| ${fields(row).map(cell).join(' | ')} |`)].join('\n') + '\n';
}

export interface ArticleLinkAudit {
  total: number;
  unknownFeatures: string[];
  unknownCatalogIds: string[];
  stale: number;
  linkedCatalogIds: number;
  catalogTotal: number;
  catalogCoveragePercent: number;
}

/** Explicit freshness/coverage check; export itself remains an exact view of persisted rows. */
export function auditArticleLinks(
  rows: ArticleLink[], catalogIds: readonly string[], featureIds: readonly string[], now = new Date(),
): ArticleLinkAudit {
  const knownCatalog = new Set(catalogIds);
  const knownFeatures = new Set(featureIds);
  const linked = new Set(rows.flatMap((row) => row.catalogIds).filter((id) => knownCatalog.has(id)));
  const staleBefore = now.getTime() - 180 * 24 * 60 * 60 * 1000;
  return {
    total: rows.length,
    unknownFeatures: [...new Set(rows.map((row) => row.featureId).filter((id) => !knownFeatures.has(id)))].sort(),
    unknownCatalogIds: [...new Set(rows.flatMap((row) => row.catalogIds).filter((id) => !knownCatalog.has(id)))].sort(),
    stale: rows.filter((row) => !Number.isFinite(Date.parse(row.capturedAt)) || Date.parse(row.capturedAt) < staleBefore).length,
    linkedCatalogIds: linked.size,
    catalogTotal: knownCatalog.size,
    catalogCoveragePercent: knownCatalog.size ? Number((100 * linked.size / knownCatalog.size).toFixed(2)) : 0,
  };
}
