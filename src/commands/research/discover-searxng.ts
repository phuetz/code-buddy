/**
 * Optional local SearXNG discovery for Deep Research.
 *
 * `SEARXNG_URL` remains the explicit opt-in (WebSearchTool is byte-identical
 * when it is unset). The Deep Research CLI, however, is running on machines
 * that already host SearXNG on loopback (default :8888) without exporting the
 * variable — and then falls through to DuckDuckGo, which is frequently
 * CAPTCHA'd. A short fail-open probe lets `--deep` use the local instance
 * without starting any service.
 *
 * Disabled by `CODEBUDDY_SEARXNG_AUTODISCOVER=false`. Never throws.
 *
 * @module commands/research/discover-searxng
 */

import { logger } from '../../utils/logger.js';

const CANDIDATES = ['http://127.0.0.1:8888', 'http://localhost:8888'] as const;

export interface DiscoverSearxngDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

function normalizeExisting(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

/**
 * If `SEARXNG_URL` is already set, return it. Otherwise probe well-known
 * loopback SearXNG endpoints; on a JSON payload with a `results` array, set
 * `SEARXNG_URL` for the rest of this process and return the base URL.
 */
export async function maybeDiscoverLocalSearxng(
  deps: DiscoverSearxngDeps = {},
): Promise<string | undefined> {
  const env = deps.env ?? process.env;
  const existing = normalizeExisting(env.SEARXNG_URL);
  if (existing) return existing;
  if (env.CODEBUDDY_SEARXNG_AUTODISCOVER === 'false') return undefined;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 800;

  for (const base of CANDIDATES) {
    try {
      const url = `${base}/search?q=_codebuddy_probe&format=json`;
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as { results?: unknown };
      if (!Array.isArray(payload.results)) continue;
      env.SEARXNG_URL = base;
      logger.info('[deep-research] discovered local SearXNG', { url: base });
      return base;
    } catch (err) {
      logger.debug('[deep-research] SearXNG probe failed', {
        url: base,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return undefined;
}
