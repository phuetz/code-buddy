/**
 * GK21 — without DISPLAY/WAYLAND, computer_control must not scrape the
 * session AT-SPI tree (that would peek at the operator desktop).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ComputerControlTool } from '../../src/tools/computer-control-tool.js';

describe('GK21 computer_control without a display', () => {
  let savedDisplay: string | undefined;
  let savedWayland: string | undefined;
  let savedOmni: string | undefined;

  beforeEach(() => {
    savedDisplay = process.env.DISPLAY;
    savedWayland = process.env.WAYLAND_DISPLAY;
    savedOmni = process.env.OMNIPARSER_API_URL;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    process.env.OMNIPARSER_API_URL = 'http://127.0.0.1:59991';
  });

  afterEach(() => {
    if (savedDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = savedDisplay;
    if (savedWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = savedWayland;
    if (savedOmni === undefined) delete process.env.OMNIPARSER_API_URL;
    else process.env.OMNIPARSER_API_URL = savedOmni;
  });

  it('does not list session windows when DISPLAY is unset', async () => {
    const tool = new ComputerControlTool();
    const result = await tool.execute({ action: 'snapshot_with_screenshot' });
    expect(result.success, result.error).toBe(true);
    expect(result.output ?? '').not.toMatch(/Chromium Web Browser|Brave|Hide Panel/i);
    expect(result.output ?? '').toMatch(/no-op|DISPLAY|no display/i);
    const data = result.data as { elementCount?: number; screenshot?: string | null };
    expect(data.elementCount ?? 0).toBe(0);
    expect(data.screenshot == null || data.screenshot === '').toBe(true);
  }, 30_000);
});
