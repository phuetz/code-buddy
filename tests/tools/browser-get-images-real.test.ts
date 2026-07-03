import { afterEach, describe, expect, it } from 'vitest';
import {
  BrowserExecuteTool,
  BrowserGetImagesExecuteTool,
  resetMiscInstances,
} from '../../src/tools/registry/misc-tools.js';
import { serveTestPages, type TestPageServer } from '../helpers/browser-test-page.js';

describe('browser_get_images real Playwright integration', () => {
  const browser = new BrowserExecuteTool();
  const images = new BrowserGetImagesExecuteTool();
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

  it('lists visible image metadata from a real browser page', async () => {
    await expect(browser.execute({ action: 'launch', headless: true }))
      .resolves.toMatchObject({ success: true });

    const svg = Buffer
      .from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="red"/></svg>')
      .toString('base64');
    pages = await serveTestPages(`<!doctype html>
      <title>Images smoke</title>
      <img src="data:image/svg+xml;base64,${svg}" alt="Hermes emblem" width="32" height="24">
      <img src="data:image/svg+xml;base64,${svg}" alt="Hidden image" style="display:none">
    `);

    await expect(browser.execute({
      action: 'navigate',
      url: pages.url,
      waitUntil: 'load',
    })).resolves.toMatchObject({ success: true });

    const result = await images.execute({ visibleOnly: true });
    expect(result.success, result.error).toBe(true);
    expect(result.output).toContain('Hermes emblem');

    const found = (result.data as {
      images?: Array<{
        alt: string;
        src: string;
        width: number;
        height: number;
        visible: boolean;
      }>;
    }).images ?? [];

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      alt: 'Hermes emblem',
      width: 32,
      height: 24,
      visible: true,
    });
    expect(found[0]!.src).toContain('data:image/svg+xml;base64,');
  });
});
