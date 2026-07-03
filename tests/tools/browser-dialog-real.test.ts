import { afterEach, describe, expect, it } from 'vitest';
import { BrowserDialogExecuteTool, BrowserExecuteTool, resetMiscInstances } from '../../src/tools/registry/misc-tools.js';
import { serveTestPages, type TestPageServer } from '../helpers/browser-test-page.js';

async function waitForDialog(tool: BrowserDialogExecuteTool): Promise<Array<{ id: string; message: string; type: string }>> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await tool.execute({ action: 'list' });
    expect(result.success, result.error).toBe(true);
    const dialogs = (result.data as { dialogs?: Array<{ id: string; message: string; type: string }> })?.dialogs ?? [];
    if (dialogs.length > 0) {
      return dialogs;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error('Timed out waiting for a real browser dialog');
}

describe('browser_dialog real Playwright integration', () => {
  const browser = new BrowserExecuteTool();
  const dialog = new BrowserDialogExecuteTool();
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

  it('lists and accepts a native prompt dialog on a real browser page', async () => {
    await expect(browser.execute({ action: 'launch', headless: true }))
      .resolves.toMatchObject({ success: true });

    pages = await serveTestPages('<!doctype html><title>Dialog smoke</title><button>ready</button>');
    await expect(browser.execute({ action: 'navigate', url: pages.url, waitUntil: 'domcontentloaded' }))
      .resolves.toMatchObject({ success: true });

    await expect(browser.execute({
      action: 'evaluate',
      expression: `setTimeout(() => { window.__dialogResult = prompt('Hermes dialog?', 'default text'); }, 0); 'scheduled';`,
    })).resolves.toMatchObject({ success: true });

    const pending = await waitForDialog(dialog);
    expect(pending[0]).toMatchObject({
      type: 'prompt',
      message: 'Hermes dialog?',
    });

    const snapshot = await browser.execute({ action: 'snapshot' });
    expect(snapshot.success, snapshot.error).toBe(true);
    expect(snapshot.output).toContain('Pending Browser Dialogs');
    expect(snapshot.output).toContain('Hermes dialog?');

    const accepted = await dialog.execute({
      action: 'accept',
      dialogId: pending[0]!.id,
      promptText: 'real browser answer',
    });
    expect(accepted.success, accepted.error).toBe(true);
    expect(accepted.output).toContain('Accepted prompt dialog');

    const result = await browser.execute({ action: 'evaluate', expression: 'window.__dialogResult' });
    expect(result.success, result.error).toBe(true);
    expect((result.data as { result?: string }).result).toBe('real browser answer');
  });
});
