/**
 * Linux Native Desktop Automation Provider
 *
 * Uses xdotool, xclip, wmctrl, and xrandr for desktop automation on Linux/X11.
 */

import { spawn, execSync as nodeExecSync } from 'child_process';
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

// Key name translation map for xdotool
const keyMap: Record<string, string> = {
  enter: 'Return',
  escape: 'Escape',
  backspace: 'BackSpace',
  tab: 'Tab',
  delete: 'Delete',
  space: 'space',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'Prior',
  pagedown: 'Next',
  f1: 'F1',
  f2: 'F2',
  f3: 'F3',
  f4: 'F4',
  f5: 'F5',
  f6: 'F6',
  f7: 'F7',
  f8: 'F8',
  f9: 'F9',
  f10: 'F10',
  f11: 'F11',
  f12: 'F12',
  ctrl: 'ctrl',
  alt: 'alt',
  shift: 'shift',
  meta: 'super',
  command: 'super',
  win: 'super',
};

/**
 * Map a mouse button name to xdotool button number
 */
function buttonNumber(button?: MouseButton): number {
  switch (button) {
    case 'right': return 3;
    case 'middle': return 2;
    default: return 1; // left
  }
}

export class LinuxNativeProvider extends BaseNativeProvider {
  readonly platformName = 'Linux';
  readonly capabilities: ProviderCapabilities = {
    mouse: true,
    keyboard: true,
    windows: true,
    apps: true,
    screenshots: true,
    colorPicker: false,
    clipboard: true,
    ocr: false,
  };

  private isX11 = true;

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    // Required: xdotool
    const hasXdotool = this.checkTool('xdotool');
    if (!hasXdotool) {
      throw new Error('xdotool is required for Linux native desktop automation. Install with: sudo apt install xdotool');
    }

    // Optional tools
    this.checkTool('xclip');
    this.checkTool('xsel');
    this.checkTool('wmctrl');
    this.checkTool('xrandr');

    // Detect session type
    this.isX11 = process.env.XDG_SESSION_TYPE !== 'wayland';

    this.initialized = true;
  }

  async isAvailable(): Promise<boolean> {
    return this.hasTool('xdotool') && this.isX11;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Map a key name to the xdotool equivalent
   */
  private mapKey(key: string): string {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_]+$/.test(key)) throw new Error('Invalid desktop key');
    return keyMap[key.toLowerCase()] ?? key;
  }

  private validateHandle(handle: string): void {
    if (typeof handle !== 'string' || !/^(?:[0-9]+|0x[a-fA-F0-9]+)$/.test(handle)) {
      throw new Error('Invalid desktop window handle');
    }
  }

  // --------------------------------------------------------------------------
  // Mouse
  // --------------------------------------------------------------------------

  async getMousePosition(): Promise<MousePosition> {
    this.ensureInitialized();
    try {
      const output = await this.execFile('xdotool', ['getmouselocation']);
      const xMatch = output.match(/x:(\d+)/);
      const yMatch = output.match(/y:(\d+)/);
      const screenMatch = output.match(/screen:(\d+)/);
      return {
        x: xMatch?.[1] ? parseInt(xMatch[1], 10) : 0,
        y: yMatch?.[1] ? parseInt(yMatch[1], 10) : 0,
        screen: screenMatch?.[1] ? parseInt(screenMatch[1], 10) : 0,
      };
    } catch {
      return { x: 0, y: 0, screen: 0 };
    }
  }

  async moveMouse(x: number, y: number, options?: MouseMoveOptions): Promise<void> {
    this.ensureInitialized();
    this.validateNumbers(x, y);
    const args = ['mousemove'];
    if (options?.smooth && options.steps) {
      this.validateNumbers(options.steps);
      args.push('--steps', String(options.steps));
    }
    args.push(String(x), String(y));
    await this.execFile('xdotool', args);
  }

  async click(options?: MouseClickOptions): Promise<void> {
    this.ensureInitialized();
    const args = ['click'];
    if (options?.clicks && options.clicks > 1) {
      this.validateNumbers(options.clicks, options.delay ?? 100);
      args.push('--repeat', String(options.clicks), '--delay', String(options.delay ?? 100));
    }
    args.push(String(buttonNumber(options?.button)));
    await this.execFile('xdotool', args);
  }

  async doubleClick(button?: MouseButton): Promise<void> {
    this.ensureInitialized();
    const btn = buttonNumber(button);
    await this.execFile('xdotool', ['click', '--repeat', '2', '--delay', '50', String(btn)]);
  }

  async rightClick(): Promise<void> {
    this.ensureInitialized();
    await this.execFile('xdotool', ['click', '3']);
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number, _options?: MouseDragOptions): Promise<void> {
    this.ensureInitialized();
    this.validateNumbers(fromX, fromY, toX, toY);
    await this.execFile('xdotool', ['mousemove', String(fromX), String(fromY), 'mousedown', '1', 'mousemove', String(toX), String(toY), 'mouseup', '1']);
  }

  async scroll(options: MouseScrollOptions): Promise<void> {
    this.ensureInitialized();
    this.validateNumbers(options.deltaX ?? 0, options.deltaY ?? 0);
    const { deltaX = 0, deltaY = 0 } = options;

    // Vertical scroll: button 4 = up, button 5 = down
    if (deltaY !== 0) {
      const btn = deltaY < 0 ? 4 : 5; // negative = scroll up
      const count = Math.abs(Math.round(deltaY));
      if (count > 0) {
        await this.execFile('xdotool', ['click', '--repeat', String(count), String(btn)]);
      }
    }

    // Horizontal scroll: button 6 = left, button 7 = right
    if (deltaX !== 0) {
      const btn = deltaX < 0 ? 6 : 7; // negative = scroll left
      const count = Math.abs(Math.round(deltaX));
      if (count > 0) {
        await this.execFile('xdotool', ['click', '--repeat', String(count), String(btn)]);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Keyboard
  // --------------------------------------------------------------------------

  async keyPress(key: KeyCode, options?: KeyPressOptions): Promise<void> {
    this.ensureInitialized();
    const mappedKey = this.mapKey(key);
    let modPrefix = '';
    if (options?.modifiers && options.modifiers.length > 0) {
      modPrefix = options.modifiers.map(m => this.mapKey(m)).join('+') + '+';
    }
    await this.execFile('xdotool', ['key', `${modPrefix}${mappedKey}`]);
  }

  async keyDown(key: KeyCode): Promise<void> {
    this.ensureInitialized();
    const mappedKey = this.mapKey(key);
    await this.execFile('xdotool', ['keydown', mappedKey]);
  }

  async keyUp(key: KeyCode): Promise<void> {
    this.ensureInitialized();
    const mappedKey = this.mapKey(key);
    await this.execFile('xdotool', ['keyup', mappedKey]);
  }

  async type(text: string, options?: TypeOptions): Promise<void> {
    this.ensureInitialized();
    const delay = options?.delay ?? 30;
    this.validateNumbers(delay);
    await this.execFile('xdotool', ['type', '--delay', String(delay), '--', text]);
  }

  async hotkey(sequence: HotkeySequence): Promise<void> {
    this.ensureInitialized();
    const parts: string[] = [];
    if (sequence.modifiers && sequence.modifiers.length > 0) {
      parts.push(...sequence.modifiers.map(m => this.mapKey(m)));
    }
    parts.push(...sequence.keys.map(k => this.mapKey(k)));
    const combo = parts.join('+');
    await this.execFile('xdotool', ['key', combo]);
  }

  // --------------------------------------------------------------------------
  // Window Management
  // --------------------------------------------------------------------------

  async getActiveWindow(): Promise<WindowInfo | null> {
    this.ensureInitialized();
    try {
      const handle = await this.execFile('xdotool', ['getactivewindow']);
      if (!handle) return null;
      return this.getWindow(handle);
    } catch {
      return null;
    }
  }

  async getWindows(options?: WindowSearchOptions): Promise<WindowInfo[]> {
    this.ensureInitialized();
    try {
      const output = await this.execFile('xdotool', ['search', '--onlyvisible', '--name', '']);
      const handles = output.split('\n').filter(h => h.trim().length > 0);
      const windows: WindowInfo[] = [];

      for (const handle of handles) {
        try {
          const win = await this.getWindow(handle);
          if (!win) continue;

          // Apply filters
          if (options?.title) {
            const titleMatch = options.title instanceof RegExp
              ? options.title.test(win.title)
              : win.title.includes(options.title);
            if (!titleMatch) continue;
          }
          if (options?.processName && win.processName !== options.processName) continue;
          if (options?.pid && win.pid !== options.pid) continue;

          windows.push(win);
        } catch {
          // Skip windows that can't be queried
        }
      }

      return windows;
    } catch {
      return [];
    }
  }

  async getWindow(handle: string): Promise<WindowInfo | null> {
    this.ensureInitialized();
    this.validateHandle(handle);
    try {
      let title = '';
      try {
        title = await this.execFile('xdotool', ['getwindowname', handle]);
      } catch {
        // Some windows have no name
      }

      let pid = 0;
      try {
        const pidStr = await this.execFile('xdotool', ['getwindowpid', handle]);
        pid = parseInt(pidStr, 10) || 0;
      } catch {
        // PID may not be available
      }

      let x = 0, y = 0, width = 0, height = 0;
      try {
        const geom = await this.execFile('xdotool', ['getwindowgeometry', handle]);
        const posMatch = geom.match(/Position:\s*(\d+),(\d+)/);
        const sizeMatch = geom.match(/Geometry:\s*(\d+)x(\d+)/);
        if (posMatch?.[1] && posMatch[2]) {
          x = parseInt(posMatch[1], 10);
          y = parseInt(posMatch[2], 10);
        }
        if (sizeMatch?.[1] && sizeMatch[2]) {
          width = parseInt(sizeMatch[1], 10);
          height = parseInt(sizeMatch[2], 10);
        }
      } catch {
        // Geometry may not be available
      }

      let processName = '';
      if (pid > 0) {
        try {
          processName = await this.execFile('ps', ['-p', String(pid), '-o', 'comm=']);
        } catch {
          // Process may have exited
        }
      }

      let focused = false;
      try {
        const activeHandle = await this.execFile('xdotool', ['getactivewindow']);
        focused = handle === activeHandle;
      } catch {
        // Can't determine focus
      }

      return {
        handle,
        title,
        pid,
        processName,
        bounds: { x, y, width, height },
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
    this.validateHandle(handle);
    await this.execFile('xdotool', ['windowactivate', '--sync', handle]);
  }

  async minimizeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    this.validateHandle(handle);
    await this.execFile('xdotool', ['windowminimize', handle]);
  }

  async maximizeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    this.validateHandle(handle);
    if (this.hasTool('wmctrl')) {
      await this.execFile('wmctrl', ['-ir', handle, '-b', 'add,maximized_vert,maximized_horz']);
    }
  }

  async restoreWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    this.validateHandle(handle);
    if (this.hasTool('wmctrl')) {
      await this.execFile('wmctrl', ['-ir', handle, '-b', 'remove,maximized_vert,maximized_horz']);
    }
  }

  async closeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    this.validateHandle(handle);
    await this.execFile('xdotool', ['windowclose', handle]);
  }

  async setWindow(handle: string, options: WindowSetOptions): Promise<void> {
    this.ensureInitialized();
    this.validateHandle(handle);
    if (options.position) {
      this.validateNumbers(options.position.x, options.position.y);
      await this.execFile('xdotool', ['windowmove', handle, String(options.position.x), String(options.position.y)]);
    }
    if (options.size) {
      this.validateNumbers(options.size.width, options.size.height);
      await this.execFile('xdotool', ['windowsize', handle, String(options.size.width), String(options.size.height)]);
    }
    if (options.focus) {
      await this.focusWindow(handle);
    }
  }

  // --------------------------------------------------------------------------
  // Application Management
  // --------------------------------------------------------------------------

  async getRunningApps(): Promise<AppInfo[]> {
    this.ensureInitialized();
    try {
      const output = await this.exec('ps -eo pid,comm');
      const lines = output.split('\n').slice(1); // skip header
      const apps: AppInfo[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^\s*(\d+)\s+(.+)$/);
        if (match?.[1] && match[2]) {
          const pid = parseInt(match[1], 10);
          const comm = match[2].trim();
          apps.push({
            name: comm,
            path: comm,
            pid,
            running: true,
          });
        }
      }

      return apps;
    } catch {
      return [];
    }
  }

  async launchApp(appPath: string, options?: AppLaunchOptions): Promise<AppInfo> {
    this.ensureInitialized();
    const args = options?.args ?? [];
    const child = spawn(appPath, args, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      detached: true,
      stdio: 'ignore',
    });

    child.unref();

    const appName = appPath.split('/').pop() ?? appPath;
    return {
      name: appName,
      path: appPath,
      pid: child.pid,
      running: true,
    };
  }

  async closeApp(pid: number): Promise<void> {
    this.ensureInitialized();
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may already be gone
    }
  }

  // --------------------------------------------------------------------------
  // Screen
  // --------------------------------------------------------------------------

  async getScreens(): Promise<ScreenInfo[]> {
    this.ensureInitialized();
    if (!this.hasTool('xrandr')) {
      return [];
    }

    try {
      const output = await this.exec('xrandr --query');
      const screens: ScreenInfo[] = [];
      const lines = output.split('\n');
      let screenId = 0;

      for (const line of lines) {
        // Match lines like: HDMI-1 connected primary 1920x1080+0+0
        // or: eDP-1 connected 1366x768+0+0
        const match = line.match(
          /^(\S+)\s+connected\s+(primary\s+)?(\d+)x(\d+)\+(\d+)\+(\d+)/
        );
        if (match?.[1] && match[3] && match[4] && match[5] && match[6]) {
          const name = match[1];
          const primary = !!match[2];
          const width = parseInt(match[3], 10);
          const height = parseInt(match[4], 10);
          const x = parseInt(match[5], 10);
          const y = parseInt(match[6], 10);

          screens.push({
            id: screenId++,
            name,
            bounds: { x, y, width, height },
            workArea: { x, y, width, height },
            scaleFactor: 1,
            primary,
          });
        }
      }

      return screens;
    } catch {
      return [];
    }
  }

  async getPixelColor(_x: number, _y: number): Promise<ColorInfo> {
    throw new Error('Color picker not supported on Linux native provider');
  }

  // --------------------------------------------------------------------------
  // Clipboard
  // --------------------------------------------------------------------------

  async getClipboard(): Promise<ClipboardContent> {
    this.ensureInitialized();
    let text = '';

    try {
      if (this.hasTool('xclip')) {
        text = await this.exec('xclip -selection clipboard -o');
      } else if (this.hasTool('xsel')) {
        text = await this.exec('xsel --clipboard --output');
      }
    } catch {
      // Clipboard may be empty
    }

    return {
      text: text || undefined,
      formats: text ? ['text'] : [],
    };
  }

  async setClipboard(content: Partial<ClipboardContent>): Promise<void> {
    this.ensureInitialized();
    const text = content.text ?? '';

    try {
      if (this.hasTool('xclip')) {
        nodeExecSync('xclip -selection clipboard', {
          input: text,
          encoding: 'utf-8',
          timeout: 5000,
        });
      } else if (this.hasTool('xsel')) {
        nodeExecSync('xsel --clipboard --input', {
          input: text,
          encoding: 'utf-8',
          timeout: 5000,
        });
      }
    } catch {
      // Clipboard operation failed
    }
  }

  async clearClipboard(): Promise<void> {
    await this.setClipboard({ text: '' });
  }
}
