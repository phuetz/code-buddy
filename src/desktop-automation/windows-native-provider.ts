/**
 * Windows Native Desktop Automation Provider
 *
 * Uses PowerShell P/Invoke (user32.dll) for native Windows desktop automation.
 * Supports WSL2 interop via powershell.exe.
 */

import { spawn } from 'child_process';
import { BaseNativeProvider } from './base-native-provider.js';
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
  // a-z (populated below)
  // 0-9 (populated below)
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
  // PowerShell execution helper
  // ---------------------------------------------------------------------------

  /**
   * Execute a PowerShell script via the configured PS command.
   * Uses EncodedCommand to avoid quoting/heredoc parsing issues.
   */
  private async ps(script: string): Promise<string> {
    const preparedScript = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; ${script}`;
    const encodedScript = Buffer.from(preparedScript, 'utf16le').toString('base64');
    return this.exec(
      `${this.psCmd} -NoProfile -NonInteractive -EncodedCommand ${encodedScript}`,
      15000
    );
  }

  /**
   * Validate that a value is a finite number to prevent injection.
   */
  private validateNumber(value: number, name: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid ${name}: must be a finite number`);
    }
  }

  /**
   * Escape a string for use inside PowerShell single quotes (double the single quotes).
   */
  private escapePsSingleQuote(s: string): string {
    return s.replace(/'/g, "''");
  }

  /**
   * Get mouse button event flags.
   */
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

  /**
   * Resolve a key name to its virtual key code.
   */
  private resolveVK(key: KeyCode): number {
    const normalized = key.toLowerCase();
    const vk = VK_CODES[normalized];
    if (vk === undefined) {
      // If single character, use its char code
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
  }

  // ---------------------------------------------------------------------------
  // Mouse
  // ---------------------------------------------------------------------------

  async getMousePosition(): Promise<MousePosition> {
    this.ensureInitialized();
    const result = await this.ps(
      `${this.P_INVOKE_BLOCK}; $p = New-Object NativeInput+POINT; [NativeInput]::GetCursorPos([ref]$p) | Out-Null; Write-Output "$($p.X),$($p.Y)"`
    );
    const parts = result.trim().split(',');
    return {
      x: parseInt(parts[0], 10),
      y: parseInt(parts[1], 10),
    };
  }

  async moveMouse(x: number, y: number, _options?: MouseMoveOptions): Promise<void> {
    this.ensureInitialized();
    this.validateNumber(x, 'x');
    this.validateNumber(y, 'y');
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})`
    );
  }

  async click(options?: MouseClickOptions): Promise<void> {
    this.ensureInitialized();
    const button = options?.button ?? 'left';
    const clicks = options?.clicks ?? 1;
    const clickDelay = options?.delay ?? 50;
    const flags = this.getMouseFlags(button);

    for (let i = 0; i < clicks; i++) {
      if (i > 0) {
        await this.delay(clickDelay);
      }
      await this.ps(
        `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.down}, 0, 0, 0, [IntPtr]::Zero); [NativeInput]::mouse_event(${flags.up}, 0, 0, 0, [IntPtr]::Zero)`
      );
    }
  }

  async doubleClick(button?: MouseButton): Promise<void> {
    this.ensureInitialized();
    const flags = this.getMouseFlags(button ?? 'left');
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.down}, 0, 0, 0, [IntPtr]::Zero); [NativeInput]::mouse_event(${flags.up}, 0, 0, 0, [IntPtr]::Zero)`
    );
    await this.delay(50);
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.down}, 0, 0, 0, [IntPtr]::Zero); [NativeInput]::mouse_event(${flags.up}, 0, 0, 0, [IntPtr]::Zero)`
    );
  }

  async rightClick(): Promise<void> {
    this.ensureInitialized();
    const flags = this.getMouseFlags('right');
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.down}, 0, 0, 0, [IntPtr]::Zero); [NativeInput]::mouse_event(${flags.up}, 0, 0, 0, [IntPtr]::Zero)`
    );
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
    const flags = this.getMouseFlags(button);
    const duration = options?.duration ?? 300;

    // Move to start position
    await this.moveMouse(fromX, fromY);
    await this.delay(50);

    // Mouse down
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.down}, 0, 0, 0, [IntPtr]::Zero)`
    );
    await this.delay(duration);

    // Move to end position
    await this.moveMouse(toX, toY);
    await this.delay(50);

    // Mouse up
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${flags.up}, 0, 0, 0, [IntPtr]::Zero)`
    );
  }

  async scroll(options: MouseScrollOptions): Promise<void> {
    this.ensureInitialized();
    const deltaY = options.deltaY ?? 0;
    const deltaX = options.deltaX ?? 0;

    if (deltaY !== 0) {
      this.validateNumber(deltaY, 'deltaY');
      const amount = Math.round(deltaY * 120);
      await this.ps(
        `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${MOUSEEVENTF_WHEEL}, 0, 0, ${amount}, [IntPtr]::Zero)`
      );
    }

    if (deltaX !== 0) {
      this.validateNumber(deltaX, 'deltaX');
      const amount = Math.round(deltaX * 120);
      await this.ps(
        `${this.P_INVOKE_BLOCK}; [NativeInput]::mouse_event(${MOUSEEVENTF_HWHEEL}, 0, 0, ${amount}, [IntPtr]::Zero)`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  async keyPress(key: KeyCode, options?: KeyPressOptions): Promise<void> {
    this.ensureInitialized();
    const vk = this.resolveVK(key);
    const modifiers = options?.modifiers ?? [];
    const modVKs = modifiers.map(m => {
      const mvk = MODIFIER_VK[m];
      if (mvk === undefined) throw new Error(`Unknown modifier: ${m}`);
      return mvk;
    });

    // Build PS script: modifiers down, key down/up, modifiers up
    const lines: string[] = [this.P_INVOKE_BLOCK];
    for (const mvk of modVKs) {
      lines.push(`[NativeInput]::keybd_event(${mvk}, 0, 0, [IntPtr]::Zero)`);
    }
    lines.push(`[NativeInput]::keybd_event(${vk}, 0, 0, [IntPtr]::Zero)`);
    if (options?.delay) {
      lines.push(`Start-Sleep -Milliseconds ${Math.round(options.delay)}`);
    }
    lines.push(`[NativeInput]::keybd_event(${vk}, 0, ${KEYEVENTF_KEYUP}, [IntPtr]::Zero)`);
    for (const mvk of modVKs.reverse()) {
      lines.push(`[NativeInput]::keybd_event(${mvk}, 0, ${KEYEVENTF_KEYUP}, [IntPtr]::Zero)`);
    }

    await this.ps(lines.join('; '));
  }

  async keyDown(key: KeyCode): Promise<void> {
    this.ensureInitialized();
    const vk = this.resolveVK(key);
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::keybd_event(${vk}, 0, 0, [IntPtr]::Zero)`
    );
  }

  async keyUp(key: KeyCode): Promise<void> {
    this.ensureInitialized();
    const vk = this.resolveVK(key);
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::keybd_event(${vk}, 0, ${KEYEVENTF_KEYUP}, [IntPtr]::Zero)`
    );
  }

  async type(text: string, _options?: TypeOptions): Promise<void> {
    this.ensureInitialized();
    // Escape special SendKeys characters: +^%~(){}[]
    const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}');
    const psEscaped = this.escapePsSingleQuote(escaped);
    await this.ps(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psEscaped}')`
    );
  }

  async hotkey(sequence: HotkeySequence): Promise<void> {
    this.ensureInitialized();
    const modifiers = sequence.modifiers ?? [];
    const modVKs = modifiers.map(m => {
      const mvk = MODIFIER_VK[m];
      if (mvk === undefined) throw new Error(`Unknown modifier: ${m}`);
      return mvk;
    });

    const lines: string[] = [this.P_INVOKE_BLOCK];

    // Modifiers down
    for (const mvk of modVKs) {
      lines.push(`[NativeInput]::keybd_event(${mvk}, 0, 0, [IntPtr]::Zero)`);
    }

    // Key presses
    for (const key of sequence.keys) {
      const vk = this.resolveVK(key);
      lines.push(`[NativeInput]::keybd_event(${vk}, 0, 0, [IntPtr]::Zero)`);
      lines.push(`[NativeInput]::keybd_event(${vk}, 0, ${KEYEVENTF_KEYUP}, [IntPtr]::Zero)`);
    }

    // Modifiers up (reverse order)
    for (const mvk of [...modVKs].reverse()) {
      lines.push(`[NativeInput]::keybd_event(${mvk}, 0, ${KEYEVENTF_KEYUP}, [IntPtr]::Zero)`);
    }

    await this.ps(lines.join('; '));
  }

  // ---------------------------------------------------------------------------
  // Windows
  // ---------------------------------------------------------------------------

  async getActiveWindow(): Promise<WindowInfo | null> {
    this.ensureInitialized();
    try {
      const handleStr = await this.ps(
        `${this.P_INVOKE_BLOCK}; [NativeInput]::GetForegroundWindow().ToInt64()`
      );
      const handle = handleStr.trim();
      if (!handle || handle === '0') return null;
      return this.getWindow(handle);
    } catch {
      return null;
    }
  }

  async getWindows(_options?: WindowSearchOptions): Promise<WindowInfo[]> {
    this.ensureInitialized();
    const result = await this.ps(
      'Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | ForEach-Object { Write-Output "$($_.MainWindowHandle)|$($_.Id)|$($_.ProcessName)|$($_.MainWindowTitle)" }'
    );

    const windows: WindowInfo[] = [];
    const lines = result.split('\n').filter(l => l.trim());

    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length < 4) continue;

      const handle = parts[0].trim();
      const pid = parseInt(parts[1].trim(), 10);
      const processName = parts[2].trim();
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

    // Apply search filters
    if (_options) {
      return windows.filter(w => {
        if (_options.title) {
          const titleMatch = _options.title instanceof RegExp
            ? _options.title.test(w.title)
            : w.title.includes(_options.title);
          if (!titleMatch) return false;
        }
        if (_options.processName && w.processName !== _options.processName) return false;
        if (_options.pid && w.pid !== _options.pid) return false;
        return true;
      });
    }

    return windows;
  }

  async getWindow(handle: string): Promise<WindowInfo | null> {
    this.ensureInitialized();
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
      if (parts.length < 8) return null;

      const left = parseInt(parts[0], 10);
      const top = parseInt(parts[1], 10);
      const right = parseInt(parts[2], 10);
      const bottom = parseInt(parts[3], 10);
      const title = parts[4];
      const pid = parseInt(parts[5], 10);
      const processName = parts[6];
      const focused = parts[7].trim().toLowerCase() === 'true';

      return {
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
      };
    } catch {
      return null;
    }
  }

  async focusWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    const handleNum = parseInt(handle, 10);
    this.validateNumber(handleNum, 'handle');
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::SetForegroundWindow([IntPtr]${handleNum})`
    );
  }

  async minimizeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    const handleNum = parseInt(handle, 10);
    this.validateNumber(handleNum, 'handle');
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::ShowWindow([IntPtr]${handleNum}, 6)`
    );
  }

  async maximizeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    const handleNum = parseInt(handle, 10);
    this.validateNumber(handleNum, 'handle');
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::ShowWindow([IntPtr]${handleNum}, 3)`
    );
  }

  async restoreWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    const handleNum = parseInt(handle, 10);
    this.validateNumber(handleNum, 'handle');
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::ShowWindow([IntPtr]${handleNum}, 9)`
    );
  }

  async closeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    const handleNum = parseInt(handle, 10);
    this.validateNumber(handleNum, 'handle');
    await this.ps(
      `${this.P_INVOKE_BLOCK}; [NativeInput]::SendMessage([IntPtr]${handleNum}, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)`
    );
  }

  async setWindow(handle: string, options: WindowSetOptions): Promise<void> {
    this.ensureInitialized();
    const handleNum = parseInt(handle, 10);
    this.validateNumber(handleNum, 'handle');

    const lines: string[] = [this.P_INVOKE_BLOCK];

    if (options.position || options.size) {
      // Need current rect to fill in missing values
      const current = await this.getWindow(handle);
      const x = options.position?.x ?? current?.bounds.x ?? 0;
      const y = options.position?.y ?? current?.bounds.y ?? 0;
      const w = options.size?.width ?? current?.bounds.width ?? 800;
      const h = options.size?.height ?? current?.bounds.height ?? 600;

      this.validateNumber(x, 'x');
      this.validateNumber(y, 'y');
      this.validateNumber(w, 'width');
      this.validateNumber(h, 'height');

      lines.push(
        `[NativeInput]::MoveWindow([IntPtr]${handleNum}, ${Math.round(x)}, ${Math.round(y)}, ${Math.round(w)}, ${Math.round(h)}, $true)`
      );
    }

    if (options.focus) {
      lines.push(`[NativeInput]::SetForegroundWindow([IntPtr]${handleNum})`);
    }

    if (lines.length > 1) {
      await this.ps(lines.join('; '));
    }
  }

  // ---------------------------------------------------------------------------
  // Applications
  // ---------------------------------------------------------------------------

  async getRunningApps(): Promise<AppInfo[]> {
    this.ensureInitialized();
    const result = await this.ps(
      'Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object Id,ProcessName,Path | ConvertTo-Json -Compress'
    );

    try {
      const parsed = JSON.parse(result);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.map((item: { Id: number; ProcessName: string; Path: string | null }) => ({
        name: item.ProcessName ?? '',
        path: item.Path ?? '',
        pid: item.Id,
        running: true,
      }));
    } catch {
      return [];
    }
  }

  async launchApp(appPath: string, options?: AppLaunchOptions): Promise<AppInfo> {
    this.ensureInitialized();
    const escapedPath = this.escapePsSingleQuote(appPath);
    let cmd = `Start-Process '${escapedPath}' -PassThru`;

    if (options?.args && options.args.length > 0) {
      const args = options.args.map(a => this.escapePsSingleQuote(a)).join(' ');
      cmd += ` -ArgumentList '${args}'`;
    }

    if (options?.cwd) {
      cmd += ` -WorkingDirectory '${this.escapePsSingleQuote(options.cwd)}'`;
    }

    if (options?.hidden) {
      cmd += ' -WindowStyle Hidden';
    }

    cmd += ' | Select-Object Id,ProcessName | ConvertTo-Json -Compress';

    const result = await this.ps(cmd);
    try {
      const parsed = JSON.parse(result);
      return {
        name: parsed.ProcessName ?? '',
        path: appPath,
        pid: parsed.Id,
        running: true,
      };
    } catch {
      return {
        name: appPath,
        path: appPath,
        running: true,
      };
    }
  }

  async closeApp(pid: number): Promise<void> {
    this.ensureInitialized();
    this.validateNumber(pid, 'pid');
    await this.ps(`Stop-Process -Id ${Math.round(pid)}`);
  }

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  async getScreens(): Promise<ScreenInfo[]> {
    this.ensureInitialized();
    const result = await this.ps(
      'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { Write-Output "$($_.DeviceName)|$($_.Bounds.X)|$($_.Bounds.Y)|$($_.Bounds.Width)|$($_.Bounds.Height)|$($_.WorkingArea.X)|$($_.WorkingArea.Y)|$($_.WorkingArea.Width)|$($_.WorkingArea.Height)|$($_.Primary)" }'
    );

    const screens: ScreenInfo[] = [];
    const lines = result.split('\n').filter(l => l.trim());

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split('|');
      if (parts.length < 10) continue;

      screens.push({
        id: i,
        name: parts[0].trim(),
        bounds: {
          x: parseInt(parts[1], 10),
          y: parseInt(parts[2], 10),
          width: parseInt(parts[3], 10),
          height: parseInt(parts[4], 10),
        },
        workArea: {
          x: parseInt(parts[5], 10),
          y: parseInt(parts[6], 10),
          width: parseInt(parts[7], 10),
          height: parseInt(parts[8], 10),
        },
        scaleFactor: 1,
        primary: parts[9].trim().toLowerCase() === 'true',
      });
    }

    return screens;
  }

  async getPixelColor(x: number, y: number): Promise<ColorInfo> {
    this.ensureInitialized();
    this.validateNumber(x, 'x');
    this.validateNumber(y, 'y');

    const result = await this.ps(
      `Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap(1, 1); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(${Math.round(x)}, ${Math.round(y)}, 0, 0, (New-Object System.Drawing.Size(1, 1))); $c = $bmp.GetPixel(0, 0); Write-Output "$($c.R)|$($c.G)|$($c.B)|$($c.A)"; $g.Dispose(); $bmp.Dispose()`
    );

    const parts = result.trim().split('|');
    const r = parseInt(parts[0], 10);
    const g = parseInt(parts[1], 10);
    const b = parseInt(parts[2], 10);
    const a = parts.length > 3 ? parseInt(parts[3], 10) : 255;

    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

    return { r, g, b, a, hex };
  }

  // ---------------------------------------------------------------------------
  // Clipboard
  // ---------------------------------------------------------------------------

  async getClipboard(): Promise<ClipboardContent> {
    this.ensureInitialized();
    try {
      const text = await this.ps('Get-Clipboard');
      return {
        text: text || undefined,
        formats: text ? ['text'] : [],
      };
    } catch {
      return { formats: [] };
    }
  }

  async setClipboard(content: Partial<ClipboardContent>): Promise<void> {
    this.ensureInitialized();
    if (content.text !== undefined) {
      const escaped = this.escapePsSingleQuote(content.text);
      await this.ps(`Set-Clipboard -Value '${escaped}'`);
    }
  }

  async clearClipboard(): Promise<void> {
    this.ensureInitialized();
    await this.ps('Set-Clipboard -Value $null');
  }
}
