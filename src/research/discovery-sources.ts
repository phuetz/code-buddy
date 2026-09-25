/** Public catalogue sources for CKG discoveries. One bounded request per source. */
import { logger } from '../utils/logger.js';
import type { Publication } from './publication-sources.js';

export type DiscoverySort = 'stars' | 'recent' | 'trending';
export interface DiscoveryOptions {
  limit: number;
  minStars?: number;
  pushedSince?: string;
  sort?: DiscoverySort;
  fetcher?: typeof fetch;
  now?: Date;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function dateOnly(value: unknown): string {
  const date = clean(value);
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : '';
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** GitHub Search response → stable CKG discoveries. Apply filters locally as well as on the API. */
export function parseGithubRepos(json: unknown, limit: number, minStars: number, pushedSince: string): Publication[] {
  const items = safeArray((json as { items?: unknown } | null)?.items);
  const out: Publication[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    const repo = item as Record<string, unknown> | null;
    if (!repo) continue;
    const fullName = clean(repo.full_name);
    const stars = repo.stargazers_count;
    const pushed = dateOnly(repo.pushed_at);
    if (!/^[^/\s]+\/[^/\s]+$/.test(fullName) || typeof stars !== 'number' || stars < minStars || !pushed || pushed < pushedSince) continue;
    const topics = safeArray(repo.topics).map(clean).filter(Boolean).join(', ');
    const abstract = [
      clean(repo.description) || 'Description non publiée',
      topics ? `Topics : ${topics}` : '',
      clean(repo.language) ? `Langage : ${clean(repo.language)}` : '',
      `Étoiles : ${stars}`,
      `Dernier push : ${pushed}`,
    ].filter(Boolean).join('. ');
    out.push({ id: `github:${fullName}`, title: fullName, abstract, source: 'github', url: `https://github.com/${fullName}` });
  }
  return out;
}

/** Hugging Face list response → text-generation model cards, with only published metadata. */
export function parseHfModels(json: unknown, limit: number): Publication[] {
  const out: Publication[] = [];
  for (const item of safeArray(json)) {
    if (out.length >= limit) break;
    const model = item as Record<string, unknown> | null;
    if (!model || model.pipeline_tag !== 'text-generation') continue;
    const id = clean(model.id);
    if (!/^[^/\s]+\/[^/\s]+$/.test(id)) continue;
    const card = (model.cardData && typeof model.cardData === 'object' ? model.cardData : {}) as Record<string, unknown>;
    const config = (model.config && typeof model.config === 'object' ? model.config : {}) as Record<string, unknown>;
    const safetensors = (model.safetensors && typeof model.safetensors === 'object' ? model.safetensors : {}) as Record<string, unknown>;
    const params = typeof safetensors.total === 'number' ? safetensors.total : card.num_parameters;
    const context = card.context_length ?? card.max_position_embeddings ?? config.max_position_embeddings;
    const created = dateOnly(model.createdAt);
    const abstract = [
      `Modèle de génération de texte ${id}`,
      typeof params === 'number' && Number.isFinite(params) ? `Taille : ${params} paramètres` : '',
      clean(card.license) ? `Licence : ${clean(card.license)}` : '',
      typeof context === 'number' && Number.isFinite(context) ? `Contexte : ${context} tokens` : '',
      created ? `Créé le : ${created}` : '',
    ].filter(Boolean).join('. ');
    out.push({ id: `hf:${id}`, title: id, abstract, source: 'models', url: `https://huggingface.co/${id}` });
  }
  return out;
}

async function getJson(url: URL, fetcher: typeof fetch, headers?: HeadersInit): Promise<unknown | null> {
  try {
    const response = await fetcher(url.toString(), { headers, signal: AbortSignal.timeout(30_000) });
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') logger.warn(`[research] ${url.host} rate limit exhausted; no retry`);
    if (!response.ok) {
      logger.warn(`[research] ${url.host} returned HTTP ${response.status}; no retry`);
      return null;
    }
    return await response.json();
  } catch (error) {
    logger.warn(`[research] ${url.host} unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function fetchGithubRepos(topic: string, opts: DiscoveryOptions): Promise<Publication[]> {
  const minStars = Math.max(0, Math.floor(opts.minStars ?? 500));
  const since = opts.pushedSince ?? new Date((opts.now ?? new Date()).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(since))) return [];
  const url = new URL('https://api.github.com/search/repositories');
  url.searchParams.set('q', `${topic} stars:>=${minStars} pushed:>=${since}`);
  url.searchParams.set('sort', opts.sort === 'recent' ? 'updated' : 'stars');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(opts.limit));
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'code-buddy-research' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const json = await getJson(url, opts.fetcher ?? fetch, headers);
  return json ? parseGithubRepos(json, opts.limit, minStars, since) : [];
}

export async function fetchHfModels(topic: string, opts: DiscoveryOptions): Promise<Publication[]> {
  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.set('search', topic);
  url.searchParams.set('pipeline_tag', 'text-generation');
  url.searchParams.set('sort', opts.sort === 'recent' ? 'createdAt' : 'trendingScore');
  url.searchParams.set('direction', '-1');
  url.searchParams.set('limit', String(opts.limit));
  url.searchParams.set('full', 'true');
  url.searchParams.set('cardData', 'true');
  const json = await getJson(url, opts.fetcher ?? fetch);
  return json ? parseHfModels(json, opts.limit) : [];
}
