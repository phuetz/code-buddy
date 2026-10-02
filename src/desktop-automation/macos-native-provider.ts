/**
 * macOS Native Desktop Automation Provider
 *
 * Uses osascript (AppleScript) and cliclick for desktop automation on macOS.
 * cliclick is optional but recommended for reliable mouse control.
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

// osascript key code map for special keys
const keyCodeMap: Record<string, number> = {
  return: 36,
  enter: 36,
  escape: 53,
  tab: 48,
  delete: 51,
  backspace: 51,
  forwarddelete: 117,
  space: 49,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};

/**
 * Escape a string for safe use inside single-quoted osascript shell arguments.
 */
function escapeForOsascript(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/**
 * Escape a string for use inside AppleScript double-quoted strings.
 */
function escapeAppleString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Parse a macOS window handle in processName:windowIndex format.
 */
function parseHandle(handle: string): { processName: string; windowIndex: number } {
  const colonIdx = handle.lastIndexOf(':');
  if (colonIdx === -1) {
    return { processName: handle, windowIndex: 1 };
  }
  const processName = handle.substring(0, colonIdx);
  const windowIndex = parseInt(handle.substring(colonIdx + 1), 10) || 1;
  return { processName, windowIndex };
}

export class MacOSNativeProvider extends BaseNativeProvider {
  readonly platformName = 'macOS';
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

  private hasCliclick = false;

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Execute an osascript command.
   */
  private async osascript(script: string): Promise<string> {
    const escaped = escapeForOsascript(script);
    return this.exec(`osascript -e '${escaped}'`);
  }

  /**
   * Execute an AppleScript via System Events.
   */
  private async sysEvents(script: string): Promise<string> {
    return this.osascript(`tell application "System Events" to ${script}`);
  }

  /**
   * Map a modifier key to AppleScript modifier syntax.
   */
  private mapModifier(mod: string): string {
    switch (mod.toLowerCase()) {
      case 'ctrl':
      case 'control':
        return 'control down';
      case 'alt':
      case 'option':
        return 'option down';
      case 'shift':
        return 'shift down';
      case 'meta':
      case 'command':
      case 'cmd':
      case 'win':
        return 'command down';
      default:
        return `${mod} down`;
    }
  }

  /**
   * Build the AppleScript 'using' clause for modifiers.
   */
  private buildModifierClause(modifiers?: string[]): string {
    if (!modifiers || modifiers.length === 0) return '';
    const mapped = modifiers.map(m => this.mapModifier(m));
    return ` using {${mapped.join(', ')}}`;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    // cliclick is optional but recommended
    this.hasCliclick = this.checkTool('cliclick');

    this.initialized = true;
  }

  async isAvailable(): Promise<boolean> {
    return process.platform === 'darwin';
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  // --------------------------------------------------------------------------
  // Mouse
  // --------------------------------------------------------------------------

  async getMousePosition(): Promise<MousePosition> {
    this.ensureInitialized();
    if (!this.hasCliclick) {
      throw new Error('cliclick is required for mouse position on macOS. Install with: brew install cliclick');
    }
    try {
      const output = await this.exec('cliclick p:');
      const parts = output.trim().split(',');
      return {
        x: parseInt(parts[0] ?? '', 10) || 0,
        y: parseInt(parts[1] ?? '', 10) || 0,
      };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  async moveMouse(x: number, y: number, _options?: MouseMoveOptions): Promise<void> {
    this.ensureInitialized();
    this.validateNumbers(x, y);
    if (this.hasCliclick) {
      await this.exec(`cliclick m:${x},${y}`);
    } else {
      await this.osascript(`do shell script "cliclick m:${x},${y}"`);
    }
  }

  async click(options?: MouseClickOptions): Promise<void> {
    this.ensureInitialized();
    const button = options?.button ?? 'left';
    const clicks = options?.clicks ?? 1;

    if (this.hasCliclick) {
      const pos = await this.getMousePosition();
      const x = pos.x;
      const y = pos.y;

      let clickCmd: string;
      switch (button) {
        case 'right':
          clickCmd = `rc:${x},${y}`;
          break;
        case 'middle':
          clickCmd = `mc:${x},${y}`;
          break;
        default:
          clickCmd = clicks === 2 ? `dc:${x},${y}` : `c:${x},${y}`;
          break;
      }

      if (button === 'left' && clicks > 2) {
        const cmds: string[] = [];
        for (let i = 0; i < clicks; i++) {
          cmds.push(`c:${x},${y}`);
        }
        await this.exec(`cliclick ${cmds.join(' ')}`);
      } else {
        await this.exec(`cliclick ${clickCmd}`);
      }
    } else {
      await this.sysEvents('click at {0, 0}');
    }
  }

  async doubleClick(button?: MouseButton): Promise<void> {
    this.ensureInitialized();
    if (this.hasCliclick) {
      const pos = await this.getMousePosition();
      if (button === 'right') {
        await this.exec(`cliclick rc:${pos.x},${pos.y} rc:${pos.x},${pos.y}`);
      } else {
        await this.exec(`cliclick dc:${pos.x},${pos.y}`);
      }
    } else {
      await this.sysEvents('click at {0, 0}');
    }
  }

  async rightClick(): Promise<void> {
    this.ensureInitialized();
    if (this.hasCliclick) {
      const pos = await this.getMousePosition();
      await this.exec(`cliclick rc:${pos.x},${pos.y}`);
    } else {
      await this.sysEvents('click at {0, 0}');
    }
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number, _options?: MouseDragOptions): Promise<void> {
    this.ensureInitialized();
    this.validateNumbers(fromX, fromY, toX, toY);
    if (this.hasCliclick) {
      await this.exec(`cliclick dd:${fromX},${fromY} du:${toX},${toY}`);
    } else {
      throw new Error('Drag requires cliclick on macOS. Install with: brew install cliclick');
    }
  }

  async scroll(options: MouseScrollOptions): Promise<void> {
    this.ensureInitialized();
    const { deltaX = 0, deltaY = 0 } = options;

    if (deltaY !== 0) {
      if (this.hasCliclick) {
        // cliclick scroll: positive = up, negative = down
        const amount = -deltaY;
        await this.exec(`cliclick "scroll:0,${amount}"`);
      } else {
        // Fallback: use key codes for up/down arrows
        const keyCode = deltaY < 0 ? 126 : 125; // up : down
        const count = Math.abs(Math.round(deltaY));
        for (let i = 0; i < count; i++) {
          await this.sysEvents(`key code ${keyCode}`);
        }
      }
    }

    if (deltaX !== 0) {
      if (this.hasCliclick) {
        const amount = -deltaX;
        await this.exec(`cliclick "scroll:${amount},0"`);
      } else {
        const keyCode = deltaX < 0 ? 123 : 124; // left : right
        const count = Math.abs(Math.round(deltaX));
        for (let i = 0; i < count; i++) {
          await this.sysEvents(`key code ${keyCode}`);
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Keyboard
  // --------------------------------------------------------------------------

  async keyPress(key: KeyCode, options?: KeyPressOptions): Promise<void> {
    this.ensureInitialized();
    const modClause = this.buildModifierClause(options?.modifiers);
    const lowerKey = key.toLowerCase();
    const code = keyCodeMap[lowerKey];

    if (code !== undefined) {
      await this.sysEvents(`key code ${code}${modClause}`);
    } else if (key.length === 1) {
      const escaped = escapeAppleString(key);
      await this.sysEvents(`keystroke "${escaped}"${modClause}`);
    } else {
      // Try as key code name
      const fallbackCode = keyCodeMap[lowerKey];
      if (fallbackCode !== undefined) {
        await this.sysEvents(`key code ${fallbackCode}${modClause}`);
      } else {
        await this.sysEvents(`keystroke "${escapeAppleString(key)}"${modClause}`);
      }
    }
  }

  async keyDown(key: KeyCode): Promise<void> {
    this.ensureInitialized();
    const lowerKey = key.toLowerCase();
    const code = keyCodeMap[lowerKey];
    if (code !== undefined) {
      await this.sysEvents(`key down ${code}`);
    } else {
      await this.sysEvents(`key down "${escapeAppleString(key)}"`);
    }
  }

  async keyUp(key: KeyCode): Promise<void> {
    this.ensureInitialized();
    const lowerKey = key.toLowerCase();
    const code = keyCodeMap[lowerKey];
    if (code !== undefined) {
      await this.sysEvents(`key up ${code}`);
    } else {
      await this.sysEvents(`key up "${escapeAppleString(key)}"`);
    }
  }

  async type(text: string, options?: TypeOptions): Promise<void> {
    this.ensureInitialized();
    const delay = options?.delay ?? 0;

    // Split long text into chunks to avoid osascript limits
    const chunkSize = 200;
    for (let i = 0; i < text.length; i += chunkSize) {
      const chunk = text.substring(i, i + chunkSize);
      const escaped = escapeAppleString(chunk);
      await this.sysEvents(`keystroke "${escaped}"`);

      if (delay > 0 && i + chunkSize < text.length) {
        await this.delay(delay);
      }
    }
  }

  async hotkey(sequence: HotkeySequence): Promise<void> {
    this.ensureInitialized();
    const modClause = this.buildModifierClause(sequence.modifiers);

    for (const key of sequence.keys) {
      const lowerKey = key.toLowerCase();
      const code = keyCodeMap[lowerKey];

      if (code !== undefined) {
        await this.sysEvents(`key code ${code}${modClause}`);
      } else if (key.length === 1) {
        await this.sysEvents(`keystroke "${escapeAppleString(key)}"${modClause}`);
      } else {
        await this.sysEvents(`keystroke "${escapeAppleString(key)}"${modClause}`);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Window Management
  // --------------------------------------------------------------------------

  async getActiveWindow(): Promise<WindowInfo | null> {
    this.ensureInitialized();
    try {
      const appName = await this.osascript(
        'tell application "System Events" to get name of first application process whose frontmost is true'
      );
      if (!appName) return null;

      // Get window properties
      const script = `tell application "System Events"
  set proc to first application process whose name is "${escapeAppleString(appName)}"
  set wins to windows of proc
  if (count of wins) > 0 then
    set w to window 1 of proc
    set wName to name of w
    set wPos to position of w
    set wSize to size of w
    set wPid to unix id of proc
    return wName & "|" & (item 1 of wPos) & "," & (item 2 of wPos) & "|" & (item 1 of wSize) & "," & (item 2 of wSize) & "|" & wPid
  end if
end tell`;

      const result = await this.osascript(script);
      if (!result) return null;

      const parts = result.split('|');
      const title = parts[0] ?? '';
      const posStr = (parts[1] ?? '0,0').split(',');
      const sizeStr = (parts[2] ?? '0,0').split(',');
      const pid = parseInt(parts[3] ?? '0', 10) || 0;

      return {
        handle: `${appName}:1`,
        title,
        pid,
        processName: appName,
        bounds: {
          x: parseInt(posStr[0] ?? '', 10) || 0,
          y: parseInt(posStr[1] ?? '', 10) || 0,
          width: parseInt(sizeStr[0] ?? '', 10) || 0,
          height: parseInt(sizeStr[1] ?? '', 10) || 0,
        },
        focused: true,
        visible: true,
        minimized: false,
        maximized: false,
        fullscreen: false,
      };
    } catch {
      return null;
    }
  }

  async getWindows(options?: WindowSearchOptions): Promise<WindowInfo[]> {
    this.ensureInitialized();
    try {
      const script = `tell application "System Events"
  set output to ""
  repeat with proc in (every application process whose visible is true)
    set procName to name of proc
    set procPid to unix id of proc
    set idx to 1
    repeat with w in (every window of proc)
      set wName to name of w
      set wPos to position of w
      set wSize to size of w
      set output to output & procName & "|||" & wName & "|||" & (item 1 of wPos) & "," & (item 2 of wPos) & "|||" & (item 1 of wSize) & "," & (item 2 of wSize) & "|||" & procPid & "|||" & idx & "###"
      set idx to idx + 1
    end repeat
  end repeat
  return output
end tell`;

      const result = await this.osascript(script);
      if (!result) return [];

      const entries = result.split('###').filter(e => e.trim().length > 0);
      const windows: WindowInfo[] = [];

      for (const entry of entries) {
        const parts = entry.split('|||');
        if (parts.length < 6) continue;

        // parts.length >= 6 verified above, so indices 0-5 are in-bounds.
        const processName = (parts[0] ?? '').trim();
        const title = (parts[1] ?? '').trim();
        const posStr = (parts[2] ?? '').split(',');
        const sizeStr = (parts[3] ?? '').split(',');
        const pid = parseInt(parts[4] ?? '', 10) || 0;
        const idx = parseInt(parts[5] ?? '', 10) || 1;

        const win: WindowInfo = {
          handle: `${processName}:${idx}`,
          title,
          pid,
          processName,
          bounds: {
            x: parseInt(posStr[0] ?? '', 10) || 0,
            y: parseInt(posStr[1] ?? '', 10) || 0,
            width: parseInt(sizeStr[0] ?? '', 10) || 0,
            height: parseInt(sizeStr[1] ?? '', 10) || 0,
          },
          focused: false,
          visible: true,
          minimized: false,
          maximized: false,
          fullscreen: false,
        };

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
      }

      return windows;
    } catch {
      return [];
    }
  }

  async getWindow(handle: string): Promise<WindowInfo | null> {
    this.ensureInitialized();
    try {
      const { processName, windowIndex } = parseHandle(handle);

      const script = `tell application "System Events"
  set proc to first application process whose name is "${escapeAppleString(processName)}"
  set wins to windows of proc
  if (count of wins) >= ${windowIndex} then
    set w to window ${windowIndex} of proc
    set wName to name of w
    set wPos to position of w
    set wSize to size of w
    set wPid to unix id of proc
    set isFront to frontmost of proc
    return wName & "|" & (item 1 of wPos) & "," & (item 2 of wPos) & "|" & (item 1 of wSize) & "," & (item 2 of wSize) & "|" & wPid & "|" & isFront
  end if
end tell`;

      const result = await this.osascript(script);
      if (!result) return null;

      const parts = result.split('|');
      const title = parts[0] ?? '';
      const posStr = (parts[1] ?? '0,0').split(',');
      const sizeStr = (parts[2] ?? '0,0').split(',');
      const pid = parseInt(parts[3] ?? '0', 10) || 0;
      const focused = parts[4]?.trim() === 'true';

      return {
        handle,
        title,
        pid,
        processName,
        bounds: {
          x: parseInt(posStr[0] ?? '', 10) || 0,
          y: parseInt(posStr[1] ?? '', 10) || 0,
          width: parseInt(sizeStr[0] ?? '', 10) || 0,
          height: parseInt(sizeStr[1] ?? '', 10) || 0,
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
    const { processName, windowIndex } = parseHandle(handle);
    const escaped = escapeAppleString(processName);

    await this.osascript(`tell application "${escaped}" to activate`);
    if (windowIndex > 1) {
      await this.sysEvents(
        `perform action "AXRaise" of window ${windowIndex} of process "${escaped}"`
      );
    }
  }

  async minimizeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    const { processName, windowIndex } = parseHandle(handle);
    const escaped = escapeAppleString(processName);

    await this.sysEvents(
      `set miniaturized of window ${windowIndex} of process "${escaped}" to true`
    );
  }

  async maximizeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    const { processName, windowIndex } = parseHandle(handle);
    const escaped = escapeAppleString(processName);

    // macOS has no true maximize; move to origin and resize to screen size
    try {
      const screenScript = `tell application "Finder" to get bounds of window of desktop`;
      const boundsStr = await this.osascript(screenScript);
      const bounds = boundsStr.split(',').map(s => parseInt(s.trim(), 10));

      if (bounds.length >= 4) {
        // safe: bounds.length >= 4 verified on the line above, indices 0-3 in-bounds
        const width = (bounds[2] ?? 0) - (bounds[0] ?? 0);
        const height = (bounds[3] ?? 0) - (bounds[1] ?? 0);
        await this.sysEvents(
          `set position of window ${windowIndex} of process "${escaped}" to {0, 0}`
        );
        await this.sysEvents(
          `set size of window ${windowIndex} of process "${escaped}" to {${width}, ${height}}`
        );
      }
    } catch {
      // Fallback: use AXZoomButton (green button) behavior
      await this.sysEvents(
        `click button 2 of window ${windowIndex} of process "${escaped}"`
      );
    }
  }

  async restoreWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    const { processName, windowIndex } = parseHandle(handle);
    const escaped = escapeAppleString(processName);

    await this.sysEvents(
      `set miniaturized of window ${windowIndex} of process "${escaped}" to false`
    );
  }

  async closeWindow(handle: string): Promise<void> {
    this.ensureInitialized();
    const { processName, windowIndex } = parseHandle(handle);
    const escaped = escapeAppleString(processName);

    try {
      await this.osascript(
        `tell application "${escaped}" to close window ${windowIndex}`
      );
    } catch {
      // Fallback: click close button via System Events
      await this.sysEvents(
        `click button 1 of window ${windowIndex} of process "${escaped}"`
      );
    }
  }

  async setWindow(handle: string, options: WindowSetOptions): Promise<void> {
    this.ensureInitialized();
    const { processName, windowIndex } = parseHandle(handle);
    const escaped = escapeAppleString(processName);

    if (options.position) {
      await this.sysEvents(
        `set position of window ${windowIndex} of process "${escaped}" to {${options.position.x}, ${options.position.y}}`
      );
    }
    if (options.size) {
      await this.sysEvents(
        `set size of window ${windowIndex} of process "${escaped}" to {${options.size.width}, ${options.size.height}}`
      );
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
      const script = `tell application "System Events"
  set output to ""
  repeat with proc in (every application process whose background only is false)
    set procName to name of proc
    set procPid to unix id of proc
    set procFile to ""
    try
      set procFile to POSIX path of (file of proc as alias)
    end try
    set output to output & procName & "|||" & procPid & "|||" & procFile & "###"
  end repeat
  return output
end tell`;

      const result = await this.osascript(script);
      if (!result) return [];

      const entries = result.split('###').filter(e => e.trim().length > 0);
      const apps: AppInfo[] = [];

      for (const entry of entries) {
        const parts = entry.split('|||');
        if (parts.length < 3) continue;

        // parts.length >= 3 verified above, so indices 0-2 are in-bounds.
        apps.push({
          name: parts[0]?.trim() ?? '',
          path: parts[2]?.trim() ?? '',
          pid: parseInt(parts[1] ?? '', 10) || undefined,
          running: true,
        });
      }

      return apps;
    } catch {
      return [];
    }
  }

  async launchApp(appPath: string, options?: AppLaunchOptions): Promise<AppInfo> {
    this.ensureInitialized();
    const args = options?.args ?? [];
    const appName = appPath.replace(/\.app$/, '').split('/').pop() ?? appPath;

    // Use 'open' command for .app bundles or direct paths
    const openArgs = ['-a', appPath, ...args];
    if (options?.hidden) {
      openArgs.unshift('-g'); // open in background
    }

    const child = spawn('open', openArgs, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // Wait briefly then try to get PID
    await this.delay(500);
    let pid: number | undefined;
    try {
      const pidStr = await this.exec(`pgrep -n "${escapeAppleString(appName)}"`);
      pid = parseInt(pidStr.trim(), 10) || undefined;
    } catch {
      // Process might not be findable by name
    }

    return {
      name: appName,
      path: appPath,
      pid,
      running: true,
    };
  }

  async closeApp(pid: number): Promise<void> {
    this.ensureInitialized();
    try {
      // Try graceful quit via AppleScript first
      const nameResult = await this.exec(`ps -p ${pid} -o comm=`);
      const appName = nameResult.trim();
      if (appName) {
        await this.osascript(`tell application "${escapeAppleString(appName)}" to quit`);
        return;
      }
    } catch {
      // Fallback to SIGTERM
    }

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
    try {
      const output = await this.exec('system_profiler SPDisplaysDataType -json');
      const data = JSON.parse(output);
      const screens: ScreenInfo[] = [];
      let screenId = 0;

      const gpus = data?.SPDisplaysDataType ?? [];
      for (const gpu of gpus) {
        const displays = gpu?.spdisplays_ndrvs ?? [];
        for (const display of displays) {
          const resolution = display?._spdisplays_resolution ?? '';
          // Parse resolution like "1920 x 1080 (QHD/QWXGA - Wide)"
          const resMatch = resolution.match(/(\d+)\s*x\s*(\d+)/);
          const width = resMatch ? parseInt(resMatch[1], 10) : 0;
          const height = resMatch ? parseInt(resMatch[2], 10) : 0;

          const name = display?._name ?? `Display ${screenId}`;
          const isPrimary = display?.spdisplays_main === 'spdisplays_yes';

          const scaleStr = display?._spdisplays_retina ?? '';
          const scaleFactor = scaleStr.toLowerCase().includes('retina') ? 2 : 1;

          screens.push({
            id: screenId++,
            name,
            bounds: { x: 0, y: 0, width, height },
            workArea: { x: 0, y: 0, width, height },
            scaleFactor,
            primary: isPrimary,
          });
        }
      }

      return screens;
    } catch {
      return [];
    }
  }

  async getPixelColor(_x: number, _y: number): Promise<ColorInfo> {
    throw new Error('Color picker requires screenshot analysis on macOS');
  }

  // --------------------------------------------------------------------------
  // Clipboard
  // --------------------------------------------------------------------------

  async getClipboard(): Promise<ClipboardContent> {
    this.ensureInitialized();
    let text = '';
    try {
      text = await this.exec('pbpaste');
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
      nodeExecSync('pbcopy', {
        input: text,
        encoding: 'utf-8',
        timeout: 5000,
      });
    } catch {
      // Clipboard operation failed
    }
  }

  async clearClipboard(): Promise<void> {
    this.ensureInitialized();
    try {
      nodeExecSync('pbcopy', {
        input: '',
        encoding: 'utf-8',
        timeout: 5000,
      });
    } catch {
      // Clipboard operation failed
    }
  }
}
