/**
 * Browser Manager
 *
 * OpenClaw-inspired browser automation using Playwright for CDP control.
 * Provides:
 * - Tab management
 * - Smart Snapshot for element references
 * - Navigation and interaction
 * - Media capture (screenshots, PDFs)
 * - Device emulation
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import {
  BrowserTab,
  BrowserProfile,
  WebElement,
  WebSnapshot,
  SnapshotOptions,
  ClickOptions,
  TypeOptions,
  FillOptions,
  ScrollOptions,
  SelectOptions,
  NavigateOptions,
  ScreenshotOptions,
  PDFOptions,
  Cookie,
  HeadersConfig,
  DeviceConfig,
  GeolocationConfig,
  EvaluateOptions,
  EvaluateResult,
  DialogInfo,
  DialogAction,
  FileUploadOptions,
  BrowserConfig,
  DEFAULT_BROWSER_CONFIG,
} from './types.js';

// Playwright types (lazy loaded) - structural shapes for type safety without importing playwright
interface PlaywrightDialog { type(): string; message(): string; defaultValue(): string; accept(text?: string): Promise<void>; dismiss(): Promise<void>; }
interface PlaywrightConsoleMessage { type(): string; text(): string; }
interface PlaywrightRequest { url(): string; method(): string; headers(): Record<string, string>; postData(): string | null; resourceType(): string; }
interface PlaywrightResponse { url(): string; status(): number; statusText(): string; headers(): Record<string, string>; }
interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  focused?: boolean;
  valuetext?: string;
  children?: AccessibilityNode[];
  [key: string]: unknown;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- playwright is dynamically loaded
type Browser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrowserContext = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightModule = any;

// ============================================================================
// Browser Manager
// ============================================================================

export class BrowserManager extends EventEmitter {
  private config: BrowserConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private currentPageId: string | null = null;
  private currentSnapshot: WebSnapshot | null = null;
  private nextRef: number = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- playwright is dynamically imported
  private playwright: Record<string, any> | null = null;

  constructor(config: Partial<BrowserConfig> = {}) {
    super();
    this.config = { ...DEFAULT_BROWSER_CONFIG, ...config };
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Launch browser
   */
  async launch(): Promise<void> {
    if (this.browser) {
      logger.warn('Browser already launched');
      return;
    }

    try {
      // Lazy load Playwright (optional dependency)
      // @ts-expect-error - playwright is an optional peer dependency
      this.playwright = await import('playwright').catch(() => null);

      if (!this.playwright) {
        throw new Error('Playwright failed to load. Install it with: npm install playwright');
      }
      const browserType = this.playwright[this.config.browser];

      this.browser = await browserType.launch({
        headless: this.config.headless,
        slowMo: this.config.slowMo,
        args: this.config.cdpPort ? [`--remote-debugging-port=${this.config.cdpPort}`] : [],
      });

      this.context = await this.browser.newContext({
        viewport: this.config.viewport,
        ignoreHTTPSErrors: this.config.ignoreHTTPSErrors,
        userAgent: this.config.proxy ? undefined : undefined,
      });

      // Set up event listeners
      this.context.on('page', (page: Page) => {
        const pageId = `page-${Date.now()}`;
        this.pages.set(pageId, page);
        this.setupPageListeners(pageId, page);
      });

      // Create initial page
      const page = await this.context.newPage();
      const pageId = `page-${Date.now()}`;
      this.pages.set(pageId, page);
      this.currentPageId = pageId;
      this.setupPageListeners(pageId, page);

      logger.info('Browser launched', { browser: this.config.browser, headless: this.config.headless });
    } catch (error) {
      logger.error('Failed to launch browser', { error });
      throw error;
    }
  }

  /**
   * Connect to existing browser via CDP
   */
  async connect(cdpUrl: string): Promise<void> {
    try {
      // @ts-expect-error - playwright is an optional peer dependency
      this.playwright = await import('playwright').catch(() => null);

      if (!this.playwright) {
        throw new Error('Playwright failed to load. Install it with: npm install playwright');
      }
      this.browser = await this.playwright.chromium.connectOverCDP(cdpUrl);
      const contexts = this.browser.contexts();
      this.context = contexts[0] || await this.browser.newContext();

      const pages = this.context.pages();
      for (const page of pages) {
        const pageId = `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.pages.set(pageId, page);
        this.setupPageListeners(pageId, page);
      }

      if (pages.length > 0) {
        this.currentPageId = Array.from(this.pages.keys())[0];
      }

      logger.info('Connected to browser via CDP', { cdpUrl });
    } catch (error) {
      logger.error('Failed to connect to browser', { error });
      throw error;
    }
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.pages.clear();
      this.currentPageId = null;
      logger.info('Browser closed');
    }
  }

  private setupPageListeners(pageId: string, page: Page): void {
    page.on('load', () => {
      this.emit('page-load', page.url());
      // Invalidate snapshot on navigation
      if (this.currentSnapshot) {
        this.currentSnapshot.valid = false;
      }
    });

    page.on('pageerror', (error: Error) => {
      this.emit('page-error', error);
    });

    page.on('dialog', (dialog: PlaywrightDialog) => {
      this.emit('dialog', {
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
      });
    });

    page.on('console', (msg: PlaywrightConsoleMessage) => {
      this.emit('console', msg.type(), msg.text());
    });

    page.on('request', (request: PlaywrightRequest) => {
      this.emit('network-request', {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData(),
        timestamp: Date.now(),
        resourceType: request.resourceType(),
      });
    });

    page.on('response', (response: PlaywrightResponse) => {
      this.emit('network-response', {
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        mimeType: response.headers()['content-type'] || '',
        timestamp: Date.now(),
      });
    });
  }

  // ============================================================================
  // Tab Management
  // ============================================================================

  /**
   * List all tabs
   */
  async getTabs(): Promise<BrowserTab[]> {
    const tabs: BrowserTab[] = [];
    let index = 0;

    for (const [id, page] of this.pages) {
      tabs.push({
        id,
        targetId: id,
        url: page.url(),
        title: await page.title(),
        active: id === this.currentPageId,
        index: index++,
      });
    }

    return tabs;
  }

  /**
   * Create new tab
   */
  async newTab(url?: string): Promise<BrowserTab> {
    if (!this.context) {
      throw new Error('Browser not launched');
    }

    const page = await this.context.newPage();
    const pageId = `page-${Date.now()}`;
    this.pages.set(pageId, page);
    this.currentPageId = pageId;
    this.setupPageListeners(pageId, page);

    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    return {
      id: pageId,
      targetId: pageId,
      url: page.url(),
      title: await page.title(),
      active: true,
      index: this.pages.size - 1,
    };
  }

  /**
   * Focus tab
   */
  async focusTab(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) {
      throw new Error(`Tab not found: ${tabId}`);
    }

    await page.bringToFront();
    this.currentPageId = tabId;
  }

  /**
   * Close tab
   */
  async closeTab(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) {
      throw new Error(`Tab not found: ${tabId}`);
    }

    await page.close();
    this.pages.delete(tabId);

    if (this.currentPageId === tabId) {
      this.currentPageId = this.pages.size > 0 ? Array.from(this.pages.keys())[0] : null;
    }
  }

  // ============================================================================
  // Smart Snapshot
  // ============================================================================

  /**
   * Take snapshot of current page
   */
  async takeSnapshot(options: SnapshotOptions = {}): Promise<WebSnapshot> {
    const page = this.getCurrentPage();
    this.nextRef = 1;

    const ttl = options.ttl ?? 5000;
    const format = options.format ?? 'ai';

    // Get all interactive elements using accessibility tree
    const elements = await this.extractElements(page, options);

    // Build element map
    const elementMap = new Map<number, WebElement>();
    for (const elem of elements) {
      elementMap.set(elem.ref, elem);
    }

    // Get viewport
    const viewport = page.viewportSize() || { width: 1280, height: 720 };

    // Create snapshot
    const snapshot: WebSnapshot = {
      id: `websnap-${Date.now()}`,
      timestamp: new Date(),
      url: page.url(),
      title: await page.title(),
      elements,
      elementMap,
      viewport,
      valid: true,
      ttl,
      format,
    };

    // Invalidate after TTL
    setTimeout(() => {
      snapshot.valid = false;
      this.emit('snapshot-expired', { id: snapshot.id });
    }, ttl);

    this.currentSnapshot = snapshot;
    logger.info('Web snapshot taken', { id: snapshot.id, elements: elements.length });

    return snapshot;
  }

  /**
   * Extract elements from page
   */
  private async extractElements(page: Page, options: SnapshotOptions): Promise<WebElement[]> {
    const maxElements = options.maxElements ?? 200;

    // Use Playwright's accessibility tree
    const accessibilityTree = await page.accessibility.snapshot({ interestingOnly: true });

    const elements: WebElement[] = [];

    const processNode = async (node: AccessibilityNode, depth = 0): Promise<void> => {
      if (elements.length >= maxElements) return;
      if (options.depth !== undefined && depth > options.depth) return;

      // Skip non-interactive if interactiveOnly
      const isInteractive = this.isInteractiveRole(node.role);
      if (options.interactiveOnly && !isInteractive) {
        // Still process children
        for (const child of node.children || []) {
          await processNode(child, depth + 1);
        }
        return;
      }

      // Get bounding box via locator
      let boundingBox = { x: 0, y: 0, width: 0, height: 0 };
      let selector = '';

      try {
        if (node.name) {
          const locator = page.getByRole(node.role, { name: node.name }).first();
          const box = await locator.boundingBox();
          if (box) {
            boundingBox = box;
          }
        }
      } catch {
        // Element might not be visible
      }

      // Skip hidden elements unless includeHidden
      if (!options.includeHidden && boundingBox.width === 0 && boundingBox.height === 0) {
        for (const child of node.children || []) {
          await processNode(child, depth + 1);
        }
        return;
      }

      const element: WebElement = {
        ref: this.nextRef++,
        tagName: this.roleToTagName(node.role),
        role: node.role,
        name: node.name || '',
        text: node.name,
        boundingBox,
        center: {
          x: boundingBox.x + boundingBox.width / 2,
          y: boundingBox.y + boundingBox.height / 2,
        },
        visible: boundingBox.width > 0 && boundingBox.height > 0,
        interactive: isInteractive,
        focused: node.focused || false,
        disabled: node.disabled || false,
        value: node.valuetext || node.value,
        ariaAttributes: {},
      };

      elements.push(element);

      // Process children
      for (const child of node.children || []) {
        await processNode(child, depth + 1);
      }
    };

    if (accessibilityTree) {
      await processNode(accessibilityTree);
    }

    return elements;
  }

  private isInteractiveRole(role: string): boolean {
    const interactiveRoles = [
      'button', 'link', 'textbox', 'checkbox', 'radio',
      'combobox', 'listbox', 'option', 'menuitem', 'tab',
      'slider', 'spinbutton', 'searchbox', 'switch',
    ];
    return interactiveRoles.includes(role.toLowerCase());
  }

  private roleToTagName(role: string): string {
    const roleMap: Record<string, string> = {
      button: 'button',
      link: 'a',
      textbox: 'input',
      checkbox: 'input',
      radio: 'input',
      combobox: 'select',
      listbox: 'select',
      option: 'option',
      menuitem: 'li',
      tab: 'button',
      img: 'img',
      heading: 'h1',
      paragraph: 'p',
      list: 'ul',
      listitem: 'li',
      table: 'table',
      cell: 'td',
      row: 'tr',
    };
    return roleMap[role.toLowerCase()] || 'div';
  }

  /**
   * Get element by reference
   */
  getElement(ref: number): WebElement | undefined {
    return this.currentSnapshot?.elementMap.get(ref);
  }

  /**
   * Generate text representation for AI
   */
  toTextRepresentation(snapshot?: WebSnapshot): string {
    const snap = snapshot || this.currentSnapshot;
    if (!snap?.valid) {
      return 'No valid snapshot. Take a new snapshot first.';
    }

    const lines: string[] = [
      `# Web Snapshot`,
      `URL: ${snap.url}`,
      `Title: ${snap.title}`,
      `Elements: ${snap.elements.length}`,
      '',
      '## Interactive Elements',
      '',
    ];

    // Group by role
    const byRole = new Map<string, WebElement[]>();
    for (const elem of snap.elements) {
      if (!elem.interactive) continue;
      const existing = byRole.get(elem.role) || [];
      existing.push(elem);
      byRole.set(elem.role, existing);
    }

    for (const [role, elements] of byRole) {
      lines.push(`### ${role}`);
      for (const elem of elements) {
        const valueStr = elem.value ? ` = "${elem.value}"` : '';
        const focusStr = elem.focused ? ' (focused)' : '';
        const disabledStr = elem.disabled ? ' (disabled)' : '';
        lines.push(`  [${elem.ref}] ${elem.name || elem.text || 'unnamed'}${valueStr}${focusStr}${disabledStr}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Navigation
  // ============================================================================

  /**
   * Navigate to URL
   */
  async navigate(options: NavigateOptions): Promise<void> {
    const page = this.getCurrentPage();

    await page.goto(options.url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || this.config.timeout,
      referer: options.referer,
    });

    // Invalidate snapshot
    if (this.currentSnapshot) {
      this.currentSnapshot.valid = false;
    }
  }

  /**
   * Go back
   */
  async goBack(): Promise<void> {
    const page = this.getCurrentPage();
    await page.goBack();
  }

  /**
   * Go forward
   */
  async goForward(): Promise<void> {
    const page = this.getCurrentPage();
    await page.goForward();
  }

  /**
   * Reload page
   */
  async reload(): Promise<void> {
    const page = this.getCurrentPage();
    await page.reload();
  }

  // ============================================================================
  // Interactions
  // ============================================================================

  /**
   * Click element by reference
   */
  async click(ref: number, options: ClickOptions = {}): Promise<void> {
    const page = this.getCurrentPage();
    const element = this.getElement(ref);

    if (!element) {
      throw new Error(`Element [${ref}] not found. Take a new snapshot.`);
    }

    await page.mouse.click(element.center.x, element.center.y, {
      button: options.button || 'left',
      clickCount: options.clickCount || 1,
      delay: options.delay,
    });
  }

  /**
   * Type text into element
   */
  async type(ref: number, text: string, options: TypeOptions = {}): Promise<void> {
    const page = this.getCurrentPage();
    const element = this.getElement(ref);

    if (!element) {
      throw new Error(`Element [${ref}] not found. Take a new snapshot.`);
    }

    // Click to focus
    await page.mouse.click(element.center.x, element.center.y);

    // Clear if requested
    if (options.clear) {
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
    }

    // Type text
    await page.keyboard.type(text, { delay: options.delay || 50 });
  }

  /**
   * Fill multiple fields
   */
  async fill(options: FillOptions): Promise<void> {
    for (const [refStr, value] of Object.entries(options.fields)) {
      const ref = parseInt(refStr, 10);
      await this.type(ref, value, { clear: true });
    }

    if (options.submit) {
      const page = this.getCurrentPage();
      await page.keyboard.press('Enter');
    }
  }

  /**
   * Scroll page
   */
  async scroll(options: ScrollOptions): Promise<void> {
    const page = this.getCurrentPage();

    if (options.toElement !== undefined) {
      const element = this.getElement(options.toElement);
      if (element) {
        await page.mouse.wheel(0, element.boundingBox.y - 100);
      }
    } else {
      let deltaX = 0;
      let deltaY = 0;
      const amount = options.amount || 300;

      switch (options.direction) {
        case 'up':
          deltaY = -amount;
          break;
        case 'down':
          deltaY = amount;
          break;
        case 'left':
          deltaX = -amount;
          break;
        case 'right':
          deltaX = amount;
          break;
      }

      await page.mouse.wheel(deltaX, deltaY);
    }
  }

  /**
   * Select option in dropdown
   */
  async select(options: SelectOptions): Promise<void> {
    const page = this.getCurrentPage();
    const element = this.getElement(options.ref);

    if (!element) {
      throw new Error(`Element [${options.ref}] not found.`);
    }

    // Click to open dropdown
    await page.mouse.click(element.center.x, element.center.y);

    // Wait a bit for dropdown to open
    await page.waitForTimeout(200);

    // Select by value, label, or index
    if (options.value) {
      await page.keyboard.type(options.value.charAt(0));
      await page.keyboard.press('Enter');
    } else if (options.index !== undefined) {
      for (let i = 0; i < options.index; i++) {
        await page.keyboard.press('ArrowDown');
      }
      await page.keyboard.press('Enter');
    }
  }

  /**
   * Press keyboard key
   */
  async press(key: string, modifiers?: string[]): Promise<void> {
    const page = this.getCurrentPage();

    if (modifiers && modifiers.length > 0) {
      for (const mod of modifiers) {
        await page.keyboard.down(mod);
      }
    }

    await page.keyboard.press(key);

    if (modifiers && modifiers.length > 0) {
      for (const mod of modifiers.reverse()) {
        await page.keyboard.up(mod);
      }
    }
  }

  /**
   * Hover over element
   */
  async hover(ref: number): Promise<void> {
    const page = this.getCurrentPage();
    const element = this.getElement(ref);

    if (!element) {
      throw new Error(`Element [${ref}] not found.`);
    }

    await page.mouse.move(element.center.x, element.center.y);
  }

  // ============================================================================
  // Media Capture
  // ============================================================================

  /**
   * Take screenshot
   */
  async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    const page = this.getCurrentPage();

    const screenshotOptions: Record<string, unknown> = {
      fullPage: options.fullPage,
      type: options.format || 'png',
      quality: options.quality,
      omitBackground: options.omitBackground,
      scale: options.scale === undefined ? 'device' : options.scale,
    };

    if (options.element !== undefined) {
      const element = this.getElement(options.element);
      if (element) {
        screenshotOptions.clip = element.boundingBox;
      }
    }

    if (options.mask && options.mask.length > 0) {
      screenshotOptions.mask = options.mask.map(sel => page.locator(sel));
    }

    return await page.screenshot(screenshotOptions);
  }

  /**
   * Generate PDF
   */
  async pdf(options: PDFOptions = {}): Promise<Buffer> {
    const page = this.getCurrentPage();

    return await page.pdf({
      format: options.format || 'A4',
      landscape: options.landscape,
      scale: options.scale,
      printBackground: options.printBackground ?? true,
      headerTemplate: options.headerTemplate,
      footerTemplate: options.footerTemplate,
      margin: options.margin,
      pageRanges: options.pageRanges,
    });
  }

  // ============================================================================
  // Cookies & Storage
  // ============================================================================

  /**
   * Get cookies
   */
  async getCookies(urls?: string[]): Promise<Cookie[]> {
    if (!this.context) {
      throw new Error('Browser not launched');
    }
    return await this.context.cookies(urls);
  }

  /**
   * Set cookies
   */
  async setCookies(cookies: Cookie[]): Promise<void> {
    if (!this.context) {
      throw new Error('Browser not launched');
    }
    await this.context.addCookies(cookies);
  }

  /**
   * Clear cookies
   */
  async clearCookies(): Promise<void> {
    if (!this.context) {
      throw new Error('Browser not launched');
    }
    await this.context.clearCookies();
  }

  // ============================================================================
  // Network & Headers
  // ============================================================================

  /**
   * Set extra headers
   */
  async setHeaders(headers: Record<string, string>): Promise<void> {
    if (!this.context) {
      throw new Error('Browser not launched');
    }
    await this.context.setExtraHTTPHeaders(headers);
  }

  /**
   * Set offline mode
   */
  async setOffline(offline: boolean): Promise<void> {
    if (!this.context) {
      throw new Error('Browser not launched');
    }
    await this.context.setOffline(offline);
  }

  // ============================================================================
  // Device Emulation
  // ============================================================================

  /**
   * Emulate device
   */
  async emulateDevice(device: DeviceConfig): Promise<void> {
    if (!this.context) {
      throw new Error('Browser not launched');
    }

    // Playwright devices
    const devices = this.playwright?.devices ?? {};
    if (device.name && devices[device.name]) {
      const preset = devices[device.name];
      await this.context.setViewportSize(preset.viewport);
      // Note: Other properties require new context
    } else if (device.viewport) {
      await this.context.setViewportSize(device.viewport);
    }
  }

  /**
   * Set geolocation
   */
  async setGeolocation(geo: GeolocationConfig): Promise<void> {
    if (!this.context) {
      throw new Error('Browser not launched');
    }
    await this.context.setGeolocation({
      latitude: geo.latitude,
      longitude: geo.longitude,
      accuracy: geo.accuracy,
    });
  }

  // ============================================================================
  // JavaScript Execution
  // ============================================================================

  /**
   * Evaluate JavaScript in page context
   */
  async evaluate(options: EvaluateOptions): Promise<EvaluateResult> {
    const page = this.getCurrentPage();

    try {
      const result = await page.evaluate(options.expression, options.args);
      return { success: true, value: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get page content
   */
  async getContent(): Promise<string> {
    const page = this.getCurrentPage();
    return await page.content();
  }

  /**
   * Get page title
   */
  async getTitle(): Promise<string> {
    const page = this.getCurrentPage();
    return await page.title();
  }

  /**
   * Get page URL
   */
  getUrl(): string {
    const page = this.getCurrentPage();
    return page.url();
  }

  // ============================================================================
  // Dialog Handling
  // ============================================================================

  /**
   * Handle dialog
   */
  async handleDialog(action: DialogAction): Promise<void> {
    const page = this.getCurrentPage();

    page.once('dialog', async (dialog: PlaywrightDialog) => {
      if (action.accept) {
        await dialog.accept(action.promptText);
      } else {
        await dialog.dismiss();
      }
    });
  }

  // ============================================================================
  // File Upload
  // ============================================================================

  /**
   * Upload files
   */
  async uploadFiles(options: FileUploadOptions): Promise<void> {
    const page = this.getCurrentPage();
    const element = this.getElement(options.ref);

    if (!element) {
      throw new Error(`Element [${options.ref}] not found.`);
    }

    // Use locator to set files
    const locator = page.locator(`[aria-label="${element.name}"]`).or(
      page.locator(`input[type="file"]`).first()
    );

    await locator.setInputFiles(options.files);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private getCurrentPage(): Page {
    if (!this.currentPageId || !this.pages.has(this.currentPageId)) {
      throw new Error('No active page. Open a tab first.');
    }
    return this.pages.get(this.currentPageId)!;
  }

  /**
   * Check if browser is launched
   */
  isLaunched(): boolean {
    return this.browser !== null;
  }

  /**
   * Get current snapshot
   */
  getCurrentSnapshot(): WebSnapshot | null {
    if (!this.currentSnapshot?.valid) {
      return null;
    }
    return this.currentSnapshot;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let browserManagerInstance: BrowserManager | null = null;

export function getBrowserManager(config?: Partial<BrowserConfig>): BrowserManager {
  if (!browserManagerInstance) {
    browserManagerInstance = new BrowserManager(config);
  }
  return browserManagerInstance;
}

export function resetBrowserManager(): void {
  if (browserManagerInstance) {
    browserManagerInstance.close().catch(() => {});
  }
  browserManagerInstance = null;
}

export default BrowserManager;
