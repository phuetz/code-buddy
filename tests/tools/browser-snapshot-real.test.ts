import { afterEach, describe, expect, it } from 'vitest';
import {
  BrowserExecuteTool,
  BrowserSnapshotExecuteTool,
  resetMiscInstances,
} from '../../src/tools/registry/misc-tools.js';
import { serveTestPages, type TestPageServer } from '../helpers/browser-test-page.js';

describe('browser_snapshot real Playwright integration', () => {
  const browser = new BrowserExecuteTool();
  const snapshot = new BrowserSnapshotExecuteTool();
  let pages: TestPageServer | undefined;

  afterEach(async () => {
    await browser.execute({ action: 'close' }).catch(() => {});
    await pages?.close();
    pages = undefined;
    resetMiscInstances();
    const { resetBrowserManager, resetBrowserTool } = await import('../../src/browser-automation/index.js');
    resetBrowserTool();
    resetBrowserManager();
  });

  it('returns real element refs from an active browser page', async () => {
    await expect(browser.execute({ action: 'launch', headless: true }))
      .resolves.toMatchObject({ success: true });

    pages = await serveTestPages(`<!doctype html>
      <title>Snapshot smoke</title>
      <main>
        <h1>Hermes snapshot smoke</h1>
        <button id="confirm">Confirm launch</button>
        <input aria-label="Mission name" value="Hermes">
      </main>
    `);

    await expect(browser.execute({
      action: 'navigate',
      url: pages.url,
      waitUntil: 'load',
    })).resolves.toMatchObject({ success: true });

    const result = await snapshot.execute({ interactiveOnly: false, maxElements: 20 });
    expect(result.success, result.error).toBe(true);
    expect(result.output).toContain('Title: Snapshot smoke');
    expect(result.output).toContain('Confirm launch');
    expect(result.output).toContain('Mission name');
    expect(result.output).toMatch(/\[\d+\] Confirm launch/);

    const data = result.data as {
      snapshotId?: string;
      url?: string;
      title?: string;
      elementCount?: number;
    };
    expect(data.snapshotId).toMatch(/^websnap-/);
    expect(data.title).toBe('Snapshot smoke');
    expect(data.url).toContain(pages.url);
    expect(data.elementCount).toBeGreaterThan(0);
  });
});
