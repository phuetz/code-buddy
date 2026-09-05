/**
 * Prefetch engine — precompute answers to common voice questions so they can be
 * served INSTANTLY (no LLM). A heartbeat treatment calls `runPrefetchCycle`
 * periodically; the reply path (hybrid-reply.ts) calls `matchPrefetched` and, on
 * a hit, returns the cached answer text directly (only the TTS synth remains).
 *
 * Reuses the real tools: WeatherTool (Open-Meteo, $0), WebSearchTool (headlines),
 * reminders agenda, and an inline French date. All deps are injectable so the
 * engine is unit-testable without network. never-throws.
 *
 * @module companion/prefetch-engine
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
import {
  formatMarketDigest,
  formatNewsDigest,
  type FreshContextPayload,
  type MarketDigest,
  type MarketDigestItem,
  type NewsDigest,
  type NewsDigestItem,
} from '../conversation/fresh-context.js';
import {
  DEFAULT_NEWS_QUERY,
  DEFAULT_NEWS_SEARCH_LANES,
  loadMarketSymbols,
  loadPrefetchItems,
  normalizeMarketSymbols,
  prefetchItemKey,
  type PrefetchItem,
  type PrefetchKind,
} from './prefetch-config.js';
import type { StockQuoteMetadata } from '../tools/stock-quote.js';
import type { SearchResult } from '../tools/web-search.js';
import type { ToolResult } from '../types/index.js';
import type { StockWidgetData } from '../widgets/widget-types.js';

export interface PrefetchEntry {
  key: string;
  kind: PrefetchKind;
  answer: string;
  at: number;
  /** Structured evidence used to formulate contextual answers and follow-ups. */
  context?: FreshContextPayload;
}

/** Fresh window: ordinary cache hits never need a disclosure. */
export const FRESH_TTL_MS: Record<PrefetchKind, number> = {
  weather: 30 * 60_000,
  news: 15 * 60_000,
  market: 15 * 60_000,
  agenda: 10 * 60_000,
  date: 12 * 60 * 60_000,
};

/** Last-known-good window used only when live refresh failed. */
export const STALE_TTL_MS: Record<PrefetchKind, number> = {
  weather: 45 * 60_000,
  news: 60 * 60_000,
  market: 30 * 60_000,
  agenda: 6 * 60 * 60_000,
  date: 24 * 60 * 60_000,
};

export interface PrefetchDeps {
  now?: number;
  cachePath?: string;
  itemsPath?: string;
  /** city → spoken weather text (null on failure). Default: WeatherTool. */
  fetchWeather?: (city: string) => Promise<string | null>;
  /** query → spoken headlines text. Default: WebSearchTool. */
  fetchNews?: (query: string) => Promise<string | null>;
  /** query → structured headlines evidence. Default: WebSearchTool. */
  fetchNewsContext?: (query: string) => Promise<NewsDigest | null>;
  /** Bounded symbols + cycle time → structured market evidence. Default: StockQuoteTool. */
  fetchMarketContext?: (symbols: readonly string[], fetchedAt: number) => Promise<MarketDigest | null>;
  /** Test/programmatic override; normal configuration uses CODEBUDDY_MARKET_SYMBOLS. */
  marketSymbols?: readonly string[];
  /** now → spoken agenda text. Default: reminders. */
  fetchAgenda?: (now: number) => Promise<string | null>;
  /** now → spoken French date. Default: inline. */
  makeDate?: (now: number) => string;
}

// ---------------------------------------------------------------------------
// Cache store (JSON under ~/.codebuddy/companion/)
// ---------------------------------------------------------------------------

export function defaultPrefetchCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.CODEBUDDY_PREFETCH_CACHE_FILE?.trim() ||
    join(homedir(), '.codebuddy', 'companion', 'prefetch-cache.json')
  );
}

export function loadPrefetchCache(path: string = defaultPrefetchCachePath()): PrefetchEntry[] {
  try {
    const raw = readJsonAtomicSync<unknown[]>(path, [], {
      mode: 0o600,
      isValid: (value): value is unknown[] => Array.isArray(value),
    });
    return raw.filter((e): e is PrefetchEntry => Boolean(e && typeof e === 'object' && 'key' in e && 'answer' in e));
  } catch {
    return [];
  }
}

export function savePrefetchCache(
  entries: PrefetchEntry[],
  path: string = defaultPrefetchCachePath()
): void {
  try {
    writeJsonAtomicSync(path, entries, { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Intent matching (pure)
// ---------------------------------------------------------------------------

/** Lowercase + strip diacritics so STT accents don't break matching. Pure. */
export function normalizeQuery(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '') // strip combining diacritics (accents)
    .replace(/['’`\-_.,!?;:()]/g, ' ') // apostrophes/hyphens/punctuation → space (STT-robust)
    .replace(/\s+/g, ' ')
    .trim();
}

const KIND_PATTERNS: Record<PrefetchKind, RegExp> = {
  weather: /\b(meteo|quel temps|le temps qu|temps qu il fait|il fait quel temps)\b/,
  news: /\b(actualite|actualites|nouvelles|les infos|quoi de neuf|gros titres|l actu)\b/,
  market:
    /\b(bourse|marches? financiers?|indices? boursiers?|cac\s*40|s\s*(?:&|et)?\s*p\s*500|sp\s*500|nasdaq|wall street|portefeuille boursier|mes valeurs|cours (?:de |des )?(?:indices?|actions?|titres?|valeurs?))\b/,
  agenda:
    /\b(agenda|mes rappels|mon programme|au programme|qu est ce que j ai|mes rendez|ma journee)\b/,
  date: /\b(quel jour|quelle date|on est quel|le jour on est|date du jour|quel jour on est|on est le combien)\b/,
};

/**
 * Which prefetch cache key a question wants, given the configured items (needed
 * to resolve the weather city). Returns null when nothing matches. Pure.
 */
export function intentKeyForQuery(heard: string, items: PrefetchItem[]): string | null {
  const q = normalizeQuery(heard);
  if (!q) return null;

  if (KIND_PATTERNS.weather.test(q)) {
    const weatherItems = items.filter((i) => i.kind === 'weather');
    if (weatherItems.length === 0) return null;
    // Prefer a configured city whose name is spoken in the question.
    const named = weatherItems.find((i) => i.param && q.includes(normalizeQuery(i.param)));
    return prefetchItemKey(named ?? weatherItems[0]!);
  }
  for (const kind of ['market', 'news', 'agenda', 'date'] as const) {
    if (KIND_PATTERNS[kind].test(q)) return kind;
  }
  return null;
}

/**
 * Return a fresh cached answer for `heard`, or null. Pure over the injected
 * cache + items (the reply path passes the loaded cache).
 */
export function matchPrefetched(
  heard: string,
  args: { cache: PrefetchEntry[]; items: PrefetchItem[]; now: number }
): string | null {
  const key = intentKeyForQuery(heard, args.items);
  if (!key) return null;
  const entry = args.cache.find((e) => e.key === key);
  if (!entry) return null;
  const ttl = FRESH_TTL_MS[entry.kind] ?? 60 * 60_000;
  return args.now - entry.at < ttl ? entry.answer : null;
}

export interface PrefetchMatch {
  entry: PrefetchEntry;
  answer: string;
  freshness: 'fresh' | 'stale';
  ageMs: number;
}

/**
 * Rich match for conversation surfaces. Unlike the legacy string matcher this
 * can use a bounded stale value after a refresh outage and discloses its age.
 */
export function matchPrefetchedDetailed(
  heard: string,
  args: { cache: PrefetchEntry[]; items: PrefetchItem[]; now: number; allowStale?: boolean }
): PrefetchMatch | null {
  const key = intentKeyForQuery(heard, args.items);
  if (!key) return null;
  const entry = args.cache.find((candidate) => candidate.key === key);
  if (!entry) return null;
  const ageMs = Math.max(0, args.now - entry.at);
  if (ageMs < FRESH_TTL_MS[entry.kind]) {
    return { entry, answer: entry.answer, freshness: 'fresh', ageMs };
  }
  if (!args.allowStale || ageMs >= STALE_TTL_MS[entry.kind]) return null;

  if (entry.kind === 'news' && entry.context?.kind === 'news') {
    const formatted = formatNewsDigest(entry.context, { stale: true, now: args.now });
    if (formatted.speech) {
      return { entry, answer: formatted.speech, freshness: 'stale', ageMs };
    }
  }
  if (entry.kind === 'market' && entry.context?.kind === 'market') {
    const formatted = formatMarketDigest(entry.context, { stale: true, now: args.now });
    if (formatted.speech) {
      return { entry, answer: formatted.speech, freshness: 'stale', ageMs };
    }
  }
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  return {
    entry,
    answer: `Je n'ai pas pu rafraîchir cette information. La dernière version date d'environ ${minutes} minutes. ${entry.answer}`,
    freshness: 'stale',
    ageMs,
  };
}

// ---------------------------------------------------------------------------
// Default compute impls (real tools, lazy-imported)
// ---------------------------------------------------------------------------

const FR_WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const FR_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export function frenchDate(now: number): string {
  const d = new Date(now);
  return `Nous sommes le ${FR_WEEKDAYS[d.getDay()]} ${d.getDate()} ${FR_MONTHS[d.getMonth()]} ${d.getFullYear()}.`;
}

async function defaultFetchWeather(city: string): Promise<string | null> {
  try {
    const { WeatherTool } = await import('../tools/weather.js');
    const res = await new WeatherTool().getWeather(city || 'Paris', 1);
    return res.success && res.output ? res.output.trim() : null;
  } catch {
    return null;
  }
}

function isStockWidgetData(value: unknown): value is StockWidgetData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StockWidgetData>;
  const validType = candidate.type === 'stock' || candidate.type === 'market' || candidate.type === 'bourse';
  const price = candidate.price ?? candidate.value;
  return validType && (typeof price === 'number' || typeof price === 'string');
}

function isStockQuoteMetadata(value: unknown): value is StockQuoteMetadata {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StockQuoteMetadata>;
  return (
    typeof candidate.provider === 'string' &&
    typeof candidate.sourceUrl === 'string' &&
    /^https?:\/\//i.test(candidate.sourceUrl) &&
    typeof candidate.fetchedAt === 'number' &&
    Number.isFinite(candidate.fetchedAt)
  );
}

/** Fetch all symbols concurrently and retain every independently sourced success. */
export async function fetchMarketContext(
  symbols: readonly string[],
  fetchedAt: number,
  getQuote: (symbol: string) => Promise<ToolResult>
): Promise<MarketDigest | null> {
  try {
    const settled = await Promise.allSettled(symbols.map((symbol) => getQuote(symbol)));
    const items: MarketDigestItem[] = [];

    for (const [index, outcome] of settled.entries()) {
      if (outcome.status !== 'fulfilled') continue;
      const result = outcome.value;
      if (!result.success || !isStockWidgetData(result.data) || !isStockQuoteMetadata(result.metadata)) {
        continue;
      }
      const data = result.data;
      const metadata = result.metadata;
      const symbol = (data.symbol ?? symbols[index] ?? '').trim().toUpperCase();
      const name = (data.name ?? symbol).trim();
      const price = data.price ?? data.value;
      if (!symbol || !name || price == null) continue;
      const quoteTime = metadata.quoteTime ?? data.time;
      items.push({
        title: `${name} (${symbol})`,
        url: metadata.sourceUrl,
        source: metadata.provider,
        symbol,
        name,
        type: data.type,
        price,
        fetchedAt: metadata.fetchedAt,
        ...(data.change != null ? { change: data.change } : {}),
        ...(data.changePercent != null ? { changePercent: data.changePercent } : {}),
        ...(data.currency ? { currency: data.currency } : {}),
        ...(data.market ? { market: data.market } : {}),
        ...(quoteTime ? { quoteTime, publishedAt: quoteTime } : {}),
      });
    }

    return items.length > 0
      ? { kind: 'market', locale: 'fr-FR', fetchedAt, symbols: [...symbols], items }
      : null;
  } catch {
    return null;
  }
}

async function defaultFetchMarketContext(
  symbols: readonly string[],
  fetchedAt: number
): Promise<MarketDigest | null> {
  const { StockQuoteTool } = await import('../tools/stock-quote.js');
  const tool = new StockQuoteTool();
  return fetchMarketContext(symbols, fetchedAt, (symbol) => tool.getQuote(symbol));
}

/** Build dated topic lanes so one broad query cannot collapse the whole bulletin onto AI. */
export function buildNewsSearchQueries(
  baseQuery: string,
  fetchedAt: number,
  locale: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const timezone = env.CODEBUDDY_TIMEZONE?.trim() || env.TZ?.trim() || 'Europe/Paris';
  let dateLabel = new Date(fetchedAt).toISOString().slice(0, 10);
  try {
    dateLabel = new Intl.DateTimeFormat(locale, {
      dateStyle: 'long',
      timeZone: timezone,
    }).format(new Date(fetchedAt));
  } catch {
    /* Invalid locale/timezone: the stable ISO date remains safe for search. */
  }
  const lanes = baseQuery === DEFAULT_NEWS_QUERY
    ? DEFAULT_NEWS_SEARCH_LANES
    : [baseQuery];
  return lanes.map((lane) => `${lane} ${dateLabel}`);
}

function interleaveSearchResults(batches: SearchResult[][], limit = 12): SearchResult[] {
  const output: SearchResult[] = [];
  const seen = new Set<string>();
  const width = Math.max(0, ...batches.map((batch) => batch.length));
  for (let index = 0; index < width && output.length < limit; index += 1) {
    for (const batch of batches) {
      const row = batch[index];
      if (!row) continue;
      const key = row.url.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(row);
      if (output.length >= limit) break;
    }
  }
  return output;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rssTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeXmlText(match?.[1] ?? '');
}

/** Parse ordinary RSS 2.0 headlines into the same evidence shape as web search. Pure. */
export function parseNewsRss(xml: string, source: string, maxItems = 6): NewsDigestItem[] {
  const blocks = String(xml ?? '').match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  const output: NewsDigestItem[] = [];
  for (const block of blocks) {
    const title = rssTag(block, 'title');
    const url = rssTag(block, 'link');
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const publishedAt = rssTag(block, 'pubDate') || rssTag(block, 'dc:date');
    const summary = rssTag(block, 'description');
    output.push({
      title,
      url,
      source,
      ...(publishedAt ? { publishedAt } : {}),
      ...(summary ? { summary } : {}),
    });
    if (output.length >= maxItems) break;
  }
  return output;
}

async function defaultFetchNewsRssContext(
  fetchedAt: number,
  locale: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NewsDigest | null> {
  if (!locale.toLowerCase().startsWith('fr')) return null;
  const configured = env.CODEBUDDY_NEWS_RSS_URLS?.trim();
  const feeds = configured
    ? configured.split(',').map((url) => url.trim()).filter(Boolean).map((url) => ({ url, source: new URL(url).hostname }))
    : [
      { url: 'https://www.franceinfo.fr/titres.rss', source: 'franceinfo' },
      { url: 'https://www.lemonde.fr/rss/une.xml', source: 'Le Monde' },
      { url: 'https://www.france24.com/fr/rss', source: 'France 24' },
    ];
  const settled = await Promise.allSettled(feeds.map(async (feed) => {
    const response = await fetch(feed.url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'CodeBuddy/1.8' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    return parseNewsRss(await response.text(), feed.source, 5);
  }));
  const batches = settled.map((result) => result.status === 'fulfilled' ? result.value : []);
  const items: NewsDigestItem[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < 5 && items.length < 10; index += 1) {
    for (const batch of batches) {
      const item = batch[index];
      if (!item) continue;
      const key = item.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items.length > 0
    ? { kind: 'news', query: feeds.map((feed) => feed.url).join(' | '), locale, fetchedAt, items }
    : null;
}

async function defaultFetchNewsContext(query: string): Promise<NewsDigest | null> {
  try {
    const fetchedAt = Date.now();
    const locale = process.env.CODEBUDDY_NEWS_LOCALE?.trim() || 'fr-FR';
    // Editorial feeds provide concrete, timestamped headlines and avoid the
    // generic homepages/SEO calendars frequently returned by broad web search.
    // Search remains the resilient fallback and supports custom topic queries.
    if (!query.trim()) {
      const rss = await defaultFetchNewsRssContext(fetchedAt, locale);
      if (rss) return rss;
    }
    const { WebSearchTool } = await import('../tools/web-search.js');
    const [language = 'fr', country = 'FR'] = locale.split('-');
    const effectiveQuery =
      query ||
      process.env.CODEBUDDY_NEWS_QUERY?.trim() ||
      DEFAULT_NEWS_QUERY;
    const datedQueries = buildNewsSearchQueries(effectiveQuery, fetchedAt, locale);
    const tool = new WebSearchTool();
    const batches: SearchResult[][] = [];
    const paceMs = Math.max(
      250,
      Math.min(5_000, Number(process.env.CODEBUDDY_NEWS_SEARCH_PACE_MS) || 1_100)
    );
    for (const [index, datedQuery] of datedQueries.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
      batches.push(await tool.searchStructured(datedQuery, {
        maxResults: 8,
        search_lang: language.toLowerCase(),
        country: country.toUpperCase(),
        freshness: 'pd',
        mode: 'live',
      }));
    }
    const rows = interleaveSearchResults(batches);
    const items = (rows ?? [])
      .filter((row) => (row?.title ?? '').trim() && (row?.url ?? '').trim())
      // Formatting applies stricter editorial gates than the search backend.
      // Preserve enough candidates here so filtered social/homepage fragments
      // can be replaced by later, concrete headlines.
      .slice(0, 12)
      .map((row) => ({
        title: row.title.trim(),
        url: row.url.trim(),
        ...(row.siteName?.trim() ? { source: row.siteName.trim() } : {}),
        ...(row.published?.trim() ? { publishedAt: row.published.trim() } : {}),
        ...(row.snippet?.trim() ? { summary: row.snippet.trim() } : {}),
      }));
    return items.length > 0
      ? { kind: 'news', query: datedQueries.join(' | '), locale, fetchedAt, items }
      : null;
  } catch {
    return null;
  }
}

async function defaultFetchAgenda(now: number): Promise<string | null> {
  try {
    const { loadReminders, agendaFor, describeAgendaForSpeech } = await import('./reminders.js');
    const reminders = await loadReminders();
    return describeAgendaForSpeech(agendaFor(reminders, now, 2), now);
  } catch {
    return null;
  }
}

/** Compute the spoken answer for one item. Returns the cache entry, or null on failure. */
export async function computeAnswer(
  item: PrefetchItem,
  deps: PrefetchDeps = {}
): Promise<PrefetchEntry | null> {
  const now = deps.now ?? Date.now();
  const key = prefetchItemKey(item);
  let answer: string | null = null;
  let context: FreshContextPayload | undefined;
  try {
    switch (item.kind) {
      case 'weather':
        answer = await (deps.fetchWeather ?? defaultFetchWeather)((item.param ?? '').trim());
        break;
      case 'news':
        if (deps.fetchNews) {
          answer = await deps.fetchNews((item.param ?? '').trim());
        } else {
          const digest = await (deps.fetchNewsContext ?? defaultFetchNewsContext)(
            (item.param ?? '').trim()
          );
          if (digest) {
            context = digest;
            answer = formatNewsDigest(digest, { now }).speech;
          }
        }
        break;
      case 'market': {
        const symbols = deps.marketSymbols
          ? normalizeMarketSymbols(deps.marketSymbols)
          : loadMarketSymbols();
        const digest = await (deps.fetchMarketContext ?? defaultFetchMarketContext)(symbols, now);
        if (digest) {
          context = digest;
          answer = formatMarketDigest(digest, { now }).speech;
        }
        break;
      }
      case 'agenda':
        answer = await (deps.fetchAgenda ?? defaultFetchAgenda)(now);
        break;
      case 'date':
        answer = (deps.makeDate ?? frenchDate)(now);
        break;
    }
  } catch {
    answer = null;
  }
  const clean = (answer ?? '').trim();
  return clean
    ? { key, kind: item.kind, answer: clean, at: now, ...(context ? { context } : {}) }
    : null;
}

export interface PrefetchCycleResult {
  computed: string[];
  failed: string[];
}

/**
 * One prefetch cycle: recompute every configured item and merge into the cache
 * (updating computed keys, preserving others). never-throws.
 */
export async function runPrefetchCycle(deps: PrefetchDeps = {}): Promise<PrefetchCycleResult> {
  const items = loadPrefetchItems(deps.itemsPath);
  const cachePath = deps.cachePath;
  const cache = loadPrefetchCache(cachePath);
  const byKey = new Map(cache.map((e) => [e.key, e]));
  const result: PrefetchCycleResult = { computed: [], failed: [] };

  const computedEntries = await Promise.all(items.map((item) => computeAnswer(item, deps)));
  for (const [index, item] of items.entries()) {
    const entry = computedEntries[index] ?? null;
    if (entry) {
      byKey.set(entry.key, entry);
      result.computed.push(entry.key);
    } else {
      result.failed.push(prefetchItemKey(item));
    }
  }

  savePrefetchCache([...byKey.values()], cachePath);
  logger.info(
    `[prefetch] cycle: ${result.computed.length} prêt(s) [${result.computed.join(', ')}]` +
      (result.failed.length ? `, ${result.failed.length} échec(s)` : '')
  );
  return result;
}
