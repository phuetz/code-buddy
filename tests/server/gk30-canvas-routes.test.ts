/**
 * GK30 — canvas routes must be mounted on the live buddy server.
 * A widget is not "rendered" until HTML is served by GET /__codebuddy__/canvas/:id.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDatabaseManager } from '../../src/database/database-manager.js';
import { canvasStore } from '../../src/server/routes/canvas.js';

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

describe('GK30 canvas routes on buddy server', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let started: StartedServer | null = null;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gk30-canvas-'));
    process.env.CODEBUDDY_HOME = tmpHome;
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
    if (previousHome === undefined) {
      delete process.env.CODEBUDDY_HOME;
    } else {
      process.env.CODEBUDDY_HOME = previousHome;
    }
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

  it('serves canvas HTML by id and refuses an empty widget as rendered', async () => {
    const baseUrl = await start();

    const empty = await fetch(`${baseUrl}/__codebuddy__/canvas/`);
    expect(empty.status).toBe(200);
    expect(empty.headers.get('content-type')).toMatch(/text\/html/);
    expect(await empty.text()).toMatch(/canvas/i);

    const a2ui = await fetch(`${baseUrl}/__codebuddy__/a2ui/`);
    expect(a2ui.status).toBe(200);
    expect(await a2ui.text()).toContain('A2UI');

    const blank = await fetch(`${baseUrl}/__codebuddy__/canvas/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: '   ' }),
    });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({ error: expect.stringMatching(/html/i) });

    const widgetDoc =
      '<!doctype html><html><head><title>AAPL</title></head>' +
      '<body><div class="cbw-stock">Apple Inc. (AAPL) : 226,34 USD</div></body></html>';
    const push = await fetch(`${baseUrl}/__codebuddy__/canvas/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: widgetDoc }),
    });
    expect(push.status).toBe(200);
    const pushed = (await push.json()) as { id: string };
    expect(pushed.id).toMatch(/^canvas_/);

    const page = await fetch(`${baseUrl}/__codebuddy__/canvas/${pushed.id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Apple Inc. (AAPL) : 226,34 USD');
    expect(html).toContain('class="cbw-stock"');
    expect(html).toContain('<!doctype html>');
    expect(html).not.toMatch(/<script>/i);
  });
});
