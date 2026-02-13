/**
 * Browser Automation Types
 *
 * OpenClaw-inspired browser control via CDP (Chrome DevTools Protocol).
 */

// ============================================================================
// Tab Management
// ============================================================================

export interface BrowserTab {
  /** Unique tab identifier */
  id: string;
  /** Target ID from CDP */
  targetId: string;
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** Is tab active/focused */
  active: boolean;
  /** Tab index */
  index: number;
  /** Favicon URL */
  faviconUrl?: string;
  /** Window ID */
  windowId?: number;
}

export interface BrowserProfile {
  /** Profile name */
  name: string;
  /** Profile type */
  type: 'managed' | 'extension' | 'remote';
  /** User data directory */
  userDataDir?: string;
  /** CDP endpoint URL */
  cdpUrl?: string;
  /** Is profile active */
  active: boolean;
}

// ============================================================================
// Smart Snapshot
// ============================================================================

export interface WebElement {
  /** Numeric reference for AI interaction */
  ref: number;
  /** Element tag name */
  tagName: string;
  /** Element role (from ARIA) */
  role: string;
  /** Accessible name */
  name: string;
  /** Element text content */
  text?: string;
  /** Bounding box */
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Center point for clicking */
  center: { x: number; y: number };
  /** Is element visible */
  visible: boolean;
  /** Is element interactive */
  interactive: boolean;
  /** Is element focused */
  focused: boolean;
  /** Is element disabled */
  disabled: boolean;
  /** Input type (for inputs) */
  inputType?: string;
  /** Current value */
  value?: string;
  /** Placeholder text */
  placeholder?: string;
  /** ARIA attributes */
  ariaAttributes?: Record<string, string>;
  /** CSS selector (fallback) */
  selector?: string;
  /** XPath (fallback) */
  xpath?: string;
}

export interface WebSnapshot {
  /** Snapshot ID */
  id: string;
  /** Timestamp */
  timestamp: Date;
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** All detected elements */
  elements: WebElement[];
  /** Element map by ref */
  elementMap: Map<number, WebElement>;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Is snapshot still valid */
  valid: boolean;
  /** Time-to-live in ms */
  ttl: number;
  /** Format used */
  format: 'ai' | 'aria' | 'role';
}

export interface SnapshotOptions {
  /** Snapshot format */
  format?: 'ai' | 'aria' | 'role';
  /** Only interactive elements */
  interactiveOnly?: boolean;
  /** Include hidden elements */
  includeHidden?: boolean;
  /** Maximum elements */
  maxElements?: number;
  /** Generate labeled screenshot */
  labels?: boolean;
  /** CSS selector to scope */
  selector?: string;
  /** Frame index */
  frame?: number;
  /** Maximum depth */
  depth?: number;
  /** Time-to-live */
  ttl?: number;
}

// ============================================================================
// Browser Actions
// ============================================================================

export interface ClickOptions {
  /** Button to click */
  button?: 'left' | 'right' | 'middle';
  /** Number of clicks */
  clickCount?: number;
  /** Delay between clicks */
  delay?: number;
  /** Modifier keys */
  modifiers?: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
  /** Force click even if element is covered */
  force?: boolean;
  /** Timeout in ms */
  timeout?: number;
}

export interface TypeOptions {
  /** Delay between keystrokes */
  delay?: number;
  /** Clear field before typing */
  clear?: boolean;
  /** Timeout in ms */
  timeout?: number;
}

export interface FillOptions {
  /** Field mappings: { fieldRef: value } */
  fields: Record<number, string>;
  /** Submit after filling */
  submit?: boolean;
  /** Timeout in ms */
  timeout?: number;
}

export interface ScrollOptions {
  /** Direction */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Amount in pixels */
  amount?: number;
  /** Scroll to element ref */
  toElement?: number;
  /** Scroll behavior */
  behavior?: 'auto' | 'smooth';
}

export interface DragOptions {
  /** Source element ref */
  source: number;
  /** Target element ref or position */
  target: number | { x: number; y: number };
  /** Timeout in ms */
  timeout?: number;
}

export interface SelectOptions {
  /** Dropdown element ref */
  ref: number;
  /** Value to select */
  value?: string;
  /** Label to select */
  label?: string;
  /** Index to select */
  index?: number;
}

// ============================================================================
// Navigation
// ============================================================================

export interface NavigateOptions {
  /** URL to navigate to */
  url: string;
  /** Wait until */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  /** Timeout in ms */
  timeout?: number;
  /** Referer header */
  referer?: string;
}

export interface WaitOptions {
  /** Wait for selector */
  selector?: string;
  /** Wait for element ref */
  ref?: number;
  /** Wait for navigation */
  navigation?: boolean;
  /** Wait for network idle */
  networkIdle?: boolean;
  /** Custom condition (JS) */
  condition?: string;
  /** Timeout in ms */
  timeout?: number;
}

// ============================================================================
// Media Capture
// ============================================================================

export interface ScreenshotOptions {
  /** Full page or viewport only */
  fullPage?: boolean;
  /** Element ref to capture */
  element?: number;
  /** Image format */
  format?: 'png' | 'jpeg' | 'webp';
  /** Quality (0-100 for jpeg/webp) */
  quality?: number;
  /** Scale factor */
  scale?: number;
  /** Omit background */
  omitBackground?: boolean;
  /** Add labels overlay */
  labels?: boolean;
  /** Mask selectors (hide elements) */
  mask?: string[];
}

export interface PDFOptions {
  /** Page format */
  format?: 'A4' | 'Letter' | 'Legal' | 'Tabloid';
  /** Landscape orientation */
  landscape?: boolean;
  /** Scale (0.1 to 2) */
  scale?: number;
  /** Print background */
  printBackground?: boolean;
  /** Header template */
  headerTemplate?: string;
  /** Footer template */
  footerTemplate?: string;
  /** Margins */
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  /** Page ranges */
  pageRanges?: string;
}

// ============================================================================
// Network & Device
// ============================================================================

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface HeadersConfig {
  /** Headers to set */
  headers: Record<string, string>;
  /** URL patterns to apply to */
  urlPatterns?: string[];
}

export interface DeviceConfig {
  /** Device name preset */
  name?: string;
  /** Custom viewport */
  viewport?: { width: number; height: number };
  /** Device scale factor */
  deviceScaleFactor?: number;
  /** Is mobile */
  isMobile?: boolean;
  /** Has touch */
  hasTouch?: boolean;
  /** User agent */
  userAgent?: string;
}

export interface GeolocationConfig {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface NetworkRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  timestamp: number;
  resourceType: string;
}

export interface NetworkResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  mimeType: string;
  timestamp: number;
}

// ============================================================================
// JavaScript Execution
// ============================================================================

export interface EvaluateOptions {
  /** JavaScript code to execute */
  expression: string;
  /** Arguments to pass */
  args?: unknown[];
  /** Return by value */
  returnByValue?: boolean;
  /** Await promise */
  awaitPromise?: boolean;
  /** Timeout in ms */
  timeout?: number;
}

export interface EvaluateResult {
  success: boolean;
  value?: unknown;
  error?: string;
}

// ============================================================================
// Dialog Handling
// ============================================================================

export type DialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload';

export interface DialogInfo {
  type: DialogType;
  message: string;
  defaultValue?: string;
}

export interface DialogAction {
  /** Accept or dismiss */
  accept: boolean;
  /** Text to enter (for prompt) */
  promptText?: string;
}

// ============================================================================
// File Upload
// ============================================================================

export interface FileUploadOptions {
  /** Element ref (file input) */
  ref: number;
  /** File paths to upload */
  files: string[];
}

// ============================================================================
// Browser Configuration
// ============================================================================

export interface BrowserConfig {
  /** Browser type */
  browser: 'chromium' | 'firefox' | 'webkit';
  /** Headless mode */
  headless: boolean;
  /** CDP port */
  cdpPort?: number;
  /** User data directory */
  userDataDir?: string;
  /** Default viewport */
  viewport: { width: number; height: number };
  /** Default timeout */
  timeout: number;
  /** Slow motion delay */
  slowMo?: number;
  /** Proxy settings */
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  /** Download path */
  downloadsPath?: string;
  /** Ignore HTTPS errors */
  ignoreHTTPSErrors?: boolean;
}

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  browser: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30000,
};

// ============================================================================
// Console History
// ============================================================================

export interface ConsoleEntry {
  /** Console message type (log, warn, error, info, debug) */
  type: string;
  /** Message text */
  text: string;
  /** When the message was logged */
  timestamp: Date;
}

// ============================================================================
// Route Interception
// ============================================================================

export interface RouteRule {
  /** Unique rule identifier */
  id: string;
  /** URL pattern to match (glob) */
  urlPattern: string;
  /** Action to take */
  action: 'block' | 'mock' | 'modify' | 'log';
  /** Mock response (for mock action) */
  mockResponse?: {
    status: number;
    body?: string;
    contentType?: string;
    headers?: Record<string, string>;
  };
  /** Headers to modify (for modify action) */
  modifyHeaders?: Record<string, string>;
}

// ============================================================================
// Browser Profile Persistence
// ============================================================================

export interface BrowserProfileData {
  /** Profile name */
  name: string;
  /** Saved cookies */
  cookies: Cookie[];
  /** localStorage per origin */
  localStorage: Record<string, Record<string, string>>;
  /** sessionStorage per origin */
  sessionStorage: Record<string, Record<string, string>>;
  /** When the profile was saved */
  savedAt: Date;
}

// ============================================================================
// Extended Device Config
// ============================================================================

export interface ExtendedDeviceConfig extends DeviceConfig {
  /** Timezone ID (e.g., 'America/New_York') */
  timezoneId?: string;
  /** Locale (e.g., 'en-US') */
  locale?: string;
  /** Color scheme preference */
  colorScheme?: 'light' | 'dark' | 'no-preference';
  /** Permissions to grant (e.g., ['geolocation', 'notifications']) */
  permissions?: string[];
}

// ============================================================================
// Events
// ============================================================================

export interface BrowserEvents {
  'page-load': (url: string) => void;
  'page-error': (error: Error) => void;
  'dialog': (dialog: DialogInfo) => void;
  'download': (path: string) => void;
  'console': (type: string, message: string) => void;
  'network-request': (request: NetworkRequest) => void;
  'network-response': (response: NetworkResponse) => void;
}
