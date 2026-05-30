/**
 * Browser Manager
 *
 * Enterprise-grade browser automation using Playwright for CDP control.
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
  ConsoleEntry,
  RouteRule,
  ExtendedDeviceConfig,
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

interface PendingDialog {
  info: DialogInfo;
  dialog: PlaywrightDialog;
}

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
  private pendingDialogs: Map<string, PendingDialog> = new Map();
  private dialogCounter = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- playwright is dynamically imported
  private playwright: Record<string, any> | null = null;

  // Console history buffer
  private consoleBuffer: ConsoleEntry[] = [];
  private static readonly MAX_CONSOLE_ENTRIES = 500;

  // Mouse position tracking for human-like movement
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Lazy-loaded subsystems
  private _routeInterceptor: import('./route-interceptor.js').RouteInterceptor | null = null;
  private _profileManager: import('./profile-manager.js').BrowserProfileManager | null = null;

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
        userAgent: this.config.userAgent || (this.config.headless ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' : undefined),
      });

      await this.applyStealth(this.context);

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
      this.playwright = await import('playwright').catch(() => null);

      if (!this.playwright) {
        throw new Error('Playwright failed to load. Install it with: npm install playwright');
      }
      this.browser = await this.playwright.chromium.connectOverCDP(cdpUrl);
      const contexts = this.browser.contexts();
      this.context = contexts[0] || await this.browser.newContext();

      await this.applyStealth(this.context);

      const pages = this.context.pages();
      for (const page of pages) {
        const pageId = `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.pages.set(pageId, page);
        this.setupPageListeners(pageId, page);
      }

      const firstPageId = Array.from(this.pages.keys())[0];
      if (pages.length > 0 && firstPageId !== undefined) {
        this.currentPageId = firstPageId;
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
      this.pendingDialogs.clear();
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
      this.pushConsoleEntry({
        type: 'pageerror',
        text: error.message,
        timestamp: new Date(),
        pageId,
        url: page.url(),
      });
      this.emit('page-error', error);
    });

    page.on('dialog', (dialog: PlaywrightDialog) => {
      const id = `dialog-${++this.dialogCounter}`;
      const info: DialogInfo = {
        id,
        pageId,
        type: this.toDialogType(dialog.type()),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
        createdAt: new Date().toISOString(),
      };
      this.pendingDialogs.set(id, { info, dialog });
      this.emit('dialog', info);
    });

    page.on('console', (msg: PlaywrightConsoleMessage) => {
      this.emit('console', msg.type(), msg.text());
      this.pushConsoleEntry({
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date(),
        pageId,
        url: page.url(),
      });
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
    this.removePendingDialogsForPage(tabId);

    if (this.currentPageId === tabId) {
      this.currentPageId = this.pages.size > 0 ? Array.from(this.pages.keys())[0] ?? null : null;
    }
  }

  // ============================================================================
  // Smart Snapshot
  // ============================================================================

  /**
   * Take snapshot of current page
   */
  /**
   * Get next available ref number (for shared ref space with desktop)
   */
  getNextRef(): number {
    return this.nextRef++;
  }

  async takeSnapshot(options: SnapshotOptions = {}): Promise<WebSnapshot> {
    const page = this.getCurrentPage();
    // Don't reset nextRef — continuous counter for globally unique refs

    const ttl = options.ttl ?? 5000;
    const format = options.format ?? 'ai';

    const pendingDialogs = this.listPendingDialogs();
    if (pendingDialogs.length > 0) {
      const viewport = page.viewportSize() || { width: 1280, height: 720 };
      const snapshot: WebSnapshot = {
        id: `websnap-${Date.now()}`,
        timestamp: new Date(),
        url: page.url(),
        title: '(browser dialog pending)',
        elements: [],
        elementMap: new Map(),
        viewport,
        valid: true,
        ttl,
        format,
        pendingDialogs,
      };

      setTimeout(() => {
        snapshot.valid = false;
        this.emit('snapshot-expired', { id: snapshot.id });
      }, ttl);

      this.currentSnapshot = snapshot;
      logger.info('Web snapshot taken with pending browser dialog', {
        id: snapshot.id,
        pendingDialogs: pendingDialogs.length,
      });

      return snapshot;
    }

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
      pendingDialogs: [],
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

    // Get accessibility tree (page.accessibility removed in Playwright 1.48+)
    let accessibilityTree: AccessibilityNode | null = null;
    try {
      if (page.accessibility) {
        accessibilityTree = await page.accessibility.snapshot({ interestingOnly: true });
      }
    } catch {
      // Accessibility API unavailable
    }

    // Fallback: extract via DOM when accessibility API is unavailable
    if (!accessibilityTree) {
      return this.extractElementsViaDOM(page, maxElements, options);
    }

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

  /**
   * DOM-based element extraction fallback for Playwright 1.48+ where page.accessibility was removed
   */
  private async extractElementsViaDOM(page: Page, maxElements: number, options: SnapshotOptions): Promise<WebElement[]> {
    const interactiveSelector = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"], [role="listbox"], [role="menuitem"], [role="tab"], [role="switch"], [role="slider"], [role="searchbox"], [contenteditable="true"]';
    const selector = options.interactiveOnly ? interactiveSelector : `${interactiveSelector}, h1, h2, h3, h4, h5, h6, p, img, li, td, th, label`;

    const startRef = this.nextRef;

    const domNodes = await page.evaluate(({ sel, start }: { sel: string, start: number }) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      let currentRef = start;
      return nodes.slice(0, 300).map((el: Element) => {
        const rect = el.getBoundingClientRect();
        const htmlEl = el as HTMLElement;

        // Inject data-agent-ref for reliable selector-based action mapping
        const ref = currentRef++;
        try {
          el.setAttribute('data-agent-ref', String(ref));
        } catch (_) { /* ignore */ }

        const name = (el.getAttribute('aria-label') || (htmlEl as any).placeholder || el.textContent?.trim().slice(0, 100) || '').trim();
        const value = (htmlEl as HTMLInputElement).value || el.getAttribute('aria-valuetext') || '';

        return {
          ref,
          tagName: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          name,
          value,
          disabled: (htmlEl as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true',
          focused: document.activeElement === el,
          checked: (htmlEl as HTMLInputElement).checked || false,
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        };
      });
    }, { sel: selector, start: startRef });

    const elements: WebElement[] = [];
    for (const node of domNodes) {
      if (elements.length >= maxElements) break;
      if (!options.includeHidden && node.width === 0 && node.height === 0) continue;

      const role = node.role || this.tagNameToRole(node.tagName);
      const isInteractive = this.isInteractiveRole(role);
      if (options.interactiveOnly && !isInteractive) continue;

      // Semantic Pruning: Skip non-interactive element if name and value are empty
      if (!isInteractive && !node.name && !node.value) {
        continue;
      }

      elements.push({
        ref: node.ref,
        tagName: node.tagName,
        role,
        name: node.name,
        text: node.name,
        boundingBox: { x: node.x, y: node.y, width: node.width, height: node.height },
        center: { x: node.x + node.width / 2, y: node.y + node.height / 2 },
        visible: node.width > 0 && node.height > 0,
        interactive: isInteractive,
        focused: node.focused,
        disabled: node.disabled,
        value: node.value || undefined,
        ariaAttributes: {},
      });
    }

    // Update nextRef
    this.nextRef = startRef + domNodes.length;

    return elements;
  }

  private tagNameToRole(tagName: string): string {
    const tagRoleMap: Record<string, string> = {
      a: 'link', button: 'button', input: 'textbox', select: 'combobox',
      textarea: 'textbox', h1: 'heading', h2: 'heading', h3: 'heading',
      h4: 'heading', h5: 'heading', h6: 'heading', img: 'img',
      p: 'paragraph', li: 'listitem', ul: 'list', ol: 'list',
      table: 'table', td: 'cell', th: 'columnheader', label: 'label',
    };
    return tagRoleMap[tagName] || 'generic';
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
    ];

    if (snap.pendingDialogs?.length) {
      lines.push('## Pending Browser Dialogs');
      lines.push('');
      for (const dialog of snap.pendingDialogs) {
        const defaultValue = dialog.defaultValue ? ` default="${dialog.defaultValue}"` : '';
        lines.push(`  [${dialog.id ?? 'dialog'}] ${dialog.type}: ${dialog.message}${defaultValue}`);
      }
      lines.push('');
    }

    lines.push('## Interactive Elements');
    lines.push('');

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

  async navigate(options: NavigateOptions): Promise<void> {
    const page = this.getCurrentPage();
    const timeout = options.timeout || this.config.timeout || 30000;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(options.url, {
          waitUntil: options.waitUntil || 'domcontentloaded',
          timeout,
          referer: options.referer,
        });

        // Invalidate snapshot
        if (this.currentSnapshot) {
          this.currentSnapshot.valid = false;
        }
        return; // Succeeded!
      } catch (err) {
        lastError = err as Error;
        logger.warn(`Navigation attempt ${attempt} to ${options.url} failed, retrying...`, { error: err });
        if (attempt < 3) {
          await page.waitForTimeout(1000 * attempt); // Exponential backoff wait before retry
        }
      }
    }

    throw new Error(`Navigation to ${options.url} failed after 3 attempts. Last error: ${lastError?.message}`);
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

  async click(ref: number, options: ClickOptions = {}): Promise<void> {
    const page = this.getCurrentPage();
    const element = this.getElement(ref);

    if (!element) {
      throw new Error(`Element [${ref}] not found. Take a new snapshot.`);
    }

    // Move mouse smoothly from last position to element center
    try {
      await this.moveMouseHumanLike(page, this.lastMouseX, this.lastMouseY, element.center.x, element.center.y);
      this.lastMouseX = element.center.x;
      this.lastMouseY = element.center.y;
    } catch (_) {
      try {
        await page.mouse.move(element.center.x, element.center.y);
      } catch (_) { /* ignore */ }
    }

    // Try selector click first for robustness
    try {
      const selector = `[data-agent-ref="${ref}"]`;
      const locator = page.locator(selector).first();
      if (await locator.count() > 0 && await locator.isVisible()) {
        await locator.click({
          button: options.button || 'left',
          clickCount: options.clickCount || 1,
          delay: options.delay,
          timeout: 2000,
        });
        logger.info(`Clicked element [${ref}] using selector ${selector}`);
        return;
      }
    } catch (err) {
      logger.debug(`Selector click failed for [${ref}], falling back to coordinates`, { error: err });
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

    let typedViaSelector = false;
    try {
      const selector = `[data-agent-ref="${ref}"]`;
      const locator = page.locator(selector).first();
      if (await locator.count() > 0 && await locator.isVisible()) {
        if (options.clear) {
          await locator.fill('');
        }
        
        await locator.focus();
        const baseDelay = options.delay || 50;
        for (const char of text) {
          await page.keyboard.type(char);
          const jitterDelay = baseDelay * 0.5 + Math.random() * baseDelay;
          await page.waitForTimeout(jitterDelay);
        }
        logger.info(`Typed into element [${ref}] using selector ${selector} with human-like jitter`);
        typedViaSelector = true;
      }
    } catch (err) {
      logger.debug(`Selector typing failed for [${ref}], falling back to coordinates`, { error: err });
    }

    if (!typedViaSelector) {
      // Click to focus (includes smooth mouse movement)
      try {
        await this.moveMouseHumanLike(page, this.lastMouseX, this.lastMouseY, element.center.x, element.center.y);
        this.lastMouseX = element.center.x;
        this.lastMouseY = element.center.y;
      } catch (_) {
        try {
          await page.mouse.move(element.center.x, element.center.y);
        } catch (_) { /* ignore */ }
      }

      await page.mouse.click(element.center.x, element.center.y);

      // Clear if requested
      if (options.clear) {
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
      }

      // Type text with human-like jitter
      const baseDelay = options.delay || 50;
      for (const char of text) {
        await page.keyboard.type(char);
        const jitterDelay = baseDelay * 0.5 + Math.random() * baseDelay;
        await page.waitForTimeout(jitterDelay);
      }
    }
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

  async select(options: SelectOptions): Promise<void> {
    const page = this.getCurrentPage();
    const element = this.getElement(options.ref);

    if (!element) {
      throw new Error(`Element [${options.ref}] not found.`);
    }

    const selector = `[data-agent-ref="${options.ref}"]`;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Native selectOption first
        if (element.tagName === 'select' || element.role === 'combobox' || element.role === 'listbox') {
          try {
            if (options.value) {
              await page.selectOption(selector, { value: options.value });
            } else if (options.label) {
              await page.selectOption(selector, { label: options.label });
            } else if (options.index !== undefined) {
              await page.selectOption(selector, { index: options.index });
            }
            return; // Succeeded natively!
          } catch (err) {
            logger.warn(`Native selectOption attempt ${attempt} failed, falling back to mouse/keyboard interactions`, { error: err });
          }
        }

        // Custom dropdown interactive fallback
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: 2000 });
        await locator.click();

        // Wait for dropdown to open (menus, listboxes, lists)
        try {
          await page.waitForSelector('[role="listbox"]:visible, [role="menu"]:visible, ul:visible, select:visible', { timeout: 500 });
        } catch {
          await page.waitForTimeout(150);
        }

        if (options.value) {
          await page.keyboard.type(options.value.charAt(0));
          await page.keyboard.press('Enter');
        } else if (options.index !== undefined) {
          for (let i = 0; i < options.index; i++) {
            await page.keyboard.press('ArrowDown');
          }
          await page.keyboard.press('Enter');
        }
        return; // Succeeded!
      } catch (err) {
        lastError = err as Error;
        logger.warn(`Dropdown select attempt ${attempt} failed, retrying...`, { error: err });
        if (attempt < 3) {
          await page.waitForTimeout(500);
        }
      }
    }

    throw new Error(`Dropdown selection failed after 3 attempts. Last error: ${lastError?.message}`);
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

    try {
      await this.moveMouseHumanLike(page, this.lastMouseX, this.lastMouseY, element.center.x, element.center.y);
      this.lastMouseX = element.center.x;
      this.lastMouseY = element.center.y;
    } catch (_) {
      await page.mouse.move(element.center.x, element.center.y);
    }
  }

  /**
   * Move mouse dynamically using cubic Bezier curves to simulate human behavior
   */
  private async moveMouseHumanLike(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    if (distance < 10) {
      await page.mouse.move(toX, toY);
      return;
    }

    const steps = Math.min(25, Math.max(10, Math.round(distance / 40)));

    // Generate random control points for Bezier curve to simulate natural arm/wrist arc
    const ctrlX1 = fromX + (toX - fromX) * 0.25 + (Math.random() - 0.5) * 150;
    const ctrlY1 = fromY + (toY - fromY) * 0.25 + (Math.random() - 0.5) * 150;
    const ctrlX2 = fromX + (toX - fromX) * 0.75 + (Math.random() - 0.5) * 150;
    const ctrlY2 = fromY + (toY - fromY) * 0.75 + (Math.random() - 0.5) * 150;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // Cubic Bezier interpolation
      const x = Math.round(
        (1 - t) ** 3 * fromX +
        3 * (1 - t) ** 2 * t * ctrlX1 +
        3 * (1 - t) * t ** 2 * ctrlX2 +
        t ** 3 * toX
      );
      const y = Math.round(
        (1 - t) ** 3 * fromY +
        3 * (1 - t) ** 2 * t * ctrlY1 +
        3 * (1 - t) * t ** 2 * ctrlY2 +
        t ** 3 * toY
      );

      const jitterX = x + (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 1.5);
      const jitterY = y + (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 1.5);

      await page.mouse.move(Math.round(jitterX), Math.round(jitterY));
      
      const stepDelay = 8 + Math.random() * 7;
      await page.waitForTimeout(stepDelay);
    }

    await page.mouse.move(toX, toY);
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

    const buffer = await page.screenshot(screenshotOptions);

    // Annotate with element reference labels if requested
    if (options.labels && this.currentSnapshot?.valid) {
      try {
        const { annotateScreenshot } = await import('./screenshot-annotator.js');
        return await annotateScreenshot(buffer, this.currentSnapshot.elements);
      } catch (err) {
        logger.warn('Screenshot annotation failed, returning raw screenshot', { error: err });
      }
    }

    return buffer;
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
  async handleDialog(action: DialogAction): Promise<DialogInfo> {
    const pending = this.findPendingDialog(action.dialogId);
    if (!pending) {
      throw new Error('No pending browser dialog found. Trigger the dialog first, then call browser_dialog.');
    }

    try {
      if (action.accept) {
        await pending.dialog.accept(action.promptText);
      } else {
        await pending.dialog.dismiss();
      }
      return pending.info;
    } finally {
      if (pending.info.id) {
        this.pendingDialogs.delete(pending.info.id);
      }
    }
  }

  listPendingDialogs(options: { currentPageOnly?: boolean } = {}): DialogInfo[] {
    const currentPageOnly = options.currentPageOnly ?? true;
    const currentPageId = this.currentPageId;
    return Array.from(this.pendingDialogs.values())
      .map(entry => entry.info)
      .filter(info => !currentPageOnly || !currentPageId || info.pageId === currentPageId);
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

  /**
   * Drag element to another element
   */
  async drag(options: { sourceRef: number; targetRef: number }): Promise<void> {
    const page = this.getCurrentPage();
    const source = this.getElement(options.sourceRef);
    const target = this.getElement(options.targetRef);

    if (!source) throw new Error(`Source element [${options.sourceRef}] not found.`);
    if (!target) throw new Error(`Target element [${options.targetRef}] not found.`);

    // Use injected selector first, fallback to coordinates or aria-label locators
    const sourceSelector = `[data-agent-ref="${options.sourceRef}"]`;
    const targetSelector = `[data-agent-ref="${options.targetRef}"]`;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const sourceLoc = page.locator(sourceSelector).first();
        const targetLoc = page.locator(targetSelector).first();

        // Check visibility and wait
        await sourceLoc.waitFor({ state: 'visible', timeout: 2000 });
        await targetLoc.waitFor({ state: 'visible', timeout: 2000 });

        await sourceLoc.dragTo(targetLoc);
        return; // Succeeded!
      } catch (err) {
        lastError = err as Error;
        logger.warn(`Drag-and-drop attempt ${attempt} failed, retrying...`, { error: err });
        // Fallback to hover + mouse down + move + mouse up if dragTo fails
        try {
          await page.mouse.move(source.center.x, source.center.y);
          await page.mouse.down();
          await page.waitForTimeout(100);
          await page.mouse.move(target.center.x, target.center.y, { steps: 5 });
          await page.mouse.up();
          return; // Fallback succeeded!
        } catch (fallbackErr) {
          logger.warn(`Drag-and-drop coordinates fallback attempt ${attempt} failed`, { error: fallbackErr });
        }
      }
    }

    throw new Error(`Drag-and-drop failed after 3 attempts. Last error: ${lastError?.message}`);
  }

  /**
   * Wait for navigation to complete
   */
  async waitForNavigation(options?: { timeout?: number }): Promise<void> {
    const page = this.getCurrentPage();
    await page.waitForURL('**', { timeout: options?.timeout ?? 30000 });
  }

  /**
   * Download a file by clicking a link or triggering a download
   */
  async downloadFile(options: { ref?: number; timeout?: number }): Promise<{ path: string; suggestedFilename: string }> {
    const page = this.getCurrentPage();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: options?.timeout ?? 30000 }),
      options?.ref !== undefined
        ? this.click(options.ref)
        : Promise.resolve(),
    ]);

    const filePath = await download.path();
    return {
      path: filePath || '',
      suggestedFilename: download.suggestedFilename(),
    };
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

  private findPendingDialog(dialogId?: string): PendingDialog | undefined {
    if (dialogId) {
      return this.pendingDialogs.get(dialogId);
    }

    const currentPageId = this.currentPageId;
    return Array.from(this.pendingDialogs.values())
      .find(entry => !currentPageId || entry.info.pageId === currentPageId);
  }

  private removePendingDialogsForPage(pageId: string): void {
    for (const [dialogId, entry] of this.pendingDialogs.entries()) {
      if (entry.info.pageId === pageId) {
        this.pendingDialogs.delete(dialogId);
      }
    }
  }

  private toDialogType(type: string): DialogInfo['type'] {
    if (type === 'alert' || type === 'confirm' || type === 'prompt' || type === 'beforeunload') {
      return type;
    }
    return 'alert';
  }

  /**
   * Check if browser is launched
   */
  isLaunched(): boolean {
    return this.browser !== null;
  }

  // ============================================================================
  // Console History
  // ============================================================================

  /**
   * Get console history buffer
   */
  getConsoleHistory(type?: string, limit?: number): ConsoleEntry[] {
    let entries = this.consoleBuffer;
    if (type) {
      entries = entries.filter(e => e.type === type);
    }
    if (limit) {
      entries = entries.slice(-limit);
    }
    return entries;
  }

  /**
   * Clear console history buffer
   */
  clearConsoleHistory(): void {
    this.consoleBuffer = [];
  }

  private pushConsoleEntry(entry: ConsoleEntry): void {
    this.consoleBuffer.push(entry);
    if (this.consoleBuffer.length > BrowserManager.MAX_CONSOLE_ENTRIES) {
      this.consoleBuffer.splice(0, this.consoleBuffer.length - BrowserManager.MAX_CONSOLE_ENTRIES);
    }
  }

  // ============================================================================
  // localStorage / sessionStorage
  // ============================================================================

  /**
   * Get localStorage for the current page's origin
   */
  async getLocalStorage(): Promise<Record<string, string>> {
    const page = this.getCurrentPage();
    return await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) data[key] = localStorage.getItem(key) || '';
      }
      return data;
    });
  }

  /**
   * Set localStorage entries for the current page
   */
  async setLocalStorage(data: Record<string, string>): Promise<void> {
    const page = this.getCurrentPage();
    await page.evaluate((entries: Record<string, string>) => {
      for (const [key, value] of Object.entries(entries)) {
        localStorage.setItem(key, value);
      }
    }, data);
  }

  /**
   * Get sessionStorage for the current page's origin
   */
  async getSessionStorage(): Promise<Record<string, string>> {
    const page = this.getCurrentPage();
    return await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) data[key] = sessionStorage.getItem(key) || '';
      }
      return data;
    });
  }

  /**
   * Set sessionStorage entries for the current page
   */
  async setSessionStorage(data: Record<string, string>): Promise<void> {
    const page = this.getCurrentPage();
    await page.evaluate((entries: Record<string, string>) => {
      for (const [key, value] of Object.entries(entries)) {
        sessionStorage.setItem(key, value);
      }
    }, data);
  }

  // ============================================================================
  // Extended Device Emulation
  // ============================================================================

  /**
   * Set timezone for the browser context
   */
  async setTimezone(timezoneId: string): Promise<void> {
    if (!this.context) throw new Error('Browser not launched');
    // Playwright doesn't have a direct setTimezone on existing context,
    // but we can use CDP to emulate it
    const page = this.getCurrentPage();
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Emulation.setTimezoneOverride', { timezoneId });
  }

  /**
   * Set locale for the browser context
   */
  async setLocale(locale: string): Promise<void> {
    if (!this.context) throw new Error('Browser not launched');
    const page = this.getCurrentPage();
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Emulation.setLocaleOverride', { locale });
  }

  /**
   * Set color scheme preference
   */
  async setColorScheme(colorScheme: 'light' | 'dark' | 'no-preference'): Promise<void> {
    if (!this.context) throw new Error('Browser not launched');
    const page = this.getCurrentPage();
    await page.emulateMedia({ colorScheme });
  }

  /**
   * Grant permissions to the browser context
   */
  async grantPermissions(permissions: string[]): Promise<void> {
    if (!this.context) throw new Error('Browser not launched');
    await this.context.grantPermissions(permissions);
  }

  /**
   * Extended device emulation with timezone, locale, colorScheme, permissions
   */
  async emulateDeviceExtended(device: ExtendedDeviceConfig): Promise<void> {
    // Apply base device emulation
    await this.emulateDevice(device);

    // Apply extensions
    if (device.timezoneId) await this.setTimezone(device.timezoneId);
    if (device.locale) await this.setLocale(device.locale);
    if (device.colorScheme) await this.setColorScheme(device.colorScheme);
    if (device.permissions) await this.grantPermissions(device.permissions);
  }

  // ============================================================================
  // Browser Profile Persistence
  // ============================================================================

  private async getProfileManager(): Promise<import('./profile-manager.js').BrowserProfileManager> {
    if (!this._profileManager) {
      const { BrowserProfileManager } = await import('./profile-manager.js');
      this._profileManager = new BrowserProfileManager();
    }
    return this._profileManager;
  }

  /**
   * Save current browser state as a named profile
   */
  async saveProfile(name: string): Promise<void> {
    const cookies = await this.getCookies();
    const localStorage: Record<string, Record<string, string>> = {};
    const sessionStorage: Record<string, Record<string, string>> = {};

    // Capture storage from current page
    try {
      const url = this.getUrl();
      const origin = new URL(url).origin;
      localStorage[origin] = await this.getLocalStorage();
      sessionStorage[origin] = await this.getSessionStorage();
    } catch {
      // Page may not be navigated yet
    }

    const mgr = await this.getProfileManager();
    await mgr.save(name, { cookies, localStorage, sessionStorage });
  }

  /**
   * Load a named profile into the browser
   */
  async loadProfile(name: string): Promise<boolean> {
    const mgr = await this.getProfileManager();
    const profile = await mgr.load(name);
    if (!profile) return false;

    // Restore cookies
    if (profile.cookies.length > 0) {
      await this.setCookies(profile.cookies);
    }

    // Restore storage per origin
    for (const [origin, data] of Object.entries(profile.localStorage)) {
      try {
        const page = this.getCurrentPage();
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
        await this.setLocalStorage(data);
      } catch {
        logger.warn(`Failed to restore localStorage for ${origin}`);
      }
    }

    return true;
  }

  // ============================================================================
  // Network Route Interception
  // ============================================================================

  private async getRouteInterceptor(): Promise<import('./route-interceptor.js').RouteInterceptor> {
    if (!this._routeInterceptor) {
      const { RouteInterceptor } = await import('./route-interceptor.js');
      this._routeInterceptor = new RouteInterceptor();
    }
    return this._routeInterceptor;
  }

  /**
   * Add a route interception rule
   */
  async addRouteRule(rule: RouteRule): Promise<void> {
    const page = this.getCurrentPage();
    const interceptor = await this.getRouteInterceptor();
    await interceptor.addRule(page, rule);
  }

  /**
   * Remove a route interception rule
   */
  async removeRouteRule(ruleId: string): Promise<void> {
    const page = this.getCurrentPage();
    const interceptor = await this.getRouteInterceptor();
    await interceptor.removeRule(page, ruleId);
  }

  /**
   * List active route rules
   */
  listRouteRules(): RouteRule[] {
    return this._routeInterceptor?.listRules() || [];
  }

  /**
   * Clear all route rules
   */
  async clearRouteRules(): Promise<void> {
    if (this._routeInterceptor) {
      const page = this.getCurrentPage();
      await this._routeInterceptor.clearRules(page);
    }
  }

  /**
   * Apply stealth overrides to browser context
   */
  private async applyStealth(context: BrowserContext): Promise<void> {
    try {
      await context.addInitScript(() => {
        try {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
          });
        } catch (_) { /* ignore */ }

        try {
          const getParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function (parameter) {
            if (parameter === 37445) return 'Intel Open Source Technology Center';
            if (parameter === 37446) return 'Mesa DRI Intel(R) HD Graphics 620 (Skylake GT2)';
            return getParameter.call(this, parameter);
          };
        } catch (_) { /* ignore */ }

        try {
          Object.defineProperty(navigator, 'languages', {
            get: () => ['fr-FR', 'fr', 'en-US', 'en'],
          });
        } catch (_) { /* ignore */ }

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).chrome = {
            runtime: {},
            loadTimes: () => {},
            csi: () => {},
            app: {},
          };
        } catch (_) { /* ignore */ }
      });
      logger.info('Applied stealth init scripts to context');
    } catch (error) {
      logger.debug('Failed to apply stealth scripts', { error });
    }
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
