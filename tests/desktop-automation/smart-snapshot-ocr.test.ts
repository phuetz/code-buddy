/**
 * Smart snapshot OCR detection tests.
 */

import { SmartSnapshotManager } from '../../src/desktop-automation/smart-snapshot.js';

const mockCapture = vi.fn();
const mockExtractText = vi.fn();

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
  exec: vi.fn((_cmd: string, cb: (error: unknown, stdout: string, stderr: string) => void) =>
    cb(null, '', '')
  ),
}));

vi.mock('../../src/tools/screenshot-tool.js', () => {
  class ScreenshotTool {
    capture = mockCapture;
  }
  return { ScreenshotTool };
});

vi.mock('../../src/tools/ocr-tool.js', () => {
  class OCRTool {
    extractText = mockExtractText;
  }
  return { OCRTool };
});

describe('SmartSnapshotManager OCR mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCapture.mockResolvedValue({
      success: true,
      data: { path: '/tmp/fake-screen.png' },
    });
  });

  it('detects OCR blocks as UI elements', async () => {
    mockExtractText.mockResolvedValue({
      success: true,
      data: {
        blocks: [
          {
            text: 'Submit',
            confidence: 95,
            boundingBox: { x: 100, y: 200, width: 120, height: 30 },
          },
          {
            text: 'https://example.com',
            confidence: 90,
            boundingBox: { x: 100, y: 260, width: 200, height: 24 },
          },
        ],
      },
    });

    const manager = new SmartSnapshotManager({ method: 'ocr', defaultTtl: 60_000 });
    const snapshot = await manager.takeSnapshot();

    expect(snapshot.elements.length).toBeGreaterThanOrEqual(2);
    const submit = snapshot.elements.find((e) => e.name === 'Submit');
    const link = snapshot.elements.find((e) => e.name.includes('example.com'));

    expect(submit?.role).toBe('button');
    expect(submit?.interactive).toBe(true);
    expect(link?.role).toBe('link');
    expect(link?.interactive).toBe(true);
  });

  it('falls back to text lines when OCR backend has no boxes', async () => {
    mockExtractText.mockResolvedValue({
      success: true,
      data: {
        text: 'Search\nRemember me\nPlain heading',
      },
    });

    const manager = new SmartSnapshotManager({ method: 'ocr', defaultTtl: 60_000 });
    const snapshot = await manager.takeSnapshot();

    const names = snapshot.elements.map((e) => e.name);
    expect(names).toContain('Search');
    expect(names).toContain('Remember me');
    expect(snapshot.elements.some((e) => e.role === 'button' || e.role === 'text-field')).toBe(true);
    expect(snapshot.elements.some((e) => e.role === 'checkbox')).toBe(true);
  });
});
