/**
 * Browser backend readiness for the native Hermes-inspired profile.
 *
 * These checks stay non-destructive: status only inspects local packages,
 * optional environment configuration, and CLI presence. The explicit smoke
 * runner is the place that launches a real browser.
 */

import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import { mkdir, mkdtemp, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { Browser, BrowserContext } from 'playwright';

export type HermesBrowserBackendStatus = 'available' | 'configured' | 'missing' | 'unsupported';
export type HermesBrowserSmokeStatus = 'passed' | 'failed' | 'blocked' | 'unsupported' | 'not-runnable';

export interface HermesBrowserBackend {
  id: string;
  label: string;
  officialSurface: string;
  status: HermesBrowserBackendStatus;
  installed: boolean;
  configured: boolean;
  runnable: boolean;
  command: string | null;
  version: string | null;
  credentialSources: string[];
  smokeCommand: string | null;
  notes: string[];
  remediation: string[];
}

export interface HermesBrowserBackendsReadiness {
  ok: boolean;
  generatedAt: string;
  platform: NodeJS.Platform;
  localRunnableCount: number;
  managedConfiguredCount: number;
  backends: HermesBrowserBackend[];
  issues: string[];
  recommendations: string[];
}

export interface HermesBrowserBackendSmokeResult {
  artifacts?: HermesBrowserSmokeArtifact[];
  backendId: string;
  command: string | null;
  durationMs: number;
  finishedAt: string;
  label: string | null;
  ok: boolean;
  output: string;
  startedAt: string;
  status: HermesBrowserSmokeStatus;
  stdout: string;
  stderr: string;
}

export interface HermesBrowserSmokeArtifact {
  exists: boolean;
  kind: 'playwright-trace';
  label: string;
  path: string;
  sizeBytes: number;
}

export interface HermesBrowserBackendsOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface HermesBrowserBackendSmokeOptions extends HermesBrowserBackendsOptions {
  artifactsDir?: string;
  backendId: string;
  cdpUrl?: string;
}

const require = createRequire(import.meta.url);

function presentEnvKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter((key) => Boolean(env[key]?.trim()));
}

function firstLine(value: string): string | null {
  const line = value.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line ?? null;
}

function packageVersion(packageName: string): string | null {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageJson = require(packageJsonPath) as { version?: string };
    return packageJson.version ?? null;
  } catch {
    return null;
  }
}

function runProbe(command: string, args: string[], env: NodeJS.ProcessEnv): { ok: boolean; output: string } {
  try {
    const result = spawnSync(command, args, {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      windowsHide: true,
    });
    return {
      ok: !result.error && result.status === 0,
      output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim(),
    };
  } catch {
    return { ok: false, output: '' };
  }
}

function localPlaywrightBackend(): HermesBrowserBackend {
  const version = packageVersion('playwright');
  const installed = Boolean(version);
  return {
    id: 'local-playwright',
    label: 'Local Playwright',
    officialSurface: 'local CDP/Playwright browser backend',
    status: installed ? 'available' : 'missing',
    installed,
    configured: installed,
    runnable: installed,
    command: process.execPath,
    version,
    credentialSources: [],
    smokeCommand: installed ? 'buddy hermes browser-smoke local-playwright --json' : null,
    notes: [
      'Status means the Playwright package is installed; the smoke runner launches Chromium and proves browser binaries work.',
    ],
    remediation: installed ? [] : ['Install Playwright and browser binaries before selecting local browser automation.'],
  };
}

function cdpBackend(env: NodeJS.ProcessEnv): HermesBrowserBackend {
  const playwrightVersion = packageVersion('playwright');
  const credentialSources = presentEnvKeys(env, [
    'CODEBUDDY_BROWSER_CDP_URL',
    'BROWSER_CDP_URL',
    'CHROME_REMOTE_DEBUGGING_URL',
  ]);
  const configured = credentialSources.length > 0;
  return {
    id: 'remote-cdp',
    label: 'Remote Chrome DevTools Protocol',
    officialSurface: 'local/remote CDP browser connection',
    status: configured ? 'configured' : playwrightVersion ? 'available' : 'missing',
    installed: Boolean(playwrightVersion),
    configured,
    runnable: Boolean(playwrightVersion && configured),
    command: null,
    version: playwrightVersion,
    credentialSources,
    smokeCommand: configured ? 'buddy hermes browser-smoke remote-cdp --json' : null,
    notes: ['Uses an already running browser endpoint; status never prints the endpoint value.'],
    remediation: configured ? [] : ['Set CODEBUDDY_BROWSER_CDP_URL to attach to an existing browser session.'],
  };
}

function browserbaseBackend(env: NodeJS.ProcessEnv): HermesBrowserBackend {
  const stagehandVersion = packageVersion('@browserbasehq/stagehand');
  const credentialSources = presentEnvKeys(env, ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID']);
  const configured = credentialSources.includes('BROWSERBASE_API_KEY') &&
    credentialSources.includes('BROWSERBASE_PROJECT_ID');
  return {
    id: 'browserbase',
    label: 'Browserbase / Stagehand',
    officialSurface: 'managed browser backend',
    status: configured ? 'configured' : stagehandVersion ? 'available' : 'missing',
    installed: Boolean(stagehandVersion),
    configured,
    runnable: false,
    command: null,
    version: stagehandVersion,
    credentialSources,
    smokeCommand: null,
    notes: [
      configured
        ? 'Stagehand is installed locally and Browserbase credentials are configured; no safe live Browserbase smoke runner is wired yet.'
        : 'Stagehand is installed locally; managed Browserbase execution still requires project credentials.',
    ],
    remediation: configured ? [] : ['Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID for managed browser sessions.'],
  };
}

function browserUseBackend(env: NodeJS.ProcessEnv): HermesBrowserBackend {
  const credentialSources = presentEnvKeys(env, ['BROWSER_USE_API_KEY', 'CODEBUDDY_NOUS_TOOL_GATEWAY_URL']);
  const configured = credentialSources.length > 0;
  return {
    id: 'browser-use',
    label: 'Browser Use gateway',
    officialSurface: 'Browser Use managed browser mode',
    status: configured ? 'configured' : 'missing',
    installed: false,
    configured,
    runnable: false,
    command: null,
    version: null,
    credentialSources,
    smokeCommand: null,
    notes: ['Tracked for Hermes parity; Code Buddy does not yet expose a first-class Browser Use runtime runner.'],
    remediation: configured ? [] : ['Set BROWSER_USE_API_KEY or CODEBUDDY_NOUS_TOOL_GATEWAY_URL before selecting Browser Use managed browser mode.'],
  };
}

function firecrawlBackend(env: NodeJS.ProcessEnv): HermesBrowserBackend {
  const credentialSources = presentEnvKeys(env, ['FIRECRAWL_API_KEY']);
  const configured = credentialSources.length > 0;
  return {
    id: 'firecrawl',
    label: 'Firecrawl',
    officialSurface: 'web extraction backend',
    status: configured ? 'configured' : 'available',
    installed: true,
    configured,
    runnable: configured,
    command: null,
    version: null,
    credentialSources,
    smokeCommand: configured ? 'buddy hermes portal tools --json' : null,
    notes: [
      configured
        ? 'Code Buddy has a native Firecrawl tool surface and a credential source is configured.'
        : 'Code Buddy has a native Firecrawl tool surface; live calls require FIRECRAWL_API_KEY.',
    ],
    remediation: configured ? [] : ['Set FIRECRAWL_API_KEY when live Firecrawl extraction is required.'],
  };
}

function camofoxBackend(env: NodeJS.ProcessEnv): HermesBrowserBackend {
  const camofox = runProbe('camofox', ['--version'], env);
  const camoufox = camofox.ok ? camofox : runProbe('camoufox', ['--version'], env);
  const installed = camoufox.ok;
  return {
    id: 'camofox',
    label: 'Camofox / Camoufox',
    officialSurface: 'anti-detection browser backend',
    status: installed ? 'available' : 'missing',
    installed,
    configured: installed,
    runnable: false,
    command: installed ? (camofox.ok ? 'camofox' : 'camoufox') : null,
    version: installed ? firstLine(camoufox.output) : null,
    credentialSources: [],
    smokeCommand: null,
    notes: ['Detected only as an optional upstream-compatible backend; no Code Buddy runner is wired yet.'],
    remediation: installed ? ['Wire a first-class runner before claiming Camofox parity.'] : ['Install Camofox/Camoufox only if this backend is required.'],
  };
}

function recordingBackend(): HermesBrowserBackend {
  const version = packageVersion('playwright');
  const installed = Boolean(version);
  return {
    id: 'session-recording',
    label: 'Browser session recording',
    officialSurface: 'browser session replay/recording',
    status: installed ? 'available' : 'missing',
    installed,
    configured: installed,
    runnable: installed,
    command: installed ? process.execPath : null,
    version,
    credentialSources: [],
    smokeCommand: installed ? 'buddy hermes browser-smoke session-recording --json' : null,
    notes: [
      installed
        ? 'The session-recording smoke writes a Playwright trace.zip artifact for replay/debugging.'
        : 'Browser Operator exports proof artifacts and action logs, but Playwright trace recording is unavailable.',
    ],
    remediation: installed ? [] : ['Install Playwright before marking browser session recording as available.'],
  };
}

export function buildHermesBrowserBackendsReadiness(
  options: HermesBrowserBackendsOptions = {},
): HermesBrowserBackendsReadiness {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const backends = [
    localPlaywrightBackend(),
    cdpBackend(env),
    browserbaseBackend(env),
    browserUseBackend(env),
    firecrawlBackend(env),
    camofoxBackend(env),
    recordingBackend(),
  ];
  const localRunnableCount = backends.filter((backend) =>
    ['local-playwright', 'remote-cdp'].includes(backend.id) && backend.runnable,
  ).length;
  const managedConfiguredCount = backends.filter((backend) =>
    ['browserbase', 'browser-use', 'firecrawl'].includes(backend.id) && backend.configured,
  ).length;
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (localRunnableCount === 0) {
    issues.push('No local browser backend is currently runnable (Playwright or configured CDP).');
  }

  if (managedConfiguredCount === 0) {
    recommendations.push('Configure Browserbase, Browser Use/Nous Gateway, or Firecrawl only if managed browser backends are a product goal.');
  }

  if (!backends.some((backend) => backend.id === 'session-recording' && backend.runnable)) {
    recommendations.push('Add a real browser session recording artifact before claiming full Hermes browser backend parity.');
  }

  return {
    ok: issues.length === 0,
    generatedAt: now().toISOString(),
    platform: process.platform,
    localRunnableCount,
    managedConfiguredCount,
    backends,
    issues,
    recommendations,
  };
}

function blockedSmokeResult(
  backendId: string,
  status: HermesBrowserSmokeStatus,
  output: string,
  options: {
    backend?: HermesBrowserBackend;
    command?: string | null;
    now: Date;
  },
): HermesBrowserBackendSmokeResult {
  const timestamp = options.now.toISOString();
  return {
    backendId,
    command: options.command ?? null,
    durationMs: 0,
    finishedAt: timestamp,
    label: options.backend?.label ?? null,
    ok: false,
    output,
    startedAt: timestamp,
    status,
    stdout: '',
    stderr: output,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cdpEndpointFromEnv(env: NodeJS.ProcessEnv): string | null {
  for (const key of ['CODEBUDDY_BROWSER_CDP_URL', 'BROWSER_CDP_URL', 'CHROME_REMOTE_DEBUGGING_URL']) {
    const value = env[key]?.trim();
    if (value) return value;
  }

  return null;
}

async function createBrowserSmokeArtifactDir(artifactsDir?: string): Promise<string> {
  if (artifactsDir?.trim()) {
    const target = resolve(artifactsDir);
    await mkdir(target, { recursive: true });
    return target;
  }

  return mkdtemp(join(tmpdir(), 'codebuddy-hermes-browser-'));
}

async function runRemoteCdpSmoke(
  now: () => Date,
  env: NodeJS.ProcessEnv,
): Promise<HermesBrowserBackendSmokeResult> {
  const started = now();
  const startedAtMs = Date.now();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const endpoint = cdpEndpointFromEnv(env);
    if (!endpoint) {
      return {
        backendId: 'remote-cdp',
        command: null,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        finishedAt: now().toISOString(),
        label: 'Remote Chrome DevTools Protocol',
        ok: false,
        output: 'CODEBUDDY_BROWSER_CDP_URL is required for remote-cdp smoke.',
        startedAt: started.toISOString(),
        status: 'not-runnable',
        stdout: '',
        stderr: 'CODEBUDDY_BROWSER_CDP_URL is required for remote-cdp smoke.',
      };
    }

    const playwright = await import('playwright');
    browser = await playwright.chromium.connectOverCDP(endpoint);
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('data:text/html,<title>OK-HERMES-CDP</title><h1>OK-HERMES-CDP</h1>', {
      waitUntil: 'domcontentloaded',
    });
    const title = await page.title();
    const heading = await page.locator('h1').textContent();
    const ok = title === 'OK-HERMES-CDP' && heading === 'OK-HERMES-CDP';
    const output = `title=${title}; heading=${heading ?? ''}`;

    return {
      backendId: 'remote-cdp',
      command: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label: 'Remote Chrome DevTools Protocol',
      ok,
      output,
      startedAt: started.toISOString(),
      status: ok ? 'passed' : 'failed',
      stdout: output,
      stderr: ok ? '' : 'Unexpected remote CDP page content.',
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      backendId: 'remote-cdp',
      command: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label: 'Remote Chrome DevTools Protocol',
      ok: false,
      output: message,
      startedAt: started.toISOString(),
      status: 'failed',
      stdout: '',
      stderr: message,
    };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

async function runLocalPlaywrightSmoke(
  now: () => Date,
  options: {
    artifactsDir?: string;
    backendId?: string;
    label?: string;
    traceFilename?: string;
  } = {},
): Promise<HermesBrowserBackendSmokeResult> {
  const started = now();
  const startedAtMs = Date.now();
  const backendId = options.backendId ?? 'local-playwright';
  const label = options.label ?? 'Local Playwright';
  const traceFilename = options.traceFilename ?? 'local-playwright-trace.zip';
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const playwright = await import('playwright');
    browser = await playwright.chromium.launch({ headless: true });
    context = await browser.newContext();
    const artifactDir = await createBrowserSmokeArtifactDir(options.artifactsDir);
    const tracePath = join(artifactDir, traceFilename);

    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });

    const page = await context.newPage();
    await page.goto('data:text/html,<title>OK-HERMES-BROWSER</title><h1>OK-HERMES-BROWSER</h1>', {
      waitUntil: 'domcontentloaded',
    });
    const title = await page.title();
    const heading = await page.locator('h1').textContent();
    const pageOk = title === 'OK-HERMES-BROWSER' && heading === 'OK-HERMES-BROWSER';
    let traceError: string | null = null;

    try {
      await context.tracing.stop({ path: tracePath });
    } catch (error) {
      traceError = errorMessage(error);
    }

    const traceStats = traceError ? null : await stat(tracePath).catch(() => null);
    const traceExists = Boolean(traceStats?.isFile() && traceStats.size > 0);
    if (!traceError && !traceExists) {
      traceError = 'Playwright trace recording was not written.';
    }

    const artifacts: HermesBrowserSmokeArtifact[] = traceStats
      ? [{
        exists: traceExists,
        kind: 'playwright-trace',
        label: `${label} trace`,
        path: tracePath,
        sizeBytes: traceStats.size,
      }]
      : [];
    const ok = pageOk && !traceError && traceExists;
    const output = `title=${title}; heading=${heading ?? ''}; trace=${tracePath}`;
    return {
      artifacts,
      backendId,
      command: process.execPath,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label,
      ok,
      output,
      startedAt: started.toISOString(),
      status: ok ? 'passed' : 'failed',
      stdout: output,
      stderr: [
        pageOk ? null : 'Unexpected browser page content.',
        traceError,
      ].filter(Boolean).join('\n'),
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      backendId,
      command: process.execPath,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label,
      ok: false,
      output: message,
      startedAt: started.toISOString(),
      status: 'failed',
      stdout: '',
      stderr: message,
    };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export async function runHermesBrowserBackendSmoke(
  options: HermesBrowserBackendSmokeOptions,
): Promise<HermesBrowserBackendSmokeResult> {
  const env = options.cdpUrl?.trim()
    ? { ...(options.env ?? process.env), CODEBUDDY_BROWSER_CDP_URL: options.cdpUrl.trim() }
    : options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const readiness = buildHermesBrowserBackendsReadiness({ env, now });
  const backendId = options.backendId.trim();
  const backend = readiness.backends.find((candidate) => candidate.id === backendId);
  const timestamp = now();

  if (!backend) {
    return blockedSmokeResult(backendId, 'unsupported', `Unknown browser backend: ${backendId}`, {
      now: timestamp,
    });
  }

  if (backend.id === 'local-playwright') {
    return runLocalPlaywrightSmoke(now, { artifactsDir: options.artifactsDir });
  }

  if (backend.id === 'session-recording') {
    return runLocalPlaywrightSmoke(now, {
      artifactsDir: options.artifactsDir,
      backendId: backend.id,
      label: backend.label,
      traceFilename: 'session-recording-trace.zip',
    });
  }

  if (backend.id === 'remote-cdp') {
    return runRemoteCdpSmoke(now, env);
  }

  if (!backend.runnable) {
    return blockedSmokeResult(backend.id, 'not-runnable', `${backend.label} is not runnable on this host.`, {
      backend,
      command: backend.command,
      now: timestamp,
    });
  }

  return blockedSmokeResult(backend.id, 'blocked', `${backend.label} does not have a safe live smoke runner yet.`, {
    backend,
    command: backend.command,
    now: timestamp,
  });
}

export function renderHermesBrowserBackendsReadiness(readiness: HermesBrowserBackendsReadiness): string {
  const lines = [
    `Hermes browser backends: ${readiness.ok ? 'ok' : 'needs attention'}`,
    `Platform: ${readiness.platform}`,
    `Local runnable: ${readiness.localRunnableCount}`,
    `Managed configured: ${readiness.managedConfiguredCount}`,
    '',
    'Backends:',
    ...readiness.backends.map((backend) =>
      `- ${backend.id}: ${backend.status}` +
      `${backend.version ? ` (${backend.version})` : ''}` +
      `${backend.smokeCommand ? ` | smoke: ${backend.smokeCommand}` : ''}`,
    ),
  ];

  if (readiness.issues.length > 0) {
    lines.push('', 'Issues:', ...readiness.issues.map((issue) => `- ${issue}`));
  }

  if (readiness.recommendations.length > 0) {
    lines.push('', 'Recommendations:', ...readiness.recommendations.map((recommendation) => `- ${recommendation}`));
  }

  return lines.join('\n');
}

export function renderHermesBrowserSmoke(result: HermesBrowserBackendSmokeResult): string {
  const lines = [
    `Hermes browser smoke (${result.backendId}): ${result.status}`,
    `Command: ${result.command ?? 'none'}`,
    `Duration: ${result.durationMs}ms`,
    `Output: ${result.output || 'none'}`,
  ];

  if (result.artifacts?.length) {
    lines.push(
      'Artifacts:',
      ...result.artifacts.map((artifact) =>
        `- ${artifact.kind}: ${artifact.path} (${artifact.sizeBytes} bytes)`,
      ),
    );
  }

  return lines.join('\n');
}
