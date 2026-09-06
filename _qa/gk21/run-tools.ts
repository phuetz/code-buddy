/**
 * GK21 live driver — calls app_server / web_test / computer_control for real.
 * Never DISPLAY, never Brave, never OmniParser on :8000.
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import { WebTestTool } from '../../src/tools/registry/web-test-tool.js';
import { BrowserExecuteTool, ComputerControlExecuteTool, resetMiscInstances } from '../../src/tools/registry/misc-tools.js';
import { getAppServerTool, resetAppServerTool } from '../../src/tools/app-server-tool.js';
import { resetDevOrigins } from '../../src/security/dev-origins.js';
import { resetProcessTool } from '../../src/tools/process-tool.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appCwd = path.join(repoRoot, '_qa/gk21-app');
const outDir = path.join(repoRoot, '_qa/gk21/artifacts');

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  const report: Record<string, unknown> = { startedAt: new Date().toISOString() };
  const webTest = new WebTestTool();
  const browser = new BrowserExecuteTool();
  const computer = new ComputerControlExecuteTool();

  try {
    const occupied = http.createServer((_q, s) => s.end('pre-existing'));
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const occupiedPort = (occupied.address() as AddressInfo).port;
    const adopt = await getAppServerTool().start({
      command: `PORT=${occupiedPort + 1} node server.mjs`,
      url: `http://127.0.0.1:${occupiedPort}/`,
      cwd: appCwd,
    });
    report.occupiedPort = {
      port: occupiedPort,
      success: adopt.success,
      error: adopt.error,
    };
    await new Promise<void>((resolve) => occupied.close(() => resolve()));

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const started = await getAppServerTool().start({
      command: `PORT=${port} node server.mjs`,
      url: `${base}/`,
      cwd: appCwd,
      timeoutMs: 15_000,
    });
    report.start = { success: started.success, error: started.error, output: started.output, data: started.data };
    if (!started.success) {
      throw new Error(`app_server start failed: ${started.error}`);
    }

    const home = await webTest.execute({
      url: `${base}/`,
      assertions: [
        { type: 'text', value: 'GK21 Mini App' },
        { type: 'selector', value: '#greet-form' },
      ],
    });
    report.home = { success: home.success, output: home.output, data: home.data };

    const about = await webTest.execute({
      url: `${base}/`,
      steps: [{ action: 'click', selector: '#nav-about' }, { action: 'wait', ms: 400 }],
      assertions: [
        { type: 'text', value: 'You navigated here' },
        { type: 'title', value: 'About GK21' },
      ],
      allowConsoleErrors: true,
    });
    report.about = { success: about.success, output: about.output, data: about.data };

    const snap = await computer.execute({
      action: 'snapshot_with_screenshot',
      useOmniParser: false,
    });
    report.computerControl = { success: snap.success, error: snap.error, output: snap.output, data: snap.data };

    const pid = (started.data as { pid?: number } | undefined)?.pid;
    if (pid) {
      report.stop = await getAppServerTool().stop(pid);
    }
  } finally {
    await browser.execute({ action: 'close' }).catch(() => {});
    await resetAppServerTool();
    resetMiscInstances();
    resetDevOrigins();
    resetProcessTool();
    const { resetBrowserManager, resetBrowserTool } = await import('../../src/browser-automation/index.js');
    resetBrowserTool();
    resetBrowserManager();
  }

  const dest = path.join(outDir, 'run-tools.json');
  fs.writeFileSync(dest, JSON.stringify(report, null, 2));
  process.stdout.write(`${dest}\n`);
  process.stdout.write(JSON.stringify({
    occupiedRefused: (report.occupiedPort as { success?: boolean })?.success === false,
    homePassed: (report.home as { data?: { passed?: boolean } })?.data?.passed,
    aboutPassed: (report.about as { data?: { passed?: boolean } })?.data?.passed,
    omniParser: (report.computerControl as { data?: { omniParser?: string } })?.data?.omniParser,
  }, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
