/**
 * GK30 — a quote without a calendar date is a stale price presented as current.
 */
import { describe, expect, it } from 'vitest';
import { parseNasdaqQuote, parseStooqCsv, parseYahooQuote } from '../../src/tools/stock-quote.js';
import { renderStockWidget } from '../../src/widgets/curated/stock.js';

const nasdaqAapl = {
  data: {
    symbol: 'AAPL',
    companyName: 'Apple Inc. Common Stock',
    exchange: 'NASDAQ-GS',
    primaryData: {
      lastSalePrice: '$315.39',
      netChange: '-0.83',
      percentageChange: '-0.26%',
      volume: '48,100,162.20',
      lastTradeTimestamp: 'Sep 03, 2026',
      currency: 'USD',
    },
    keyStats: { dayrange: { label: 'High/Low:', value: '308.16 - 316.53' } },
  },
};

describe('GK30 quote dates', () => {
  it('keeps the Nasdaq last-trade date on the payload and widget', () => {
    const d = parseNasdaqQuote(nasdaqAapl, 'AAPL');
    expect(d?.time).toBe('Sep 03, 2026');
    expect(renderStockWidget(d)).toContain('Sep 03, 2026');
  });

  it('keeps the Stooq calendar date, not only the clock', () => {
    const csv = 'Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-07-09,22:00:02,223.50,227.10,222.80,226.34,48200000';
    const d = parseStooqCsv(csv, 'aapl');
    expect(d?.time).toBe('2026-07-09 22:00');
    expect(renderStockWidget(d)).toContain('2026-07-09');
  });

  it('formats Yahoo regularMarketTime with a calendar date', () => {
    const raw = {
      chart: {
        result: [{
          meta: {
            symbol: 'AAPL',
            shortName: 'Apple Inc.',
            instrumentType: 'EQUITY',
            currency: 'USD',
            regularMarketPrice: 226.34,
            chartPreviousClose: 223.22,
            regularMarketTime: 1_778_000_000,
            exchangeTimezoneName: 'America/New_York',
          },
          indicators: { quote: [{}] },
        }],
      },
    };
    const d = parseYahooQuote(raw, 'AAPL');
    expect(d?.time).toMatch(/\d{4}/);
    expect(d?.time).toMatch(/\d{2}:\d{2}/);
    expect(renderStockWidget(d)).toMatch(/\d{4}/);
  });
});
