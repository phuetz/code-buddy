import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseKeyCombination, captureScreenshotNative, executeGuiAction, guiControl } from '../../src/tools/gui-tool.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => Buffer.from('fakepng')),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

vi.mock('os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

// ============================================================================
// parseKeyCombination
// ============================================================================

describe('parseKeyCombination', () => {
  it('parses a simple key with no modifiers', () => {
    const result = parseKeyCombination('enter');
    expect(result.key).toBe('enter');
    expect(result.modifiers).toEqual([]);
  });

  it('parses ctrl+c', () => {
    const result = parseKeyCombination('ctrl+c');
    expect(result.modifiers).toContain('ctrl');
    expect(result.key).toBe('c');
  });

  it('parses ctrl+shift+s', () => {
    const result = parseKeyCombination('ctrl+shift+s');
    expect(result.modifiers).toContain('ctrl');
    expect(result.modifiers).toContain('shift');
    expect(result.key).toBe('s');
  });

  it('normalises "control" to "ctrl"', () => {
    const result = parseKeyCombination('control+v');
    expect(result.modifiers).toContain('ctrl');
    expect(result.key).toBe('v');
  });

  it('normalises "cmd" to "meta"', () => {
    const result = parseKeyCombination('cmd+z');
    expect(result.modifiers).toContain('meta');
    expect(result.key).toBe('z');
  });

  it('normalises "win" to "meta"', () => {
    const result = parseKeyCombination('win+d');
    expect(result.modifiers).toContain('meta');
    expect(result.key).toBe('d');
  });

  it('handles single function key', () => {
    const result = parseKeyCombination('f5');
    expect(result.key).toBe('f5');
    expect(result.modifiers).toEqual([]);
  });

  it('is case-insensitive', () => {
    const result = parseKeyCombination('CTRL+C');
    expect(result.modifiers).toContain('ctrl');
    expect(result.key).toBe('c');
  });
});

// ============================================================================
// captureScreenshotNative — platform command selection
// ============================================================================

describe('captureScreenshotNative', () => {
  const originalPlatform = process.platform;

  function setPlatform(p: string) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.restoreAllMocks();
  });

  it('calls powershell on Windows', () => {
    setPlatform('win32');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('png'));

    const result = captureScreenshotNative();
    expect(result).toBeTruthy();
    const calls = vi.mocked(execSync).mock.calls;
    expect(calls.some(([cmd]) => typeof cmd === 'string' && cmd.includes('powershell'))).toBe(true);
  });

  it('calls screencapture on macOS', () => {
    setPlatform('darwin');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('png'));

    const result = captureScreenshotNative();
    expect(result).toBeTruthy();
    const calls = vi.mocked(execSync).mock.calls;
    expect(calls.some(([cmd]) => typeof cmd === 'string' && cmd.includes('screencapture'))).toBe(true);
  });

  it('passes requested crop region to macOS screenshot command', () => {
    setPlatform('darwin');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('png'));

    const result = captureScreenshotNative({ x: 10, y: 20, width: 300, height: 200 });

    expect(result).toBeTruthy();
    const calls = vi.mocked(execSync).mock.calls;
    expect(calls.some(([cmd]) => typeof cmd === 'string' && cmd.includes('-R10,20,300,200'))).toBe(true);
  });

  it('rejects invalid screenshot crop regions', () => {
    setPlatform('darwin');

    expect(() => captureScreenshotNative({ x: 0, y: 0, width: 0, height: 10 }))
      .toThrow('positive width/height');
  });

  it('fails Linux region screenshots when only gnome-screenshot is available', () => {
    setPlatform('linux');
    vi.mocked(execSync).mockImplementation((cmd: Parameters<typeof execSync>[0]) => {
      if (typeof cmd === 'string' && cmd === 'which gnome-screenshot') {
        return Buffer.from('/usr/bin/gnome-screenshot');
      }
      throw new Error('missing command');
    });

    expect(() => captureScreenshotNative({ x: 10, y: 20, width: 30, height: 40 }))
      .toThrow('Region screenshot requires scrot or ImageMagick import');
  });

  it('returns base64 string', () => {
    setPlatform('darwin');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('PNG_DATA'));

    const result = captureScreenshotNative();
    expect(typeof result).toBe('string');
    // base64 of "PNG_DATA"
    expect(result).toBe(Buffer.from('PNG_DATA').toString('base64'));
  });

  it('throws when screenshot file not created', () => {
    setPlatform('darwin');
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => captureScreenshotNative()).toThrow('Screenshot file not created');
  });
});

// ============================================================================
// executeGuiAction
// ============================================================================

describe('executeGuiAction', () => {
  afterEach(() => vi.restoreAllMocks());

  it('screenshot action returns base64 screenshot', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('SCREENBYTES'));

    const result = await executeGuiAction({ action: 'screenshot' });
    expect(result.success).toBe(true);
    expect(result.screenshot).toBeTruthy();
  });

  it('click without coordinates returns error', async () => {
    const result = await executeGuiAction({ action: 'click' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/x and y/);
  });

  it('type without text returns error', async () => {
    const result = await executeGuiAction({ action: 'type' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/text/);
  });

  it('key without keys returns error', async () => {
    const result = await executeGuiAction({ action: 'key' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/keys/);
  });

  it('scroll without coordinates returns error', async () => {
    const result = await executeGuiAction({ action: 'scroll' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/x and y/);
  });

  it('find_element without description returns error', async () => {
    const result = await executeGuiAction({ action: 'find_element' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/description/);
  });

  it('find_element with description returns screenshot', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('FINDPNG'));

    const result = await executeGuiAction({ action: 'find_element', description: 'Submit button' });
    expect(result.success).toBe(true);
    expect(result.screenshot).toBeTruthy();
  });
});

// ============================================================================
// guiControl — ToolResult adapter
// ============================================================================

describe('guiControl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns success with screenshot text in output', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('BYTES'));

    const result = await guiControl({ action: 'screenshot' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('screenshot');
    expect(result.output).toContain('data:image/png;base64,');
  });

  it('returns failure on bad action', async () => {
    const result = await guiControl({ action: 'click' }); // missing x/y
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
