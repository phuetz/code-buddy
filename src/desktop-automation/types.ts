/**
 * Desktop Automation Types
 *
 * Type definitions for mouse, keyboard, window, and application control.
 */

// ============================================================================
// Common Types
// ============================================================================

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta' | 'command' | 'win';

// ============================================================================
// Mouse Types
// ============================================================================

export type MouseButton = 'left' | 'right' | 'middle';

export interface MousePosition extends Point {
  /** Screen index (for multi-monitor) */
  screen?: number;
}

export interface MouseMoveOptions {
  /** Duration of movement in ms (0 = instant) */
  duration?: number;
  /** Use smooth movement curve */
  smooth?: boolean;
  /** Steps for smooth movement */
  steps?: number;
}

export interface MouseClickOptions {
  /** Button to click */
  button?: MouseButton;
  /** Number of clicks */
  clicks?: number;
  /** Delay between clicks in ms */
  delay?: number;
  /** Modifier keys to hold */
  modifiers?: ModifierKey[];
}

export interface MouseDragOptions {
  /** Button to use for dragging */
  button?: MouseButton;
  /** Duration of drag in ms */
  duration?: number;
  /** Use smooth movement */
  smooth?: boolean;
}

export interface MouseScrollOptions {
  /** Horizontal scroll amount */
  deltaX?: number;
  /** Vertical scroll amount */
  deltaY?: number;
  /** Use smooth scrolling */
  smooth?: boolean;
}

// ============================================================================
// Keyboard Types
// ============================================================================

export type KeyCode = string; // e.g., 'a', 'enter', 'f1', 'escape', etc.

export interface KeyPressOptions {
  /** Modifier keys to hold */
  modifiers?: ModifierKey[];
  /** Delay before key up in ms */
  delay?: number;
}

export interface TypeOptions {
  /** Delay between keystrokes in ms */
  delay?: number;
  /** Interval variance for natural typing */
  variance?: number;
  /** Simulate typing mistakes (rate 0-1) */
  errorRate?: number;
}

export interface HotkeySequence {
  /** Keys to press (in order) */
  keys: KeyCode[];
  /** Modifiers to hold during sequence */
  modifiers?: ModifierKey[];
}

// ============================================================================
// Window Types
// ============================================================================

export interface WindowInfo {
  /** Window handle/ID */
  handle: string;
  /** Window title */
  title: string;
  /** Process ID */
  pid: number;
  /** Process name */
  processName: string;
  /** Window bounds */
  bounds: Rect;
  /** Is focused */
  focused: boolean;
  /** Is visible */
  visible: boolean;
  /** Is minimized */
  minimized: boolean;
  /** Is maximized */
  maximized: boolean;
  /** Is fullscreen */
  fullscreen: boolean;
  /** Parent window handle */
  parent?: string;
  /** Child window handles */
  children?: string[];
}

export interface WindowSearchOptions {
  /** Search by title (regex or string) */
  title?: string | RegExp;
  /** Search by process name */
  processName?: string;
  /** Search by PID */
  pid?: number;
  /** Include hidden windows */
  includeHidden?: boolean;
  /** Include minimized windows */
  includeMinimized?: boolean;
}

export interface WindowSetOptions {
  /** New position */
  position?: Point;
  /** New size */
  size?: Size;
  /** Bring to front */
  focus?: boolean;
  /** Set always on top */
  alwaysOnTop?: boolean;
  /** Set opacity (0-1) */
  opacity?: number;
}

// ============================================================================
// Application Types
// ============================================================================

export interface AppInfo {
  /** Application name */
  name: string;
  /** Executable path */
  path: string;
  /** Process ID (if running) */
  pid?: number;
  /** Bundle ID (macOS) */
  bundleId?: string;
  /** Is running */
  running: boolean;
  /** Associated windows */
  windows?: WindowInfo[];
}

export interface AppLaunchOptions {
  /** Command line arguments */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Wait for window to appear */
  waitForWindow?: boolean;
  /** Timeout for window in ms */
  windowTimeout?: number;
  /** Launch hidden */
  hidden?: boolean;
}

// ============================================================================
// Screen Types
// ============================================================================

export interface ScreenInfo {
  /** Screen ID */
  id: number;
  /** Screen name */
  name: string;
  /** Screen bounds */
  bounds: Rect;
  /** Work area (excluding taskbar, etc.) */
  workArea: Rect;
  /** Scale factor */
  scaleFactor: number;
  /** Is primary screen */
  primary: boolean;
  /** Refresh rate */
  refreshRate?: number;
}

export interface ColorInfo {
  /** Red (0-255) */
  r: number;
  /** Green (0-255) */
  g: number;
  /** Blue (0-255) */
  b: number;
  /** Alpha (0-255) */
  a?: number;
  /** Hex string */
  hex: string;
}

// ============================================================================
// Clipboard Types
// ============================================================================

export interface ClipboardContent {
  /** Text content */
  text?: string;
  /** HTML content */
  html?: string;
  /** RTF content */
  rtf?: string;
  /** Image (base64 or buffer) */
  image?: string | Buffer;
  /** File paths */
  files?: string[];
  /** Available formats */
  formats: string[];
}

// ============================================================================
// Provider Types
// ============================================================================

export type AutomationProvider = 'robotjs' | 'nutjs' | 'pyautogui' | 'mock';

export interface ProviderCapabilities {
  /** Supports mouse control */
  mouse: boolean;
  /** Supports keyboard control */
  keyboard: boolean;
  /** Supports window management */
  windows: boolean;
  /** Supports app launching */
  apps: boolean;
  /** Supports screenshots */
  screenshots: boolean;
  /** Supports screen color picking */
  colorPicker: boolean;
  /** Supports clipboard */
  clipboard: boolean;
  /** Supports OCR */
  ocr: boolean;
}

export interface ProviderStatus {
  /** Provider name */
  name: AutomationProvider;
  /** Is available */
  available: boolean;
  /** Version */
  version?: string;
  /** Capabilities */
  capabilities: ProviderCapabilities;
  /** Error if not available */
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

export interface DesktopAutomationConfig {
  /** Preferred provider */
  provider: AutomationProvider;
  /** Fallback providers */
  fallbackProviders?: AutomationProvider[];
  /** Default delays */
  defaultDelays: {
    mouseMove: number;
    keyPress: number;
    typeChar: number;
    afterClick: number;
  };
  /** Safety features */
  safety: {
    /** Enable fail-safe (move to corner to abort) */
    failSafe: boolean;
    /** Fail-safe corner */
    failSafeCorner: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
    /** Minimum delay between actions */
    minActionDelay: number;
    /** Maximum automation speed multiplier */
    maxSpeed: number;
  };
  /** Debug mode */
  debug: boolean;
}

export const DEFAULT_AUTOMATION_CONFIG: DesktopAutomationConfig = {
  provider: 'mock',
  fallbackProviders: ['robotjs', 'nutjs'],
  defaultDelays: {
    mouseMove: 100,
    keyPress: 50,
    typeChar: 30,
    afterClick: 100,
  },
  safety: {
    failSafe: true,
    failSafeCorner: 'topLeft',
    minActionDelay: 10,
    maxSpeed: 10,
  },
  debug: false,
};

// ============================================================================
// Events
// ============================================================================

export interface DesktopAutomationEvents {
  'mouse-move': (position: Point) => void;
  'mouse-click': (position: Point, button: MouseButton) => void;
  'mouse-drag': (from: Point, to: Point) => void;
  'key-press': (key: KeyCode, modifiers: ModifierKey[]) => void;
  'key-type': (text: string) => void;
  'window-focus': (window: WindowInfo) => void;
  'window-change': (window: WindowInfo, changes: Partial<WindowInfo>) => void;
  'app-launch': (app: AppInfo) => void;
  'app-close': (app: AppInfo) => void;
  'fail-safe': () => void;
  'error': (error: Error) => void;
}
