/**
 * Link preview for the mobile PWA. SSRF via assertSafeUrl + safeFetchFollow.
 * In-memory LRU cache (24 h, 200 entries). Response body is capped at 256 KiB.
 */

import { logger } from '../../utils/logger.js';
import { safeFetchFollow } from '../../security/safe-fetch.js';

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
}

export const MAX_LINK_PREVIEW_BYTES = 256 * 1024;
export const LINK_PREVIEW_CACHE_MAX = 200;
export const LINK_PREVIEW_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: LinkPreview }>();

/** Read at most `maxBytes` from a Response, then cancel the remainder. */
export async function readCappedText(
  res: Response,
  maxBytes: number = MAX_LINK_PREVIEW_BYTES,
): Promise<{ text: string; bytesRead: number }> {
  if (!res.body) {
    return { text: '', bytesRead: 0 };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = maxBytes - bytesRead;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        bytesRead += remaining;
        break;
      }
      chunks.push(value);
      bytesRead += value.byteLength;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  if (chunks.length === 0) return { text: '', bytesRead };
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), bytesRead };
}

function cacheGet(url: string): LinkPreview | undefined {
  const hit = cache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= CACHE_TTL_MS) {
    cache.delete(url);
    return undefined;
  }
  cache.delete(url);
  cache.set(url, hit);
  return hit.value;
}

function cachePut(url: string, value: LinkPreview): void {
  if (cache.has(url)) cache.delete(url);
  cache.set(url, { at: Date.now(), value });
  while (cache.size > LINK_PREVIEW_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

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
  const cached = cacheGet(url);
  if (cached) return cached;
  try {
    const html = deps.fetchHtml
      ? await deps.fetchHtml(url)
      : await (async () => {
          const res = await safeFetchFollow(url, {
            method: 'GET',
            headers: { Accept: 'text/html' },
            signal: AbortSignal.timeout(LINK_PREVIEW_TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const { text } = await readCappedText(res);
          return text;
        })();
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    const title = meta(html, 'og:title') || decodeHtml(titleMatch?.[1] || '') || parsed.hostname;
    const description = meta(html, 'og:description') || meta(html, 'description');
    const value: LinkPreview = {
      url,
      title: stripTags(title).slice(0, 140),
      description: stripTags(description).slice(0, 240),
    };
    cachePut(url, value);
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
