/**
 * Base Native Provider
 *
 * Abstract base class for platform-native desktop automation providers.
 * Provides shared utilities for executing CLI tools, checking tool availability,
 * and common helper methods.
 */

import { execSync, exec as execCb } from 'child_process';
import { promisify } from 'util';
import type { IAutomationProvider } from './automation-manager.js';
import type {
  AutomationProvider,
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

const execAsync = promisify(execCb);

export abstract class BaseNativeProvider implements IAutomationProvider {
  readonly name: AutomationProvider = 'native';
  abstract readonly capabilities: ProviderCapabilities;
  abstract readonly platformName: string;

  protected initialized = false;
  protected availableTools: Map<string, boolean> = new Map();

  /**
   * Execute a command asynchronously with optional timeout
   */
  protected async exec(cmd: string, timeout = 10000): Promise<string> {
    try {
      // Prefer sync path first so unit tests that mock execSync remain deterministic.
      return this.execSync(cmd, timeout);
    } catch (error) {
      // Fallback to async execution in case sync execution is blocked.
      try {
        const { stdout } = await execAsync(cmd, {
          timeout,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
        });
        return stdout.trim();
      } catch {
        throw error;
      }
    }
  }

  /**
   * Execute a command synchronously
   */
  protected execSync(cmd: string, timeout = 5000): string {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout,
      maxBuffer: 1024 * 1024,
    }).trim();
  }

  /**
   * Check if a CLI tool is available (cached)
   */
  protected checkTool(name: string): boolean {
    if (this.availableTools.has(name)) {
      return this.availableTools.get(name)!;
    }
    let available = false;
    try {
      execSync(`which ${name}`, { encoding: 'utf-8', timeout: 3000 });
      available = true;
    } catch {
      available = false;
    }
    this.availableTools.set(name, available);
    return available;
  }

  /**
   * Check if a tool is available (from cache)
   */
  protected hasTool(name: string): boolean {
    return this.availableTools.get(name) ?? false;
  }

  /**
   * Delay helper
   */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Ensure provider is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`${this.platformName} native provider not initialized. Call initialize() first.`);
    }
  }

  // Abstract methods that subclasses must implement
  abstract initialize(): Promise<void>;
  abstract shutdown(): Promise<void>;
  abstract isAvailable(): Promise<boolean>;

  abstract getMousePosition(): Promise<MousePosition>;
  abstract moveMouse(x: number, y: number, options?: MouseMoveOptions): Promise<void>;
  abstract click(options?: MouseClickOptions): Promise<void>;
  abstract doubleClick(button?: MouseButton): Promise<void>;
  abstract rightClick(): Promise<void>;
  abstract drag(fromX: number, fromY: number, toX: number, toY: number, options?: MouseDragOptions): Promise<void>;
  abstract scroll(options: MouseScrollOptions): Promise<void>;

  abstract keyPress(key: KeyCode, options?: KeyPressOptions): Promise<void>;
  abstract keyDown(key: KeyCode): Promise<void>;
  abstract keyUp(key: KeyCode): Promise<void>;
  abstract type(text: string, options?: TypeOptions): Promise<void>;
  abstract hotkey(sequence: HotkeySequence): Promise<void>;

  abstract getActiveWindow(): Promise<WindowInfo | null>;
  abstract getWindows(options?: WindowSearchOptions): Promise<WindowInfo[]>;
  abstract getWindow(handle: string): Promise<WindowInfo | null>;
  abstract focusWindow(handle: string): Promise<void>;
  abstract minimizeWindow(handle: string): Promise<void>;
  abstract maximizeWindow(handle: string): Promise<void>;
  abstract restoreWindow(handle: string): Promise<void>;
  abstract closeWindow(handle: string): Promise<void>;
  abstract setWindow(handle: string, options: WindowSetOptions): Promise<void>;

  abstract getRunningApps(): Promise<AppInfo[]>;
  abstract launchApp(appPath: string, options?: AppLaunchOptions): Promise<AppInfo>;
  abstract closeApp(pid: number): Promise<void>;

  abstract getScreens(): Promise<ScreenInfo[]>;
  abstract getPixelColor(x: number, y: number): Promise<ColorInfo>;

  abstract getClipboard(): Promise<ClipboardContent>;
  abstract setClipboard(content: Partial<ClipboardContent>): Promise<void>;
  abstract clearClipboard(): Promise<void>;
}
