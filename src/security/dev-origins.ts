/**
 * Dev-origin registry — the browser's ONLY sanctioned door onto loopback.
 *
 * The SSRF guard (ssrf-guard.ts) rightly blocks navigation to private and
 * loopback addresses: an agent-driven browser must not read cloud metadata,
 * LAN services, or a pre-existing local admin panel into model context. But
 * the develop → launch → browse → verify loop (the whole point of the agent
 * testing the app it just built) needs to visit the dev server it launched
 * on localhost.
 *
 * This registry is that single, narrow exception:
 * - Only LOOPBACK origins are registrable (localhost / 127.0.0.0/8 / ::1).
 *   A registration attempt for anything else is rejected — the registry can
 *   never be used to reach metadata endpoints or LAN hosts.
 * - Registration is code-driven (the managed app_server tool registers the
 *   origin of a process IT spawned, and unregisters it when that process
 *   dies) or user-driven (CODEBUDDY_BROWSER_DEV_ORIGINS, csv). There is no
 *   LLM-facing "allow this origin" tool.
 * - The guard consults `isDevOriginAllowed()` BEFORE the SSRF check; a miss
 *   falls through to the normal fail-closed path.
 */

import { logger } from '../utils/logger.js';

const registered = new Set<string>();
let envSeeded = false;

/** Loopback = localhost, *.localhost, 127.0.0.0/8, ::1 (with or without brackets). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const octets = m.slice(1).map(Number);
    return octets[0] === 127 && octets.every((o) => o >= 0 && o <= 255);
  }
  return false;
}

/** Parse + validate a candidate; returns the canonical origin or an error. */
function toLoopbackOrigin(rawUrl: string): { ok: true; origin: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: `Invalid URL: ${rawUrl}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `Only http(s) dev origins are allowed, got ${parsed.protocol}` };
  }
  if (!isLoopbackHost(parsed.hostname)) {
    return { ok: false, error: `Dev origins must be loopback (localhost/127.x/::1), got ${parsed.hostname}` };
  }
  return { ok: true, origin: parsed.origin };
}

function seedFromEnv(): void {
  if (envSeeded) return;
  envSeeded = true;
  const raw = process.env.CODEBUDDY_BROWSER_DEV_ORIGINS;
  if (!raw) return;
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const check = toLoopbackOrigin(entry);
    if (check.ok) {
      registered.add(check.origin);
    } else {
      logger.warn(`CODEBUDDY_BROWSER_DEV_ORIGINS entry rejected: ${check.error}`);
    }
  }
}

/**
 * Register a loopback origin as browsable for this session. Callers own the
 * lifecycle: unregister when the backing process stops.
 */
export function registerDevOrigin(rawUrl: string): { ok: true; origin: string } | { ok: false; error: string } {
  const check = toLoopbackOrigin(rawUrl);
  if (!check.ok) return check;
  seedFromEnv();
  registered.add(check.origin);
  return check;
}

export function unregisterDevOrigin(rawUrl: string): void {
  const check = toLoopbackOrigin(rawUrl);
  if (check.ok) registered.delete(check.origin);
}

/** Is this URL inside a registered dev origin? (exact origin match) */
export function isDevOriginAllowed(rawUrl: string): boolean {
  seedFromEnv();
  if (registered.size === 0) return false;
  try {
    return registered.has(new URL(rawUrl).origin);
  } catch {
    return false;
  }
}

export function listDevOrigins(): string[] {
  seedFromEnv();
  return [...registered].sort();
}

/** Test hook: clear everything and re-read the env on next use. */
export function resetDevOrigins(): void {
  registered.clear();
  envSeeded = false;
}
