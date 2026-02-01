/**
 * Browser Controller Types
 *
 * Type definitions for Chrome DevTools Protocol browser automation.
 */

/**
 * Browser launch options
 */
export interface BrowserLaunchOptions {
  /** Browser executable path */
  executablePath?: string;
  /** Run in headless mode */
  headless?: boolean;
  /** Browser arguments */
  args?: string[];
  /** Default viewport */
  defaultViewport?: ViewportOptions | null;
  /** Slow down operations by ms */
  slowMo?: number;
  /** Connection timeout in ms */
  timeout?: number;
  /** User data directory */
  userDataDir?: string;
  /** Ignore HTTPS errors */
  ignoreHTTPSErrors?: boolean;
  /** DevTools port */
  devToolsPort?: number;
}

/**
 * Viewport options
 */
export interface ViewportOptions {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  isLandscape?: boolean;
}

/**
 * Navigation options
 */
export interface NavigationOptions {
  /** Timeout in ms */
  timeout?: number;
  /** Wait until event */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  /** Referrer */
  referer?: string;
}

/**
 * Screenshot options
 */
export interface ScreenshotOptions {
  /** Output path */
  path?: string;
  /** Image type */
  type?: 'png' | 'jpeg' | 'webp';
  /** JPEG/WebP quality (0-100) */
  quality?: number;
  /** Full page screenshot */
  fullPage?: boolean;
  /** Clip region */
  clip?: { x: number; y: number; width: number; height: number };
  /** Omit background */
  omitBackground?: boolean;
  /** Encoding */
  encoding?: 'base64' | 'binary';
}

/**
 * PDF options
 */
export interface PDFOptions {
  /** Output path */
  path?: string;
  /** Page scale */
  scale?: number;
  /** Display header/footer */
  displayHeaderFooter?: boolean;
  /** Header template */
  headerTemplate?: string;
  /** Footer template */
  footerTemplate?: string;
  /** Print background */
  printBackground?: boolean;
  /** Landscape mode */
  landscape?: boolean;
  /** Page ranges (e.g., '1-5, 8') */
  pageRanges?: string;
  /** Paper format */
  format?: 'Letter' | 'Legal' | 'Tabloid' | 'Ledger' | 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6';
  /** Paper width */
  width?: string | number;
  /** Paper height */
  height?: string | number;
  /** Margins */
  margin?: { top?: string | number; right?: string | number; bottom?: string | number; left?: string | number };
  /** Prefer CSS page size */
  preferCSSPageSize?: boolean;
}

/**
 * Element selector options
 */
export interface SelectorOptions {
  /** Timeout in ms */
  timeout?: number;
  /** Visible only */
  visible?: boolean;
  /** Hidden only */
  hidden?: boolean;
}

/**
 * Click options
 */
export interface ClickOptions {
  /** Mouse button */
  button?: 'left' | 'right' | 'middle';
  /** Click count */
  clickCount?: number;
  /** Delay between mousedown and mouseup */
  delay?: number;
  /** Offset X */
  offsetX?: number;
  /** Offset Y */
  offsetY?: number;
}

/**
 * Type options
 */
export interface TypeOptions {
  /** Delay between key presses */
  delay?: number;
}

/**
 * Cookie
 */
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

/**
 * Page metrics
 */
export interface PageMetrics {
  /** Timestamp */
  Timestamp: number;
  /** Documents */
  Documents: number;
  /** Frames */
  Frames: number;
  /** JS event listeners */
  JSEventListeners: number;
  /** Nodes */
  Nodes: number;
  /** Layout count */
  LayoutCount: number;
  /** Recalc style count */
  RecalcStyleCount: number;
  /** Layout duration */
  LayoutDuration: number;
  /** Recalc style duration */
  RecalcStyleDuration: number;
  /** Script duration */
  ScriptDuration: number;
  /** Task duration */
  TaskDuration: number;
  /** JS heap used size */
  JSHeapUsedSize: number;
  /** JS heap total size */
  JSHeapTotalSize: number;
}

/**
 * Console message
 */
export interface ConsoleMessage {
  type: 'log' | 'debug' | 'info' | 'error' | 'warning' | 'dir' | 'table' | 'trace' | 'clear' | 'assert';
  text: string;
  args: unknown[];
  location?: { url: string; lineNumber: number; columnNumber: number };
}

/**
 * Network request
 */
export interface NetworkRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
}

/**
 * Network response
 */
export interface NetworkResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timing?: {
    requestTime: number;
    dnsStart: number;
    dnsEnd: number;
    connectStart: number;
    connectEnd: number;
    sslStart: number;
    sslEnd: number;
    sendStart: number;
    sendEnd: number;
    receiveHeadersEnd: number;
  };
}

/**
 * Browser events
 */
export interface BrowserEvents {
  'console': (message: ConsoleMessage) => void;
  'pageerror': (error: Error) => void;
  'request': (request: NetworkRequest) => void;
  'response': (response: NetworkResponse) => void;
  'dialog': (dialog: { type: string; message: string }) => void;
  'close': () => void;
}

/**
 * Default browser options
 */
export const DEFAULT_BROWSER_OPTIONS: BrowserLaunchOptions = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1280, height: 720 },
  timeout: 30000,
  ignoreHTTPSErrors: false,
};

/**
 * Default navigation options
 */
export const DEFAULT_NAVIGATION_OPTIONS: NavigationOptions = {
  timeout: 30000,
  waitUntil: 'load',
};
