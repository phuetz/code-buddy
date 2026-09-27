/** Configured RSS/Atom laboratory blogs for CKG ingestion. */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getCodeBuddyHome } from '../utils/codebuddy-home.js';
import { logger } from '../utils/logger.js';
import type { Publication } from './publication-sources.js';

export interface BlogOptions {
  limit: number;
  feedsFile?: string;
  fetcher?: typeof fetch;
}

const MAX_FEEDS = 32;
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_POSTS_PER_FEED = 1000;

function decodeText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const point = code[0]?.toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name: string) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name.toLowerCase()] ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function field(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i').exec(xml);
  return match ? decodeText(match[1] ?? '') : '';
}

function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return match?.[2] ?? '';
}

/** The post URL, rather than an RSS GUID or Atom tag ID, is the stable CKG identity. */
export function canonicalBlogUrl(raw: string, feedUrl: string): string | null {
  if (!raw.trim()) return null;
  try {
    const url = new URL(decodeText(raw), feedUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function entryLink(entry: string, kind: string): string {
  if (kind === 'item') {
    const link = field(entry, 'link');
    const guid = field(entry, 'guid');
    return link || (/^https?:\/\//i.test(guid) ? guid : '');
  }
  const links = entry.match(/<link\b[^>]*\/?\s*>/gi) ?? [];
  const alternate = links.find((tag) => attribute(tag, 'rel').toLowerCase() === 'alternate');
  const fallback = links.find((tag) => !attribute(tag, 'rel') || attribute(tag, 'rel').toLowerCase() !== 'self');
  return attribute(alternate ?? fallback ?? '', 'href');
}

function words(value: string): string[] {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Parse one RSS or Atom document and filter entries before ingestion. */
export function parseBlogFeed(xml: string, feedUrl: string, topic: string, limit: number): Publication[] {
  if (!/<(?:rss|feed)\b/i.test(xml)) return [];
  const keywords = words(topic);
  if (keywords.length === 0) return [];
  const out: Publication[] = [];
  const seen = new Set<string>();
  const entries = xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi);
  for (const match of entries) {
    if (out.length >= limit) break;
    const entry = match[2] ?? '';
    const title = field(entry, 'title');
    const summary = field(entry, 'description') || field(entry, 'summary') || field(entry, 'content') || field(entry, 'content:encoded');
    const url = canonicalBlogUrl(entryLink(entry, (match[1] ?? '').toLowerCase()), feedUrl);
    if (!title || !url || seen.has(url)) continue;
    const text = new Set(words(`${title} ${summary}`));
    if (!keywords.every((word) => text.has(word))) continue;
    seen.add(url);
    out.push({ id: url, url, title, abstract: summary || title, source: 'blogs' });
  }
  return out;
}

async function loadFeeds(file: string): Promise<string[]> {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_CONFIG_BYTES) return [];
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((value): value is string => {
      if (typeof value !== 'string') return false;
      try { return new URL(value).protocol === 'https:'; } catch { return false; }
    }))].slice(0, MAX_FEEDS);
  } catch (error) {
    logger.warn(`[research blogs] feed list unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** Each feed may fail independently; no retry or ledger write occurs here. */
export async function fetchBlogPosts(topic: string, opts: BlogOptions): Promise<Publication[]> {
  const file = opts.feedsFile ?? join(getCodeBuddyHome(), 'research', 'blog-feeds.json');
  const feeds = await loadFeeds(file);
  const out: Publication[] = [];
  const seen = new Set<string>();
  for (const feed of feeds) {
    if (out.length >= opts.limit) break;
    try {
      const response = await (opts.fetcher ?? fetch)(feed, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        logger.warn(`[research blogs] ${new URL(feed).host} returned HTTP ${response.status}`);
        continue;
      }
      // Parse past duplicates from earlier feeds so they cannot consume the remaining quota.
      const posts = parseBlogFeed(await response.text(), feed, topic, MAX_POSTS_PER_FEED);
      for (const post of posts) {
        if (seen.has(post.id)) continue;
        seen.add(post.id);
        out.push(post);
        if (out.length >= opts.limit) break;
      }
    } catch (error) {
      logger.warn(`[research blogs] ${new URL(feed).host} unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}
