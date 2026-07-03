/**
 * Session unification proof — browser_launch and browser_action used to
 * drive a SEPARATE legacy BrowserTool instance, so the session they touched
 * was never the one browser_navigate/snapshot/evaluate used. This real
 * round-trip drives one page through all three adapter families and asserts
 * they observe each other's effects.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

import { BrowserExecuteTool, resetMiscInstances } from '../../src/tools/registry/misc-tools.js';
import {
  BrowserActionTool,
  BrowserLaunchTool,
  BrowserNavigateTool,
  resetBrowserInstance,
} from '../../src/tools/registry/browser-tools.js';
import { serveTestPages, type TestPageServer } from '../helpers/browser-test-page.js';

describe('browser adapters share ONE BrowserManager session', () => {
  const launch = new BrowserLaunchTool();
  const navigate = new BrowserNavigateTool();
  const action = new BrowserActionTool();
  const browser = new BrowserExecuteTool();
  let pages: TestPageServer | undefined;

  afterEach(async () => {
    await browser.execute({ action: 'close' }).catch(() => {});
    await pages?.close();
    pages = undefined;
    await resetBrowserInstance().catch(() => {});
    resetMiscInstances();
    const { resetBrowserManager, resetBrowserTool } = await import('../../src/browser-automation/index.js');
    resetBrowserTool();
    resetBrowserManager();
  });

  it('launch → navigate → action click/type/html all hit the same page', async () => {
    pages = await serveTestPages(`<!doctype html>
      <title>Unified session</title>
      <input id="name" value="">
      <button id="go" onclick="document.title = 'clicked:' + document.getElementById('name').value">Go</button>
    `);

    await expect(launch.execute({ headless: true })).resolves.toMatchObject({ success: true });
    await expect(navigate.execute({ url: pages.url, waitUntil: 'load' }))
      .resolves.toMatchObject({ success: true });

    // Selector-based type + click via browser_action…
    await expect(action.execute({ action: 'type', selector: '#name', value: 'Hermes' }))
      .resolves.toMatchObject({ success: true });
    await expect(action.execute({ action: 'click', selector: '#go' }))
      .resolves.toMatchObject({ success: true });

    // …must be visible from the `browser` tool (same session, same page).
    const title = await browser.execute({ action: 'evaluate', expression: 'document.title' });
    expect(title).toMatchObject({ success: true, data: { result: 'clicked:Hermes' } });

    // html goes through the shared session too — it sees the clicked title.
    const html = await action.execute({ action: 'html' });
    expect(html.success, html.error).toBe(true);
    expect(html.output).toContain('clicked:Hermes');

    // A selector that matches nothing fails loudly, not silently.
    const miss = await action.execute({ action: 'click', selector: '#nope' });
    expect(miss.success).toBe(false);
    expect(miss.error).toContain('#nope');
  });
});
