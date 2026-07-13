/**
 * SSRF-safe fetch — validates the initial URL AND every redirect hop.
 *
 * The SSRF guard (`assertSafeUrl`) only ever validated the URL the caller passed.
 * Every outbound call site then followed 3xx redirects with no per-hop re-check,
 * so a public attacker URL that 302-redirects to `http://169.254.169.254/…`
 * (cloud metadata) or `http://127.0.0.1:…` (loopback admin panels) sailed
 * straight through and streamed its response into model context.
 *
 * `safeFetch` closes that: auto-redirect is disabled (`redirect:'manual'`) and
 * each `Location` is re-validated against the guard before it is followed, capped
 * at `maxHops`. Route outbound fetches through this instead of bare `fetch`.
 *
 * NOTE: this closes the redirect vector. The narrower DNS-rebind TOCTOU (the guard
 * resolves the hostname, then `fetch` resolves it again independently — a low-TTL
 * record can differ) is a separate gap; pinning the validated IP via a custom
 * undici dispatcher is a documented follow-up.
 *
 * @module security/safe-fetch
 */

import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { assertSafeUrl } from './ssrf-guard.js';
import { logger } from '../utils/logger.js';

export interface SafeFetchOptions {
  /** Max redirect hops to follow — each re-validated by the SSRF guard. Default 5. */
  maxHops?: number;
  /** Follow 3xx redirects (default true). When false the first 3xx is returned as-is. */
  followRedirects?: boolean;
}

/**
 * Fetch a URL with SSRF protection on the initial request and on every redirect
 * hop. Throws `Error('SSRF protection: …')` on any unsafe hop, an invalid
 * `Location`, or too many redirects.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const maxHops = Math.max(0, opts.maxHops ?? 5);
  const follow = opts.followRedirects ?? true;
  let currentUrl = url;

  for (let hop = 0; ; hop++) {
    const check = await assertSafeUrl(currentUrl);
    if (!check.safe) {
      throw new Error(`SSRF protection: ${check.reason}`);
    }

    // redirect:'manual' — we drive the redirect chain ourselves so each hop is checked.
    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect || !follow) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response; // 3xx with no Location — nothing to follow
    }
    if (hop >= maxHops) {
      throw new Error(`SSRF protection: too many redirects (>${maxHops})`);
    }

    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new Error(`SSRF protection: invalid redirect Location: ${location}`);
    }
    logger.debug(`safeFetch: following validated redirect hop ${hop + 1} → ${currentUrl}`);
  }
}

/** Minimal shape of an axios instance's `.get` — avoids importing the concrete instance type. */
export interface AxiosGetter {
  get(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse>;
}

/**
 * SSRF-safe `axios.get` — same per-hop guarantee as {@link safeFetch} for the
 * axios call sites (web-search, image download). Forces `maxRedirects:0` and drives
 * the redirect chain manually so every `Location` is re-validated before it is
 * followed. The caller's other config (responseType, maxContentLength, headers,
 * timeout) is preserved.
 */
export async function safeAxiosGet(
  client: AxiosGetter,
  url: string,
  config: AxiosRequestConfig = {},
  opts: SafeFetchOptions = {},
): Promise<AxiosResponse> {
  const maxHops = Math.max(0, opts.maxHops ?? 5);
  const follow = opts.followRedirects ?? true;
  let currentUrl = url;

  for (let hop = 0; ; hop++) {
    const check = await assertSafeUrl(currentUrl);
    if (!check.safe) {
      throw new Error(`SSRF protection: ${check.reason}`);
    }

    const response = await client.get(currentUrl, {
      ...config,
      maxRedirects: 0,
      // Accept 3xx (and the caller's own 2xx range) so we can inspect Location
      // instead of axios throwing on the redirect status.
      validateStatus: (s: number) => s >= 200 && s < 400,
    });

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect || !follow) {
      return response;
    }

    const location = (response.headers?.location ?? response.headers?.Location) as string | undefined;
    if (!location) {
      return response;
    }
    if (hop >= maxHops) {
      throw new Error(`SSRF protection: too many redirects (>${maxHops})`);
    }

    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new Error(`SSRF protection: invalid redirect Location: ${location}`);
    }
    logger.debug(`safeAxiosGet: following validated redirect hop ${hop + 1} → ${currentUrl}`);
  }
}
