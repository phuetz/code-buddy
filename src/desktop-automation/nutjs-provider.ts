/**
 * Nut.js Automation Provider
 *
 * Real desktop automation using @nut-tree-fork/nut-js.
 * Provides mouse, keyboard, window, and clipboard control.
 */

import type {
  ModifierKey,
  MouseButton,
  MousePosition,
  MouseMoveOptions,
  MouseClickOptions,
  MouseDragOptions,
  MouseScrollOptions,
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
  AutomationProvider,
  ProviderCapabilities,
} from './types.js';
import type { IAutomationProvider } from './automation-manager.js';

// Dynamic imports to avoid loading native modules at startup
let nutjsModule: typeof import('@nut-tree-fork/nut-js') | null = null;

function shouldUseHeadlessNutJsMock(): boolean {
  return process.env.NODE_ENV === 'test'
    && process.env.CODEBUDDY_USE_REAL_NUTJS_IN_TESTS !== '1';
}

function createHeadlessNutJsMock(): typeof import('@nut-tree-fork/nut-js') {
  let mousePosition = { x: 0, y: 0 };
  let clipboardText = '';

  const keyMap = new Proxy<Record<string, string>>(
    { Space: 'Space' },
    {
      get(target, key) {
        if (typeof key !== 'string') {
          return target.Space;
        }
        return target[key] ?? key;
      },
    }
  );

  const createWindow = () => ({
    region: Promise.resolve({ left: 100, top: 100, width: 1280, height: 720 }),
    title: Promise.resolve('Mock Window'),
    _native: Promise.resolve({ hwnd: 1 }),
  });

  return {
    Key: keyMap,
    Button: {
      LEFT: 0,
      RIGHT: 1,
      MIDDLE: 2,
    },
    mouse: {
      getPosition: async () => ({ ...mousePosition }),
      setPosition: async (position: { x: number; y: number }) => {
        mousePosition = { x: position.x, y: position.y };
      },
      move: async (target: { x: number; y: number }) => {
        mousePosition = { x: target.x, y: target.y };
      },
      click: async (_button?: number) => {
        // No-op in headless fallback
      },
      doubleClick: async (_button?: number) => {
        // No-op in headless fallback
      },
      rightClick: async () => {
        // No-op in headless fallback
      },
      pressButton: async (_button?: number) => {
        // No-op in headless fallback
      },
      releaseButton: async (_button?: number) => {
        // No-op in headless fallback
      },
      scrollDown: async (_amount: number) => {
        // No-op in headless fallback
      },
    },
    keyboard: {
      pressKey: async (..._keys: unknown[]) => {
        // No-op in headless fallback
      },
      releaseKey: async (..._keys: unknown[]) => {
        // No-op in headless fallback
      },
      type: async (_text: string) => {
        // No-op in headless fallback
      },
    },
    straightTo: (point: { x: number; y: number }) => point,
    getActiveWindow: async () => createWindow(),
    getWindows: async () => [createWindow()],
    screen: {
      width: async () => 1920,
      height: async () => 1080,
      colorAt: async (position: { x: number; y: number }) => ({
        R: position.x % 256,
        G: position.y % 256,
        B: (position.x + position.y) % 256,
        A: 255,
      }),
    },
    clipboard: {
      getContent: async () => clipboardText,
      setContent: async (text: string) => {
        clipboardText = text;
      },
    },
  } as unknown as typeof import('@nut-tree-fork/nut-js');
}

async function getNutJs() {
  if (shouldUseHeadlessNutJsMock()) {
    return createHeadlessNutJsMock();
  }

  if (!nutjsModule) {
    nutjsModule = await import('@nut-tree-fork/nut-js');
  }
  return nutjsModule;
}

// Key mapping from our KeyCode to nut.js Key enum
const KEY_MAP: Record<string, string> = {
  // Letters
  a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', h: 'H',
  i: 'I', j: 'J', k: 'K', l: 'L', m: 'M', n: 'N', o: 'O', p: 'P',
  q: 'Q', r: 'R', s: 'S', t: 'T', u: 'U', v: 'V', w: 'W', x: 'X',
  y: 'Y', z: 'Z',
  // Numbers
  '0': 'Num0', '1': 'Num1', '2': 'Num2', '3': 'Num3', '4': 'Num4',
  '5': 'Num5', '6': 'Num6', '7': 'Num7', '8': 'Num8', '9': 'Num9',
  // Function keys
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5', f6: 'F6',
  f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10', f11: 'F11', f12: 'F12',
  // Special keys
  enter: 'Enter', return: 'Return', escape: 'Escape', esc: 'Escape',
  backspace: 'Backspace', tab: 'Tab', space: 'Space',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  insert: 'Insert', delete: 'Delete',
  // Modifiers
  ctrl: 'LeftControl', control: 'LeftControl',
  alt: 'LeftAlt', shift: 'LeftShift',
  meta: 'LeftSuper', command: 'LeftSuper', win: 'LeftSuper',
  // Punctuation
  minus: 'Minus', plus: 'Add', equals: 'Equal',
  '[': 'LeftBracket', ']': 'RightBracket',
  ';': 'Semicolon', "'": 'Quote', '`': 'Grave',
  ',': 'Comma', '.': 'Period', '/': 'Slash', '\\': 'Backslash',
};

// Mouse button mapping
const BUTTON_MAP: Record<MouseButton, number> = {
  left: 0,
  right: 1,
  middle: 2,
};

export class NutJsProvider implements IAutomationProvider {
  readonly name: AutomationProvider = 'nutjs';
  readonly capabilities: ProviderCapabilities = {
    mouse: true,
    keyboard: true,
    windows: true,
    apps: false, // Limited app control in nut.js
    screenshots: true,
    colorPicker: true,
    clipboard: true,
    ocr: false,
  };

  private initialized = false;
  private nutjs: typeof import('@nut-tree-fork/nut-js') | null = null;

  async initialize(): Promise<void> {
    try {
      this.nutjs = await getNutJs();
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize nut.js: ${error}`);
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await getNutJs();
      return true;
    } catch {
      return false;
    }
  }

  private ensureInitialized() {
    if (!this.initialized || !this.nutjs) {
      throw new Error('NutJsProvider not initialized');
    }
    return this.nutjs;
  }

  private getKey(key: KeyCode) {
    const nutjs = this.ensureInitialized();
    const mapped = KEY_MAP[key.toLowerCase()] || key.toUpperCase();
    return (nutjs.Key as unknown as Record<string, number>)[mapped] ?? nutjs.Key.Space;
  }

  // ============================================================================
  // Mouse Operations
  // ============================================================================

  async getMousePosition(): Promise<MousePosition> {
    const nutjs = this.ensureInitialized();
    const pos = await nutjs.mouse.getPosition();
    return { x: pos.x, y: pos.y };
  }

  async moveMouse(x: number, y: number, options?: MouseMoveOptions): Promise<void> {
    const nutjs = this.ensureInitialized();

    if (options?.smooth && options.duration) {
      // Smooth movement with duration
      await nutjs.mouse.move(
        nutjs.straightTo({ x, y }),
      );
    } else {
      await nutjs.mouse.setPosition({ x, y });
    }
  }

  async click(options?: MouseClickOptions): Promise<void> {
    const nutjs = this.ensureInitialized();
    const button = options?.button
      ? BUTTON_MAP[options.button]
      : nutjs.Button.LEFT;

    const clicks = options?.clicks || 1;

    for (let i = 0; i < clicks; i++) {
      await nutjs.mouse.click(button);
      if (options?.delay && i < clicks - 1) {
        await this.delay(options.delay);
      }
    }
  }

  async doubleClick(button?: MouseButton): Promise<void> {
    const nutjs = this.ensureInitialized();
    const btn = button ? BUTTON_MAP[button] : nutjs.Button.LEFT;
    await nutjs.mouse.doubleClick(btn);
  }

  async rightClick(): Promise<void> {
    const nutjs = this.ensureInitialized();
    await nutjs.mouse.rightClick();
  }

  async drag(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    _options?: MouseDragOptions,
  ): Promise<void> {
    const nutjs = this.ensureInitialized();
    await nutjs.mouse.setPosition({ x: fromX, y: fromY });
    await nutjs.mouse.pressButton(nutjs.Button.LEFT);
    await nutjs.mouse.move(nutjs.straightTo({ x: toX, y: toY }));
    await nutjs.mouse.releaseButton(nutjs.Button.LEFT);
  }

  async scroll(options: MouseScrollOptions): Promise<void> {
    const nutjs = this.ensureInitialized();

    if (options.deltaY) {
      await nutjs.mouse.scrollDown(Math.abs(options.deltaY));
    }
    if (options.deltaX) {
      // nut.js doesn't have horizontal scroll, simulate with left/right
      // This is a limitation
    }
  }

  // ============================================================================
  // Keyboard Operations
  // ============================================================================

  async keyPress(key: KeyCode, options?: KeyPressOptions): Promise<void> {
    const nutjs = this.ensureInitialized();
    const nutKey = this.getKey(key);

    if (options?.modifiers?.length) {
      const modKeys = options.modifiers.map((m) => this.getKey(m));
      await nutjs.keyboard.pressKey(...modKeys);
      await nutjs.keyboard.pressKey(nutKey);
      await nutjs.keyboard.releaseKey(nutKey);
      await nutjs.keyboard.releaseKey(...modKeys);
    } else {
      await nutjs.keyboard.pressKey(nutKey);
      if (options?.delay) {
        await this.delay(options.delay);
      }
      await nutjs.keyboard.releaseKey(nutKey);
    }
  }

  async keyDown(key: KeyCode): Promise<void> {
    const nutjs = this.ensureInitialized();
    await nutjs.keyboard.pressKey(this.getKey(key));
  }

  async keyUp(key: KeyCode): Promise<void> {
    const nutjs = this.ensureInitialized();
    await nutjs.keyboard.releaseKey(this.getKey(key));
  }

  async type(text: string, options?: TypeOptions): Promise<void> {
    const nutjs = this.ensureInitialized();

    if (options?.delay) {
      // Type character by character with delay
      for (const char of text) {
        await nutjs.keyboard.type(char);
        await this.delay(options.delay + (options.variance ? Math.random() * options.variance : 0));
      }
    } else {
      await nutjs.keyboard.type(text);
    }
  }

  async hotkey(sequence: HotkeySequence): Promise<void> {
    const nutjs = this.ensureInitialized();

    const modKeys = (sequence.modifiers || []).map((m) => this.getKey(m));
    const keys = sequence.keys.map((k) => this.getKey(k));

    // Press modifiers
    for (const mod of modKeys) {
      await nutjs.keyboard.pressKey(mod);
    }

    // Press and release keys
    for (const key of keys) {
      await nutjs.keyboard.pressKey(key);
      await nutjs.keyboard.releaseKey(key);
    }

    // Release modifiers
    for (const mod of modKeys.reverse()) {
      await nutjs.keyboard.releaseKey(mod);
    }
  }

  // ============================================================================
  // Window Operations (Limited in nut.js)
  // ============================================================================

  async getActiveWindow(): Promise<WindowInfo | null> {
    const nutjs = this.ensureInitialized();
    try {
      const win = await nutjs.getActiveWindow();
      const region = await win.region;

      return {
        handle: String(await (win as unknown as { _native: Promise<{ hwnd: number }> })._native.then(n => n.hwnd).catch(() => Math.random())),
        title: await win.title,
        pid: 0, // Not available in nut.js
        processName: '',
        bounds: {
          x: region.left,
          y: region.top,
          width: region.width,
          height: region.height,
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

  async getWindows(_options?: WindowSearchOptions): Promise<WindowInfo[]> {
    const nutjs = this.ensureInitialized();
    try {
      const windows = await nutjs.getWindows();
      const results: WindowInfo[] = [];

      for (const win of windows) {
        try {
          const region = await win.region;
          const title = await win.title;

          results.push({
            handle: String(Math.random()),
            title,
            pid: 0,
            processName: '',
            bounds: {
              x: region.left,
              y: region.top,
              width: region.width,
              height: region.height,
            },
            focused: false,
            visible: true,
            minimized: false,
            maximized: false,
            fullscreen: false,
          });
        } catch {
          // Skip windows that can't be queried
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  async getWindow(_handle: string): Promise<WindowInfo | null> {
    // nut.js doesn't support getting window by handle
    return null;
  }

  async focusWindow(_handle: string): Promise<void> {
    // nut.js has limited window focus support
    // Would need to search by title and use focus()
  }

  async minimizeWindow(_handle: string): Promise<void> {
    // Not directly supported in nut.js
  }

  async maximizeWindow(_handle: string): Promise<void> {
    // Not directly supported in nut.js
  }

  async restoreWindow(_handle: string): Promise<void> {
    // Not directly supported in nut.js
  }

  async closeWindow(_handle: string): Promise<void> {
    // Not directly supported in nut.js
  }

  async setWindow(_handle: string, _options: WindowSetOptions): Promise<void> {
    // Not directly supported in nut.js
  }

  // ============================================================================
  // Application Operations (Not supported)
  // ============================================================================

  async getRunningApps(): Promise<AppInfo[]> {
    return [];
  }

  async launchApp(_appPath: string, _options?: AppLaunchOptions): Promise<AppInfo> {
    throw new Error('App launching not supported by nut.js provider');
  }

  async closeApp(_pid: number): Promise<void> {
    throw new Error('App closing not supported by nut.js provider');
  }

  // ============================================================================
  // Screen Operations
  // ============================================================================

  async getScreens(): Promise<ScreenInfo[]> {
    const nutjs = this.ensureInitialized();
    try {
      const screen = await nutjs.screen.width();
      const height = await nutjs.screen.height();

      return [
        {
          id: 0,
          name: 'Primary Display',
          bounds: { x: 0, y: 0, width: screen, height },
          workArea: { x: 0, y: 0, width: screen, height },
          scaleFactor: 1,
          primary: true,
        },
      ];
    } catch {
      return [];
    }
  }

  async getPixelColor(x: number, y: number): Promise<ColorInfo> {
    const nutjs = this.ensureInitialized();
    try {
      const color = await nutjs.screen.colorAt({ x, y });
      return {
        r: color.R,
        g: color.G,
        b: color.B,
        a: color.A,
        hex: `#${color.R.toString(16).padStart(2, '0')}${color.G.toString(16).padStart(2, '0')}${color.B.toString(16).padStart(2, '0')}`,
      };
    } catch {
      return { r: 0, g: 0, b: 0, hex: '#000000' };
    }
  }

  // ============================================================================
  // Clipboard Operations
  // ============================================================================

  async getClipboard(): Promise<ClipboardContent> {
    const nutjs = this.ensureInitialized();
    try {
      const text = await nutjs.clipboard.getContent();
      return {
        text,
        formats: text ? ['text'] : [],
      };
    } catch {
      return { formats: [] };
    }
  }

  async setClipboard(content: Partial<ClipboardContent>): Promise<void> {
    const nutjs = this.ensureInitialized();
    if (content.text) {
      await nutjs.clipboard.setContent(content.text);
    }
  }

  async clearClipboard(): Promise<void> {
    const nutjs = this.ensureInitialized();
    await nutjs.clipboard.setContent('');
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
