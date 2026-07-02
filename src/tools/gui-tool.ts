/**
 * GUI Control Tool
 *
 * Simplified desktop GUI automation for AI agents.
 * Wraps desktop-automation providers with a minimal interface:
 * screenshot, click, type, scroll, key, find_element.
 *
 * Uses nutjs when available, falls back to platform-native commands
 * (PowerShell/screencapture/ImageMagick) for screenshots.
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { getPermissionModeManager } from '../security/permission-modes.js';
import type { ToolResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface GuiToolInput {
  action: 'screenshot' | 'click' | 'type' | 'scroll' | 'key' | 'find_element';
  /** Crop region for screenshot */
  region?: { x: number; y: number; width: number; height: number };
  /** X coordinate for click/scroll */
  x?: number;
  /** Y coordinate for click/scroll */
  y?: number;
  /** Mouse button for click */
  button?: 'left' | 'right' | 'middle';
  /** Double-click flag */
  doubleClick?: boolean;
  /** Text to type */
  text?: string;
  /** Scroll direction */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Scroll amount (lines/clicks) */
  amount?: number;
  /** Key combination, e.g. "ctrl+c", "enter", "tab" */
  keys?: string;
  /** Natural-language description of element to find */
  description?: string;
}

export interface GuiToolResult {
  success: boolean;
  /** Base64-encoded PNG screenshot */
  screenshot?: string;
  /** Resolved element center for find_element */
  elementFound?: { x: number; y: number; confidence: number };
  error?: string;
}

// ============================================================================
// Key-combo parser
// ============================================================================

/**
 * Parse a human-readable key combo like "ctrl+shift+s" into parts.
 * Returns { modifiers, key } where each is a lowercase string.
 */
export function parseKeyCombination(keys: string): { modifiers: string[]; key: string } {
  const parts = keys.toLowerCase().split('+').map((p) => p.trim());
  const modifierSet = new Set(['ctrl', 'control', 'alt', 'shift', 'meta', 'cmd', 'super', 'win']);
  const modifiers: string[] = [];
  let key = '';
  for (const part of parts) {
    if (modifierSet.has(part)) {
      let normalised = part;
      if (part === 'control') normalised = 'ctrl';
      else if (part === 'cmd' || part === 'super' || part === 'win') normalised = 'meta';
      modifiers.push(normalised);
    } else {
      key = part;
    }
  }
  return { modifiers, key };
}

/**
 * Validate a mouse coordinate / count is a finite, non-negative integer before
 * it is handed to a subprocess. The model supplies x/y/amount, so a NaN, a
 * negative, or a non-number must never reach the OS automation layer.
 */
function assertScreenInteger(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${label}: expected a non-negative finite number, got ${String(value)}`);
  }
  return Math.round(value);
}

/** GUI actions that drive real OS input (must be gated). */
const MUTATING_GUI_ACTIONS = new Set(['click', 'type', 'scroll', 'key']);

/**
 * Honour the active permission mode for GUI mutation. gui_control is not a
 * read-only tool, so a read-only posture (e.g. `plan` mode) must block it — the
 * same gate computer_control lives behind. Returns an error string when denied,
 * or null when allowed. This closes S4: previously gui_control was a second,
 * ungated input path that bypassed computer_control's danger classification.
 */
function guiPermissionError(action: string): string | null {
  const decision = getPermissionModeManager().checkPermission(action, 'gui_control');
  return decision.allowed ? null : `gui_control blocked: ${decision.reason}`;
}

/**
 * System-level key combinations that switch the active virtual terminal, kill
 * the X server, or trigger a secure-attention sequence. A prompt-injected agent
 * could otherwise boot the user out of their session, so these are refused
 * unless the operator explicitly opts in via CODEBUDDY_GUI_ALLOW_SYSTEM_KEYS.
 */
function isSystemKeyCombo(modifiers: string[], key: string): boolean {
  if (modifiers.includes('ctrl') && modifiers.includes('alt')) {
    if (/^f([1-9]|1[0-2])$/.test(key)) return true; // ctrl+alt+F1..F12 → VT switch
    if (key === 'delete' || key === 'backspace') return true; // ctrl+alt+del / X-server kill
  }
  return false;
}

// ============================================================================
// Platform screenshot helpers
// ============================================================================

function tmpScreenshotPath(): string {
  return join(tmpdir(), `codebuddy_gui_${Date.now()}.png`);
}

/**
 * Capture full-screen screenshot via platform-native command.
 * Returns base64-encoded PNG string or throws.
 * Synchronous — wraps execSync for simplicity.
 */
export function captureScreenshotNative(region?: GuiToolInput['region']): string {
  const outPath = tmpScreenshotPath();

  try {
    if (process.platform === 'win32') {
      // PowerShell screen capture via .NET System.Drawing
      const escapedPath = outPath.replace(/\\/g, '\\\\');
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '$primary = [System.Windows.Forms.Screen]::PrimaryScreen',
        '$w = $primary.Bounds.Width',
        '$h = $primary.Bounds.Height',
        '$bmp = New-Object System.Drawing.Bitmap($w, $h)',
        '$g = [System.Drawing.Graphics]::FromImage($bmp)',
        '$g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)',
        `$bmp.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
        '$g.Dispose()',
        '$bmp.Dispose()',
      ].join('; ');
      execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, { timeout: 15000 });
    } else if (process.platform === 'darwin') {
      execFileSync('screencapture', ['-x', outPath], { timeout: 10000 });
    } else {
      // Linux: try scrot, then import (ImageMagick), then gnome-screenshot
      const hasScrot = ((): boolean => {
        try { execFileSync('which', ['scrot'], { stdio: 'ignore' }); return true; } catch { return false; }
      })();
      const hasImport = ((): boolean => {
        try { execFileSync('which', ['import'], { stdio: 'ignore' }); return true; } catch { return false; }
      })();
      if (hasScrot) {
        execFileSync('scrot', [outPath], { timeout: 10000 });
      } else if (hasImport) {
        execFileSync('import', ['-window', 'root', outPath], { timeout: 10000 });
      } else {
        execFileSync('gnome-screenshot', ['-f', outPath], { timeout: 10000 });
      }
    }

    if (!existsSync(outPath)) {
      throw new Error('Screenshot file not created');
    }

    const data = readFileSync(outPath);

    // Region crop is a no-op in the sync path when sharp is unavailable.
    // Async callers can crop after decoding the base64 if needed.
    void region; // accepted but not processed in sync path

    return data.toString('base64');
  } finally {
    try { if (existsSync(outPath)) unlinkSync(outPath); } catch { /* ignore cleanup errors */ }
  }
}

// ============================================================================
// Automation helpers via nutjs (lazy-loaded)
// ============================================================================

async function getNutjs(): Promise<typeof import('@nut-tree-fork/nut-js') | null> {
  try {
    const mod = await import('@nut-tree-fork/nut-js');
    return mod;
  } catch {
    return null;
  }
}

async function performClick(x: number, y: number, button: 'left' | 'right' | 'middle', doubleClick: boolean): Promise<void> {
  const nut = await getNutjs();
  if (!nut) {
    if (process.platform === 'linux') {
      const sx = assertScreenInteger(x, 'x');
      const sy = assertScreenInteger(y, 'y');
      const btn = button === 'right' ? '3' : button === 'middle' ? '2' : '1';
      // execFileSync (no shell) — model-controlled coords are validated integers
      // above and passed as discrete argv entries, so no shell metacharacter can
      // reach a subprocess.
      const args = ['mousemove', String(sx), String(sy), 'click'];
      if (doubleClick) args.push('--repeat', '2', '--delay', '100');
      args.push(btn);
      execFileSync('xdotool', args, { timeout: 5000 });
    } else {
      throw new Error('nutjs not available and no fallback for click on this platform');
    }
    return;
  }
  const { mouse, Button, straightTo, Point } = nut;
  await mouse.move(straightTo(new Point(x, y)));
  const btn = button === 'right' ? Button.RIGHT : button === 'middle' ? Button.MIDDLE : Button.LEFT;
  if (doubleClick) {
    await mouse.doubleClick(btn);
  } else {
    await mouse.click(btn);
  }
}

async function performType(text: string): Promise<void> {
  const nut = await getNutjs();
  if (!nut) {
    if (process.platform === 'linux') {
      // execFileSync (no shell): `text` is a single argv entry after the `--`
      // terminator, so a payload like `$(rm -rf ~)` is typed literally, never
      // evaluated by a shell.
      execFileSync('xdotool', ['type', '--clearmodifiers', '--', text], { timeout: 10000 });
    } else {
      throw new Error('nutjs not available for type action');
    }
    return;
  }
  await nut.keyboard.type(text);
}

async function performKey(keys: string): Promise<void> {
  const nut = await getNutjs();
  const { modifiers, key } = parseKeyCombination(keys);

  if (!nut) {
    if (process.platform === 'linux') {
      // execFileSync (no shell): `combo` (e.g. "ctrl+c") is a single argv entry
      // to `xdotool key`; an invalid keysym is rejected by xdotool, and no shell
      // metacharacter (`;`, `|`, `$(…)`) is ever interpreted.
      const combo = [...modifiers, key].join('+');
      execFileSync('xdotool', ['key', combo], { timeout: 5000 });
    } else if (process.platform === 'darwin') {
      const modMap: Record<string, string> = { ctrl: 'control', meta: 'command', alt: 'option', shift: 'shift' };
      const osModifiers = modifiers.map((m) => modMap[m] ?? m);
      const modStr = osModifiers.length > 0 ? `using {${osModifiers.map((m) => `${m} down`).join(', ')}}` : '';
      // execFileSync passes the whole AppleScript as one `-e` arg (no shell), and
      // `key` is escaped for the AppleScript string literal so a payload can't
      // break out of the "keystroke" quotes into arbitrary AppleScript.
      const escapedKey = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `tell application "System Events" to keystroke "${escapedKey}" ${modStr}`;
      execFileSync('osascript', ['-e', script], { timeout: 5000 });
    } else {
      throw new Error('nutjs not available for key action');
    }
    return;
  }

  const { keyboard, Key } = nut;

  // Map modifier names to nut Key enum values
  const modKeyMap: Record<string, unknown> = {
    ctrl: Key.LeftControl,
    alt: Key.LeftAlt,
    shift: Key.LeftShift,
    meta: Key.LeftSuper,
  };
  // Map common key names to nut Key enum
  const keyNameMap: Record<string, unknown> = {
    enter: Key.Return,
    return: Key.Return,
    tab: Key.Tab,
    escape: Key.Escape,
    esc: Key.Escape,
    space: Key.Space,
    backspace: Key.Backspace,
    delete: Key.Delete,
    up: Key.Up,
    down: Key.Down,
    left: Key.Left,
    right: Key.Right,
    home: Key.Home,
    end: Key.End,
    pageup: Key.PageUp,
    pagedown: Key.PageDown,
    f1: Key.F1, f2: Key.F2, f3: Key.F3, f4: Key.F4,
    f5: Key.F5, f6: Key.F6, f7: Key.F7, f8: Key.F8,
    f9: Key.F9, f10: Key.F10, f11: Key.F11, f12: Key.F12,
  };

  const nutKey = keyNameMap[key] ?? (Key as Record<string, unknown>)[key.toUpperCase()];
  if (!nutKey) throw new Error(`Unknown key: "${key}"`);

  const modKeys = modifiers.map((m) => modKeyMap[m]).filter(Boolean);
  const sequence = [...modKeys, nutKey] as unknown[];

  // pressKey / releaseKey accept spread of Key enum values
  await (keyboard.pressKey as unknown as (...args: unknown[]) => Promise<void>)(...sequence);
  await (keyboard.releaseKey as unknown as (...args: unknown[]) => Promise<void>)(...sequence.slice().reverse());
}

async function performScroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void> {
  const nut = await getNutjs();
  if (!nut) {
    if (process.platform === 'linux') {
      const sx = assertScreenInteger(x, 'x');
      const sy = assertScreenInteger(y, 'y');
      const sAmount = assertScreenInteger(amount, 'amount');
      // xdotool buttons: 4=up, 5=down, 6=left, 7=right
      const btnMap: Record<string, number> = { up: 4, down: 5, left: 6, right: 7 };
      const btn = btnMap[direction];
      if (btn === undefined) throw new Error(`Invalid scroll direction: ${direction}`);
      // execFileSync (no shell): all args are validated integers / a fixed button.
      execFileSync('xdotool', ['mousemove', String(sx), String(sy), 'click', '--repeat', String(sAmount), String(btn)], { timeout: 5000 });
    } else {
      throw new Error('nutjs not available for scroll action');
    }
    return;
  }
  const { mouse, straightTo, Point } = nut;
  await mouse.move(straightTo(new Point(x, y)));
  if (direction === 'up') {
    await mouse.scrollUp(amount);
  } else if (direction === 'down') {
    await mouse.scrollDown(amount);
  } else if (direction === 'left') {
    await mouse.scrollLeft(amount);
  } else {
    await mouse.scrollRight(amount);
  }
}

// ============================================================================
// Main executor
// ============================================================================

/**
 * Execute a GUI automation action.
 */
export async function executeGuiAction(input: GuiToolInput): Promise<GuiToolResult> {
  try {
    // S4 — mutating GUI actions must respect the active permission mode (a
    // read-only posture blocks them); screenshot/find_element are read-only.
    if (MUTATING_GUI_ACTIONS.has(input.action)) {
      const permErr = guiPermissionError(input.action);
      if (permErr) return { success: false, error: permErr };
    }

    switch (input.action) {
      case 'screenshot': {
        const b64 = captureScreenshotNative(input.region);
        return { success: true, screenshot: b64 };
      }

      case 'click': {
        if (input.x === undefined || input.y === undefined) {
          return { success: false, error: 'click requires x and y coordinates' };
        }
        await performClick(
          input.x,
          input.y,
          input.button ?? 'left',
          input.doubleClick ?? false,
        );
        return { success: true };
      }

      case 'type': {
        if (!input.text) {
          return { success: false, error: 'type requires text' };
        }
        await performType(input.text);
        return { success: true };
      }

      case 'key': {
        if (!input.keys) {
          return { success: false, error: 'key requires keys (e.g. "ctrl+c")' };
        }
        const { modifiers, key } = parseKeyCombination(input.keys);
        if (isSystemKeyCombo(modifiers, key) && process.env.CODEBUDDY_GUI_ALLOW_SYSTEM_KEYS !== 'true') {
          return {
            success: false,
            error: `gui_control blocked: system key combo "${input.keys}" can switch VT / kill the display (set CODEBUDDY_GUI_ALLOW_SYSTEM_KEYS=true to allow)`,
          };
        }
        await performKey(input.keys);
        return { success: true };
      }

      case 'scroll': {
        if (input.x === undefined || input.y === undefined) {
          return { success: false, error: 'scroll requires x and y coordinates' };
        }
        await performScroll(
          input.x,
          input.y,
          input.direction ?? 'down',
          input.amount ?? 3,
        );
        return { success: true };
      }

      case 'find_element': {
        if (!input.description) {
          return { success: false, error: 'find_element requires description' };
        }
        // Capture screenshot and return it — the LLM uses vision to locate the element
        const b64 = captureScreenshotNative();
        return { success: true, screenshot: b64 };
      }

      default:
        return { success: false, error: `Unknown action: ${(input as GuiToolInput).action}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('gui_control action failed', { action: input.action, error: msg });
    return { success: false, error: msg };
  }
}

// ============================================================================
// Tool result adapter
// ============================================================================

/**
 * Entry point called by the tool registry adapter.
 */
export async function guiControl(input: Record<string, unknown>): Promise<ToolResult> {
  const typedInput = input as unknown as GuiToolInput;
  const result = await executeGuiAction(typedInput);

  if (!result.success) {
    return { success: false, error: result.error ?? 'GUI action failed' };
  }

  const parts: string[] = [`Action '${typedInput.action}' completed.`];

  if (result.screenshot) {
    parts.push(`Screenshot captured (base64 PNG, ${result.screenshot.length} chars).`);
    parts.push(`data:image/png;base64,${result.screenshot}`);
  }

  if (result.elementFound) {
    parts.push(
      `Element found at (${result.elementFound.x}, ${result.elementFound.y}) ` +
      `confidence=${result.elementFound.confidence.toFixed(2)}.`,
    );
  }

  return { success: true, output: parts.join('\n') };
}
