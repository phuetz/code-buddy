/**
 * Desktop Automation Manager
 *
 * Unified interface for mouse, keyboard, window, and application control.
 * Supports multiple backends (robotjs, nut.js, etc.) with mock for testing.
 */

import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
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
  ProviderStatus,
  DesktopAutomationConfig,
} from './types.js';
import { DEFAULT_AUTOMATION_CONFIG } from './types.js';

// ============================================================================
// Provider Interface
// ============================================================================

export interface IAutomationProvider {
  readonly name: AutomationProvider;
  readonly capabilities: ProviderCapabilities;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  isAvailable(): Promise<boolean>;

  // Mouse
  getMousePosition(): Promise<MousePosition>;
  moveMouse(x: number, y: number, options?: MouseMoveOptions): Promise<void>;
  click(options?: MouseClickOptions): Promise<void>;
  doubleClick(button?: MouseButton): Promise<void>;
  rightClick(): Promise<void>;
  drag(fromX: number, fromY: number, toX: number, toY: number, options?: MouseDragOptions): Promise<void>;
  scroll(options: MouseScrollOptions): Promise<void>;

  // Keyboard
  keyPress(key: KeyCode, options?: KeyPressOptions): Promise<void>;
  keyDown(key: KeyCode): Promise<void>;
  keyUp(key: KeyCode): Promise<void>;
  type(text: string, options?: TypeOptions): Promise<void>;
  hotkey(sequence: HotkeySequence): Promise<void>;

  // Windows
  getActiveWindow(): Promise<WindowInfo | null>;
  getWindows(options?: WindowSearchOptions): Promise<WindowInfo[]>;
  getWindow(handle: string): Promise<WindowInfo | null>;
  focusWindow(handle: string): Promise<void>;
  minimizeWindow(handle: string): Promise<void>;
  maximizeWindow(handle: string): Promise<void>;
  restoreWindow(handle: string): Promise<void>;
  closeWindow(handle: string): Promise<void>;
  setWindow(handle: string, options: WindowSetOptions): Promise<void>;

  // Applications
  getRunningApps(): Promise<AppInfo[]>;
  launchApp(appPath: string, options?: AppLaunchOptions): Promise<AppInfo>;
  closeApp(pid: number): Promise<void>;

  // Screen
  getScreens(): Promise<ScreenInfo[]>;
  getPixelColor(x: number, y: number): Promise<ColorInfo>;

  // Clipboard
  getClipboard(): Promise<ClipboardContent>;
  setClipboard(content: Partial<ClipboardContent>): Promise<void>;
  clearClipboard(): Promise<void>;
}

// ============================================================================
// Mock Provider (for testing and fallback)
// ============================================================================

export class MockAutomationProvider implements IAutomationProvider {
  readonly name: AutomationProvider = 'mock';
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

  private mousePos: MousePosition = { x: 500, y: 500 };
  private mockWindows: WindowInfo[] = [];
  private mockApps: AppInfo[] = [];
  private mockClipboard: ClipboardContent = { formats: [] };
  private initialized = false;
  private windowIdCounter = 1;
  private appPidCounter = 1000;

  async initialize(): Promise<void> {
    this.initialized = true;
    this.mockWindows = [
      {
        handle: 'window-1',
        title: 'Terminal',
        pid: 1001,
        processName: 'terminal',
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        focused: true,
        visible: true,
        minimized: false,
        maximized: false,
        fullscreen: false,
      },
      {
        handle: 'window-2',
        title: 'Browser - Home',
        pid: 1002,
        processName: 'browser',
        bounds: { x: 200, y: 150, width: 1200, height: 800 },
        focused: false,
        visible: true,
        minimized: false,
        maximized: false,
        fullscreen: false,
      },
    ];
    this.mockApps = [
      {
        name: 'Terminal',
        path: '/usr/bin/terminal',
        pid: 1001,
        running: true,
      },
      {
        name: 'Browser',
        path: '/usr/bin/browser',
        pid: 1002,
        running: true,
      },
    ];
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  async isAvailable(): Promise<boolean> {
    return true; // Mock is always available
  }

  // Mouse
  async getMousePosition(): Promise<MousePosition> {
    return { ...this.mousePos };
  }

  async moveMouse(x: number, y: number, options?: MouseMoveOptions): Promise<void> {
    if (options?.duration && options.duration > 0) {
      await this.simulateDelay(options.duration);
    }
    this.mousePos = { x, y };
  }

  async click(_options?: MouseClickOptions): Promise<void> {
    await this.simulateDelay(50);
  }

  async doubleClick(_button?: MouseButton): Promise<void> {
    await this.simulateDelay(100);
  }

  async rightClick(): Promise<void> {
    await this.simulateDelay(50);
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number, options?: MouseDragOptions): Promise<void> {
    this.mousePos = { x: fromX, y: fromY };
    await this.simulateDelay(options?.duration || 200);
    this.mousePos = { x: toX, y: toY };
  }

  async scroll(_options: MouseScrollOptions): Promise<void> {
    await this.simulateDelay(50);
  }

  // Keyboard
  async keyPress(_key: KeyCode, _options?: KeyPressOptions): Promise<void> {
    await this.simulateDelay(30);
  }

  async keyDown(_key: KeyCode): Promise<void> {
    await this.simulateDelay(10);
  }

  async keyUp(_key: KeyCode): Promise<void> {
    await this.simulateDelay(10);
  }

  async type(text: string, options?: TypeOptions): Promise<void> {
    const delay = options?.delay || 30;
    await this.simulateDelay(text.length * delay);
  }

  async hotkey(_sequence: HotkeySequence): Promise<void> {
    await this.simulateDelay(50);
  }

  // Windows
  async getActiveWindow(): Promise<WindowInfo | null> {
    return this.mockWindows.find(w => w.focused) || null;
  }

  async getWindows(options?: WindowSearchOptions): Promise<WindowInfo[]> {
    let windows = [...this.mockWindows];

    if (options?.title) {
      const pattern = options.title instanceof RegExp
        ? options.title
        : new RegExp(options.title, 'i');
      windows = windows.filter(w => pattern.test(w.title));
    }

    if (options?.processName) {
      windows = windows.filter(w => w.processName === options.processName);
    }

    if (options?.pid) {
      windows = windows.filter(w => w.pid === options.pid);
    }

    if (!options?.includeHidden) {
      windows = windows.filter(w => w.visible);
    }

    if (!options?.includeMinimized) {
      windows = windows.filter(w => !w.minimized);
    }

    return windows;
  }

  async getWindow(handle: string): Promise<WindowInfo | null> {
    return this.mockWindows.find(w => w.handle === handle) || null;
  }

  async focusWindow(handle: string): Promise<void> {
    for (const window of this.mockWindows) {
      window.focused = window.handle === handle;
    }
  }

  async minimizeWindow(handle: string): Promise<void> {
    const window = this.mockWindows.find(w => w.handle === handle);
    if (window) {
      window.minimized = true;
      window.focused = false;
    }
  }

  async maximizeWindow(handle: string): Promise<void> {
    const window = this.mockWindows.find(w => w.handle === handle);
    if (window) {
      window.maximized = true;
      window.minimized = false;
    }
  }

  async restoreWindow(handle: string): Promise<void> {
    const window = this.mockWindows.find(w => w.handle === handle);
    if (window) {
      window.minimized = false;
      window.maximized = false;
    }
  }

  async closeWindow(handle: string): Promise<void> {
    const index = this.mockWindows.findIndex(w => w.handle === handle);
    if (index >= 0) {
      this.mockWindows.splice(index, 1);
    }
  }

  async setWindow(handle: string, options: WindowSetOptions): Promise<void> {
    const window = this.mockWindows.find(w => w.handle === handle);
    if (window) {
      if (options.position) {
        window.bounds.x = options.position.x;
        window.bounds.y = options.position.y;
      }
      if (options.size) {
        window.bounds.width = options.size.width;
        window.bounds.height = options.size.height;
      }
      if (options.focus) {
        await this.focusWindow(handle);
      }
    }
  }

  // Applications
  async getRunningApps(): Promise<AppInfo[]> {
    return [...this.mockApps];
  }

  async launchApp(appPath: string, _options?: AppLaunchOptions): Promise<AppInfo> {
    const pid = this.appPidCounter++;
    const name = appPath.split('/').pop() || 'App';

    const app: AppInfo = {
      name,
      path: appPath,
      pid,
      running: true,
    };

    this.mockApps.push(app);

    // Create a window for the app
    const window: WindowInfo = {
      handle: `window-${this.windowIdCounter++}`,
      title: name,
      pid,
      processName: name.toLowerCase(),
      bounds: { x: 100 + this.windowIdCounter * 50, y: 100 + this.windowIdCounter * 30, width: 800, height: 600 },
      focused: true,
      visible: true,
      minimized: false,
      maximized: false,
      fullscreen: false,
    };

    this.mockWindows.push(window);

    return app;
  }

  async closeApp(pid: number): Promise<void> {
    const index = this.mockApps.findIndex(a => a.pid === pid);
    if (index >= 0) {
      this.mockApps.splice(index, 1);
      this.mockWindows = this.mockWindows.filter(w => w.pid !== pid);
    }
  }

  // Screen
  async getScreens(): Promise<ScreenInfo[]> {
    return [
      {
        id: 0,
        name: 'Primary Display',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1,
        primary: true,
        refreshRate: 60,
      },
    ];
  }

  async getPixelColor(x: number, y: number): Promise<ColorInfo> {
    // Return a mock color based on position
    const r = x % 256;
    const g = y % 256;
    const b = (x + y) % 256;
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

    return { r, g, b, a: 255, hex };
  }

  // Clipboard
  async getClipboard(): Promise<ClipboardContent> {
    return { ...this.mockClipboard };
  }

  async setClipboard(content: Partial<ClipboardContent>): Promise<void> {
    this.mockClipboard = {
      ...this.mockClipboard,
      ...content,
      formats: Object.keys(content).filter(k => k !== 'formats' && content[k as keyof ClipboardContent]),
    };
  }

  async clearClipboard(): Promise<void> {
    this.mockClipboard = { formats: [] };
  }

  // Helper
  private async simulateDelay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, Math.min(ms, 100)));
  }

  // Test helpers
  addMockWindow(window: WindowInfo): void {
    this.mockWindows.push(window);
  }

  removeMockWindow(handle: string): void {
    this.mockWindows = this.mockWindows.filter(w => w.handle !== handle);
  }
}

// ============================================================================
// Automation Manager
// ============================================================================

export class DesktopAutomationManager extends EventEmitter {
  private config: DesktopAutomationConfig;
  private provider: IAutomationProvider | null = null;
  private providers: Map<AutomationProvider, IAutomationProvider> = new Map();
  private failSafeActive = false;
  private lastActionTime = 0;

  constructor(config: Partial<DesktopAutomationConfig> = {}) {
    super();
    this.config = { ...DEFAULT_AUTOMATION_CONFIG, ...config };
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Register a provider
   */
  registerProvider(provider: IAutomationProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Initialize with the best available provider
   */
  async initialize(): Promise<void> {
    // Register mock provider by default
    if (!this.providers.has('mock')) {
      this.registerProvider(new MockAutomationProvider());
    }

    // Auto-create native provider if requested but not yet registered
    if (this.config.provider === 'native' && !this.providers.has('native')) {
      const nativeProvider = await this.createNativeProvider();
      if (nativeProvider) {
        this.registerProvider(nativeProvider);
      }
    }

    // Try preferred provider first
    const preferred = this.providers.get(this.config.provider);
    if (preferred && await preferred.isAvailable()) {
      await preferred.initialize();
      this.provider = preferred;
      return;
    }

    // Try fallback providers
    for (const fallbackName of this.config.fallbackProviders || []) {
      const fallback = this.providers.get(fallbackName);
      if (fallback && await fallback.isAvailable()) {
        await fallback.initialize();
        this.provider = fallback;
        return;
      }
    }

    // Fall back to mock
    const mock = this.providers.get('mock');
    if (mock) {
      await mock.initialize();
      this.provider = mock;
    } else {
      throw new Error('No automation provider available');
    }
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    if (this.provider) {
      await this.provider.shutdown();
      this.provider = null;
    }
  }

  /**
   * Get current provider status
   */
  async getProviderStatus(): Promise<ProviderStatus | null> {
    if (!this.provider) return null;

    return {
      name: this.provider.name,
      available: await this.provider.isAvailable(),
      capabilities: this.provider.capabilities,
    };
  }

  /**
   * Get all provider statuses
   */
  async getAllProviderStatuses(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = [];

    for (const [_, provider] of this.providers) {
      statuses.push({
        name: provider.name,
        available: await provider.isAvailable(),
        capabilities: provider.capabilities,
      });
    }

    return statuses;
  }

  // ============================================================================
  // Safety
  // ============================================================================

  private async checkSafety(): Promise<void> {
    if (!this.config.safety.failSafe) return;

    const pos = await this.getMousePosition();
    const screens = await this.getScreens();
    const screen = screens[0];

    if (!screen) return;

    let isInCorner = false;
    const threshold = 5;

    switch (this.config.safety.failSafeCorner) {
      case 'topLeft':
        isInCorner = pos.x < threshold && pos.y < threshold;
        break;
      case 'topRight':
        isInCorner = pos.x > screen.bounds.width - threshold && pos.y < threshold;
        break;
      case 'bottomLeft':
        isInCorner = pos.x < threshold && pos.y > screen.bounds.height - threshold;
        break;
      case 'bottomRight':
        isInCorner = pos.x > screen.bounds.width - threshold && pos.y > screen.bounds.height - threshold;
        break;
    }

    if (isInCorner && !this.failSafeActive) {
      this.failSafeActive = true;
      this.emit('fail-safe');
      throw new Error('Fail-safe triggered: automation aborted');
    }
  }

  private async enforceDelay(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastActionTime;
    const minDelay = this.config.safety.minActionDelay;

    if (elapsed < minDelay) {
      await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
    }

    this.lastActionTime = Date.now();
  }

  private ensureProvider(): IAutomationProvider {
    if (!this.provider) {
      throw new Error('Automation not initialized. Call initialize() first.');
    }
    return this.provider;
  }

  // ============================================================================
  // Mouse Operations
  // ============================================================================

  async getMousePosition(): Promise<MousePosition> {
    return this.ensureProvider().getMousePosition();
  }

  async moveMouse(x: number, y: number, options?: MouseMoveOptions): Promise<void> {
    await this.checkSafety();
    await this.enforceDelay();

    await this.ensureProvider().moveMouse(x, y, options);
    this.emit('mouse-move', { x, y });
  }

  async click(x?: number, y?: number, options?: MouseClickOptions): Promise<void> {
    await this.checkSafety();
    await this.enforceDelay();

    if (x !== undefined && y !== undefined) {
      await this.moveMouse(x, y);
    }

    const pos = await this.getMousePosition();
    await this.ensureProvider().click(options);
    this.emit('mouse-click', pos, options?.button || 'left');
  }

  async doubleClick(x?: number, y?: number, button?: MouseButton): Promise<void> {
    await this.checkSafety();
    await this.enforceDelay();

    if (x !== undefined && y !== undefined) {
      await this.moveMouse(x, y);
    }

    await this.ensureProvider().doubleClick(button);
  }

  async rightClick(x?: number, y?: number): Promise<void> {
    await this.checkSafety();
    await this.enforceDelay();

    if (x !== undefined && y !== undefined) {
      await this.moveMouse(x, y);
    }

    await this.ensureProvider().rightClick();
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number, options?: MouseDragOptions): Promise<void> {
    await this.checkSafety();
    await this.enforceDelay();

    await this.ensureProvider().drag(fromX, fromY, toX, toY, options);
    this.emit('mouse-drag', { x: fromX, y: fromY }, { x: toX, y: toY });
  }

  async scroll(options: MouseScrollOptions): Promise<void> {
    await this.checkSafety();
    await this.enforceDelay();

    await this.ensureProvider().scroll(options);
  }

  // ============================================================================
  // Keyboard Operations
  // ============================================================================

  async keyPress(key: KeyCode, options?: KeyPressOptions): Promise<void> {
    await this.checkSafety();
    await this.enforceDelay();

    await this.ensureProvider().keyPress(key, options);
    this.emit('key-press', key, options?.modifiers || []);
  }

  async keyDown(key: KeyCode): Promise<void> {
    await this.enforceDelay();
    await this.ensureProvider().keyDown(key);
  }

  async keyUp(key: KeyCode): Promise<void> {
    await this.enforceDelay();
    await this.ensureProvider().keyUp(key);
  }

  async type(text: string, options?: TypeOptions): Promise<void> {
    await this.checkSafety();
    await this.enforceDelay();

    await this.ensureProvider().type(text, options);
    this.emit('key-type', text);
  }

  async hotkey(...keys: KeyCode[]): Promise<void> {
    await this.checkSafety();
    await this.enforceDelay();

    // Determine modifiers
    const modifiers: ModifierKey[] = [];
    const regularKeys: KeyCode[] = [];

    for (const key of keys) {
      if (['ctrl', 'alt', 'shift', 'meta', 'command', 'win'].includes(key)) {
        modifiers.push(key as ModifierKey);
      } else {
        regularKeys.push(key);
      }
    }

    await this.ensureProvider().hotkey({ keys: regularKeys, modifiers });
  }

  // ============================================================================
  // Window Operations
  // ============================================================================

  async getActiveWindow(): Promise<WindowInfo | null> {
    return this.ensureProvider().getActiveWindow();
  }

  async getWindows(options?: WindowSearchOptions): Promise<WindowInfo[]> {
    return this.ensureProvider().getWindows(options);
  }

  async getWindow(handle: string): Promise<WindowInfo | null> {
    return this.ensureProvider().getWindow(handle);
  }

  async findWindow(titleOrProcess: string | RegExp): Promise<WindowInfo | null> {
    const windows = await this.getWindows({
      includeHidden: false,
    });

    const found = windows.find(w => this.matchesWindowInfo(w, titleOrProcess));
    return found || null;
  }

  /**
   * Wait for a window matching title to appear, up to timeoutMs.
   */
  async waitForWindow(
    titleOrProcess: string | RegExp,
    timeoutMs = 10000,
    pollIntervalMs = 250
  ): Promise<WindowInfo | null> {
    const timeout = Math.max(0, timeoutMs);
    const poll = Math.max(10, pollIntervalMs);
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeout) {
      const win = await this.findWindow(titleOrProcess);
      if (win) {
        return win;
      }
      await new Promise(resolve => setTimeout(resolve, poll));
    }

    return null;
  }

  private matchesWindowTitle(title: string, matcher: string | RegExp): boolean {
    if (matcher instanceof RegExp) {
      return matcher.test(title);
    }
    return title.toLowerCase().includes(matcher.toLowerCase());
  }

  private matchesWindowInfo(window: WindowInfo, matcher: string | RegExp): boolean {
    return (
      this.matchesWindowTitle(window.title, matcher) ||
      this.matchesWindowTitle(window.processName, matcher)
    );
  }

  async focusWindow(handle: string): Promise<void> {
    await this.ensureProvider().focusWindow(handle);
    const window = await this.getWindow(handle);
    if (window) {
      this.emit('window-focus', window);
    }
  }

  async minimizeWindow(handle: string): Promise<void> {
    await this.ensureProvider().minimizeWindow(handle);
  }

  async maximizeWindow(handle: string): Promise<void> {
    await this.ensureProvider().maximizeWindow(handle);
  }

  async restoreWindow(handle: string): Promise<void> {
    await this.ensureProvider().restoreWindow(handle);
  }

  async closeWindow(handle: string): Promise<void> {
    await this.ensureProvider().closeWindow(handle);
  }

  async setWindow(handle: string, options: WindowSetOptions): Promise<void> {
    await this.ensureProvider().setWindow(handle, options);
    const window = await this.getWindow(handle);
    if (window) {
      this.emit('window-change', window, options);
    }
  }

  async moveWindow(handle: string, x: number, y: number): Promise<void> {
    await this.setWindow(handle, { position: { x, y } });
  }

  async resizeWindow(handle: string, width: number, height: number): Promise<void> {
    await this.setWindow(handle, { size: { width, height } });
  }

  // ============================================================================
  // Application Operations
  // ============================================================================

  async getRunningApps(): Promise<AppInfo[]> {
    return this.ensureProvider().getRunningApps();
  }

  async launchApp(appPath: string, options?: AppLaunchOptions): Promise<AppInfo> {
    const app = await this.ensureProvider().launchApp(appPath, options);
    this.emit('app-launch', app);
    return app;
  }

  async closeApp(pid: number): Promise<void> {
    const apps = await this.getRunningApps();
    const app = apps.find(a => a.pid === pid);

    await this.ensureProvider().closeApp(pid);

    if (app) {
      this.emit('app-close', app);
    }
  }

  async findApp(name: string): Promise<AppInfo | null> {
    const apps = await this.getRunningApps();
    return apps.find(a =>
      a.name.toLowerCase().includes(name.toLowerCase()) ||
      a.path.toLowerCase().includes(name.toLowerCase())
    ) || null;
  }

  // ============================================================================
  // Screen Operations
  // ============================================================================

  async getScreens(): Promise<ScreenInfo[]> {
    return this.ensureProvider().getScreens();
  }

  async getPrimaryScreen(): Promise<ScreenInfo | null> {
    const screens = await this.getScreens();
    return screens.find(s => s.primary) || screens[0] || null;
  }

  async getPixelColor(x: number, y: number): Promise<ColorInfo> {
    return this.ensureProvider().getPixelColor(x, y);
  }

  // ============================================================================
  // Clipboard Operations
  // ============================================================================

  async getClipboard(): Promise<ClipboardContent> {
    return this.ensureProvider().getClipboard();
  }

  async setClipboard(content: Partial<ClipboardContent>): Promise<void> {
    await this.ensureProvider().setClipboard(content);
  }

  async copyText(text: string): Promise<void> {
    await this.setClipboard({ text });
  }

  async getClipboardText(): Promise<string | undefined> {
    const content = await this.getClipboard();
    return content.text;
  }

  async clearClipboard(): Promise<void> {
    await this.ensureProvider().clearClipboard();
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  getConfig(): DesktopAutomationConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<DesktopAutomationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  resetFailSafe(): void {
    this.failSafeActive = false;
  }

  /**
   * Get current provider
   */
  getProvider(): IAutomationProvider | null {
    return this.provider;
  }

  /**
   * Create the appropriate native provider for the current platform
   */
  private async createNativeProvider(): Promise<IAutomationProvider | null> {
    try {
      if (this.isWSL()) {
        const { WindowsNativeProvider } = await import('./windows-native-provider.js');
        return new WindowsNativeProvider({ wsl: true });
      }

      switch (process.platform) {
        case 'darwin': {
          const { MacOSNativeProvider } = await import('./macos-native-provider.js');
          return new MacOSNativeProvider();
        }
        case 'win32': {
          const { WindowsNativeProvider } = await import('./windows-native-provider.js');
          return new WindowsNativeProvider({ wsl: false });
        }
        case 'linux': {
          const { LinuxNativeProvider } = await import('./linux-native-provider.js');
          return new LinuxNativeProvider();
        }
        default:
          logger.debug(`No native provider for platform: ${process.platform}`);
          return null;
      }
    } catch (err) {
      logger.debug('Failed to create native provider', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /**
   * Detect if running inside WSL2
   */
  private isWSL(): boolean {
    if (process.platform !== 'linux') {
      return false;
    }
    try {
      const release = execSync('uname -r', { encoding: 'utf-8' });
      return /microsoft|wsl/i.test(release);
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let automationInstance: DesktopAutomationManager | null = null;

export function getDesktopAutomation(config?: Partial<DesktopAutomationConfig>): DesktopAutomationManager {
  if (!automationInstance) {
    automationInstance = new DesktopAutomationManager(config);
  }
  return automationInstance;
}

export function resetDesktopAutomation(): void {
  if (automationInstance) {
    automationInstance.shutdown().catch((err) => {
      logger.debug('Desktop automation shutdown error (ignored)', { error: err instanceof Error ? err.message : String(err) });
    });
    automationInstance = null;
  }
}
