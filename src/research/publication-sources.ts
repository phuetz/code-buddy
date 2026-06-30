/**
 * Scientific publication sources for `buddy research ingest` — open, $0, no API key.
 *
 * Feeds the Collective Knowledge Graph (CKG) with real research so discoveries self-organise
 * into a queryable graph (Patrice's vision: "lui faire étudier une base de publications
 * scientifiques"). Domain-agnostic: arXiv covers CS/AI/physics/math/bio, Europe PMC covers
 * life sciences/medicine.
 *
 * The PARSERS are pure (testable with fixtures, no network); the fetchers are best-effort and
 * NEVER-THROW (a source that's down or unreachable yields [] rather than failing the command).
 *
 * @module research/publication-sources
 */

import { logger } from '../utils/logger.js';

export interface Publication {
  /** Stable id, e.g. "arxiv:2501.13956" or "MED:39000000". */
  id: string;
  title: string;
  abstract: string;
  source: string;
  url?: string;
}

export type PublicationSource = 'arxiv' | 'europepmc' | 'both';

const FETCH_TIMEOUT_MS = 20_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pure parser for the arXiv Atom feed. */
export function parseArxivAtom(xml: string, limit: number): Publication[] {
  const out: Publication[] = [];
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  for (const e of entries) {
    if (out.length >= limit) break;
    const title = decodeEntities(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const abstract = decodeEntities(e.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? '');
    const rawId = (e.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? '').trim();
    if (!title || !abstract) continue;
    const arxivId = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, '').trim() || rawId;
    out.push({ id: `arxiv:${arxivId}`, title, abstract, source: 'arxiv', ...(rawId ? { url: rawId } : {}) });
  }
  return out;
}

/** Pure parser for the Europe PMC JSON `search` response. */
export function parseEuropePmc(json: unknown, limit: number): Publication[] {
  const results = (json as { resultList?: { result?: unknown[] } })?.resultList?.result ?? [];
  const out: Publication[] = [];
  for (const r of results) {
    if (out.length >= limit) break;
    const rec = r as { id?: string; source?: string; title?: string; abstractText?: string; doi?: string };
    const title = (rec.title ?? '').replace(/\s+/g, ' ').trim();
    const abstract = (rec.abstractText ?? '').replace(/\s+/g, ' ').trim();
    if (!title || !abstract) continue;
    const id = `${rec.source ?? 'EPMC'}:${rec.id ?? ''}`;
    out.push({
      id,
      title,
      abstract,
      source: 'europepmc',
      ...(rec.doi ? { url: `https://doi.org/${rec.doi}` } : {}),
    });
  }
  return out;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn(`[research] ${new URL(url).host} returned HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    logger.warn(`[research] fetch failed (${new URL(url).host}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function fetchArxiv(topic: string, limit: number): Promise<Publication[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(topic)}&start=0&max_results=${limit}`;
  const xml = await fetchText(url);
  return xml ? parseArxivAtom(xml, limit) : [];
}

async function fetchEuropePmc(topic: string, limit: number): Promise<Publication[]> {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(topic)}&format=json&pageSize=${limit}&resultType=core`;
  const text = await fetchText(url);
  if (!text) return [];
  try {
    return parseEuropePmc(JSON.parse(text), limit);
  } catch {
    return [];
  }
}

/**
 * Fetch publications on a topic from the requested source(s). Best-effort and never-throws:
 * an unreachable source contributes nothing. Results are de-duplicated by id.
 */
export async function fetchPublications(
  topic: string,
  opts: { source?: PublicationSource; limit?: number } = {},
): Promise<Publication[]> {
  const source = opts.source ?? 'both';
  const limit = Math.max(1, Math.min(50, opts.limit ?? 6));
  const jobs: Array<Promise<Publication[]>> = [];
  if (source === 'arxiv' || source === 'both') jobs.push(fetchArxiv(topic, limit));
  if (source === 'europepmc' || source === 'both') jobs.push(fetchEuropePmc(topic, limit));
  const all = (await Promise.all(jobs)).flat();
  const seen = new Set<string>();
  const deduped: Publication[] = [];
  for (const p of all) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    deduped.push(p);
  }
  return deduped;
}
