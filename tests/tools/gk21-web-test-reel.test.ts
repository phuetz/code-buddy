/**
 * GK21 — real mini-app loop: app_server starts `_qa/gk21-app`, web_test
 * reports console errors + screenshot + assertions, occupied port is
 * refused, never DISPLAY=:10 / never a pre-existing browser.
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

import { WebTestTool } from '../../src/tools/registry/web-test-tool.js';
import { BrowserExecuteTool, resetMiscInstances } from '../../src/tools/registry/misc-tools.js';
import { getAppServerTool, resetAppServerTool } from '../../src/tools/app-server-tool.js';
import { resetDevOrigins } from '../../src/security/dev-origins.js';
import { resetProcessTool } from '../../src/tools/process-tool.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appCwd = path.join(repoRoot, '_qa/gk21-app');
const gk21Home = path.join(repoRoot, '_qa/gk21/home');

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

describe('GK21 real mini-app (app_server + web_test)', () => {
  const webTest = new WebTestTool();
  const browser = new BrowserExecuteTool();
  let savedDisplay: string | undefined;
  let savedWayland: string | undefined;
  let savedHome: string | undefined;
  let savedPlaywrightBrowsers: string | undefined;

  beforeAll(() => {
    savedDisplay = process.env.DISPLAY;
    savedWayland = process.env.WAYLAND_DISPLAY;
    savedHome = process.env.HOME;
    savedPlaywrightBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    fs.mkdirSync(gk21Home, { recursive: true });
    process.env.HOME = gk21Home;
    // Reuse the already-installed Playwright cache; do not download, never Brave.
    if (!savedPlaywrightBrowsers) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(savedHome || '/home/patrice', '.cache/ms-playwright');
    }
  });

  afterAll(() => {
    if (savedDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = savedDisplay;
    if (savedWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = savedWayland;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedPlaywrightBrowsers === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = savedPlaywrightBrowsers;
  });

  afterEach(async () => {
    await browser.execute({ action: 'close' }).catch(() => {});
    await resetAppServerTool();
    resetMiscInstances();
    resetDevOrigins();
    resetProcessTool();
    const { resetBrowserManager, resetBrowserTool } = await import('../../src/browser-automation/index.js');
    resetBrowserTool();
    resetBrowserManager();
  });

  it('refuses to adopt a pre-existing service on the port', async () => {
    const existing = http.createServer((_q, s) => s.end('pre-existing-gk21'));
    await new Promise<void>((resolve) => existing.listen(0, '127.0.0.1', resolve));
    const port = (existing.address() as AddressInfo).port;
    try {
      const result = await getAppServerTool().start({
        command: `PORT=${port + 1} node server.mjs`,
        url: `http://127.0.0.1:${port}/`,
        cwd: appCwd,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already in use');
      expect(result.error).toMatch(/refuses to adopt|pre-existing/i);
    } finally {
      await new Promise<void>((resolve) => existing.close(() => resolve()));
    }
  });

  it('starts the mini-app, fails web_test on the voluntary console error, passes about after navigate, keeps a screenshot file', async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const started = await getAppServerTool().start({
      command: `PORT=${port} node server.mjs`,
      url: `${base}/`,
      cwd: appCwd,
      timeoutMs: 15_000,
    });
    expect(started.success, started.error).toBe(true);
    expect(started.output).toContain('Dev server ready');

    const home = await webTest.execute({
      url: `${base}/`,
      assertions: [
        { type: 'text', value: 'GK21 Mini App' },
        { type: 'selector', value: '#greet-form' },
        { type: 'title', value: 'GK21 Mini App' },
      ],
    });
    expect(home.success, home.error).toBe(true);
    const homeData = home.data as {
      passed: boolean;
      consoleErrorCount: number;
      screenshotPath?: string;
    };
    expect(homeData.passed).toBe(false);
    expect(homeData.consoleErrorCount).toBeGreaterThan(0);
    expect(home.output).toContain('FAILED');
    expect(home.output).toContain('GK21 voluntary console error');
    expect(home.output).toContain('Server logs (app_server)');
    expect(home.output).toContain('GK21 hit');
    expect(homeData.screenshotPath).toBeTruthy();
    expect(homeData.screenshotPath, 'evidence must not land in shared /tmp').not.toMatch(/^\/tmp(?:\/|$)/);
    expect(homeData.screenshotPath).toContain(gk21Home);
    expect(fs.existsSync(homeData.screenshotPath as string), `missing screenshot ${homeData.screenshotPath}`).toBe(
      true,
    );

    const about = await webTest.execute({
      url: `${base}/`,
      steps: [{ action: 'click', selector: '#nav-about' }, { action: 'wait', ms: 400 }],
      assertions: [
        { type: 'text', value: 'You navigated here' },
        { type: 'title', value: 'About GK21' },
        { type: 'selector', value: '#about-heading' },
      ],
      allowConsoleErrors: true,
    });
    expect(about.success, about.error).toBe(true);
    expect((about.data as { passed: boolean }).passed).toBe(true);
    expect(about.output).toContain('PASSED');
    expect(about.output).toContain('✓ step 1 click "#nav-about"');
    const aboutShot = (about.data as { screenshotPath?: string }).screenshotPath;
    expect(aboutShot).toBeTruthy();
    expect(aboutShot, 'evidence must not land in shared /tmp').not.toMatch(/^\/tmp(?:\/|$)/);
    expect(aboutShot).toContain(gk21Home);
    expect(fs.existsSync(aboutShot as string)).toBe(true);
  });
});
