/**
 * GK30 live path: fake quote servers + buddy server + stock_quote + canvas.
 * Optional Ollama chat when RUN_OLLAMA=1.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startServer } from '../../src/server/index.js';
import { canvasStore } from '../../src/server/routes/canvas.js';

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

async function main(): Promise<void> {
  canvasStore.clear();
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

  process.env.CODEBUDDY_YAHOO_FINANCE_BASE = yahoo.url;
  process.env.CODEBUDDY_NASDAQ_BASE = nasdaq.url;
  process.env.CODEBUDDY_EURONEXT_BASE = 'http://127.0.0.1:9';
  process.env.CODEBUDDY_STOOQ_BASE = 'http://127.0.0.1:9';
  process.env.CODEBUDDY_WIDGETS = 'true';
  process.env.CODEBUDDY_WIDGETS_AUTO = 'true';
  delete process.env.FINNHUB_API_KEY;

  const started = await startServer({
    port: 0,
    host: '127.0.0.1',
    authEnabled: false,
    websocketEnabled: false,
    logging: false,
    rateLimit: false,
    cors: false,
    docsEnabled: false,
    securityHeaders: { enabled: false },
  });
  const address = started.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const toolRes = await fetch(`${baseUrl}/api/tools/stock_quote/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parameters: { symbol: 'AAPL' }, confirmed: true }),
  });
  const toolBody = await toolRes.json() as {
    success: boolean;
    output?: string;
    data?: unknown;
    canvasId?: string;
    canvasPath?: string;
    widgetHtml?: string;
  };
  const report: Record<string, unknown> = {
    toolStatus: toolRes.status,
    body: toolBody,
    widgetHasHtml: Boolean(toolBody.widgetHtml && toolBody.widgetHtml.includes('AAPL')),
  };

  if (toolBody.canvasPath) {
    const html = await (await fetch(`${baseUrl}${toolBody.canvasPath}`)).text();
    report.canvasHtmlHasAapl = html.includes('AAPL');
    report.canvasHtmlHasDate = html.includes('2026');
  }

  if (process.env.RUN_OLLAMA === '1') {
    const chatRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROK_MODEL || 'qwen3:4b-instruct',
        messages: [{
          role: 'user',
          content: 'Quel est le cours de AAPL ? Utilise uniquement l\'outil stock_quote avec symbol AAPL.',
        }],
      }),
    });
    const chatBody = await chatRes.json() as Record<string, unknown>;
    report.chatStatus = chatRes.status;
    report.chatContent = chatBody.content;
    report.chatToolCalls = chatBody.toolCalls;
    report.chatData = chatBody.data;
    report.chatCanvasPath = chatBody.canvasPath;
  }

  const out = path.resolve('_qa/gk30/work/run-path.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  await new Promise<void>((resolve) => started.server.close(() => resolve()));
  yahoo.server.close();
  nasdaq.server.close();
  process.exit(toolBody.success ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
