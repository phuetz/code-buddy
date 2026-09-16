/**
 * GK30 — stock_quote payload and auto widget reach the live canvas route.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDatabaseManager } from '../../src/database/database-manager.js';
import { canvasStore } from '../../src/server/routes/canvas.js';

const stockData = {
  type: 'stock',
  symbol: 'AAPL',
  name: 'Apple Inc.',
  price: 226.34,
  currency: 'USD',
  change: 3.12,
  changePercent: 1.4,
  time: '03/09/2026 15:00',
};

const stockResult = {
  success: true,
  output: 'Apple Inc. (AAPL) : 226,34 USD, 03/09/2026 15:00.',
  data: stockData,
  metadata: { provider: 'Nasdaq', fetchedAt: Date.now(), quoteTime: stockData.time },
};

vi.mock('../../src/server/agent-adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/server/agent-adapter.js')>(
    '../../src/server/agent-adapter.js',
  );
  const processUserMessage = vi.fn(async () => [
    {
      type: 'tool_result',
      content: stockResult.output,
      timestamp: new Date(),
      toolCall: {
        id: 'call-stock',
        type: 'function',
        function: { name: 'stock_quote', arguments: '{"symbol":"AAPL"}' },
      },
      toolResult: stockResult,
    },
    {
      type: 'assistant',
      content: stockResult.output,
      timestamp: new Date(),
    },
  ]);

  function createConversationState() {
    return {
      messages: [],
      chatHistory: [],
      sessionCost: 0,
      routingSessionCost: 0,
      workingDirectory: process.cwd(),
      contextManagerState: {
        summaries: [], systemMessage: null, triggeredWarnings: [], lastTokenCount: 0,
        lastEnhancedResult: null, sessionId: 'gk30-stock', peakMessageCount: 0,
        compressionCount: 0, totalTokensSaved: 0, lastCompressionTime: null,
        snapshotCount: 0, enhancedCompression: null,
      },
    };
  }

  return {
    ...actual,
    createServerAgent: vi.fn(async () => {
      let state = createConversationState();
      return {
        processUserMessage,
        processUserMessageStream: vi.fn(async function* () {
          yield { type: 'content', content: stockResult.output };
        }),
        getChatHistory: () => [],
        getCurrentModel: () => 'qa-stock',
        setModel: vi.fn(),
        setRecoverySessionId: vi.fn(),
        abortCurrentOperation: vi.fn(),
        executeToolByName: vi.fn(async () => stockResult),
        systemPromptReady: Promise.resolve(),
        addToHistory: vi.fn(),
        exportConversationState: () => structuredClone(state),
        importConversationState: (next: ReturnType<typeof createConversationState>) => {
          state = structuredClone(next);
        },
      };
    }),
  };
});

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

describe('GK30 stock widget on buddy server', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let previousWidgets: string | undefined;
  let previousAuto: string | undefined;
  let started: StartedServer | null = null;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    previousWidgets = process.env.CODEBUDDY_WIDGETS;
    previousAuto = process.env.CODEBUDDY_WIDGETS_AUTO;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gk30-stock-canvas-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    delete process.env.CODEBUDDY_WIDGETS;
    delete process.env.CODEBUDDY_WIDGETS_AUTO;
    resetDatabaseManager();
    canvasStore.clear();
  });

  afterEach(async () => {
    if (started) {
      await new Promise<void>((resolve, reject) => {
        started?.server.close((error) => (error ? reject(error) : resolve()));
      });
      started = null;
    }
    canvasStore.clear();
    resetDatabaseManager();
    if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = previousHome;
    if (previousWidgets === undefined) delete process.env.CODEBUDDY_WIDGETS;
    else process.env.CODEBUDDY_WIDGETS = previousWidgets;
    if (previousAuto === undefined) delete process.env.CODEBUDDY_WIDGETS_AUTO;
    else process.env.CODEBUDDY_WIDGETS_AUTO = previousAuto;
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  async function start(): Promise<string> {
    const { startServer } = await import('../../src/server/index.js');
    started = await startServer({
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
    return `http://127.0.0.1:${address.port}`;
  }

  it('returns stock_quote data without publishing a widget when AUTO is off', async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/tools/stock_quote/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parameters: { symbol: 'AAPL' }, confirmed: true }),
    });
    const body = await response.json() as {
      success: boolean;
      data?: { type?: string; symbol?: string };
      widgetHtml?: string;
      canvasId?: string;
    };
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ type: 'stock', symbol: 'AAPL', price: 226.34 });
    expect(body.widgetHtml).toBeUndefined();
    expect(body.canvasId).toBeUndefined();
    expect(canvasStore.list()).toHaveLength(0);
  });

  it('publishes the curated stock widget to /__codebuddy__/canvas/:id when AUTO is on', async () => {
    process.env.CODEBUDDY_WIDGETS = 'true';
    process.env.CODEBUDDY_WIDGETS_AUTO = 'true';
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/tools/stock_quote/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parameters: { symbol: 'AAPL' }, confirmed: true }),
    });
    const body = await response.json() as {
      success: boolean;
      data?: { type?: string };
      widgetHtml?: string;
      canvasId?: string;
      canvasPath?: string;
    };
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ type: 'stock', symbol: 'AAPL' });
    expect(body.widgetHtml).toContain('AAPL');
    expect(body.widgetHtml).toContain('226,34');
    expect(body.widgetHtml).toContain('03/09/2026');
    expect(body.widgetHtml).not.toMatch(/<script/i);
    expect(body.canvasId).toMatch(/^canvas_/);
    expect(body.canvasPath).toBe(`/__codebuddy__/canvas/${body.canvasId}`);

    const page = await fetch(`${baseUrl}${body.canvasPath}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Apple Inc.');
    expect(html).toContain('AAPL');
    expect(html).toContain('226,34');
  });
});
