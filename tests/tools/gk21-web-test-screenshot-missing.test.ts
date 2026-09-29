/**
 * GK21 — a web_test that cannot capture a screenshot must not announce PASSED.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

import { WebTestTool } from '../../src/tools/registry/web-test-tool.js';
import { BrowserExecuteTool, resetMiscInstances } from '../../src/tools/registry/misc-tools.js';
import { getAppServerTool, resetAppServerTool } from '../../src/tools/app-server-tool.js';
import { resetDevOrigins } from '../../src/security/dev-origins.js';
import { resetProcessTool } from '../../src/tools/process-tool.js';
import { chromiumExecutableExists } from '../helpers/cifix2-dependencies.js';

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

describe.skipIf(!chromiumExecutableExists())('GK21 web_test refuses PASSED without a screenshot', () => {
  const webTest = new WebTestTool();
  const browser = new BrowserExecuteTool();
  let appCwd: string;

  beforeAll(() => {
    appCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-gk21-shot-'));
  });

  afterAll(() => {
    if (appCwd) fs.rmSync(appCwd, { recursive: true, force: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await browser.execute({ action: 'close' }).catch(() => {});
    await resetAppServerTool();
    resetMiscInstances();
    resetDevOrigins();
    resetProcessTool();
    const { resetBrowserManager, resetBrowserTool } = await import('../../src/browser-automation/index.js');
    resetBrowserTool();
    resetBrowserManager();
  });

  it('fails the run when screenshot capture fails even if assertions pass', async () => {
    const original = BrowserExecuteTool.prototype.execute;
    vi.spyOn(BrowserExecuteTool.prototype, 'execute').mockImplementation(async function spy(this: BrowserExecuteTool, input) {
      if ((input as { action?: string }).action === 'screenshot') {
        return { success: false, error: 'gk21 screenshot capture failed' };
      }
      return original.call(this, input);
    });

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    fs.writeFileSync(path.join(appCwd, 'server.mjs'), [
      'import http from "node:http";',
      'http.createServer((_q, s) => {',
      '  s.setHeader("Content-Type", "text/html");',
      '  s.end("<!doctype html><title>Shot app</title><h1>Welcome</h1>");',
      `}).listen(${port}, "127.0.0.1");`,
    ].join('\n'));
    const started = await getAppServerTool().start({
      command: 'node server.mjs',
      url: `${base}/`,
      cwd: appCwd,
      timeoutMs: 15_000,
    });
    expect(started.success, started.error).toBe(true);

    const result = await webTest.execute({
      url: `${base}/`,
      assertions: [{ type: 'text', value: 'Welcome' }],
    });
    expect(result.success, result.error).toBe(true);
    expect((result.data as { passed: boolean }).passed).toBe(false);
    expect(result.output).toContain('FAILED');
    expect(result.output).toMatch(/screenshot/i);
    expect(result.output).not.toMatch(/^Web test PASSED/m);
  });
});
