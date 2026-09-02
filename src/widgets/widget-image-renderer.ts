/**
 * Local HTML → PNG rendering for channels that cannot display inline widgets.
 * Browser dependencies stay optional: Playwright is preferred, then
 * puppeteer-core with a system Chromium executable.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { renderWidgetForData } from './widget-registry.js';
import { widgetKind } from './widget-types.js';

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const require = createRequire(import.meta.url);

interface WidgetPage {
  setViewportSize?: (size: { width: number; height: number }) => void | Promise<unknown>;
  setViewport?: (size: { width: number; height: number }) => void | Promise<unknown>;
  setContent(html: string, options: Record<string, unknown>): Promise<void>;
  screenshot(options: Record<string, unknown>): Promise<Buffer | Uint8Array>;
}

interface WidgetBrowser {
  newPage(): Promise<WidgetPage>;
  close(): Promise<void>;
}

interface WidgetLauncher {
  launch(options: Record<string, unknown>): Promise<WidgetBrowser>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function moduleRoots(): string[] {
  const roots: string[] = [];
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let current = resolve(start);
    for (let depth = 0; depth < 7; depth++) {
      roots.push(current, join(current, 'cowork'));
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return [...new Set(roots)];
}

function loadOptionalModule(name: string): unknown | null {
  try {
    return require(name) as unknown;
  } catch {
    // Try sibling Cowork installations and ancestor workspaces below.
  }
  for (const root of moduleRoots()) {
    try {
      return require(require.resolve(name, { paths: [root] })) as unknown;
    } catch {
      // Keep looking for the optional renderer.
    }
  }
  return null;
}

function exportRecord(module: unknown): Record<string, unknown> | null {
  const record = asRecord(module);
  if (!record) return null;
  const defaultExport = asRecord(record.default);
  return defaultExport && !record.chromium && !record.launch ? defaultExport : record;
}

function launcherFromPlaywright(): WidgetLauncher | null {
  const module = exportRecord(loadOptionalModule('playwright'));
  const chromium = asRecord(module?.chromium);
  if (!chromium || typeof chromium.launch !== 'function') return null;
  const launch = chromium.launch as (options: Record<string, unknown>) => Promise<WidgetBrowser>;
  return { launch: (options) => launch.call(chromium, options) };
}

function chromiumExecutable(): string | null {
  const candidates = [
    process.env.CODEBUDDY_CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
}

function launcherFromPuppeteer(): WidgetLauncher | null {
  const module = exportRecord(loadOptionalModule('puppeteer-core'));
  if (!module || typeof module.launch !== 'function') return null;
  const executablePath = chromiumExecutable();
  if (!executablePath) return null;
  const launch = module.launch as (options: Record<string, unknown>) => Promise<WidgetBrowser>;
  return {
    launch: (options) => launch.call(module, {
      ...options,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }),
  };
}

function remaining(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('widget PNG render timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function prepareHtml(html: string): string {
  const backgroundStyle = '<style>html,body{background:#fff!important}body{margin:0}</style>';
  return /<\/head\s*>/iu.test(html)
    ? html.replace(/<\/head\s*>/iu, `${backgroundStyle}</head>`)
    : `${backgroundStyle}${html}`;
}

async function renderWithLauncher(
  launcher: WidgetLauncher,
  html: string,
  timeoutMs: number,
): Promise<Buffer | null> {
  const deadline = Date.now() + timeoutMs;
  let browser: WidgetBrowser | undefined;
  try {
    browser = await within(launcher.launch({ headless: true, timeout: remaining(deadline) }), remaining(deadline));
    const page = await within(browser.newPage(), remaining(deadline));
    if (page.setViewportSize) {
      await within(Promise.resolve(page.setViewportSize({ width: 1_200, height: 800 })), remaining(deadline));
    } else if (page.setViewport) {
      await within(Promise.resolve(page.setViewport({ width: 1_200, height: 800 })), remaining(deadline));
    }
    await within(
      page.setContent(prepareHtml(html), { waitUntil: 'load', timeout: remaining(deadline) }),
      remaining(deadline),
    );
    const screenshot = await within(
      page.screenshot({ type: 'png', fullPage: true }),
      remaining(deadline),
    );
    const png = Buffer.from(screenshot);
    return png.byteLength > 0 ? png : null;
  } catch {
    return null;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

/** Render a trusted, inert widget document to a PNG using local Chromium. */
export async function renderWidgetHtmlToPng(
  html: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Buffer | null> {
  if (!html.trim() || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES || /<\s*script\b/iu.test(html)) {
    return null;
  }
  const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : DEFAULT_TIMEOUT_MS;
  const playwright = launcherFromPlaywright();
  if (playwright) {
    const png = await renderWithLauncher(playwright, html, safeTimeout);
    if (png) return png;
  }
  const puppeteer = launcherFromPuppeteer();
  return puppeteer ? renderWithLauncher(puppeteer, html, safeTimeout) : null;
}

/** Render a curated/authored widget payload to a PNG using the shared registry. */
export async function renderWidgetDataToPng(
  data: unknown,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Buffer | null> {
  const record = asRecord(data);
  const payload = record && widgetKind(record.data) ? record.data : data;
  const html = renderWidgetForData(payload, env);
  return html ? renderWidgetHtmlToPng(html, timeoutMs) : null;
}
