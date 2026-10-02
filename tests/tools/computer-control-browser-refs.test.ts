/**
 * Tests for ComputerControlTool browser-sourced ref handling
 *
 * When an element has attributes.source === 'browser-accessibility' with
 * zero coordinates, resolvePoint() should throw a descriptive error
 * telling the LLM to use the browser tool instead.
 */

import { vi } from 'vitest';

// Hoist mock variables so they are available inside vi.mock() factories
const { mockGetElement, mockSnapshotManager } = vi.hoisted(() => {
  const mockGetElement = vi.fn();
  const mockSnapshotManager = {
    getElement: mockGetElement,
    takeSnapshot: vi.fn(),
    getCurrentSnapshot: vi.fn(),
    toTextRepresentation: vi.fn(),
    findElements: vi.fn(),
    toAnnotatedScreenshot: vi.fn(),
  };
  return { mockGetElement, mockSnapshotManager };
});

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

import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { getDesktopAutomation } from '../../src/desktop-automation/index.js';

import { ComputerControlTool } from '../../src/tools/computer-control-tool.js';

describe('ComputerControlTool browser ref handling', () => {
  let tool: ComputerControlTool;
  const service = ConfirmationService.getInstance();
  const human = vi.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetPermissionModeManager(); service.resetSession();
    human.mockResolvedValue({ confirmed: true }); service.setInteractiveBridge(human);
    tool = new ComputerControlTool();
  });

  afterEach(() => { service.setInteractiveBridge(null); resetPermissionModeManager(); });

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
    const result = await tool.execute({ action: 'click', ref: 42 });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('browser');
    expect(result.error).toContain('42');
    expect(human).toHaveBeenCalledTimes(1); expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
    expect(getDesktopAutomation().click).not.toHaveBeenCalled();
  });

  it('refusal stops before browser ref resolution and never clicks', async () => {
    human.mockResolvedValue({ confirmed: false });
    const result = await tool.execute({ action: 'click', ref: 42 });
    expect(result.success).toBe(false); expect(result.error).toMatch(/human confirmation/);
    expect(mockGetElement).not.toHaveBeenCalled(); expect(getDesktopAutomation().click).not.toHaveBeenCalled();
    expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
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
    expect(result.success).toBe(true);
    expect(getDesktopAutomation().click).toHaveBeenCalledTimes(1);
    // The mandatory gate and the existing observed-target guard both remain active.
    expect(human).toHaveBeenCalledTimes(2);
    expect(human.mock.calls.every(([request]) => request.forcePrompt === true)).toBe(true);
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
    expect(result.success).toBe(true);
    expect(getDesktopAutomation().click).toHaveBeenCalledTimes(1);
    // The mandatory gate and the existing observed-target guard both remain active.
    expect(human).toHaveBeenCalledTimes(2);
    expect(human.mock.calls.every(([request]) => request.forcePrompt === true)).toBe(true);
  });
});
