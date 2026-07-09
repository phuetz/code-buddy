/**
 * Stock quote tool — real market quotes via Yahoo Finance's public chart API
 * (free, NO API key), with a Stooq CSV fallback (also free, no key). Returns BOTH
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
  /** Stooq base (default `https://stooq.com`). */
  stooqBaseUrl?: string;
  /** Finnhub base (default `https://finnhub.io`). */
  finnhubBaseUrl?: string;
  /** Finnhub API key (default env `FINNHUB_API_KEY`). When set, tried FIRST (most reliable). */
  finnhubKey?: string;
  timeoutMs?: number;
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

export class StockQuoteTool {
  private readonly yahooBaseUrl: string;
  private readonly nasdaqBaseUrl: string;
  private readonly stooqBaseUrl: string;
  private readonly finnhubBaseUrl: string;
  private readonly finnhubKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: StockQuoteToolOptions = {}) {
    this.yahooBaseUrl =
      options.yahooBaseUrl ?? process.env.CODEBUDDY_YAHOO_FINANCE_BASE ?? 'https://query1.finance.yahoo.com';
    this.nasdaqBaseUrl = options.nasdaqBaseUrl ?? process.env.CODEBUDDY_NASDAQ_BASE ?? 'https://api.nasdaq.com';
    this.stooqBaseUrl = options.stooqBaseUrl ?? process.env.CODEBUDDY_STOOQ_BASE ?? 'https://stooq.com';
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
        if (data) return { success: true, output: formatQuoteSummary(data), data };
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
      if (data) return { success: true, output: formatQuoteSummary(data), data };
    } catch {
      /* fall through to Nasdaq */
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
        if (data) return { success: true, output: formatQuoteSummary(data), data };
      } catch {
        /* fall through to Stooq */
      }
    }

    // Fallback: Stooq CSV (basic OHLCV, no change).
    try {
      const stooqSym = /[.^]/.test(s) ? s : `${s}.us`;
      const url = `${this.stooqBaseUrl}/q/l/?s=${encodeURIComponent(stooqSym.toLowerCase())}&f=sd2t2ohlcv&h&e=csv`;
      const resp = await axios.get(url, { timeout: this.timeoutMs, responseType: 'text' });
      const data = parseStooqCsv(String(resp.data), s);
      if (data) return { success: true, output: formatQuoteSummary(data), data };
    } catch {
      /* fall through */
    }

    return {
      success: false,
      error: `Cotation introuvable pour « ${s} ». Essayez un symbole boursier (ex. AAPL, MC.PA pour LVMH, ^FCHI pour le CAC 40).`,
    };
  }
}
