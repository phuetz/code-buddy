/**
 * Desktop Automation Module
 *
 * Cross-platform desktop automation for mouse, keyboard, windows, and applications.
 * Supports multiple backends (robotjs, nut.js) with mock for testing.
 */

// Types
export type {
  Point,
  Size,
  Rect,
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
  DesktopAutomationEvents,
} from './types.js';

export { DEFAULT_AUTOMATION_CONFIG } from './types.js';

// Manager
export type { IAutomationProvider } from './automation-manager.js';

export {
  MockAutomationProvider,
  DesktopAutomationManager,
  getDesktopAutomation,
  resetDesktopAutomation,
} from './automation-manager.js';

// Providers
export { NutJsProvider } from './nutjs-provider.js';
