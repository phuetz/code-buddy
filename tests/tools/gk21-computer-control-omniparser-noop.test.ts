/**
 * GK21 — computer_control snapshot without OmniParser must be an honest no-op:
 * no fake parse, no hang on localhost:8000, explicit skip in the report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/desktop-automation/index.js', () => ({
  getDesktopAutomation: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
  }),
  getPermissionManager: vi.fn().mockReturnValue({
    check: vi.fn(),
    getInstructions: vi.fn(),
  }),
  getSystemControl: vi.fn().mockReturnValue({
    notify: vi.fn().mockResolvedValue(undefined),
  }),
  getSmartSnapshotManager: vi.fn().mockReturnValue({
    takeSnapshot: vi.fn().mockResolvedValue({
      id: 'snap-gk21',
      timestamp: new Date(),
      elements: [],
      ttl: 5_000,
    }),
    toTextRepresentation: vi.fn().mockReturnValue('# UI Snapshot (snap-gk21)\nElements: 0\n'),
    getElement: vi.fn(),
    getCurrentSnapshot: vi.fn(),
    findElements: vi.fn(),
    toAnnotatedScreenshot: vi.fn(),
  }),
  getScreenRecorder: vi.fn().mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(),
  }),
}));

const { screenshotState, PNG_1PX } = vi.hoisted(() => ({
  screenshotState: { mode: 'fail' as 'fail' | 'ok' },
  PNG_1PX:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
}));

vi.mock('../../src/tools/screenshot-tool.js', () => ({
  ScreenshotTool: class {
    async capture() {
      if (screenshotState.mode === 'fail') {
        return { success: false, error: 'no display (gk21 headless)' };
      }
      return { success: true, data: { path: '/dev/null' } };
    }
    async normalizeForLLM() {
      if (screenshotState.mode === 'fail') throw new Error('no screenshot');
      return { base64: PNG_1PX, contentType: 'image/png' as const, width: 1, height: 1 };
    }
    async toBase64() {
      if (screenshotState.mode === 'fail') return { success: false, error: 'no screenshot' };
      return { success: true, data: { base64: PNG_1PX, mediaType: 'image/png' } };
    }
  },
}));

import { ComputerControlTool } from '../../src/tools/computer-control-tool.js';

describe('GK21 computer_control OmniParser honest no-op', () => {
  let savedUrl: string | undefined;
  let savedDisplay: string | undefined;

  beforeEach(() => {
    savedUrl = process.env.OMNIPARSER_API_URL;
    savedDisplay = process.env.DISPLAY;
    delete process.env.DISPLAY;
    screenshotState.mode = 'fail';
    // Dead loopback port — never the unrelated uvicorn on :8000.
    process.env.OMNIPARSER_API_URL = 'http://127.0.0.1:59991';
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.OMNIPARSER_API_URL;
    else process.env.OMNIPARSER_API_URL = savedUrl;
    if (savedDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = savedDisplay;
  });

  it('does not pretend OmniParser ran when screenshot capture fails', async () => {
    const tool = new ComputerControlTool();
    const result = await tool.execute({
      action: 'snapshot_with_screenshot',
      useOmniParser: true,
    });
    expect(result.success, result.error).toBe(true);
    const data = result.data as {
      screenshot?: string | null;
      omniParser?: string;
    };
    expect(data.screenshot == null || data.screenshot === '').toBe(true);
    expect(result.output).toMatch(/OmniParser/i);
    expect(result.output).toMatch(/no-op|skipped|unavailable/i);
    expect(result.output).not.toMatch(/\[OmniParser Elements\]/);
    expect(data.omniParser).toMatch(/skip|unavail|noop/i);
  });

  it('does not call OmniParser when useOmniParser is omitted', async () => {
    const tool = new ComputerControlTool();
    const result = await tool.execute({ action: 'snapshot_with_screenshot' });
    expect(result.success, result.error).toBe(true);
    const data = result.data as { omniParser?: string; screenshot?: string | null };
    expect(data.screenshot == null || data.screenshot === '').toBe(true);
    expect(data.omniParser === undefined || /skip|not.?requested|off/i.test(String(data.omniParser))).toBe(true);
    expect(result.output ?? '').not.toMatch(/\[OmniParser Elements\]/);
  });

  it('says OmniParser unavailable when a screenshot exists but the server is down', async () => {
    screenshotState.mode = 'ok';
    const tool = new ComputerControlTool();
    const result = await tool.execute({
      action: 'snapshot_with_screenshot',
      useOmniParser: true,
    });
    expect(result.success, result.error).toBe(true);
    const data = result.data as { omniParser?: string; screenshot?: string | null };
    expect(data.screenshot).toBe(PNG_1PX);
    expect(data.omniParser).toBe('unavailable');
    expect(result.output).toMatch(/OmniParser unavailable/i);
    expect(result.output).not.toMatch(/\[OmniParser Elements\]/);
  });
});
