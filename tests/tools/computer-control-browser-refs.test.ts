/**
 * Tests for ComputerControlTool browser-sourced ref handling
 *
 * When an element has attributes.source === 'browser-accessibility' with
 * zero coordinates, resolvePoint() should throw a descriptive error
 * telling the LLM to use the browser tool instead.
 */

// Mock desktop-automation
const mockGetElement = jest.fn();
const mockSnapshotManager = {
  getElement: mockGetElement,
  takeSnapshot: jest.fn(),
  getCurrentSnapshot: jest.fn(),
  toTextRepresentation: jest.fn(),
  findElements: jest.fn(),
  toAnnotatedScreenshot: jest.fn(),
};

jest.mock('../../src/desktop-automation/index.js', () => ({
  getDesktopAutomation: jest.fn().mockReturnValue({
    click: jest.fn(),
    doubleClick: jest.fn(),
    rightClick: jest.fn(),
    moveMouse: jest.fn(),
    drag: jest.fn(),
    scroll: jest.fn(),
    type: jest.fn(),
    pressKey: jest.fn(),
    hotkey: jest.fn(),
    getWindows: jest.fn(),
    focusWindow: jest.fn(),
    closeWindow: jest.fn(),
    getScreenSize: jest.fn().mockResolvedValue({ width: 1920, height: 1080 }),
  }),
  getPermissionManager: jest.fn().mockReturnValue({
    check: jest.fn(),
    getInstructions: jest.fn(),
  }),
  getSystemControl: jest.fn().mockReturnValue({
    getVolume: jest.fn(),
    setVolume: jest.fn(),
    getBrightness: jest.fn(),
    setBrightness: jest.fn(),
    notify: jest.fn(),
    lock: jest.fn(),
    sleep: jest.fn(),
    getSystemInfo: jest.fn(),
    getBatteryInfo: jest.fn(),
    getNetworkInfo: jest.fn(),
  }),
  getSmartSnapshotManager: jest.fn().mockReturnValue(mockSnapshotManager),
  getScreenRecorder: jest.fn().mockReturnValue({
    start: jest.fn(),
    stop: jest.fn(),
    getStatus: jest.fn(),
  }),
}));

import { ComputerControlTool } from '../../src/tools/computer-control-tool.js';

describe('ComputerControlTool browser ref handling', () => {
  let tool: ComputerControlTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new ComputerControlTool();
  });

  it('should return descriptive error for browser-sourced element with zero coordinates', async () => {
    mockGetElement.mockReturnValue({
      ref: 42,
      role: 'button',
      name: 'Submit',
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      center: { x: 0, y: 0 },
      interactive: true,
      focused: false,
      enabled: true,
      visible: true,
      attributes: { source: 'browser-accessibility' },
    });

    // The error thrown in resolvePoint() is caught by execute()'s try/catch
    // and returned as { success: false, error: '...' }
    const result = await tool.execute({ action: 'click', ref: 42 } as any);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('browser');
    expect(result.error).toContain('42');
  });

  it('should handle normal desktop elements normally', async () => {
    mockGetElement.mockReturnValue({
      ref: 1,
      role: 'button',
      name: 'OK',
      bounds: { x: 100, y: 200, width: 80, height: 30 },
      center: { x: 140, y: 215 },
      interactive: true,
      focused: false,
      enabled: true,
      visible: true,
    });

    // This would attempt actual click, which is mocked
    const result = await tool.execute({ action: 'click', ref: 1 });

    // Should not throw browser-related error
    if (result.error) {
      expect(result.error).not.toContain('browser element');
    }
  });

  it('should handle browser element with non-zero coordinates normally', async () => {
    // A browser element that has been assigned real viewport coordinates
    // should work fine with computer_control
    mockGetElement.mockReturnValue({
      ref: 10,
      role: 'button',
      name: 'Click Me',
      bounds: { x: 300, y: 400, width: 100, height: 40 },
      center: { x: 350, y: 420 },
      interactive: true,
      focused: false,
      enabled: true,
      visible: true,
      attributes: { source: 'browser-accessibility' },
    });

    const result = await tool.execute({ action: 'click', ref: 10 });

    // Should not throw browser-related error (coordinates are non-zero)
    if (result.error) {
      expect(result.error).not.toContain('browser element');
    }
  });
});
