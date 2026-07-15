/**
 * Stock quote tool — real market quotes through a free-first provider ladder:
 * optional Finnhub, Yahoo, CNBC indices, Nasdaq, Euronext and Stooq. Returns BOTH
 * a deterministic French summary and a structured `data` payload of shape
 * `StockWidgetData` (`type: 'stock' | 'market'`) so the curated stock widget
 * renders inline.
 *
 * Fail-soft: any network/parse problem returns a French error ToolResult, never a
 * throw. The two parsers are PURE and unit-tested against captured payloads; base
 * URLs are overridable for loopback/integration tests.
 *
 * @module tools/stock-quote
 */
import axios from 'axios';
import { createDecipheriv, createHash } from 'node:crypto';
import type { ToolResult } from '../types/index.js';
import type { StockWidgetData } from '../widgets/widget-types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export interface StockQuoteToolOptions {
  /** Yahoo chart API base (default `https://query1.finance.yahoo.com`). */
  yahooBaseUrl?: string;
  /** Nasdaq API base (default `https://api.nasdaq.com`). */
  nasdaqBaseUrl?: string;
  /** CNBC quote API base (default `https://quote.cnbc.com`). */
  cnbcBaseUrl?: string;
  /** Stooq base (default `https://stooq.com`). */
  stooqBaseUrl?: string;
  /** Euronext Live base (default `https://live.euronext.com`). */
  euronextBaseUrl?: string;
  /** Finnhub base (default `https://finnhub.io`). */
  finnhubBaseUrl?: string;
  /** Finnhub API key (default env `FINNHUB_API_KEY`). When set, tried FIRST (most reliable). */
  finnhubKey?: string;
  timeoutMs?: number;
}

export type StockQuoteProvider =
  | 'Finnhub'
  | 'Yahoo Finance'
  | 'CNBC'
  | 'Nasdaq'
  | 'Euronext Live'
  | 'Stooq';

/** Public provenance attached to every successful quote. Never contains credentials. */
export interface StockQuoteMetadata extends Record<string, unknown> {
  provider: StockQuoteProvider;
  sourceUrl: string;
  fetchedAt: number;
  /** Provider-reported quote time, when the upstream payload exposes one. */
  quoteTime?: string;
}

export interface EuronextInstrument {
  isin: string;
  mic: string;
  link: string;
  name: string;
  symbol: string;
  type: 'stock' | 'market';
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const n = Number(v.trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function round(v: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function marketNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  let text = v.replace(/[\s\u00a0€$£%]/g, '').replace(/[−–]/g, '-');
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = /,\d{1,4}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '');
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function htmlText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function elementTextById(html: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<[^>]+\\bid=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'));
  return htmlText(match?.[1] ?? '');
}

function normalizedMarketKey(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^A-Z0-9]+/gi, '').toUpperCase();
}

/** Resolve an exact Euronext search result without accepting fuzzy lookalikes. Pure. */
export function parseEuronextSearch(raw: unknown, symbolInput: string): EuronextInstrument | null {
  if (!Array.isArray(raw)) return null;
  const aliases: Record<string, { query: string; name: string; symbol: string }> = {
    '^FCHI': { query: 'CAC40', name: 'CAC40', symbol: 'PX1' },
  };
  const upperInput = symbolInput.trim().toUpperCase();
  const alias = aliases[upperInput];
  const suffix = upperInput.match(/\.([A-Z]{2})$/)?.[1];
  const requested = normalizedMarketKey(alias?.query ?? upperInput.replace(/\.[A-Z]{2}$/, ''));
  const expectedMic: Record<string, string> = {
    PA: 'XPAR', AS: 'XAMS', BR: 'XBRU', LS: 'XLIS', IR: 'XDUB', MI: 'XMIL', OL: 'XOSL',
  };

  let best: { score: number; instrument: EuronextInstrument } | null = null;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const link = typeof candidate.link === 'string' ? candidate.link : '';
    const product = link.match(/\/product\/(equities|indices)\/([^/?#]+)/i);
    if (!product) continue;
    const label = typeof candidate.label === 'string' ? candidate.label : '';
    const symbol = htmlText(label.match(/<span[^>]+class=['"]symbol['"][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const isin = typeof candidate.isin === 'string'
      ? candidate.isin
      : typeof candidate.value === 'string' ? candidate.value : '';
    const mic = typeof candidate.mic === 'string' ? candidate.mic.toUpperCase() : '';
    if (!isin || !mic || !name || !symbol) continue;

    const exactSymbol = normalizedMarketKey(symbol) === requested;
    const exactName = normalizedMarketKey(name) === requested;
    const exactIsin = normalizedMarketKey(isin) === requested;
    const aliasMatch = alias != null && (
      normalizedMarketKey(name) === alias.name || normalizedMarketKey(symbol) === alias.symbol
    );
    if (!exactSymbol && !exactName && !exactIsin && !aliasMatch) continue;
    let score = exactSymbol ? 10 : exactName ? 9 : exactIsin ? 8 : 7;
    if (suffix && expectedMic[suffix] === mic) score += 4;
    if (mic.startsWith('X')) score += 1;
    if (!best || score > best.score) {
      best = {
        score,
        instrument: {
          isin,
          mic,
          link,
          name,
          symbol,
          type: product[1]!.toLowerCase() === 'indices' ? 'market' : 'stock',
        },
      };
    }
  }
  return best?.instrument ?? null;
}

/** Decrypt the CryptoJS/OpenSSL-compatible envelope returned by Euronext Live. Pure. */
export function decryptEuronextPayload(raw: unknown, passphrase: string): string | null {
  const envelope = raw as { ct?: unknown; iv?: unknown; s?: unknown } | null;
  if (!envelope || typeof envelope.ct !== 'string' || typeof envelope.s !== 'string') return null;
  if (!/^[0-9a-f]{16,64}$/i.test(envelope.s) || envelope.ct.length > 8_000_000) return null;
  try {
    const salt = Buffer.from(envelope.s, 'hex');
    const password = Buffer.from(passphrase, 'utf8');
    let derived = Buffer.alloc(0);
    let previous = Buffer.alloc(0);
    while (derived.length < 48) {
      previous = createHash('md5').update(Buffer.concat([previous, password, salt])).digest();
      derived = Buffer.concat([derived, previous]);
    }
    const decipher = createDecipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48));
    const plaintext = decipher.update(envelope.ct, 'base64', 'utf8') + decipher.final('utf8');
    const decoded: unknown = JSON.parse(plaintext);
    return typeof decoded === 'string' ? decoded : null;
  } catch {
    return null;
  }
}

/** Parse Euronext's decrypted detailed-quote HTML. Pure. */
export function parseEuronextQuoteHtml(
  html: string,
  instrument: EuronextInstrument,
): StockWidgetData | null {
  const price = marketNum(elementTextById(html, 'header-instrument-price'));
  if (price == null) return null;
  const currencyMark = elementTextById(html, 'header-instrument-currency');
  const currency = currencyMark.includes('€') ? 'EUR' : currencyMark.includes('$') ? 'USD' : currencyMark.includes('£') ? 'GBP' : undefined;
  const previousBlock = html.match(/Since Previous Close<\/div>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<span[^>]*>\s*\(?([\s\S]*?)\)?\s*<\/span>/i);
  const change = marketNum(htmlText(previousBlock?.[1] ?? ''));
  const changePercent = marketNum(htmlText(previousBlock?.[2] ?? ''));
  const previousClose = change != null ? round(price - change) : undefined;
  const time = html.match(/\b(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}:\d{2})\b/)?.[1];
  const name = elementTextById(html, 'header-instrument-name') || instrument.name;
  const marketNames: Record<string, string> = {
    XPAR: 'Euronext Paris', XAMS: 'Euronext Amsterdam', XBRU: 'Euronext Brussels',
    XLIS: 'Euronext Lisbon', XDUB: 'Euronext Dublin', XMIL: 'Euronext Milan', XOSL: 'Euronext Oslo',
  };
  return {
    type: instrument.type,
    symbol: instrument.symbol,
    name,
    price,
    ...(change != null ? { change } : {}),
    ...(changePercent != null ? { changePercent } : {}),
    ...(currency ? { currency } : {}),
    ...(previousClose != null ? { previousClose } : {}),
    market: marketNames[instrument.mic] ?? `Euronext ${instrument.mic}`,
    ...(time ? { time } : {}),
  };
}

function lastFinite(arr: unknown): number | null {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

function fmtFr(v: number | null | undefined, digits = 2): string {
  return v == null
    ? '—'
    : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

function fmtTime(sec: unknown, tz: unknown): string | undefined {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return undefined;
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      ...(typeof tz === 'string' && tz ? { timeZone: tz } : {}),
    }).format(new Date(sec * 1000));
  } catch {
    return undefined;
  }
}

/** Parse a Yahoo Finance v8 chart response into a StockWidgetData. Pure. null if unusable. */
export function parseYahooQuote(raw: unknown, symbolInput: string): StockWidgetData | null {
  const result = (raw as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | { meta?: Record<string, unknown>; indicators?: { quote?: Array<Record<string, unknown>> } }
    | undefined;
  const meta = result?.meta;
  const price = num(meta?.regularMarketPrice);
  if (!meta || price == null) return null;

  const q = result?.indicators?.quote?.[0] ?? {};
  const prev = num(meta.chartPreviousClose) ?? num(meta.previousClose);
  const open = num(meta.regularMarketOpen) ?? lastFinite(q.open);
  const high = num(meta.regularMarketDayHigh) ?? lastFinite(q.high);
  const low = num(meta.regularMarketDayLow) ?? lastFinite(q.low);
  const volume = num(meta.regularMarketVolume) ?? lastFinite(q.volume);
  const change = prev != null ? round(price - prev) : undefined;
  const changePercent = prev != null && prev !== 0 ? round(((price - prev) / prev) * 100, 2) : undefined;
  const type: StockWidgetData['type'] = meta.instrumentType === 'INDEX' ? 'market' : 'stock';
  const name =
    (typeof meta.shortName === 'string' && meta.shortName) ||
    (typeof meta.longName === 'string' && meta.longName) ||
    (typeof meta.symbol === 'string' && meta.symbol) ||
    symbolInput.toUpperCase();
  const time = fmtTime(meta.regularMarketTime, meta.exchangeTimezoneName);

  return {
    type,
    symbol: typeof meta.symbol === 'string' ? meta.symbol : symbolInput.toUpperCase(),
    name,
    price,
    ...(change != null ? { change } : {}),
    ...(changePercent != null ? { changePercent } : {}),
    ...(typeof meta.currency === 'string' ? { currency: meta.currency } : {}),
    ...(open != null ? { open } : {}),
    ...(high != null ? { high } : {}),
    ...(low != null ? { low } : {}),
    ...(prev != null ? { previousClose: prev } : {}),
    ...(volume != null ? { volume } : {}),
    ...(typeof meta.exchangeName === 'string' ? { market: meta.exchangeName } : {}),
    ...(time ? { time } : {}),
  };
}

/** Parse a "$1,234.50"/"−0.26%"/"48,100,162" US-formatted string. null if unusable. */
function usNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const t = v.replace(/[$%\s]/g, '').replace(/,/g, '');
  if (!t || /^n\/?a$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse a Nasdaq `/api/quote/<sym>/info` response. Pure. null if unusable. */
export function parseNasdaqQuote(raw: unknown, symbolInput: string): StockWidgetData | null {
  const d = (raw as { data?: Record<string, unknown> })?.data;
  const pd = d?.primaryData as Record<string, unknown> | undefined;
  const price = usNum(pd?.lastSalePrice);
  if (!d || price == null) return null;
  const change = usNum(pd?.netChange);
  const changePercent = usNum(pd?.percentageChange);
  const volume = usNum(pd?.volume);
  const previousClose = change != null ? round(price - change) : undefined;
  // keyStats.dayrange.value is "low - high".
  let high: number | undefined;
  let low: number | undefined;
  const dr = (d.keyStats as { dayrange?: { value?: unknown } } | undefined)?.dayrange?.value;
  if (typeof dr === 'string') {
    const parts = dr.split('-').map((x) => usNum(x));
    if (parts.length === 2 && parts[0] != null && parts[1] != null) {
      low = parts[0];
      high = parts[1];
    }
  }
  const rawName = typeof d.companyName === 'string' ? d.companyName : '';
  const name = rawName.replace(/\s+(Common Stock|Common Shares|Ordinary Shares|Class [A-Z] Common Stock).*$/i, '').trim();
  const currency = (typeof pd?.currency === 'string' && pd.currency) || 'USD';
  return {
    type: 'stock',
    symbol: typeof d.symbol === 'string' ? d.symbol : symbolInput.toUpperCase(),
    name: name || (typeof d.symbol === 'string' ? d.symbol : symbolInput.toUpperCase()),
    price,
    ...(change != null ? { change } : {}),
    ...(changePercent != null ? { changePercent } : {}),
    currency,
    ...(high != null ? { high } : {}),
    ...(low != null ? { low } : {}),
    ...(previousClose != null ? { previousClose } : {}),
    ...(volume != null ? { volume } : {}),
    ...(typeof d.exchange === 'string' ? { market: d.exchange } : {}),
  };
}

/** Parse CNBC's public formatted-quote response. Pure. */
export function parseCnbcQuote(raw: unknown, symbolInput: string): StockWidgetData | null {
  const quotes = (raw as {
    FormattedQuoteResult?: { FormattedQuote?: unknown[] };
  })?.FormattedQuoteResult?.FormattedQuote;
  if (!Array.isArray(quotes)) return null;
  const d = quotes.find((item) => {
    if (!item || typeof item !== 'object') return false;
    return num((item as Record<string, unknown>).code) === 0;
  }) as Record<string, unknown> | undefined;
  const price = usNum(d?.last);
  if (!d || price == null) return null;
  const change = usNum(d.change);
  const changePercent = usNum(d.change_pct);
  const previousClose = change != null ? round(price - change) : usNum(d.previous_day_closing);
  const type: StockWidgetData['type'] = d.type === 'INDEX' ? 'market' : 'stock';
  const name =
    (typeof d.shortName === 'string' && d.shortName) ||
    (typeof d.name === 'string' && d.name) ||
    symbolInput.toUpperCase();
  return {
    type,
    symbol: symbolInput.toUpperCase(),
    name,
    price,
    ...(change != null ? { change } : {}),
    ...(changePercent != null ? { changePercent } : {}),
    ...(typeof d.currencyCode === 'string' ? { currency: d.currencyCode } : {}),
    ...(usNum(d.open) != null ? { open: usNum(d.open)! } : {}),
    ...(usNum(d.high) != null ? { high: usNum(d.high)! } : {}),
    ...(usNum(d.low) != null ? { low: usNum(d.low)! } : {}),
    ...(previousClose != null ? { previousClose } : {}),
    ...(usNum(d.volume) != null ? { volume: usNum(d.volume)! } : {}),
    ...(typeof d.exchange === 'string' ? { market: d.exchange } : {}),
    ...(typeof d.last_timedate === 'string' ? { time: d.last_timedate } : {}),
  };
}

/** Parse a Finnhub `/quote` (+ optional `/stock/profile2`) response. Pure. null if unusable. */
export function parseFinnhubQuote(quote: unknown, profile: unknown, symbolInput: string): StockWidgetData | null {
  const q = (quote ?? {}) as Record<string, unknown>;
  const p = (profile ?? {}) as Record<string, unknown>;
  const price = num(q.c);
  if (price == null || price === 0) return null; // Finnhub returns c:0 for unknown symbols
  const prev = num(q.pc);
  const change = num(q.d) ?? (prev != null ? round(price - prev) : undefined);
  const changePercent = num(q.dp) ?? (prev != null && prev !== 0 ? round(((price - prev) / prev) * 100, 2) : undefined);
  const ticker = (typeof p.ticker === 'string' && p.ticker) || symbolInput.toUpperCase();
  return {
    type: 'stock',
    symbol: ticker,
    name: (typeof p.name === 'string' && p.name) || ticker,
    price,
    ...(change != null ? { change } : {}),
    ...(changePercent != null ? { changePercent } : {}),
    ...(typeof p.currency === 'string' ? { currency: p.currency } : {}),
    ...(num(q.o) != null ? { open: num(q.o)! } : {}),
    ...(num(q.h) != null ? { high: num(q.h)! } : {}),
    ...(num(q.l) != null ? { low: num(q.l)! } : {}),
    ...(prev != null ? { previousClose: prev } : {}),
    ...(typeof p.exchange === 'string' ? { market: p.exchange } : {}),
  };
}

/** Parse a Stooq light CSV quote (`Symbol,Date,Time,Open,High,Low,Close,Volume`). Pure. null if unusable. */
export function parseStooqCsv(text: string, symbolInput: string): StockWidgetData | null {
  const lines = String(text ?? '').trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const cols = lines[1]!.split(',');
  const price = num(cols[6]);
  // Stooq returns "N/D" for unknown symbols.
  if (price == null || cols.some((c) => c === 'N/D')) return null;
  const open = num(cols[3]);
  const high = num(cols[4]);
  const low = num(cols[5]);
  const volume = num(cols[7]);
  const sym = (cols[0] || symbolInput).toUpperCase();
  const time = cols[2] && /^\d{2}:\d{2}/.test(cols[2]) ? cols[2].slice(0, 5) : undefined;
  return {
    type: 'stock',
    symbol: sym,
    name: sym,
    price,
    // Stooq's light quote has no previous close → change is left undefined.
    ...(open != null ? { open } : {}),
    ...(high != null ? { high } : {}),
    ...(low != null ? { low } : {}),
    ...(volume != null ? { volume } : {}),
    market: 'Stooq',
    ...(time ? { time } : {}),
  };
}

/** Deterministic French one-line summary from a StockWidgetData. Pure. */
export function formatQuoteSummary(d: StockWidgetData): string {
  const unit = d.currency ? ` ${d.currency}` : d.type === 'market' || d.type === 'bourse' ? ' pts' : '';
  const priceStr = d.price != null ? `${fmtFr(num(d.price))}${unit}` : '—';
  const parts = [`${d.name ?? d.symbol ?? 'Cours'}${d.symbol ? ` (${d.symbol})` : ''} : ${priceStr}`];
  const pct = num(d.changePercent);
  const chg = num(d.change);
  if (pct != null || chg != null) {
    const dir = (pct ?? chg ?? 0) >= 0 ? 'en hausse' : 'en baisse';
    const chgStr = chg != null ? `${chg >= 0 ? '+' : ''}${fmtFr(chg)}${unit}` : '';
    const pctStr = pct != null ? `${pct >= 0 ? '+' : ''}${fmtFr(pct)} %` : '';
    parts.push(`${dir} ${[chgStr, pctStr && `(${pctStr})`].filter(Boolean).join(' ')}`.trim());
  }
  const h = num(d.high);
  const l = num(d.low);
  if (h != null && l != null) parts.push(`séance ${fmtFr(l)}–${fmtFr(h)}`);
  return parts.join(', ') + '.';
}

function quoteResult(
  data: StockWidgetData,
  provider: StockQuoteProvider,
  sourceUrl: string
): ToolResult {
  const metadata: StockQuoteMetadata = {
    provider,
    sourceUrl,
    fetchedAt: Date.now(),
    ...(data.time ? { quoteTime: data.time } : {}),
  };
  return { success: true, output: formatQuoteSummary(data), data, metadata };
}

export class StockQuoteTool {
  private readonly yahooBaseUrl: string;
  private readonly cnbcBaseUrl: string;
  private readonly nasdaqBaseUrl: string;
  private readonly stooqBaseUrl: string;
  private readonly euronextBaseUrl: string;
  private readonly finnhubBaseUrl: string;
  private readonly finnhubKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: StockQuoteToolOptions = {}) {
    this.yahooBaseUrl =
      options.yahooBaseUrl ?? process.env.CODEBUDDY_YAHOO_FINANCE_BASE ?? 'https://query1.finance.yahoo.com';
    this.cnbcBaseUrl =
      options.cnbcBaseUrl ?? process.env.CODEBUDDY_CNBC_QUOTE_BASE ?? 'https://quote.cnbc.com';
    this.nasdaqBaseUrl = options.nasdaqBaseUrl ?? process.env.CODEBUDDY_NASDAQ_BASE ?? 'https://api.nasdaq.com';
    this.stooqBaseUrl = options.stooqBaseUrl ?? process.env.CODEBUDDY_STOOQ_BASE ?? 'https://stooq.com';
    this.euronextBaseUrl = options.euronextBaseUrl ?? process.env.CODEBUDDY_EURONEXT_BASE ?? 'https://live.euronext.com';
    this.finnhubBaseUrl = options.finnhubBaseUrl ?? process.env.CODEBUDDY_FINNHUB_BASE ?? 'https://finnhub.io';
    this.finnhubKey = options.finnhubKey ?? process.env.FINNHUB_API_KEY ?? undefined;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Fetch a quote for a ticker (e.g. AAPL, MC.PA, ^FCHI). Fail-soft. */
  async getQuote(symbol: string): Promise<ToolResult> {
    const s = (symbol ?? '').trim();
    if (!s) {
      return { success: false, error: 'Aucun symbole fourni. Exemple : stock_quote({ symbol: "AAPL" }).' };
    }

    // Preferred when configured: Finnhub (free key, reliable from any IP).
    if (this.finnhubKey) {
      try {
        const auth = { token: this.finnhubKey };
        const quote = await axios.get(`${this.finnhubBaseUrl}/api/v1/quote`, {
          timeout: this.timeoutMs,
          params: { symbol: s, ...auth },
        });
        // Best-effort company profile for name/currency/exchange (don't fail if it 4xxs).
        let profile: unknown = null;
        try {
          const p = await axios.get(`${this.finnhubBaseUrl}/api/v1/stock/profile2`, {
            timeout: this.timeoutMs,
            params: { symbol: s, ...auth },
          });
          profile = p.data;
        } catch {
          /* profile optional */
        }
        const data = parseFinnhubQuote(quote.data, profile, s);
        if (data) {
          const sourceUrl = `${this.finnhubBaseUrl}/api/v1/quote?symbol=${encodeURIComponent(s)}`;
          return quoteResult(data, 'Finnhub', sourceUrl);
        }
      } catch {
        /* fall through to Yahoo */
      }
    }

    // Primary ($0): Yahoo Finance chart API (rich: price, change, OHLC, prev close, currency).
    try {
      const url = `${this.yahooBaseUrl}/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=1d`;
      const resp = await axios.get(url, {
        timeout: this.timeoutMs,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      const data = parseYahooQuote(resp.data, s);
      if (data) return quoteResult(data, 'Yahoo Finance', url);
    } catch {
      /* fall through to CNBC/Nasdaq */
    }

    // Index fallback ($0): CNBC's public quote cache is independent from
    // Yahoo's aggressive per-IP rate limit and covers the two US indices in
    // the default companion briefing.
    const cnbcSymbols: Record<string, string> = {
      '^GSPC': '.SPX',
      '^IXIC': '.IXIC',
    };
    const cnbcSymbol = cnbcSymbols[s.toUpperCase()];
    if (cnbcSymbol) {
      try {
        const url = `${this.cnbcBaseUrl}/quote-html-webservice/restQuote/symbolType/symbol`;
        const resp = await axios.get(url, {
          timeout: this.timeoutMs,
          params: {
            symbols: cnbcSymbol,
            requestMethod: 'quick',
            noform: 1,
            partnerId: 2,
            fund: 1,
            exthrs: 1,
            output: 'json',
          },
          headers: { 'User-Agent': UA, Accept: 'application/json' },
        });
        const data = parseCnbcQuote(resp.data, s);
        if (data) {
          return quoteResult(
            data,
            'CNBC',
            `https://www.cnbc.com/quotes/${encodeURIComponent(cnbcSymbol)}`,
          );
        }
      } catch {
        /* fall through to Nasdaq/Euronext/Stooq */
      }
    }

    // Fallback ($0, works from datacenter IPs where Yahoo/Stooq block): Nasdaq API.
    // US symbols only (no `.`/`^` suffix), rich enough (price, change, day range, volume).
    if (!/[.^]/.test(s)) {
      try {
        const url = `${this.nasdaqBaseUrl}/api/quote/${encodeURIComponent(s.toUpperCase())}/info?assetclass=stocks`;
        const resp = await axios.get(url, {
          timeout: this.timeoutMs,
          headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
        });
        const data = parseNasdaqQuote(resp.data, s);
        if (data) return quoteResult(data, 'Nasdaq', url);
      } catch {
        /* fall through to Stooq */
      }
    }

    // European fallback ($0): Euronext's public instrument search and official
    // detailed quote. This covers symbols Yahoo currently rate-limits and the
    // dead Stooq endpoint, notably MC.PA/LVMH and ^FCHI/CAC 40.
    try {
      const searchQuery = s.toUpperCase() === '^FCHI' ? 'CAC 40' : s.replace(/\.[A-Z]{2}$/i, '');
      const search = await axios.get(`${this.euronextBaseUrl}/en/instrumentSearch/searchJSON`, {
        timeout: this.timeoutMs,
        params: { q: searchQuery },
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en' },
      });
      const instrument = parseEuronextSearch(search.data, s);
      if (instrument) {
        const productPage = await axios.get(`${this.euronextBaseUrl}${instrument.link}`, {
          timeout: this.timeoutMs,
          headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en' },
        });
        const page = String(productPage.data);
        const key = page.match(/"ajax_secure"\s*:\s*\{\s*"kye"\s*:\s*"([^"]+)"/)?.[1];
        if (key) {
          const productData = `${instrument.isin}-${instrument.mic}`;
          const quoteUrl = `${this.euronextBaseUrl}/en/ajax/getDetailedQuote/${encodeURIComponent(productData)}`;
          const quote = await axios.get(quoteUrl, {
            timeout: this.timeoutMs,
            headers: { 'User-Agent': UA, Accept: 'application/json', Referer: `${this.euronextBaseUrl}${instrument.link}` },
          });
          const quoteHtml = decryptEuronextPayload(quote.data, key);
          const data = quoteHtml ? parseEuronextQuoteHtml(quoteHtml, instrument) : null;
          if (data) return quoteResult(data, 'Euronext Live', quoteUrl);
        }
      }
    } catch {
      /* fall through to Stooq */
    }

    // Fallback: Stooq CSV (basic OHLCV, no change).
    try {
      const stooqSym = /[.^]/.test(s) ? s : `${s}.us`;
      const url = `${this.stooqBaseUrl}/q/l/?s=${encodeURIComponent(stooqSym.toLowerCase())}&f=sd2t2ohlcv&h&e=csv`;
      const resp = await axios.get(url, { timeout: this.timeoutMs, responseType: 'text' });
      const data = parseStooqCsv(String(resp.data), s);
      if (data) return quoteResult(data, 'Stooq', url);
    } catch {
      /* fall through */
    }

    return {
      success: false,
      error: `Cotation introuvable pour « ${s} ». Essayez un symbole boursier (ex. AAPL, MC.PA pour LVMH, ^FCHI pour le CAC 40).`,
    };
  }
}
