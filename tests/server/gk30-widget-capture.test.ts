/**
 * GK30 — recover canvas HTML and capture it headless (Playwright).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';

import { resetDatabaseManager } from '../../src/database/database-manager.js';
import { canvasStore } from '../../src/server/routes/canvas.js';
import { renderWidgetForData } from '../../src/widgets/widget-registry.js';
import { publishAnswerWidget } from '../../src/widgets/canvas-publish.js';
import { chromiumExecutableExists } from '../helpers/cifix2-dependencies.js';

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

const proofsDir = path.resolve('_qa/gk30/proofs');

describe.skipIf(!chromiumExecutableExists())('GK30 canvas headless capture', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let started: StartedServer | null = null;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gk30-capture-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    resetDatabaseManager();
    canvasStore.clear();
    fs.mkdirSync(proofsDir, { recursive: true });
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
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('serves the stock widget HTML and writes a headless screenshot', async () => {
    const data = {
      type: 'stock',
      name: 'Apple Inc.',
      symbol: 'AAPL',
      price: 226.34,
      change: 3.12,
      changePercent: 1.4,
      currency: 'USD',
      time: '03/09/2026 15:00',
      market: 'NASDAQ',
    };
    const html = renderWidgetForData(data);
    expect(html).toContain('AAPL');

    const published = await publishAnswerWidget('Apple Inc. (AAPL) : 226,34 USD', [{ data }], {
      env: { CODEBUDDY_WIDGETS: 'true', CODEBUDDY_WIDGETS_AUTO: 'true' } as NodeJS.ProcessEnv,
    });
    expect(published.canvasPath).toBeTruthy();
    expect(published.widgetHtml).toContain('226,34');

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
    const url = `http://127.0.0.1:${address.port}${published.canvasPath}`;
    const pageHtml = await (await fetch(url)).text();
    expect(pageHtml).toContain('Apple Inc.');
    expect(pageHtml).toContain('03/09/2026');

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
    });
    try {
      const page = await browser.newPage({ viewport: { width: 720, height: 480 } });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const shot = path.join(proofsDir, 'stock-widget.png');
      await page.screenshot({ path: shot, fullPage: true });
      expect(fs.statSync(shot).size).toBeGreaterThan(1000);
    } finally {
      await browser.close();
    }
  });
});
