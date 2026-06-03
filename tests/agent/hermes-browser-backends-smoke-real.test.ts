import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { createServer } from 'net';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

import {
  buildHermesBrowserBackendsReadiness,
  runHermesBrowserBackendSmoke,
} from '../../src/agent/hermes-browser-backends.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
          return;
        }
        reject(new Error('Unable to reserve a free port.'));
      });
    });
  });
}

async function waitForCdpEndpoint(port: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const payload = await response.json() as { webSocketDebuggerUrl?: string };
        if (payload.webSocketDebuggerUrl) {
          return payload.webSocketDebuggerUrl;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for local CDP endpoint: ${lastError || 'no response'}`);
}

async function launchLocalCdpBrowser(): Promise<{
  endpoint: string;
  kill: () => Promise<void>;
}> {
  const port = await freePort();
  const userDataDir = await mkdtemp(join(tmpdir(), 'codebuddy-hermes-cdp-'));
  const processRef = spawn(chromium.executablePath(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-gpu',
    '--no-default-browser-check',
    '--no-first-run',
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  const endpoint = await waitForCdpEndpoint(port);

  return {
    endpoint,
    kill: async () => {
      processRef.kill();
      await new Promise((resolve) => {
        processRef.once('exit', resolve);
        setTimeout(resolve, 2000);
      });
      await rm(userDataDir, { force: true, recursive: true });
    },
  };
}

function runHermesJson(args: string[]): unknown {
  const result = spawnSync(process.execPath, [tsxCli, 'src/index.ts', 'hermes', ...args, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 90_000,
    windowsHide: true,
  });

  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toMatch(/^\{/);
  return JSON.parse(result.stdout) as unknown;
}

describe('Hermes browser backend readiness and live smoke', () => {
  it('reports browser backend readiness without leaking configured secrets', () => {
    const readiness = buildHermesBrowserBackendsReadiness({
      env: {
        CODEBUDDY_BROWSER_CDP_URL: 'ws://secret-cdp-host.example.test/devtools/browser/abc',
        BROWSERBASE_API_KEY: 'secret-browserbase-key',
        BROWSERBASE_PROJECT_ID: 'secret-browserbase-project',
        BROWSER_USE_API_KEY: 'secret-browser-use-key',
        FIRECRAWL_API_KEY: 'secret-firecrawl-key',
      },
      now: () => new Date('2026-05-31T13:35:00.000Z'),
    });

    expect(readiness.generatedAt).toBe('2026-05-31T13:35:00.000Z');
    expect(readiness.backends.map((backend) => backend.id)).toEqual(
      expect.arrayContaining([
        'local-playwright',
        'remote-cdp',
        'browserbase',
        'browser-use',
        'firecrawl',
        'camofox',
        'session-recording',
      ]),
    );
    expect(readiness.localRunnableCount).toBeGreaterThanOrEqual(1);
    expect(readiness.managedConfiguredCount).toBe(3);
    expect(readiness.backends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local-playwright',
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
          status: 'available',
        }),
        expect.objectContaining({
          id: 'remote-cdp',
          credentialSources: ['CODEBUDDY_BROWSER_CDP_URL'],
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke remote-cdp --json',
          status: 'configured',
        }),
        expect.objectContaining({
          id: 'browserbase',
          configured: true,
          credentialSources: ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID'],
          remediation: [],
          runnable: false,
          status: 'configured',
        }),
        expect.objectContaining({
          id: 'browser-use',
          configured: true,
          credentialSources: ['BROWSER_USE_API_KEY'],
          remediation: [],
          runnable: false,
          status: 'configured',
        }),
        expect.objectContaining({
          id: 'firecrawl',
          configured: true,
          credentialSources: ['FIRECRAWL_API_KEY'],
          remediation: [],
          runnable: true,
          status: 'configured',
        }),
        expect.objectContaining({
          id: 'session-recording',
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke session-recording --json',
          status: 'available',
        }),
      ]),
    );
    expect(JSON.stringify(readiness)).not.toContain('secret-');
    expect(JSON.stringify(readiness)).not.toContain('ws://secret-cdp-host');
  });

  it('keeps Browser Use setup remediation only when no gateway credential is configured', () => {
    const unconfigured = buildHermesBrowserBackendsReadiness({ env: {} });
    const unconfiguredBrowserUse = unconfigured.backends.find((backend) => backend.id === 'browser-use');
    expect(unconfiguredBrowserUse).toMatchObject({
      configured: false,
      remediation: [
        'Set BROWSER_USE_API_KEY or CODEBUDDY_NOUS_TOOL_GATEWAY_URL before selecting Browser Use managed browser mode.',
      ],
      status: 'missing',
    });

    const configured = buildHermesBrowserBackendsReadiness({
      env: {
        CODEBUDDY_NOUS_TOOL_GATEWAY_URL: 'https://gateway.example.test',
      },
    });
    const configuredBrowserUse = configured.backends.find((backend) => backend.id === 'browser-use');
    const raw = JSON.stringify(configured);

    expect(configuredBrowserUse).toMatchObject({
      configured: true,
      credentialSources: ['CODEBUDDY_NOUS_TOOL_GATEWAY_URL'],
      remediation: [],
      status: 'configured',
    });
    expect(raw).not.toContain('gateway.example.test');
  });

  it('launches Chromium through a real local Playwright smoke', async () => {
    const result = await runHermesBrowserBackendSmoke({
      backendId: 'local-playwright',
      now: () => new Date('2026-05-31T13:36:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'local-playwright',
      command: process.execPath,
      ok: true,
      status: 'passed',
    });
    expect(result.stdout).toContain('OK-HERMES-BROWSER');
    expect(result.output).toContain('OK-HERMES-BROWSER');
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exists: true,
          kind: 'playwright-trace',
          sizeBytes: expect.any(Number),
        }),
      ]),
    );
    expect(result.artifacts?.[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it('launches a real session-recording smoke with a dedicated trace artifact', async () => {
    const result = await runHermesBrowserBackendSmoke({
      backendId: 'session-recording',
      now: () => new Date('2026-05-31T13:37:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'session-recording',
      command: process.execPath,
      ok: true,
      status: 'passed',
    });
    expect(result.stdout).toContain('OK-HERMES-BROWSER');
    expect(result.output).toContain('session-recording-trace.zip');
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exists: true,
          kind: 'playwright-trace',
          path: expect.stringContaining('session-recording-trace.zip'),
          sizeBytes: expect.any(Number),
        }),
      ]),
    );
    expect(result.artifacts?.[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it('connects to a real remote CDP endpoint without leaking the endpoint', async () => {
    const cdp = await launchLocalCdpBrowser();
    try {
      const result = await runHermesBrowserBackendSmoke({
        backendId: 'remote-cdp',
        cdpUrl: cdp.endpoint,
        now: () => new Date('2026-05-31T19:50:00.000Z'),
      });

      expect(result).toMatchObject({
        backendId: 'remote-cdp',
        ok: true,
        status: 'passed',
      });
      expect(result.stdout).toContain('OK-HERMES-CDP');
      expect(result.output).toContain('OK-HERMES-CDP');
      expect(JSON.stringify(result)).not.toContain(cdp.endpoint);
    } finally {
      await cdp.kill();
    }
  });

  it('runs the remote CDP smoke through the real CLI entrypoint', async () => {
    const cdp = await launchLocalCdpBrowser();
    try {
      const output = runHermesJson(['browser-smoke', 'remote-cdp', '--cdp-url', cdp.endpoint]) as {
        kind: string;
        result: {
          backendId: string;
          ok: boolean;
          output: string;
          status: string;
          stdout: string;
        };
      };

      expect(output.kind).toBe('hermes_browser_backend_smoke');
      expect(output.result).toMatchObject({
        backendId: 'remote-cdp',
        ok: true,
        status: 'passed',
      });
      expect(output.result.stdout).toContain('OK-HERMES-CDP');
      expect(output.result.output).toContain('OK-HERMES-CDP');
      expect(JSON.stringify(output)).not.toContain(cdp.endpoint);
    } finally {
      await cdp.kill();
    }
  });
});
