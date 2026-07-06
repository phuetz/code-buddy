/**
 * Windows Native Desktop Automation Provider
 *
 * Uses a persistent C# background daemon (CodeBuddyDesktopBridge.exe)
 * for native Windows desktop automation, falling back to PowerShell scripts.
 * Supports WSL2 interop.
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { BaseNativeProvider } from './base-native-provider.js';
import { logger } from '../utils/logger.js';
import type {
  ProviderCapabilities,
  MousePosition,
  MouseMoveOptions,
  MouseClickOptions,
  MouseDragOptions,
  MouseScrollOptions,
  MouseButton,
  KeyCode,
  KeyPressOptions,
  TypeOptions,
  HotkeySequence,
  WindowInfo,
  WindowSearchOptions,
  WindowSetOptions,
  AppInfo,
  AppLaunchOptions,
  ScreenInfo,
  ColorInfo,
  ClipboardContent,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Virtual key code mapping
const VK_CODES: Record<string, number> = {
  'return': 0x0D,
  'enter': 0x0D,
  'escape': 0x1B,
  'esc': 0x1B,
  'tab': 0x09,
  'backspace': 0x08,
  'delete': 0x2E,
  'space': 0x20,
  'up': 0x26,
  'down': 0x28,
  'left': 0x25,
  'right': 0x27,
  'control': 0x11,
  'ctrl': 0x11,
  'alt': 0x12,
  'menu': 0x12,
  'shift': 0x10,
  'win': 0x5B,
  'meta': 0x5B,
  'command': 0x5B,
  'home': 0x24,
  'end': 0x23,
  'pageup': 0x21,
  'pagedown': 0x22,
  'insert': 0x2D,
  'printscreen': 0x2C,
  'capslock': 0x14,
  'numlock': 0x90,
  'scrolllock': 0x91,
  'pause': 0x13,
  'f1': 0x70,
  'f2': 0x71,
  'f3': 0x72,
  'f4': 0x73,
  'f5': 0x74,
  'f6': 0x75,
  'f7': 0x76,
  'f8': 0x77,
  'f9': 0x78,
  'f10': 0x79,
  'f11': 0x7A,
  'f12': 0x7B,
};

// Populate a-z
for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(97 + i); // 'a' to 'z'
  VK_CODES[letter] = 0x41 + i;
}

// Populate 0-9
for (let i = 0; i <= 9; i++) {
  VK_CODES[String(i)] = 0x30 + i;
}

// Modifier keys to VK codes
const MODIFIER_VK: Record<string, number> = {
  'ctrl': 0x11,
  'control': 0x11,
  'alt': 0x12,
  'shift': 0x10,
  'meta': 0x5B,
  'command': 0x5B,
  'win': 0x5B,
};

// Mouse event flags
const MOUSEEVENTF_LEFTDOWN = 0x2;
const MOUSEEVENTF_LEFTUP = 0x4;
const MOUSEEVENTF_RIGHTDOWN = 0x8;
const MOUSEEVENTF_RIGHTUP = 0x10;
const MOUSEEVENTF_MIDDLEDOWN = 0x20;
const MOUSEEVENTF_MIDDLEUP = 0x40;
const MOUSEEVENTF_WHEEL = 0x800;
const MOUSEEVENTF_HWHEEL = 0x1000;

// Keyboard event flags
const KEYEVENTF_KEYUP = 0x2;

export class WindowsNativeProvider extends BaseNativeProvider {
  readonly platformName = 'Windows';
  readonly capabilities: ProviderCapabilities = {
    mouse: true,
    keyboard: true,
    windows: true,
    apps: true,
    screenshots: true,
    colorPicker: true,
    clipboard: true,
    ocr: false,
  };

  private readonly psCmd: string;
  private readonly wsl: boolean;
  private daemonProcess: ChildProcess | null = null;
  private daemonInterface: readline.Interface | null = null;
  private daemonQueue: Promise<any> = Promise.resolve();

  private readonly P_INVOKE_BLOCK = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@`;

  constructor(options?: { wsl?: boolean }) {
    super();
    this.wsl = options?.wsl ?? false;
    this.psCmd = this.wsl ? 'powershell.exe' : 'powershell';
  }

  // ---------------------------------------------------------------------------
  // Environment Check
  // ---------------------------------------------------------------------------

  private isTestMode(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true' || !!process.env.JEST_WORKER_ID;
  }

  // ---------------------------------------------------------------------------
  // Persistent Daemon / Execution
  // ---------------------------------------------------------------------------

  private getWindowsPath(posixPath: string): string {
    if (!this.wsl) return posixPath;
    try {
      return execSync(`wslpath -w "${posixPath}"`, { encoding: 'utf8' }).trim();
    } catch {
      return posixPath;
    }
  }

  private compileBridge(): void {
    if (this.isTestMode()) return;

    const srcPath = path.join(__dirname, 'CodeBuddyDesktopBridge.cs');
    const exePath = path.join(__dirname, 'CodeBuddyDesktopBridge.exe');

    let needsCompile = false;
    try {
      if (!fs.existsSync(exePath)) {
        needsCompile = true;
      } else {
        const srcStat = fs.statSync(srcPath);
        const exeStat = fs.statSync(exePath);
        if (srcStat.mtime > exeStat.mtime) {
          needsCompile = true;
        }
      }
    } catch {
      needsCompile = true;
    }

    if (needsCompile) {
      logger.info('Compiling CodeBuddyDesktopBridge...');
      const cscPath = this.wsl
        ? '/mnt/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe'
        : 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

      const winSrcPath = this.getWindowsPath(srcPath);
      const winExePath = this.getWindowsPath(exePath);

      const cmd = `"${cscPath}" /r:"System.dll" /r:"System.Drawing.dll" /r:"System.Windows.Forms.dll" /r:"System.Web.Extensions.dll" /r:"C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\UIAutomationClient.dll" /r:"C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\UIAutomationTypes.dll" /r:"C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\WindowsBase.dll" /out:"${winExePath}" "${winSrcPath}"`;
      try {
        execSync(cmd, { stdio: 'ignore' });
        logger.info('CodeBuddyDesktopBridge compiled successfully.');
      } catch (err) {
        logger.warn('Failed to compile CodeBuddyDesktopBridge, falling back to legacy PowerShell:', { error: err });
      }
    }
  }

  private spawnDaemon(): void {
    if (this.isTestMode()) return;

    const exePath = path.join(__dirname, 'CodeBuddyDesktopBridge.exe');
    if (!fs.existsSync(exePath)) {
      logger.warn('CodeBuddyDesktopBridge.exe not found, using legacy PowerShell execution.');
      return;
    }

    try {
      const execName = this.wsl ? 'powershell.exe' : exePath;
      const args = this.wsl
        ? ['-NoProfile', '-NonInteractive', '-Command', `& "${this.getWindowsPath(exePath)}"`]
        : [];

      this.daemonProcess = spawn(execName, args, {
        stdio: ['pipe', 'pipe', 'ignore'],
      });

      this.daemonInterface = readline.createInterface({
        input: this.daemonProcess.stdout!,
        output: this.daemonProcess.stdin!,
      });

      this.daemonProcess.on('error', (err) => {
        logger.error('CodeBuddyDesktopBridge daemon process error:', { error: err });
        this.daemonProcess = null;
      });

      this.daemonProcess.on('exit', (code) => {
        logger.warn(`CodeBuddyDesktopBridge daemon process exited with code ${code}`);
        this.daemonProcess = null;
      });
    } catch (err) {
      logger.error('Failed to spawn CodeBuddyDesktopBridge daemon:', { error: err });
      this.daemonProcess = null;
    }
  }

  private writeToDaemon(action: string, args: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.daemonProcess || !this.daemonInterface) {
        return reject(new Error('Daemon not running'));
      }

      const timeout = setTimeout(() => {
        this.daemonInterface?.removeAllListeners('line');
        reject(new Error(`Daemon request timed out: ${action}`));
      }, 10000);

      this.daemonInterface.once('line', (line) => {
        clearTimeout(timeout);
        try {
          const res = JSON.parse(line);
          if (res.success) {
            resolve(res);
          } else {
            reject(new Error(res.error || 'Unknown daemon error'));
          }
        } catch (_err) {
          reject(new Error(`Failed to parse daemon response: ${line}`));
        }
      });

      this.daemonProcess.stdin!.write(JSON.stringify({ action, ...args }) + '\n');
    });
  }

  private async executeAction(action: string, args: Record<string, any> = {}): Promise<any> {
    if (this.isTestMode() || !this.daemonProcess) {
      return this.fallbackPs(action, args);
    }

    return new Promise((resolve, reject) => {
      this.daemonQueue = this.daemonQueue.then(async () => {
        try {
          const res = await this.writeToDaemon(action, args);
          resolve(res);
        } catch (err) {
          logger.warn(`Daemon action ${action} failed, trying PowerShell fallback:`, { error: err });
          try {
            const res = await this.fallbackPs(action, args);
            resolve(res);
          } catch (fallbackErr) {
            reject(fallbackErr);
          }
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // PowerShell execution helper (for fallback/test mode)
  // ---------------------------------------------------------------------------

  private async ps(script: string): Promise<string> {
    const preparedScript = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; ${script}`;
    const encodedScript = Buffer.from(preparedScript, 'utf16le').toString('base64');
    return this.exec(
      `${this.psCmd} -NoProfile -NonInteractive -EncodedCommand ${encodedScript}`,
      15000
    );
  }

  private validateNumber(value: number, name: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid ${name}: must be a finite number`);
    }
  }

  private escapePsSingleQuote(s: string): string {
    return s.replace(/'/g, "''");
  }

  private getMouseFlags(button: MouseButton = 'left'): { down: number; up: number } {
    switch (button) {
      case 'right':
        return { down: MOUSEEVENTF_RIGHTDOWN, up: MOUSEEVENTF_RIGHTUP };
      case 'middle':
        return { down: MOUSEEVENTF_MIDDLEDOWN, up: MOUSEEVENTF_MIDDLEUP };
      case 'left':
      default:
        return { down: MOUSEEVENTF_LEFTDOWN, up: MOUSEEVENTF_LEFTUP };
    }
  }

  private resolveVK(key: KeyCode): number {
    const normalized = key.toLowerCase();
    const vk = VK_CODES[normalized];
    if (vk === undefined) {
      if (key.length === 1) {
        return key.toUpperCase().charCodeAt(0);
      }
      throw new Error(`Unknown key: ${key}`);
    }
    return vk;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    try {
      this.compileBridge();
      this.spawnDaemon();
      await this.ps('Write-Output ok');
      this.initialized = true;
    } catch (err) {
      throw new Error(
        `Failed to initialize Windows native provider: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.exec(`${this.psCmd} -NoProfile -NonInteractive -Command "Write-Output ok"`, 5000);
      return true;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    if (this.daemonProcess) {
      try {
        this.daemonProcess.stdin?.end();
        this.daemonProcess.kill();
      } catch {
        // ignore
      }
      this.daemonProcess = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Mouse
  // ---------------------------------------------------------------------------

  async getMousePosition(): Promise<MousePosition> {
    this.ensureInitialized();
    const result = await this.executeAction('get_mouse_position');
    return { x: result.x, y: result.y };
  }

  async moveMouse(x: number, y: number, _options?: MouseMoveOptions): Promise<void> {
    this.ensureInitialized();
    this.validateNumber(x, 'x');
    this.validateNumber(y, 'y');
    await this.executeAction('move_mouse', { x: Math.round(x), y: Math.round(y) });
  }

  async click(options?: MouseClickOptions): Promise<void> {
    this.ensureInitialized();
    const button = options?.button ?? 'left';
    const clicks = options?.clicks ?? 1;
    const delay = options?.delay ?? 50;
    await this.executeAction('click', { button, clicks, delay });
  }

  async doubleClick(button?: MouseButton): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('double_click', { button: button ?? 'left' });
  }

  async rightClick(): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('right_click');
  }

  async drag(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: MouseDragOptions
  ): Promise<void> {
    this.ensureInitialized();
    this.validateNumber(fromX, 'fromX');
    this.validateNumber(fromY, 'fromY');
    this.validateNumber(toX, 'toX');
    this.validateNumber(toY, 'toY');

    const button = options?.button ?? 'left';
    const duration = options?.duration ?? 300;
    await this.executeAction('drag', { fromX, fromY, toX, toY, button, duration });
  }

  async scroll(options: MouseScrollOptions): Promise<void> {
    this.ensureInitialized();
    const deltaY = options.deltaY ?? 0;
    const deltaX = options.deltaX ?? 0;
    await this.executeAction('scroll', { deltaY, deltaX });
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  async keyPress(key: KeyCode, options?: KeyPressOptions): Promise<void> {
    this.ensureInitialized();
    const vk = this.resolveVK(key);
    const modifiers = options?.modifiers ?? [];
    const delay = options?.delay ?? 0;
    await this.executeAction('key_press', { vk, modifiers, delay });
  }

  async keyDown(key: KeyCode): Promise<void> {
    this.ensureInitialized();
    const vk = this.resolveVK(key);
    await this.executeAction('key_down', { vk });
  }

  async keyUp(key: KeyCode): Promise<void> {
    this.ensureInitialized();
    const vk = this.resolveVK(key);
    await this.executeAction('key_up', { vk });
  }

  async type(text: string, _options?: TypeOptions): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('type', { text });
  }

  async hotkey(sequence: HotkeySequence): Promise<void> {
    this.ensureInitialized();
    const modifiers = sequence.modifiers ?? [];
    const keys = sequence.keys.map(k => String(this.resolveVK(k)));
    await this.executeAction('hotkey', { keys, modifiers });
  }

  // ---------------------------------------------------------------------------
  // Windows
  // ---------------------------------------------------------------------------

  async getActiveWindow(): Promise<WindowInfo | null> {
    this.ensureInitialized();
    const res = await this.executeAction('get_active_window');
    return res.window;
  }

  async getWindows(options?: WindowSearchOptions): Promise<WindowInfo[]> {
    this.ensureInitialized();
    const res = await this.executeAction('get_windows');
    const windows: WindowInfo[] = res.windows || [];

    if (options) {
      return windows.filter(w => {
        if (options.title) {
          const titleMatch = options.title instanceof RegExp
            ? options.title.test(w.title)
            : w.title.includes(options.title);
          if (!titleMatch) return false;
        }
        if (options.processName && w.processName !== options.processName) return false;
        if (options.pid && w.pid !== options.pid) return false;
        return true;
      });
    }
    return windows;
  }

  async getWindow(handle: string): Promise<WindowInfo | null> {
    this.ensureInitialized();
    const res = await this.executeAction('get_window', { handle });
    return res.window;
  }

  async focusWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('focus_window', { handle });
  }

  async minimizeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('minimize_window', { handle });
  }

  async maximizeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('maximize_window', { handle });
  }

  async restoreWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('restore_window', { handle });
  }

  async closeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('close_window', { handle });
  }

  async setWindow(handle: string, options: WindowSetOptions): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('set_window', { handle, ...options });
  }

  // ---------------------------------------------------------------------------
  // Applications
  // ---------------------------------------------------------------------------

  async getRunningApps(): Promise<AppInfo[]> {
    this.ensureInitialized();
    const res = await this.executeAction('get_running_apps');
    return res.apps || [];
  }

  async launchApp(appPath: string, options?: AppLaunchOptions): Promise<AppInfo> {
    this.ensureInitialized();
    const res = await this.executeAction('launch_app', { path: appPath, ...options });
    return res.app;
  }

  async closeApp(pid: number): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('close_app', { pid });
  }

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  async getScreens(): Promise<ScreenInfo[]> {
    this.ensureInitialized();
    const res = await this.executeAction('get_screens');
    return res.screens || [];
  }

  async getPixelColor(x: number, y: number): Promise<ColorInfo> {
    this.ensureInitialized();
    this.validateNumber(x, 'x');
    this.validateNumber(y, 'y');
    const res = await this.executeAction('get_pixel_color', { x, y });
    return { r: res.r, g: res.g, b: res.b, a: res.a, hex: res.hex };
  }

  // ---------------------------------------------------------------------------
  // Clipboard
  // ---------------------------------------------------------------------------

  async getClipboard(): Promise<ClipboardContent> {
    this.ensureInitialized();
    const res = await this.executeAction('get_clipboard');
    return {
      text: res.text || undefined,
      formats: res.formats || [],
    };
  }

  async setClipboard(content: Partial<ClipboardContent>): Promise<void> {
    this.ensureInitialized();
    if (content.text !== undefined) {
      await this.executeAction('set_clipboard', { text: content.text });
    }
  }

  async clearClipboard(): Promise<void> {
    this.ensureInitialized();
    await this.executeAction('clear_clipboard');
  }

  // ---------------------------------------------------------------------------
  // Legacy PowerShell Failback Logic
  // ---------------------------------------------------------------------------

  private async fallbackPs(action: string, args: Record<string, any>): Promise<any> {
    switch (action) {
      case 'get_mouse_position': {
        const result = await this.ps(
          `${this.P_INVOKE_BLOCK}; $p = New-Object NativeInput+POINT; [NativeInput]::GetCursorPos([ref]$p) | Out-Null; Write-Output "$($p.X),$($p.Y)"`
        );
        const parts = result.trim().split(',');
        return {
          x: parseInt(parts[0] ?? '', 10),
          y: parseInt(parts[1] ?? '', 10),
        };
      }
      case 'move_mouse': {
        const { x, y } = args;
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})`
        );
        break;
      }
      case 'click': {
        const { button, clicks, delay } = args;
        const flags = this.getMouseFlags(button);
        for (let i = 0; i < clicks; i++) {
          if (i > 0) await this.delay(delay);
          await this.ps(
            `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.down}, 0, 0, 0, [IntPtr]::Zero); [NativeInput]::mouse_event(${flags.up}, 0, 0, 0, [IntPtr]::Zero)`
          );
        }
        break;
      }
      case 'double_click': {
        const { button } = args;
        const flags = this.getMouseFlags(button);
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.down}, 0, 0, 0, [IntPtr]::Zero); [NativeInput]::mouse_event(${flags.up}, 0, 0, 0, [IntPtr]::Zero)`
        );
        await this.delay(50);
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.down}, 0, 0, 0, [IntPtr]::Zero); [NativeInput]::mouse_event(${flags.up}, 0, 0, 0, [IntPtr]::Zero)`
        );
        break;
      }
      case 'right_click': {
        const flags = this.getMouseFlags('right');
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.down}, 0, 0, 0, [IntPtr]::Zero); [NativeInput]::mouse_event(${flags.up}, 0, 0, 0, [IntPtr]::Zero)`
        );
        break;
      }
      case 'drag': {
        const { fromX, fromY, toX, toY, button, duration } = args;
        const flags = this.getMouseFlags(button);
        await this.moveMouse(fromX, fromY);
        await this.delay(50);
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.down}, 0, 0, 0, [IntPtr]::Zero)`
        );
        await this.delay(duration);
        await this.moveMouse(toX, toY);
        await this.delay(50);
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.up}, 0, 0, 0, [IntPtr]::Zero)`
        );
        break;
      }
      case 'scroll': {
        const { deltaY, deltaX } = args;
        if (deltaY !== 0) {
          const amount = Math.round(deltaY * 120);
          await this.ps(
            `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${MOUSEEVENTF_WHEEL}, 0, 0, ${amount}, [IntPtr]::Zero)`
          );
        }
        if (deltaX !== 0) {
          const amount = Math.round(deltaX * 120);
          await this.ps(
            `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${MOUSEEVENTF_HWHEEL}, 0, 0, ${amount}, [IntPtr]::Zero)`
          );
        }
        break;
      }
      case 'key_press': {
        const { vk, modifiers, delay } = args;
        const modVKs = modifiers.map((m: string) => {
          const mvk = MODIFIER_VK[m];
          if (mvk === undefined) throw new Error(`Unknown modifier: ${m}`);
          return mvk;
        });

        const lines: string[] = [this.P_INVOKE_BLOCK];
        for (const mvk of modVKs) {
          lines.push(`[NativeInput]::keybd_event(${mvk}, 0, 0, [IntPtr]::Zero)`);
        }
        lines.push(`[NativeInput]::keybd_event(${vk}, 0, 0, [IntPtr]::Zero)`);
        if (delay) {
          lines.push(`Start-Sleep -Milliseconds ${Math.round(delay)}`);
        }
        lines.push(`[NativeInput]::keybd_event(${vk}, 0, ${KEYEVENTF_KEYUP}, [IntPtr]::Zero)`);
        for (const mvk of modVKs.reverse()) {
          lines.push(`[NativeInput]::keybd_event(${mvk}, 0, ${KEYEVENTF_KEYUP}, [IntPtr]::Zero)`);
        }
        await this.ps(lines.join('; '));
        break;
      }
      case 'key_down': {
        const { vk } = args;
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::keybd_event(${vk}, 0, 0, [IntPtr]::Zero)`
        );
        break;
      }
      case 'key_up': {
        const { vk } = args;
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::keybd_event(${vk}, 0, ${KEYEVENTF_KEYUP}, [IntPtr]::Zero)`
        );
        break;
      }
      case 'type': {
        const { text } = args;
        const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}');
        const psEscaped = this.escapePsSingleQuote(escaped);
        await this.ps(
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psEscaped}')`
        );
        break;
      }
      case 'hotkey': {
        const { keys, modifiers } = args;
        const modVKs = modifiers.map((m: string) => {
          const mvk = MODIFIER_VK[m];
          if (mvk === undefined) throw new Error(`Unknown modifier: ${m}`);
          return mvk;
        });

        const lines: string[] = [this.P_INVOKE_BLOCK];
        for (const mvk of modVKs) {
          lines.push(`[NativeInput]::keybd_event(${mvk}, 0, 0, [IntPtr]::Zero)`);
        }
        for (const key of keys) {
          const vk = parseInt(key, 10);
          lines.push(`[NativeInput]::keybd_event(${vk}, 0, 0, [IntPtr]::Zero)`);
          lines.push(`[NativeInput]::keybd_event(${vk}, 0, ${KEYEVENTF_KEYUP}, [IntPtr]::Zero)`);
        }
        for (const mvk of [...modVKs].reverse()) {
          lines.push(`[NativeInput]::keybd_event(${mvk}, 0, ${KEYEVENTF_KEYUP}, [IntPtr]::Zero)`);
        }
        await this.ps(lines.join('; '));
        break;
      }
      case 'get_active_window': {
        try {
          const handleStr = await this.ps(
            `${this.P_INVOKE_BLOCK}; [NativeInput]::GetForegroundWindow().ToInt64()`
          );
          const handle = handleStr.trim();
          if (!handle || handle === '0') return { window: null };
          const win = await this.getWindow(handle);
          return { window: win };
        } catch {
          return { window: null };
        }
      }
      case 'get_windows': {
        const result = await this.ps(
          'Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | ForEach-Object { Write-Output "$($_.MainWindowHandle)|$($_.Id)|$($_.ProcessName)|$($_.MainWindowTitle)" }'
        );

        const windows: WindowInfo[] = [];
        const lines = result.split('\n').filter(l => l.trim());

        for (const line of lines) {
          const parts = line.split('|');
          if (parts.length < 4) continue;
          const [rawHandle = '', rawPid = '', rawProcessName = ''] = parts;

          const handle = rawHandle.trim();
          const pid = parseInt(rawPid.trim(), 10);
          const processName = rawProcessName.trim();
          const title = parts.slice(3).join('|').trim();

          windows.push({
            handle,
            title,
            pid,
            processName,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            focused: false,
            visible: true,
            minimized: false,
            maximized: false,
            fullscreen: false,
          });
        }
        return { windows };
      }
      case 'get_window': {
        const { handle } = args;
        const handleNum = parseInt(handle, 10);
        this.validateNumber(handleNum, 'handle');

        try {
          const script = `${this.P_INVOKE_BLOCK};
$h = [IntPtr]${handleNum};
$r = New-Object NativeInput+RECT;
[NativeInput]::GetWindowRect($h, [ref]$r) | Out-Null;
$len = [NativeInput]::GetWindowTextLength($h);
$sb = New-Object System.Text.StringBuilder($len + 1);
[NativeInput]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null;
$procId = [uint32]0;
[NativeInput]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null;
$fg = [NativeInput]::GetForegroundWindow();
$pname = '';
try { $pname = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName } catch {}
Write-Output "$($r.Left)|$($r.Top)|$($r.Right)|$($r.Bottom)|$($sb.ToString())|$procId|$pname|$($fg -eq $h)"`;

          const result = await this.ps(script);
          const parts = result.trim().split('|');
          if (parts.length < 8) return { window: null };
          const [
            rawLeft = '',
            rawTop = '',
            rawRight = '',
            rawBottom = '',
            rawTitle = '',
            rawPid = '',
            rawProcessName = '',
            rawFocused = '',
          ] = parts;

          const left = parseInt(rawLeft, 10);
          const top = parseInt(rawTop, 10);
          const right = parseInt(rawRight, 10);
          const bottom = parseInt(rawBottom, 10);
          const title = rawTitle;
          const pid = parseInt(rawPid, 10);
          const processName = rawProcessName;
          const focused = rawFocused.trim().toLowerCase() === 'true';

          return {
            window: {
              handle,
              title,
              pid,
              processName,
              bounds: {
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
              },
              focused,
              visible: true,
              minimized: false,
              maximized: false,
              fullscreen: false,
            }
          };
        } catch {
          return { window: null };
        }
      }
      case 'focus_window': {
        const { handle } = args;
        const handleNum = parseInt(handle, 10);
        this.validateNumber(handleNum, 'handle');
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::SetForegroundWindow([IntPtr]${handleNum})`
        );
        break;
      }
      case 'minimize_window': {
        const { handle } = args;
        const handleNum = parseInt(handle, 10);
        this.validateNumber(handleNum, 'handle');
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::ShowWindow([IntPtr]${handleNum}, 6)`
        );
        break;
      }
      case 'maximize_window': {
        const { handle } = args;
        const handleNum = parseInt(handle, 10);
        this.validateNumber(handleNum, 'handle');
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::ShowWindow([IntPtr]${handleNum}, 3)`
        );
        break;
      }
      case 'restore_window': {
        const { handle } = args;
        const handleNum = parseInt(handle, 10);
        this.validateNumber(handleNum, 'handle');
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::ShowWindow([IntPtr]${handleNum}, 9)`
        );
        break;
      }
      case 'close_window': {
        const { handle } = args;
        const handleNum = parseInt(handle, 10);
        this.validateNumber(handleNum, 'handle');
        await this.ps(
          `${this.P_INVOKE_BLOCK}; [NativeInput]::SendMessage([IntPtr]${handleNum}, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)`
        );
        break;
      }
      case 'set_window': {
        const { handle, position, size, focus } = args;
        const handleNum = parseInt(handle, 10);
        this.validateNumber(handleNum, 'handle');

        const lines: string[] = [this.P_INVOKE_BLOCK];

        if (position || size) {
          const current = await this.getWindow(handle);
          const x = position?.x ?? current?.bounds.x ?? 0;
          const y = position?.y ?? current?.bounds.y ?? 0;
          const w = size?.width ?? current?.bounds.width ?? 800;
          const h = size?.height ?? current?.bounds.height ?? 600;

          this.validateNumber(x, 'x');
          this.validateNumber(y, 'y');
          this.validateNumber(w, 'width');
          this.validateNumber(h, 'height');

          lines.push(
            `[NativeInput]::MoveWindow([IntPtr]${handleNum}, ${Math.round(x)}, ${Math.round(y)}, ${Math.round(w)}, ${Math.round(h)}, $true)`
          );
        }

        if (focus) {
          lines.push(`[NativeInput]::SetForegroundWindow([IntPtr]${handleNum})`);
        }

        if (lines.length > 1) {
          await this.ps(lines.join('; '));
        }
        break;
      }
      case 'get_running_apps': {
        const result = await this.ps(
          'Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object Id,ProcessName,Path | ConvertTo-Json -Compress'
        );

        try {
          const parsed = JSON.parse(result);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          const apps = items.map((item: { Id: number; ProcessName: string; Path: string | null }) => ({
            name: item.ProcessName ?? '',
            path: item.Path ?? '',
            pid: item.Id,
            running: true,
          }));
          return { apps };
        } catch {
          return { apps: [] };
        }
      }
      case 'launch_app': {
        const { path: appPath, args: appArgs, cwd, hidden } = args;
        const escapedPath = this.escapePsSingleQuote(appPath);
        let cmd = `Start-Process '${escapedPath}' -PassThru`;

        if (appArgs && appArgs.length > 0) {
          const joinedArgs = appArgs.map((a: string) => this.escapePsSingleQuote(a)).join(' ');
          cmd += ` -ArgumentList '${joinedArgs}'`;
        }

        if (cwd) {
          cmd += ` -WorkingDirectory '${this.escapePsSingleQuote(cwd)}'`;
        }

        if (hidden) {
          cmd += ' -WindowStyle Hidden';
        }

        cmd += ' | Select-Object Id,ProcessName | ConvertTo-Json -Compress';

        const result = await this.ps(cmd);
        try {
          const parsed = JSON.parse(result);
          return {
            app: {
              name: parsed.ProcessName ?? '',
              path: appPath,
              pid: parsed.Id,
              running: true,
            }
          };
        } catch {
          return {
            app: {
              name: appPath,
              path: appPath,
              running: true,
            }
          };
        }
      }
      case 'close_app': {
        const { pid } = args;
        this.validateNumber(pid, 'pid');
        await this.ps(`Stop-Process -Id ${Math.round(pid)}`);
        break;
      }
      case 'get_screens': {
        const result = await this.ps(
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { Write-Output "$($_.DeviceName)|$($_.Bounds.X)|$($_.Bounds.Y)|$($_.Bounds.Width)|$($_.Bounds.Height)|$($_.WorkingArea.X)|$($_.WorkingArea.Y)|$($_.WorkingArea.Width)|$($_.WorkingArea.Height)|$($_.Primary)" }'
        );

        const screens: ScreenInfo[] = [];
        const lines = result.split('\n').filter(l => l.trim());

        for (const [i, line] of lines.entries()) {
          const parts = line.split('|');
          if (parts.length < 10) continue;
          const [
            name = '',
            boundsX = '',
            boundsY = '',
            boundsW = '',
            boundsH = '',
            workX = '',
            workY = '',
            workW = '',
            workH = '',
            primary = '',
          ] = parts;

          screens.push({
            id: i,
            name: name.trim(),
            bounds: {
              x: parseInt(boundsX, 10),
              y: parseInt(boundsY, 10),
              width: parseInt(boundsW, 10),
              height: parseInt(boundsH, 10),
            },
            workArea: {
              x: parseInt(workX, 10),
              y: parseInt(workY, 10),
              width: parseInt(workW, 10),
              height: parseInt(workH, 10),
            },
            scaleFactor: 1,
            primary: primary.trim().toLowerCase() === 'true',
          });
        }
        return { screens };
      }
      case 'get_pixel_color': {
        const { x, y } = args;
        const result = await this.ps(
          `Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap(1, 1); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(${Math.round(x)}, ${Math.round(y)}, 0, 0, (New-Object System.Drawing.Size(1, 1))); $c = $bmp.GetPixel(0, 0); Write-Output "$($c.R)|$($c.G)|$($c.B)|$($c.A)"; $g.Dispose(); $bmp.Dispose()`
        );

        const parts = result.trim().split('|');
        const r = parseInt(parts[0] ?? '', 10);
        const g = parseInt(parts[1] ?? '', 10);
        const b = parseInt(parts[2] ?? '', 10);
        const a = parts.length > 3 ? parseInt(parts[3] ?? '', 10) : 255;
        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        return { r, g, b, a, hex };
      }
      case 'get_clipboard': {
        const text = await this.ps('Get-Clipboard');
        return {
          text: text || undefined,
          formats: text ? ['text'] : [],
        };
      }
      case 'set_clipboard': {
        const { text } = args;
        const escaped = this.escapePsSingleQuote(text);
        await this.ps(`Set-Clipboard -Value '${escaped}'`);
        break;
      }
      case 'clear_clipboard': {
        await this.ps('Set-Clipboard -Value $null');
        break;
      }
      default:
        throw new Error(`Unknown fallback action: ${action}`);
    }
  }
}
