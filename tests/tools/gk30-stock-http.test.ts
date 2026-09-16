/**
 * GK30 — real loopback HTTP: Yahoo 500 → Nasdaq quote, never an invented price.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { StockQuoteTool } from '../../src/tools/stock-quote.js';

const nasdaqAapl = {
  data: {
    symbol: 'AAPL',
    companyName: 'Apple Inc. Common Stock',
    exchange: 'NASDAQ-GS',
    primaryData: {
      lastSalePrice: '$226.34',
      netChange: '+3.12',
      percentageChange: '+1.40%',
      volume: '48,200,000',
      lastTradeTimestamp: 'Sep 03, 2026',
      currency: 'USD',
    },
    keyStats: { dayrange: { label: 'High/Low:', value: '222.80 - 227.10' } },
  },
};

function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe('GK30 stock_quote over real loopback HTTP', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve());
    })));
  });

  it('falls back from a failing Yahoo server to Nasdaq and dates the quote', async () => {
    const yahoo = await listen((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('yahoo down');
    });
    const nasdaq = await listen((req, res) => {
      if ((req.url ?? '').includes('/api/quote/AAPL/info')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(nasdaqAapl));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    servers.push(yahoo.server, nasdaq.server);

    const result = await new StockQuoteTool({
      yahooBaseUrl: yahoo.url,
      nasdaqBaseUrl: nasdaq.url,
      euronextBaseUrl: 'http://127.0.0.1:9',
      stooqBaseUrl: 'http://127.0.0.1:9',
      timeoutMs: 2000,
    }).getQuote('AAPL');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ type: 'stock', symbol: 'AAPL', price: 226.34 });
    expect(result.metadata).toMatchObject({ provider: 'Nasdaq' });
    expect(result.output).toMatch(/Yahoo Finance indisponible/);
    expect(result.output).toMatch(/Repli Nasdaq/);
    expect(result.output).toMatch(/226,34/);
    expect((result.data as { time?: string }).time).toBe('Sep 03, 2026');
  });

  it('does not invent a price when Yahoo and Nasdaq both error', async () => {
    const down = await listen((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('nope');
    });
    servers.push(down.server);

    const result = await new StockQuoteTool({
      yahooBaseUrl: down.url,
      nasdaqBaseUrl: down.url,
      euronextBaseUrl: down.url,
      stooqBaseUrl: down.url,
      timeoutMs: 500,
    }).getQuote('AAPL');

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/226[,.]34/);
  });
});
