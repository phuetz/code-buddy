/**
 * Link preview for the mobile PWA. SSRF via assertSafeUrl + safeFetchFollow.
 * In-memory cache, 24 h.
 */

import { logger } from '../../utils/logger.js';
import { safeFetchFollow } from '../../security/safe-fetch.js';

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: LinkPreview }>();

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function meta(html: string, key: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
    'i',
  );
  return decodeHtml(re.exec(html)?.[1] || alt.exec(html)?.[1] || '');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export async function fetchLinkPreview(
  rawUrl: string,
  deps: { fetchHtml?: (url: string) => Promise<string> } = {},
): Promise<LinkPreview | { error: string; status: number }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: 'Invalid URL', status: 400 };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'Invalid URL', status: 400 };
  }
  const url = parsed.toString();
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  try {
    const html = deps.fetchHtml
      ? await deps.fetchHtml(url)
      : await (async () => {
          const res = await safeFetchFollow(url, {
            method: 'GET',
            headers: { Accept: 'text/html' },
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.text()).slice(0, 80_000);
        })();
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    const title = meta(html, 'og:title') || decodeHtml(titleMatch?.[1] || '') || parsed.hostname;
    const description = meta(html, 'og:description') || meta(html, 'description');
    const value: LinkPreview = {
      url,
      title: stripTags(title).slice(0, 140),
      description: stripTags(description).slice(0, 240),
    };
    cache.set(url, { at: Date.now(), value });
    return value;
  } catch (err) {
    logger.warn('[link-preview] failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Preview unavailable', status: 502 };
  }
}

export function _resetLinkPreviewCacheForTests(): void {
  cache.clear();
}
