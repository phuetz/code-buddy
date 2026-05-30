import { afterEach, describe, expect, it } from 'vitest';
import {
  BrowserConsoleExecuteTool,
  BrowserExecuteTool,
  resetMiscInstances,
} from '../../src/tools/registry/misc-tools.js';

describe('browser_console real Playwright integration', () => {
  const browser = new BrowserExecuteTool();
  const consoleTool = new BrowserConsoleExecuteTool();

  afterEach(async () => {
    await browser.execute({ action: 'close' }).catch(() => {});
    resetMiscInstances();
    const { resetBrowserManager, resetBrowserTool } = await import('../../src/browser-automation/index.js');
    resetBrowserTool();
    resetBrowserManager();
  });

  it('lists and clears real console messages from a browser page', async () => {
    await expect(browser.execute({ action: 'launch', headless: true }))
      .resolves.toMatchObject({ success: true });

    const html = encodeURIComponent(`<!doctype html>
      <title>Console smoke</title>
      <script>
        console.log('Hermes console log');
        console.warn('Hermes console warning');
        console.error('Hermes console error');
        setTimeout(() => { throw new Error('Hermes page boom'); }, 0);
      </script>
    `);

    await expect(browser.execute({
      action: 'navigate',
      url: `data:text/html,${html}`,
      waitUntil: 'load',
    })).resolves.toMatchObject({ success: true });

    await expect(browser.execute({
      action: 'evaluate',
      expression: 'new Promise(resolve => setTimeout(() => resolve("settled"), 50))',
    })).resolves.toMatchObject({ success: true });

    const listed = await consoleTool.execute({ action: 'list', limit: 10 });
    expect(listed.success, listed.error).toBe(true);
    expect(listed.output).toContain('Hermes console log');
    expect(listed.output).toContain('Hermes console warning');
    expect(listed.output).toContain('Hermes console error');
    expect(listed.output).toContain('Hermes page boom');

    const entries = (listed.data as {
      entries?: Array<{ type: string; text: string; url?: string }>;
    }).entries ?? [];
    expect(entries.map(entry => entry.type)).toEqual(expect.arrayContaining(['log', 'warning', 'error', 'pageerror']));
    expect(entries.some(entry => entry.url?.startsWith('data:text/html,'))).toBe(true);

    await expect(consoleTool.execute({ action: 'clear' }))
      .resolves.toMatchObject({ success: true });

    const empty = await consoleTool.execute({ action: 'list' });
    expect(empty.success, empty.error).toBe(true);
    expect(empty.output).toContain('No browser console entries.');
  });
});
