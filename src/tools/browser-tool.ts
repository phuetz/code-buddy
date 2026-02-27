/**
 * Browser Automation Tool
 *
 * Provides headless browser capabilities using Playwright for:
 * - Web page navigation and interaction
 * - Form filling and button clicking
 * - Screenshot capture
 * - JavaScript execution
 * - DOM element selection
 *
 * Playwright is loaded as an optional dependency - if not installed,
 * the tool will provide installation instructions.
 */

import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';
import type { ToolResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Browser action types supported by the tool
 */
export type BrowserAction =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'screenshot'
  | 'getText'
  | 'getHtml'
  | 'evaluate'
  | 'waitForSelector'
  | 'getLinks'
  | 'getForms'
  | 'submit'
  | 'select'
  | 'hover'
  | 'scroll'
  | 'goBack'
  | 'goForward'
  | 'reload'
  | 'close';

/**
 * Parameters for browser tool execution
 */
export interface BrowserParams {
  /** The action to perform */
  action: BrowserAction;
  /** URL to navigate to (for navigate action) */
  url?: string;
  /** CSS selector for element operations */
  selector?: string;
  /** Value for fill/select operations */
  value?: string;
  /** JavaScript code for evaluate action */
  script?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Screenshot options */
  screenshotOptions?: {
    fullPage?: boolean;
    path?: string;
    type?: 'png' | 'jpeg';
    quality?: number;
  };
  /** Scroll options */
  scrollOptions?: {
    x?: number;
    y?: number;
    behavior?: 'auto' | 'smooth';
  };
}

/**
 * Browser configuration
 */
export interface BrowserConfig {
  /** Run in headless mode */
  headless: boolean;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Custom user agent */
  userAgent?: string;
  /** Default timeout for operations */
  timeout: number;
  /** Directory for screenshots */
  screenshotDir: string;
  /** Browser type to use */
  browserType: 'chromium' | 'firefox' | 'webkit';
  /** Block requests to these patterns */
  blockedUrls?: string[];
  /** Enable JavaScript */
  javaScriptEnabled: boolean;
}

/**
 * Page information returned by browser operations
 */
export interface PageInfo {
  url: string;
  title: string;
  html?: string;
  text?: string;
  screenshot?: string;
}

/**
 * Link information extracted from page
 */
export interface LinkInfo {
  href: string;
  text: string;
  title?: string;
}

/**
 * Form information extracted from page
 */
export interface FormInfo {
  action: string;
  method: string;
  id?: string;
  name?: string;
  fields: Array<{
    name: string;
    type: string;
    id?: string;
    placeholder?: string;
    required?: boolean;
  }>;
}

// Playwright types (dynamically loaded)
type PlaywrightBrowser = {
  newContext: (options?: unknown) => Promise<PlaywrightContext>;
  close: () => Promise<void>;
};

type PlaywrightContext = {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
};

type PlaywrightPage = {
  goto: (url: string, options?: unknown) => Promise<unknown>;
  click: (selector: string, options?: unknown) => Promise<void>;
  fill: (selector: string, value: string, options?: unknown) => Promise<void>;
  screenshot: (options?: unknown) => Promise<Buffer>;
  textContent: (selector: string, options?: unknown) => Promise<string | null>;
  innerHTML: (selector: string, options?: unknown) => Promise<string>;
  content: () => Promise<string>;
  title: () => Promise<string>;
  url: () => string;
  evaluate: <T>(fnOrExpression: (() => T) | string) => Promise<T>;
  waitForSelector: (selector: string, options?: unknown) => Promise<unknown>;
  selectOption: (selector: string, values: string | string[]) => Promise<string[]>;
  hover: (selector: string, options?: unknown) => Promise<void>;
  goBack: (options?: unknown) => Promise<unknown>;
  goForward: (options?: unknown) => Promise<unknown>;
  reload: (options?: unknown) => Promise<unknown>;
  close: () => Promise<void>;
  $: (selector: string) => Promise<unknown>;
  $$: (selector: string) => Promise<unknown[]>;
  $$eval: <T>(selector: string, fn: (elements: Element[]) => T) => Promise<T>;
};

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: BrowserConfig = {
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30000,
  screenshotDir: path.join(os.tmpdir(), 'codebuddy-browser-screenshots'),
  browserType: 'chromium',
  javaScriptEnabled: true,
  blockedUrls: [],
};

// Internal URL patterns to block for security
const BLOCKED_URL_PATTERNS = [
  /^file:\/\//i,
  /^localhost/i,
  /^127\.\d+\.\d+\.\d+/,
  /^192\.168\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\.0\.0\.0/,
  /^::1$/,
  /^fe80:/i,
];

// ============================================================================
// Browser Tool Implementation
// ============================================================================

/**
 * BrowserTool provides headless browser automation capabilities
 * using Playwright for web page interaction, testing, and scraping.
 */
export class BrowserTool extends EventEmitter {
  name = 'browser';
  description = 'Automate web browser for navigation, interaction, screenshots, and testing';
  dangerLevel: 'safe' | 'low' | 'medium' | 'high' = 'medium';

  inputSchema = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: [
          'navigate',
          'click',
          'fill',
          'screenshot',
          'getText',
          'getHtml',
          'evaluate',
          'waitForSelector',
          'getLinks',
          'getForms',
          'submit',
          'select',
          'hover',
          'scroll',
          'goBack',
          'goForward',
          'reload',
          'close',
        ],
        description: 'Browser action to perform',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (for navigate action)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector for element operations',
      },
      value: {
        type: 'string',
        description: 'Value for fill/select operations',
      },
      script: {
        type: 'string',
        description: 'JavaScript code for evaluate action',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
      screenshotOptions: {
        type: 'object',
        description: 'Options for screenshot (fullPage, path, type, quality)',
      },
    },
    required: ['action'],
  };

  private config: BrowserConfig;
  private playwright: unknown = null;
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightContext | null = null;
  private page: PlaywrightPage | null = null;
  private isPlaywrightAvailable: boolean | null = null;
  private currentUrl: string = '';

  constructor(config: Partial<BrowserConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureScreenshotDir();
  }

  /**
   * Inject playwright module for testing purposes
   * @internal
   */
  _injectPlaywright(playwright: unknown): void {
    this.playwright = playwright;
    this.isPlaywrightAvailable = true;
  }

  /**
   * Ensure screenshot directory exists
   */
  private async ensureScreenshotDir(): Promise<void> {
    await UnifiedVfsRouter.Instance.ensureDir(this.config.screenshotDir);
  }

  /**
   * Check if Playwright is available
   */
  private async checkPlaywrightAvailable(): Promise<boolean> {
    if (this.isPlaywrightAvailable !== null) {
      return this.isPlaywrightAvailable;
    }

    try {
      // Dynamic import of playwright — the string literal is intentionally
      // constructed to prevent bundlers from statically resolving the module.
      const specifier = 'playwright';
      this.playwright = await import(/* webpackIgnore: true */ specifier);
      this.isPlaywrightAvailable = true;
      return true;
    } catch {
      this.isPlaywrightAvailable = false;
      return false;
    }
  }

  /**
   * Get installation instructions for Playwright
   */
  private getInstallInstructions(): string {
    return `Playwright is not installed. To enable browser automation, run:

npm install playwright
npx playwright install chromium

Or for all browsers:
npx playwright install

This will install the browser binaries needed for automation.`;
  }

  /**
   * Check if URL is blocked (internal/local)
   */
  private isBlockedUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;

      for (const pattern of BLOCKED_URL_PATTERNS) {
        if (pattern.test(hostname) || pattern.test(url)) {
          return true;
        }
      }

      // Check custom blocked patterns
      for (const blocked of this.config.blockedUrls || []) {
        if (url.includes(blocked)) {
          return true;
        }
      }

      return false;
    } catch {
      return true; // Invalid URLs are blocked
    }
  }

  /**
   * Initialize browser instance
   */
  private async initBrowser(): Promise<ToolResult> {
    if (!(await this.checkPlaywrightAvailable())) {
      return {
        success: false,
        error: this.getInstallInstructions(),
      };
    }

    if (this.browser && this.page) {
      return { success: true, output: 'Browser already initialized' };
    }

    try {
      const pw = this.playwright as {
        chromium: { launch: (opts: unknown) => Promise<PlaywrightBrowser> };
        firefox: { launch: (opts: unknown) => Promise<PlaywrightBrowser> };
        webkit: { launch: (opts: unknown) => Promise<PlaywrightBrowser> };
      };

      const browserLauncher = pw[this.config.browserType];
      this.browser = await browserLauncher.launch({
        headless: this.config.headless,
      });

      this.context = await this.browser.newContext({
        viewport: this.config.viewport,
        userAgent: this.config.userAgent,
        javaScriptEnabled: this.config.javaScriptEnabled,
      });

      this.page = await this.context.newPage();

      this.emit('browser:initialized', { browserType: this.config.browserType });
      return { success: true, output: `Browser initialized (${this.config.browserType})` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to initialize browser: ${message}` };
    }
  }

  /**
   * Execute browser action
   */
  async execute(params: BrowserParams): Promise<ToolResult> {
    const { action, timeout = this.config.timeout } = params;

    // Handle close action without init
    if (action === 'close') {
      return this.close();
    }

    // Initialize browser if needed
    const initResult = await this.initBrowser();
    if (!initResult.success) {
      return initResult;
    }

    try {
      switch (action) {
        case 'navigate':
          return this.navigate(params.url!, timeout);

        case 'click':
          return this.click(params.selector!, timeout);

        case 'fill':
          return this.fill(params.selector!, params.value!, timeout);

        case 'screenshot':
          return this.screenshot(params.screenshotOptions);

        case 'getText':
          return this.getText(params.selector);

        case 'getHtml':
          return this.getHtml(params.selector);

        case 'evaluate':
          return this.evaluate(params.script!);

        case 'waitForSelector':
          return this.waitForSelector(params.selector!, timeout);

        case 'getLinks':
          return this.getLinks();

        case 'getForms':
          return this.getForms();

        case 'submit':
          return this.submit(params.selector!);

        case 'select':
          return this.select(params.selector!, params.value!);

        case 'hover':
          return this.hover(params.selector!, timeout);

        case 'scroll':
          return this.scroll(params.scrollOptions);

        case 'goBack':
          return this.goBack(timeout);

        case 'goForward':
          return this.goForward(timeout);

        case 'reload':
          return this.reload(timeout);

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('browser:error', { action, error: message });
      return { success: false, error: `Browser action '${action}' failed: ${message}` };
    }
  }

  /**
   * Navigate to URL
   */
  private async navigate(url: string, timeout: number): Promise<ToolResult> {
    if (!url) {
      return { success: false, error: 'URL is required for navigate action' };
    }

    if (this.isBlockedUrl(url)) {
      return { success: false, error: 'Access to internal/local URLs is blocked for security' };
    }

    try {
      await this.page!.goto(url, { timeout, waitUntil: 'domcontentloaded' });
      this.currentUrl = this.page!.url();
      const title = await this.page!.title();

      this.emit('browser:navigate', { url: this.currentUrl, title });

      return {
        success: true,
        output: `Navigated to: ${this.currentUrl}\nTitle: ${title}`,
        metadata: { url: this.currentUrl, title },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Navigation failed: ${message}` };
    }
  }

  /**
   * Click on element
   */
  private async click(selector: string, timeout: number): Promise<ToolResult> {
    if (!selector) {
      return { success: false, error: 'Selector is required for click action' };
    }

    try {
      await this.page!.waitForSelector(selector, { timeout });
      await this.page!.click(selector, { timeout });

      this.emit('browser:click', { selector });
      return { success: true, output: `Clicked on: ${selector}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Click failed on '${selector}': ${message}` };
    }
  }

  /**
   * Fill input field
   */
  private async fill(selector: string, value: string, timeout: number): Promise<ToolResult> {
    if (!selector) {
      return { success: false, error: 'Selector is required for fill action' };
    }
    if (value === undefined) {
      return { success: false, error: 'Value is required for fill action' };
    }

    try {
      await this.page!.waitForSelector(selector, { timeout });
      await this.page!.fill(selector, value, { timeout });

      this.emit('browser:fill', { selector, valueLength: value.length });
      return { success: true, output: `Filled '${selector}' with ${value.length} characters` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Fill failed on '${selector}': ${message}` };
    }
  }

  /**
   * Take screenshot
   */
  private async screenshot(options?: BrowserParams['screenshotOptions']): Promise<ToolResult> {
    try {
      const filename = `screenshot-${Date.now()}.${options?.type || 'png'}`;
      const filepath = options?.path || path.join(this.config.screenshotDir, filename);

      const buffer = await this.page!.screenshot({
        path: filepath,
        fullPage: options?.fullPage ?? false,
        type: options?.type || 'png',
        quality: options?.type === 'jpeg' ? options?.quality : undefined,
      });

      this.emit('browser:screenshot', { path: filepath, size: buffer.length });

      return {
        success: true,
        output: `Screenshot saved: ${filepath}`,
        metadata: { path: filepath, size: buffer.length },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Screenshot failed: ${message}` };
    }
  }

  /**
   * Get text content
   */
  private async getText(selector?: string): Promise<ToolResult> {
    try {
      let text: string;

      if (selector) {
        const element = await this.page!.$(selector);
        if (!element) {
          return { success: false, error: `Element not found: ${selector}` };
        }
        text = (await this.page!.textContent(selector)) || '';
      } else {
        // Get all visible text
        text = await this.page!.evaluate(() => document.body.innerText);
      }

      // Truncate if too long
      const maxLength = 50000;
      const truncated = text.length > maxLength;
      const output = truncated ? text.substring(0, maxLength) + '\n... (truncated)' : text;

      return {
        success: true,
        output,
        metadata: { length: text.length, truncated },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Get text failed: ${message}` };
    }
  }

  /**
   * Get HTML content
   */
  private async getHtml(selector?: string): Promise<ToolResult> {
    try {
      let html: string;

      if (selector) {
        html = await this.page!.innerHTML(selector);
      } else {
        html = await this.page!.content();
      }

      // Truncate if too long
      const maxLength = 100000;
      const truncated = html.length > maxLength;
      const output = truncated ? html.substring(0, maxLength) + '\n... (truncated)' : html;

      return {
        success: true,
        output,
        metadata: { length: html.length, truncated },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Get HTML failed: ${message}` };
    }
  }

  /**
   * Evaluate JavaScript
   */
  private async evaluate(script: string): Promise<ToolResult> {
    if (!script) {
      return { success: false, error: 'Script is required for evaluate action' };
    }

    try {
      // SECURITY: The script is evaluated inside Playwright's browser sandbox,
      // not on the Node.js server. page.evaluate() accepts a string and runs it
      // in the isolated browser context. We avoid new Function() to prevent
      // server-side code execution during function construction.
      const result = await this.page!.evaluate(script);

      const output =
        typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? 'undefined');

      this.emit('browser:evaluate', { scriptLength: script.length });

      return {
        success: true,
        output,
        metadata: { resultType: typeof result },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Evaluate failed: ${message}` };
    }
  }

  /**
   * Wait for selector
   */
  private async waitForSelector(selector: string, timeout: number): Promise<ToolResult> {
    if (!selector) {
      return { success: false, error: 'Selector is required for waitForSelector action' };
    }

    try {
      await this.page!.waitForSelector(selector, { timeout });

      return { success: true, output: `Element found: ${selector}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Wait for selector failed: ${message}` };
    }
  }

  /**
   * Get all links on page
   */
  private async getLinks(): Promise<ToolResult> {
    try {
      const links: LinkInfo[] = await this.page!.$$eval('a[href]', (elements: Element[]) =>
        elements.map((el) => ({
          href: (el as HTMLAnchorElement).href,
          text: el.textContent?.trim() || '',
          title: el.getAttribute('title') || undefined,
        }))
      );

      const output = links
        .slice(0, 100) // Limit to 100 links
        .map((l) => `${l.text || '(no text)'}: ${l.href}`)
        .join('\n');

      return {
        success: true,
        output: output || 'No links found',
        metadata: { count: links.length, shown: Math.min(links.length, 100) },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Get links failed: ${message}` };
    }
  }

  /**
   * Get all forms on page
   */
  private async getForms(): Promise<ToolResult> {
    try {
      const forms: FormInfo[] = await this.page!.$$eval('form', (elements: Element[]) =>
        elements.map((form) => {
          const formEl = form as HTMLFormElement;
          const inputs = Array.from(formEl.querySelectorAll('input, select, textarea'));

          return {
            action: formEl.action,
            method: formEl.method.toUpperCase() || 'GET',
            id: formEl.id || undefined,
            name: formEl.name || undefined,
            fields: inputs.map((input) => {
              const inputEl = input as HTMLInputElement;
              return {
                name: inputEl.name,
                type: inputEl.type || 'text',
                id: inputEl.id || undefined,
                placeholder: inputEl.placeholder || undefined,
                required: inputEl.required,
              };
            }),
          };
        })
      );

      if (forms.length === 0) {
        return { success: true, output: 'No forms found on page' };
      }

      const output = forms
        .map((f, i) => {
          const fields = f.fields.map((field) => `    - ${field.name} (${field.type})`).join('\n');
          return `Form ${i + 1}: ${f.method} ${f.action}\n${fields}`;
        })
        .join('\n\n');

      return {
        success: true,
        output,
        metadata: { count: forms.length },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Get forms failed: ${message}` };
    }
  }

  /**
   * Submit form
   */
  private async submit(selector: string): Promise<ToolResult> {
    if (!selector) {
      return { success: false, error: 'Form selector is required for submit action' };
    }

    try {
      // Find submit button or trigger form submit
      const submitButton = await this.page!.$(`${selector} [type="submit"], ${selector} button`);
      if (submitButton) {
        await this.page!.click(`${selector} [type="submit"], ${selector} button`);
      } else {
        // SECURITY: The expression is evaluated inside Playwright's browser sandbox,
        // not on the Node.js server. The selector is JSON-stringified to prevent
        // injection within the browser context.
        const safeSelector = JSON.stringify(selector);
        await this.page!.evaluate(
          `document.querySelector(${safeSelector}).submit()`
        );
      }

      // Wait for navigation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      this.emit('browser:submit', { selector });
      return {
        success: true,
        output: `Form submitted: ${selector}\nCurrent URL: ${this.page!.url()}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Submit failed: ${message}` };
    }
  }

  /**
   * Select option from dropdown
   */
  private async select(selector: string, value: string): Promise<ToolResult> {
    if (!selector) {
      return { success: false, error: 'Selector is required for select action' };
    }
    if (!value) {
      return { success: false, error: 'Value is required for select action' };
    }

    try {
      await this.page!.selectOption(selector, value);

      this.emit('browser:select', { selector, value });
      return { success: true, output: `Selected '${value}' in ${selector}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Select failed: ${message}` };
    }
  }

  /**
   * Hover over element
   */
  private async hover(selector: string, timeout: number): Promise<ToolResult> {
    if (!selector) {
      return { success: false, error: 'Selector is required for hover action' };
    }

    try {
      await this.page!.waitForSelector(selector, { timeout });
      await this.page!.hover(selector);

      return { success: true, output: `Hovering over: ${selector}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Hover failed: ${message}` };
    }
  }

  /**
   * Scroll page
   */
  private async scroll(options?: BrowserParams['scrollOptions']): Promise<ToolResult> {
    try {
      const x = options?.x ?? 0;
      const y = options?.y ?? 500;
      const behavior = options?.behavior ?? 'auto';

      // SECURITY: The expression is evaluated inside Playwright's browser sandbox,
      // not on the Node.js server. Values are sanitized (Number() coercion,
      // behavior allow-list) to prevent injection within the browser context.
      const safeBehavior = ['auto', 'smooth', 'instant'].includes(behavior) ? behavior : 'auto';
      await this.page!.evaluate(
        `window.scrollTo({ left: ${Number(x)}, top: ${Number(y)}, behavior: '${safeBehavior}' })`
      );

      return { success: true, output: `Scrolled to x:${x}, y:${y}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Scroll failed: ${message}` };
    }
  }

  /**
   * Go back in history
   */
  private async goBack(timeout: number): Promise<ToolResult> {
    try {
      await this.page!.goBack({ timeout });
      const url = this.page!.url();

      return { success: true, output: `Navigated back to: ${url}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Go back failed: ${message}` };
    }
  }

  /**
   * Go forward in history
   */
  private async goForward(timeout: number): Promise<ToolResult> {
    try {
      await this.page!.goForward({ timeout });
      const url = this.page!.url();

      return { success: true, output: `Navigated forward to: ${url}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Go forward failed: ${message}` };
    }
  }

  /**
   * Reload page
   */
  private async reload(timeout: number): Promise<ToolResult> {
    try {
      await this.page!.reload({ timeout });
      const url = this.page!.url();

      return { success: true, output: `Page reloaded: ${url}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Reload failed: ${message}` };
    }
  }

  /**
   * Close browser
   */
  async close(): Promise<ToolResult> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      this.currentUrl = '';
      this.emit('browser:closed');

      return { success: true, output: 'Browser closed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Close failed: ${message}` };
    }
  }

  /**
   * Get current page info
   */
  async getPageInfo(): Promise<PageInfo | null> {
    if (!this.page) {
      return null;
    }

    try {
      return {
        url: this.page.url(),
        title: await this.page.title(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if browser is initialized
   */
  isInitialized(): boolean {
    return this.browser !== null && this.page !== null;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BrowserConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('config:updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): BrowserConfig {
    return { ...this.config };
  }

  /**
   * Dispose and cleanup resources
   */
  async dispose(): Promise<void> {
    await this.close();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let browserToolInstance: BrowserTool | null = null;

/**
 * Get the singleton BrowserTool instance
 */
export function getBrowserTool(config?: Partial<BrowserConfig>): BrowserTool {
  if (!browserToolInstance) {
    browserToolInstance = new BrowserTool(config);
  }
  return browserToolInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export async function resetBrowserTool(): Promise<void> {
  if (browserToolInstance) {
    await browserToolInstance.dispose();
    browserToolInstance = null;
  }
}
