/**
 * GK21 — without DISPLAY/WAYLAND, computer_control must not scrape the
 * session AT-SPI tree (that would peek at the operator desktop).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forceLinuxWithoutDisplay } from '../setup/platform-fixtures.js';
import { ComputerControlTool } from '../../src/tools/computer-control-tool.js';

describe('GK21 computer_control without a display', () => {
  let restorePlatform: () => void;

  beforeEach(() => {
    restorePlatform = forceLinuxWithoutDisplay();
    vi.stubEnv('OMNIPARSER_API_URL', 'http://127.0.0.1:59991');
  });

  afterEach(() => {
    restorePlatform();
    vi.unstubAllEnvs();
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
