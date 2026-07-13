import { chromium } from 'playwright';

const cdpUrl = process.env.CODEBUDDY_COWORK_CDP_URL || 'http://127.0.0.1:9222';
const desktopScreenshot = process.env.CODEBUDDY_MAISON_DESKTOP_SCREENSHOT
  || '/tmp/codebuddy-maison-desktop.png';
const compactScreenshot = process.env.CODEBUDDY_MAISON_COMPACT_SCREENSHOT
  || '/tmp/codebuddy-maison-compact.png';

const browser = await chromium.connectOverCDP(cdpUrl);
const deadline = Date.now() + 30_000;
let page;
while (!page && Date.now() < deadline) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  page = pages.find((candidate) => candidate.url().startsWith('file:')) ?? pages[0];
  if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!page) throw new Error(`No Electron renderer page is exposed by ${cdpUrl}`);

const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => {
  requestFailures.push(`${request.url()} · ${request.failure()?.errorText ?? 'unknown error'}`);
});

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="maison-home-card"]', { timeout: 30_000 });
await page.waitForSelector('[data-testid="living-briefing-maison"]', { timeout: 30_000 });
await page.waitForFunction(() => {
  const card = document.querySelector('[data-testid="maison-card"]');
  return card?.getAttribute('data-status') !== 'loading';
}, { timeout: 30_000 });

const rendererApiReady = await page.evaluate(() => (
  typeof window.electronAPI?.maison?.snapshot === 'function'
  && typeof window.electronAPI?.maison?.setMode === 'function'
));
const ipcProbe = rendererApiReady
  ? await page.evaluate(async () => {
      const startedAt = performance.now();
      const payload = await window.electronAPI.maison.snapshot();
      return {
        latencyMs: Math.round((performance.now() - startedAt) * 10) / 10,
        status: payload.status,
        activeTimerCount: payload.activeTimers.length,
      };
    })
  : null;
const cardStatus = await page.locator('[data-testid="maison-card"]').getAttribute('data-status');
const cardText = (await page.locator('[data-testid="maison-card"]').innerText()).replace(/\s+/g, ' ').trim();
const briefingMaisonText = (await page.locator('[data-testid="living-briefing-maison"]').innerText())
  .replace(/\s+/g, ' ')
  .trim();
const overlayCount = await page.locator('vite-error-overlay, [data-vite-dev-id], [data-nextjs-dialog-overlay]').count();

await page.setViewportSize({ width: 1440, height: 1000 });
await page.screenshot({ path: desktopScreenshot, fullPage: true });

const trigger = page.locator('[data-testid="maison-change-mode"]');
await trigger.focus();
await page.keyboard.press('Enter');
const menu = page.getByRole('menu', { name: 'Choisir le mode Maison' });
await menu.waitFor();
await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitemradio');
const initialFocus = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
await page.keyboard.press('ArrowDown');
const nextFocus = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('[role="menu"][aria-label="Choisir le mode Maison"]'));
await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'maison-change-mode');
const restoredFocus = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));

await page.setViewportSize({ width: 430, height: 932 });
await trigger.click();
await menu.waitFor();
await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitemradio');
const compactLayout = await page.evaluate(() => {
  const menuElement = document.querySelector('[role="menu"][aria-label="Choisir le mode Maison"]');
  const card = document.querySelector('[data-testid="maison-card"]');
  const bounds = menuElement?.getBoundingClientRect();
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    cardWidth: card?.getBoundingClientRect().width ?? null,
    menu: bounds ? {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
    } : null,
  };
});
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('[role="menu"][aria-label="Choisir le mode Maison"]'));
await page.evaluate(() => {
  window.scrollTo(0, 0);
  let element = document.querySelector('[data-testid="maison-card"]');
  while (element) {
    if (element instanceof HTMLElement) element.scrollTop = 0;
    element = element.parentElement;
  }
});
await page.waitForTimeout(250);
await page.screenshot({ path: compactScreenshot, fullPage: true });
await page.setViewportSize({ width: 1440, height: 1000 });

const failures = [];
if (!rendererApiReady) failures.push('preload Maison API is missing');
if (ipcProbe && ipcProbe.status !== 'ready') failures.push(`Maison IPC probe is ${ipcProbe.status}`);
if (ipcProbe && ipcProbe.latencyMs > 2_000) failures.push(`Maison IPC probe is slow (${ipcProbe.latencyMs}ms)`);
if (cardStatus !== 'ready') failures.push(`Maison card status is ${cardStatus ?? 'missing'}`);
if (!/maison/i.test(cardText)) failures.push('Maison card text is missing');
if (!briefingMaisonText) failures.push('Living briefing Maison cue is missing');
if (overlayCount > 0) failures.push(`${overlayCount} framework error overlay(s) visible`);
if (initialFocus !== 'maison-mode-normal') {
  failures.push(`initial menu focus is ${initialFocus ?? 'missing'}, expected maison-mode-normal`);
}
if (nextFocus !== 'maison-mode-free-day') {
  failures.push(`ArrowDown focus is ${nextFocus ?? 'missing'}, expected maison-mode-free-day`);
}
if (restoredFocus !== 'maison-change-mode') failures.push('Escape did not restore trigger focus');
if (compactLayout.documentWidth > compactLayout.viewportWidth + 1) {
  failures.push(`compact layout overflows horizontally (${compactLayout.documentWidth}px > ${compactLayout.viewportWidth}px)`);
}
if (
  !compactLayout.menu
  || compactLayout.menu.left < -1
  || compactLayout.menu.right > compactLayout.viewportWidth + 1
  || compactLayout.menu.top < -1
  || compactLayout.menu.bottom > compactLayout.viewportHeight + 1
) {
  failures.push('compact mode menu is clipped');
}
if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} renderer console error(s)`);
if (pageErrors.length > 0) failures.push(`${pageErrors.length} uncaught renderer error(s)`);
if (requestFailures.length > 0) failures.push(`${requestFailures.length} failed renderer request(s)`);

const report = {
  ok: failures.length === 0,
  cdpUrl,
  url: page.url(),
  cardStatus,
  cardTextPreview: cardText.slice(0, 240),
  briefingMaisonText,
  rendererApiReady,
  ipcProbe,
  initialFocus,
  nextFocus,
  restoredFocus,
  compactLayout,
  screenshots: { desktop: desktopScreenshot, compact: compactScreenshot },
  consoleErrors,
  pageErrors,
  requestFailures,
  failures,
};
console.log(JSON.stringify(report, null, 2));
process.exit(failures.length > 0 ? 1 : 0);
