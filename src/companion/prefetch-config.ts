/**
 * Prefetch config — the user-configurable list of "things to precompute" so the
 * voice assistant can answer common questions INSTANTLY (no LLM round-trip).
 *
 * Each item names a cheap, recurring answer to keep warm: today's weather for a
 * city, the day's news headlines, the reminder agenda, the date. A background
 * heartbeat treatment recomputes them (prefetch-engine.ts) and the reply path
 * serves the cached answer on a matching question.
 *
 * Stored as JSON under ~/.codebuddy/companion/ (voice-guidance.ts template):
 * never-throws, env-overridable path, bounded.
 *
 * @module companion/prefetch-config
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export type PrefetchKind = 'weather' | 'news' | 'market' | 'agenda' | 'date';
export const PREFETCH_KINDS: readonly PrefetchKind[] = [
  'weather',
  'news',
  'market',
  'agenda',
  'date',
];
export const DEFAULT_NEWS_QUERY =
  "actualités France monde technologie intelligence artificielle aujourd'hui";
export const DEFAULT_NEWS_SEARCH_LANES = [
  "actualités importantes France monde aujourd'hui",
  "actualités technologie intelligence artificielle aujourd'hui",
] as const;
export const DEFAULT_MARKET_SYMBOLS = ['^FCHI', '^GSPC', '^IXIC'] as const;
export const MAX_MARKET_SYMBOLS = 10;

export function normalizeMarketSymbols(symbols: readonly string[]): string[] {
  const cleaned = symbols
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9^.=:-]{1,24}$/.test(symbol));
  return [...new Set(cleaned)].slice(0, MAX_MARKET_SYMBOLS);
}

export interface PrefetchItem {
  kind: PrefetchKind;
  /** Weather → city name; news → optional query override; market/agenda/date → unused. */
  param?: string;
}

/** Keep the list small — each item is a periodic network/compute cost. */
export const MAX_PREFETCH_ITEMS = 12;

/**
 * Out-of-the-box list. News uses the normal web-search provider chain and is
 * kept as structured evidence; no LLM generation is performed by the warmer.
 */
export const DEFAULT_PREFETCH_ITEMS: PrefetchItem[] = [
  { kind: 'date' },
  { kind: 'agenda' },
  { kind: 'news' },
  { kind: 'market' },
];

/**
 * Indices kept warm for everyone, followed by an optional bounded watchlist.
 * Invalid values are ignored instead of reaching a remote quote endpoint.
 */
export function loadMarketSymbols(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.CODEBUDDY_MARKET_SYMBOLS ?? '')
    .split(',')
    .filter(Boolean);
  return normalizeMarketSymbols([...DEFAULT_MARKET_SYMBOLS, ...configured]);
}

export function defaultPrefetchItemsPath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.CODEBUDDY_PREFETCH_ITEMS_FILE?.trim() ||
    join(homedir(), '.codebuddy', 'companion', 'prefetch-items.json')
  );
}

/** A stable cache key for an item (weather is per-city; the rest are singletons). */
export function prefetchItemKey(item: PrefetchItem): string {
  const p = (item.param ?? '').trim().toLowerCase();
  return item.kind === 'weather' && p ? `weather:${p}` : item.kind;
}

function isValidItem(x: unknown): x is PrefetchItem {
  const o = x as PrefetchItem;
  return !!o && (PREFETCH_KINDS as readonly string[]).includes(o.kind);
}

/**
 * Load the configured items. Missing file → the DEFAULT list (first-run gets
 * date+agenda); a saved list (even empty) is respected verbatim. never-throws.
 */
export function loadPrefetchItems(path: string = defaultPrefetchItemsPath()): PrefetchItem[] {
  try {
    const raw = readJsonAtomicSync<unknown[]>(path, [...DEFAULT_PREFETCH_ITEMS], {
      mode: 0o600,
      isValid: (value): value is unknown[] => Array.isArray(value),
    });
    return raw
      .filter(isValidItem)
      .map((o) => ({ kind: o.kind, ...(o.param?.trim() ? { param: o.param.trim() } : {}) }))
      .slice(0, MAX_PREFETCH_ITEMS);
  } catch {
    return [...DEFAULT_PREFETCH_ITEMS];
  }
}

/** Persist the list (never-throws; creates the dir). */
export function savePrefetchItems(
  items: PrefetchItem[],
  path: string = defaultPrefetchItemsPath()
): void {
  try {
    writeJsonAtomicSync(path, items.slice(0, MAX_PREFETCH_ITEMS), { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

/** Add an item (validated, deduped by key, capped). Pure on the input array. */
export function addPrefetchItem(item: PrefetchItem, existing: PrefetchItem[] = []): PrefetchItem[] {
  if (!isValidItem(item)) return existing;
  const clean: PrefetchItem = {
    kind: item.kind,
    ...(item.param?.trim() ? { param: item.param.trim() } : {}),
  };
  const key = prefetchItemKey(clean);
  const kept = existing.filter((x) => prefetchItemKey(x) !== key);
  return [...kept, clean].slice(0, MAX_PREFETCH_ITEMS);
}

/** Remove the item at `index`. Pure. */
export function removePrefetchItem(index: number, existing: PrefetchItem[] = []): PrefetchItem[] {
  if (index < 0 || index >= existing.length) return existing;
  return existing.filter((_, i) => i !== index);
}
