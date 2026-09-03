#!/usr/bin/env node
import http from 'node:http';

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

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

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

process.stdout.write(`${JSON.stringify({ yahoo: yahoo.url, nasdaq: nasdaq.url })}\n`);
process.on('SIGTERM', () => {
  yahoo.server.close();
  nasdaq.server.close();
  process.exit(0);
});
