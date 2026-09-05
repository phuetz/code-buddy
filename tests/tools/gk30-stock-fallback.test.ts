/**
 * GK30 — stock_quote fallback must be announced, dated, and never invented.
 */
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StockQuoteTool } from '../../src/tools/stock-quote.js';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axiosGet = vi.mocked(axios.get);

beforeEach(() => {
  axiosGet.mockReset();
});

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

describe('GK30 stock_quote honesty', () => {
  it('announces the Yahoo failure when falling back to Nasdaq and keeps the date', async () => {
    axiosGet
      .mockRejectedValueOnce(Object.assign(new Error('yahoo down'), { response: { status: 500 } }))
      .mockResolvedValueOnce({ data: nasdaqAapl });

    const result = await new StockQuoteTool({
      yahooBaseUrl: 'http://127.0.0.1:9',
      nasdaqBaseUrl: 'http://127.0.0.1:9',
      stooqBaseUrl: 'http://127.0.0.1:9',
      timeoutMs: 50,
    }).getQuote('AAPL');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ type: 'stock', symbol: 'AAPL', price: 315.39 });
    expect(result.metadata).toMatchObject({ provider: 'Nasdaq' });
    expect(result.output).toMatch(/Yahoo Finance/i);
    expect(result.output).toMatch(/indisponible/i);
    expect(result.output).toMatch(/Nasdaq/i);
    expect(result.output).toMatch(/315,39/);
    expect((result.data as { time?: string }).time).toMatch(/2026/);
    expect(result.output).toMatch(/2026|Sep 03/);
    expect(result.metadata?.fallbackFrom).toEqual(['Yahoo Finance']);
  });

  it('does not claim a fallback when Yahoo is the source that worked', async () => {
    axiosGet.mockResolvedValueOnce({
      data: {
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
            },
            indicators: { quote: [{}] },
          }],
        },
      },
    });

    const result = await new StockQuoteTool({
      yahooBaseUrl: 'http://127.0.0.1:9',
      timeoutMs: 50,
    }).getQuote('AAPL');

    expect(result.success).toBe(true);
    expect(result.metadata).toMatchObject({ provider: 'Yahoo Finance' });
    expect(result.output).not.toMatch(/indisponible/i);
    expect(result.output).not.toMatch(/Repli /);
    expect(result.metadata?.fallbackFrom).toBeUndefined();
  });

  it('does not invent a quote when every free source fails', async () => {
    axiosGet.mockRejectedValue(Object.assign(new Error('all down'), { response: { status: 503 } }));

    const result = await new StockQuoteTool({
      yahooBaseUrl: 'http://127.0.0.1:9',
      nasdaqBaseUrl: 'http://127.0.0.1:9',
      euronextBaseUrl: 'http://127.0.0.1:9',
      stooqBaseUrl: 'http://127.0.0.1:9',
      timeoutMs: 50,
    }).getQuote('AAPL');

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.output ?? '').not.toMatch(/\d+[.,]\d{2}/);
    expect(result.error).toMatch(/introuvable/i);
  });

  it('does not invent a quote from an unusable Yahoo payload', async () => {
    axiosGet
      .mockResolvedValueOnce({ data: { chart: { result: [{ meta: { symbol: 'AAPL' } }] } } })
      .mockRejectedValueOnce(new Error('nasdaq down'))
      .mockRejectedValueOnce(new Error('euronext down'))
      .mockResolvedValueOnce({ data: 'Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D' });

    const result = await new StockQuoteTool({
      yahooBaseUrl: 'http://127.0.0.1:9',
      nasdaqBaseUrl: 'http://127.0.0.1:9',
      euronextBaseUrl: 'http://127.0.0.1:9',
      stooqBaseUrl: 'http://127.0.0.1:9',
      timeoutMs: 50,
    }).getQuote('AAPL');

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/226[,.]34/);
  });
});
