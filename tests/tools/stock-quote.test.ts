/**
 * Stock quote tool — pure parsers (Yahoo chart JSON, Stooq CSV) + French summary.
 * No network: tests run against captured payload shapes.
 */
import axios from 'axios';
import { beforeEach, vi } from 'vitest';
import {
  StockQuoteTool,
  parseYahooQuote,
  parseStooqCsv,
  parseFinnhubQuote,
  parseNasdaqQuote,
  parseCnbcQuote,
  parseEuronextSearch,
  decryptEuronextPayload,
  parseEuronextQuoteHtml,
  formatQuoteSummary,
} from '../../src/tools/stock-quote.js';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

beforeEach(() => {
  axiosGet.mockReset();
});

const yahooEquity = {
  chart: {
    result: [
      {
        meta: {
          currency: 'USD',
          symbol: 'AAPL',
          shortName: 'Apple Inc.',
          exchangeName: 'NMS',
          instrumentType: 'EQUITY',
          regularMarketPrice: 226.34,
          chartPreviousClose: 223.22,
          regularMarketDayHigh: 227.1,
          regularMarketDayLow: 222.8,
          regularMarketOpen: 223.5,
          regularMarketVolume: 48200000,
        },
        indicators: { quote: [{ open: [223.5], high: [227.1], low: [222.8], close: [226.34], volume: [48200000] }] },
      },
    ],
    error: null,
  },
};

const cnbcSp500 = {
  FormattedQuoteResult: {
    FormattedQuote: [{
      symbol: '.SPX',
      code: 0,
      name: 'S&P 500 Index',
      shortName: 'S&P 500',
      last: '7,543.59',
      last_timedate: '07/14/26 EDT',
      type: 'INDEX',
      exchange: 'INDEX',
      open: '7,536.70',
      high: '7,557.44',
      low: '7,513.23',
      change: '+28.25',
      change_pct: '+0.38%',
      currencyCode: 'USD',
      volume: '2,804,670,000',
    }],
  },
};

describe('parseYahooQuote', () => {
  it('parses an equity: price, computed change/percent, OHLC, currency, name', () => {
    const d = parseYahooQuote(yahooEquity, 'aapl')!;
    expect(d.type).toBe('stock');
    expect(d.symbol).toBe('AAPL');
    expect(d.name).toBe('Apple Inc.');
    expect(d.price).toBe(226.34);
    expect(d.previousClose).toBe(223.22);
    expect(d.change).toBe(3.12); // 226.34 - 223.22
    expect(d.changePercent).toBe(1.4); // rounded 2dp
    expect(d.currency).toBe('USD');
    expect(d.open).toBe(223.5);
    expect(d.high).toBe(227.1);
    expect(d.low).toBe(222.8);
    expect(d.volume).toBe(48200000);
    expect(d.market).toBe('NMS');
  });

  it('maps an INDEX instrumentType to type "market" (points)', () => {
    const idx = {
      chart: {
        result: [
          {
            meta: {
              symbol: '^FCHI',
              shortName: 'CAC 40',
              instrumentType: 'INDEX',
              regularMarketPrice: 7654.2,
              chartPreviousClose: 7697.0,
            },
            indicators: { quote: [{}] },
          },
        ],
      },
    };
    const d = parseYahooQuote(idx, '^FCHI')!;
    expect(d.type).toBe('market');
    expect(d.name).toBe('CAC 40');
    expect(d.change).toBe(-42.8);
    expect(d.changePercent).toBeCloseTo(-0.56, 2);
    expect(d.currency).toBeUndefined(); // no currency → widget shows "pts"
  });

  it('falls back to the indicators arrays when meta lacks OHLC', () => {
    const raw = {
      chart: {
        result: [
          {
            meta: { symbol: 'X', instrumentType: 'EQUITY', regularMarketPrice: 10, chartPreviousClose: 9 },
            indicators: { quote: [{ open: [8], high: [11], low: [7], volume: [123] }] },
          },
        ],
      },
    };
    const d = parseYahooQuote(raw, 'X')!;
    expect(d.open).toBe(8);
    expect(d.high).toBe(11);
    expect(d.low).toBe(7);
    expect(d.volume).toBe(123);
  });

  it('returns null when there is no price', () => {
    expect(parseYahooQuote({ chart: { result: [{ meta: {} }] } }, 'X')).toBeNull();
    expect(parseYahooQuote({}, 'X')).toBeNull();
    expect(parseYahooQuote(null, 'X')).toBeNull();
  });
});

describe('parseStooqCsv', () => {
  it('parses a valid quote (no change without previous close)', () => {
    const csv = 'Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-07-09,22:00:02,223.50,227.10,222.80,226.34,48200000';
    const d = parseStooqCsv(csv, 'aapl')!;
    expect(d.type).toBe('stock');
    expect(d.symbol).toBe('AAPL.US');
    expect(d.price).toBe(226.34);
    expect(d.open).toBe(223.5);
    expect(d.high).toBe(227.1);
    expect(d.low).toBe(222.8);
    expect(d.volume).toBe(48200000);
    expect(d.time).toBe('22:00');
    expect(d.change).toBeUndefined();
    expect(d.market).toBe('Stooq');
  });

  it('returns null for an unknown symbol (N/D)', () => {
    expect(parseStooqCsv('Symbol,Date,Time,Open,High,Low,Close,Volume\nNOPE,N/D,N/D,N/D,N/D,N/D,N/D,N/D', 'nope')).toBeNull();
    expect(parseStooqCsv('', 'x')).toBeNull();
  });
});

describe('parseFinnhubQuote', () => {
  it('parses a Finnhub quote + profile (name, currency, exchange)', () => {
    const quote = { c: 226.34, d: 3.12, dp: 1.4, h: 227.1, l: 222.8, o: 223.5, pc: 223.22 };
    const profile = { name: 'Apple Inc', ticker: 'AAPL', currency: 'USD', exchange: 'NASDAQ NMS' };
    const d = parseFinnhubQuote(quote, profile, 'aapl')!;
    expect(d.type).toBe('stock');
    expect(d.name).toBe('Apple Inc');
    expect(d.symbol).toBe('AAPL');
    expect(d.price).toBe(226.34);
    expect(d.change).toBe(3.12);
    expect(d.changePercent).toBe(1.4);
    expect(d.currency).toBe('USD');
    expect(d.previousClose).toBe(223.22);
    expect(d.market).toBe('NASDAQ NMS');
  });

  it('works without a profile (name falls back to the symbol)', () => {
    const d = parseFinnhubQuote({ c: 10, pc: 9, o: 8, h: 11, l: 7 }, null, 'x')!;
    expect(d.name).toBe('X');
    expect(d.change).toBe(1); // derived from c - pc when d absent
    expect(d.changePercent).toBeCloseTo(11.11, 1);
  });

  it('returns null for an unknown symbol (Finnhub c:0)', () => {
    expect(parseFinnhubQuote({ c: 0 }, null, 'nope')).toBeNull();
    expect(parseFinnhubQuote({}, null, 'x')).toBeNull();
  });
});

describe('parseNasdaqQuote', () => {
  // Real Nasdaq /info shape (US-formatted strings: "$", "%", thousands ",").
  const nasdaq = {
    data: {
      symbol: 'AAPL',
      companyName: 'Apple Inc. Common Stock',
      exchange: 'NASDAQ-GS',
      primaryData: {
        lastSalePrice: '$315.39',
        netChange: '-0.83',
        percentageChange: '-0.26%',
        volume: '48,100,162.20',
        currency: null,
      },
      keyStats: { dayrange: { label: 'High/Low:', value: '308.16 - 316.53' } },
    },
  };

  it('parses US-formatted values, derives previous close, trims the name', () => {
    const d = parseNasdaqQuote(nasdaq, 'aapl')!;
    expect(d.type).toBe('stock');
    expect(d.symbol).toBe('AAPL');
    expect(d.name).toBe('Apple Inc.'); // " Common Stock" trimmed
    expect(d.price).toBe(315.39);
    expect(d.change).toBe(-0.83);
    expect(d.changePercent).toBe(-0.26);
    expect(d.currency).toBe('USD'); // null → USD default
    expect(d.low).toBe(308.16);
    expect(d.high).toBe(316.53);
    expect(d.previousClose).toBe(316.22); // price - change = 315.39 - (-0.83)
    expect(d.volume).toBe(48100162.2);
    expect(d.market).toBe('NASDAQ-GS');
  });

  it('returns null without a price', () => {
    expect(parseNasdaqQuote({ data: { primaryData: {} } }, 'x')).toBeNull();
    expect(parseNasdaqQuote({}, 'x')).toBeNull();
  });
});

describe('parseCnbcQuote', () => {
  it('parses a public index quote with movement and provider time', () => {
    const d = parseCnbcQuote(cnbcSp500, '^GSPC')!;
    expect(d).toMatchObject({
      type: 'market',
      symbol: '^GSPC',
      name: 'S&P 500',
      price: 7543.59,
      change: 28.25,
      changePercent: 0.38,
      previousClose: 7515.34,
      currency: 'USD',
      time: '07/14/26 EDT',
    });
    expect(d.high).toBe(7557.44);
    expect(d.low).toBe(7513.23);
  });

  it('returns null for a missing or failed quote', () => {
    expect(parseCnbcQuote({}, '^GSPC')).toBeNull();
    expect(parseCnbcQuote({
      FormattedQuoteResult: { FormattedQuote: [{ code: 1, last: '7,543.59' }] },
    }, '^GSPC')).toBeNull();
  });
});

describe('Euronext fallback parsers', () => {
  const search = [
    {
      value: 'FR0000121014',
      isin: 'FR0000121014',
      mic: 'XPAR',
      label: "<span class='name'>LVMH</span><span class='symbol'>MC</span><span class='mic'>XPAR</span>",
      link: '/en/product/equities/FR0000121014-XPAR',
      name: 'LVMH',
    },
  ];

  it('resolves an exact Paris ticker and rejects fuzzy results', () => {
    expect(parseEuronextSearch(search, 'MC.PA')).toMatchObject({
      isin: 'FR0000121014', symbol: 'MC', mic: 'XPAR', type: 'stock',
    });
    expect(parseEuronextSearch(search, 'ML.PA')).toBeNull();
  });

  it('decrypts the CryptoJS passphrase envelope used by Euronext', () => {
    expect(decryptEuronextPayload({
      ct: 'i6RBsxw0SlDD8+Nnn0d9A4uurNDcfdJ0g67xbmi5OA4PoUWjkO/sa+42xqedXUNvJh7quDqUMhw1OuQKOwr0sA==',
      iv: 'df6675fa0ee3829c9d71124e37020847',
      s: '0011223344556677',
    }, '24ayqVo7yJma')).toBe('<span id="header-instrument-price">482.95</span>');
  });

  it('parses price, move, currency and timestamp from detailed quote HTML', () => {
    const instrument = parseEuronextSearch(search, 'LVMH')!;
    const html = `
      <h1 id="header-instrument-name"><strong>LVMH</strong></h1>
      <span id="header-instrument-currency">€</span>
      <span id="header-instrument-price">482.95</span>
      <div>14/07/2026 - 17:36</div>
      <div>Since Previous Close</div><span>-8.55</span><span>(-1.74%)</span>`;
    expect(parseEuronextQuoteHtml(html, instrument)).toMatchObject({
      type: 'stock', symbol: 'MC', name: 'LVMH', price: 482.95,
      change: -8.55, changePercent: -1.74, previousClose: 491.5,
      currency: 'EUR', market: 'Euronext Paris', time: '14/07/2026 - 17:36',
    });
  });
});

describe('formatQuoteSummary', () => {
  it('summarizes an up move (en hausse, + sign)', () => {
    const s = formatQuoteSummary(parseYahooQuote(yahooEquity, 'aapl')!);
    expect(s).toContain('Apple Inc.');
    expect(s).toContain('226,34 USD');
    expect(s).toContain('en hausse');
    expect(s).toContain('+3,12');
    expect(s).toContain('séance');
  });

  it('summarizes a down index in points', () => {
    const s = formatQuoteSummary({ type: 'market', name: 'CAC 40', symbol: '^FCHI', price: 7654.2, change: -42.8, changePercent: -0.56 });
    expect(s).toContain('654,20 pts'); // fr-FR thousands sep is U+202F
    expect(s).toContain('en baisse');
    expect(s).toContain('-42,80');
  });

  it('omits the move line when there is no change (Stooq)', () => {
    const s = formatQuoteSummary({ type: 'stock', symbol: 'AAPL.US', name: 'AAPL.US', price: 226.34 });
    expect(s).toContain('226,34');
    expect(s).not.toContain('hausse');
    expect(s).not.toContain('baisse');
  });
});

describe('StockQuoteTool provenance', () => {
  it('attaches public Yahoo provenance and a separate collection timestamp', async () => {
    axiosGet.mockResolvedValueOnce({ data: yahooEquity });
    const before = Date.now();
    const result = await new StockQuoteTool({
      yahooBaseUrl: 'https://quotes.example.test',
      timeoutMs: 100,
    }).getQuote('AAPL');

    expect(result.success).toBe(true);
    expect(result.metadata).toMatchObject({
      provider: 'Yahoo Finance',
      sourceUrl: 'https://quotes.example.test/v8/finance/chart/AAPL?interval=1d&range=1d',
    });
    expect(result.metadata?.fetchedAt).toEqual(expect.any(Number));
    expect(Number(result.metadata?.fetchedAt)).toBeGreaterThanOrEqual(before);
  });

  it('never exposes the Finnhub token in provenance', async () => {
    axiosGet
      .mockResolvedValueOnce({ data: { c: 226.34, d: 3.12, dp: 1.4, pc: 223.22 } })
      .mockResolvedValueOnce({
        data: { name: 'Apple Inc', ticker: 'AAPL', currency: 'USD', exchange: 'NASDAQ NMS' },
      });
    const result = await new StockQuoteTool({
      finnhubBaseUrl: 'https://finnhub.example.test',
      finnhubKey: 'super-secret-token',
      timeoutMs: 100,
    }).getQuote('AAPL');

    expect(result.metadata).toMatchObject({
      provider: 'Finnhub',
      sourceUrl: 'https://finnhub.example.test/api/v1/quote?symbol=AAPL',
    });
    expect(JSON.stringify(result.metadata)).not.toContain('super-secret-token');
  });

  it('falls back to CNBC for default US indices when Yahoo is rate-limited', async () => {
    axiosGet
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { response: { status: 429 } }))
      .mockResolvedValueOnce({ data: cnbcSp500 });
    const result = await new StockQuoteTool({
      yahooBaseUrl: 'https://yahoo.example.test',
      cnbcBaseUrl: 'https://cnbc.example.test',
      timeoutMs: 100,
    }).getQuote('^GSPC');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ symbol: '^GSPC', name: 'S&P 500', price: 7543.59 });
    expect(result.metadata).toMatchObject({
      provider: 'CNBC',
      sourceUrl: 'https://www.cnbc.com/quotes/.SPX',
      quoteTime: '07/14/26 EDT',
    });
    expect(axiosGet).toHaveBeenNthCalledWith(
      2,
      'https://cnbc.example.test/quote-html-webservice/restQuote/symbolType/symbol',
      expect.objectContaining({ params: expect.objectContaining({ symbols: '.SPX' }) }),
    );
  });
});
