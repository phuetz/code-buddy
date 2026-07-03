import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

import { BrowserExecuteTool, BrowserSnapshotExecuteTool, resetMiscInstances } from '../../src/tools/registry/misc-tools.js';
import {
  BrowserBackTool,
  BrowserClickTool,
  BrowserNavigateTool,
  BrowserPressTool,
  BrowserScrollTool,
  BrowserTypeTool,
  resetBrowserInstance,
} from '../../src/tools/registry/browser-tools.js';
import { serveTestPages, type TestPageServer } from '../helpers/browser-test-page.js';

function htmlPage(title: string, body: string): string {
  return `<!doctype html><title>${title}</title>${body}`;
}

function refFor(output: string | undefined, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = output?.match(new RegExp(`\\[(\\d+)\\]\\s+${escaped}`));
  const ref = match?.[1] === undefined ? NaN : Number(match[1]);
  expect(Number.isFinite(ref), `Missing browser_snapshot ref for ${label} in:\n${output}`).toBe(true);
  return ref;
}

describe('Hermes browser action wrappers real Playwright integration', () => {
  const browser = new BrowserExecuteTool();
  const navigate = new BrowserNavigateTool();
  const snapshot = new BrowserSnapshotExecuteTool();
  const click = new BrowserClickTool();
  const type = new BrowserTypeTool();
  const press = new BrowserPressTool();
  const scroll = new BrowserScrollTool();
  const back = new BrowserBackTool();
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

  it('navigates, snapshots, types, presses, clicks, scrolls, and goes back in one real browser session', async () => {
    const firstPage = htmlPage('Hermes browser wrappers', `
      <main style="min-height: 2400px">
        <h1>Hermes browser wrappers</h1>
        <input aria-label="Mission name" value="" onkeydown="
          if (event.key === 'Enter') {
            document.getElementById('status').textContent = 'entered:' + this.value;
          }
        ">
        <button onclick="
          document.body.dataset.clicked = 'yes';
          document.getElementById('status').textContent = 'clicked';
        ">Confirm launch</button>
        <p id="status">idle</p>
        <button id="bottom" style="margin-top: 1900px">Bottom marker</button>
      </main>
    `);
    pages = await serveTestPages({
      '/': firstPage,
      '/second': htmlPage('Hermes second page', '<h1>Second page</h1>'),
    });
    const firstUrl = `${pages.url}/`;
    const secondUrl = `${pages.url}/second`;

    await expect(navigate.execute({ url: firstUrl, waitUntil: 'load' }))
      .resolves.toMatchObject({ success: true });

    const snap = await snapshot.execute({ interactiveOnly: false, maxElements: 20 });
    expect(snap.success, snap.error).toBe(true);

    const inputRef = refFor(snap.output, 'Mission name');
    const buttonRef = refFor(snap.output, 'Confirm launch');
    const bottomRef = refFor(snap.output, 'Bottom marker');

    await expect(type.execute({ ref: inputRef, text: 'Code Buddy real path', clear: true }))
      .resolves.toMatchObject({ success: true });
    await expect(press.execute({ key: 'Enter' }))
      .resolves.toMatchObject({ success: true });

    const afterPress = await browser.execute({
      action: 'evaluate',
      expression: 'document.getElementById("status").textContent',
    });
    expect(afterPress).toMatchObject({
      success: true,
      data: { result: 'entered:Code Buddy real path' },
    });

    await expect(click.execute({ ref: buttonRef }))
      .resolves.toMatchObject({ success: true });

    const afterClick = await browser.execute({
      action: 'evaluate',
      expression: '({ status: document.getElementById("status").textContent, clicked: document.body.dataset.clicked })',
    });
    expect(afterClick).toMatchObject({
      success: true,
      data: { result: { status: 'clicked', clicked: 'yes' } },
    });

    await expect(scroll.execute({ toElement: bottomRef }))
      .resolves.toMatchObject({ success: true });

    const afterScroll = await browser.execute({
      action: 'evaluate',
      expression: 'document.getElementById("bottom").getBoundingClientRect().top < window.innerHeight',
    });
    expect(afterScroll).toMatchObject({
      success: true,
      data: { result: true },
    });

    await expect(navigate.execute({ url: secondUrl, waitUntil: 'load' }))
      .resolves.toMatchObject({ success: true });
    await expect(back.execute({}))
      .resolves.toMatchObject({ success: true });

    const afterBack = await browser.execute({
      action: 'evaluate',
      expression: 'document.title',
    });
    expect(afterBack).toMatchObject({
      success: true,
      data: { result: 'Hermes browser wrappers' },
    });
  });
});
