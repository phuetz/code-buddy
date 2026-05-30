/**
 * Browser Tool
 *
 * Enterprise-grade unified browser control interface for AI agents.
 */

import { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getBrowserManager, BrowserManager } from './browser-manager.js';
import {
  buildInternetProofPersistenceSuggestions,
  buildInternetProofPlan,
  type InternetProofEvidence,
  type InternetProofPersistenceSuggestion,
} from './internet-proof-plan.js';

// ============================================================================
// Types
// ============================================================================

export type BrowserAction =
  // Lifecycle
  | 'launch'
  | 'connect'
  | 'close'
  // Tabs
  | 'tabs'
  | 'new_tab'
  | 'focus_tab'
  | 'close_tab'
  // Snapshot
  | 'snapshot'
  | 'observe'
  | 'get_element'
  | 'find_elements'
  // Navigation
  | 'navigate'
  | 'go_back'
  | 'go_forward'
  | 'reload'
  // Interaction
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'fill'
  | 'select'
  | 'press'
  | 'hover'
  | 'scroll'
  // Media
  | 'screenshot'
  | 'pdf'
  // Cookies
  | 'get_cookies'
  | 'set_cookie'
  | 'clear_cookies'
  // Network
  | 'set_headers'
  | 'set_offline'
  // Device
  | 'emulate_device'
  | 'set_geolocation'
  // JS
  | 'evaluate'
  | 'get_content'
  | 'extract'
  | 'assert_text'
  | 'get_images'
  | 'console'
  | 'dialog'
  // Info
  | 'get_url'
  | 'get_title'
  // Drag & Drop
  | 'drag'
  // File Upload
  | 'upload_files'
  // Wait
  | 'wait_for_navigation'
  // Storage
  | 'get_local_storage'
  | 'set_local_storage'
  | 'get_session_storage'
  | 'set_session_storage'
  // Route Interception
  | 'add_route_rule'
  | 'remove_route_rule'
  | 'clear_route_rules'
  // Timezone/Locale
  | 'set_timezone'
  | 'set_locale'
  // Download
  | 'download'
  // Batch (Native Engine v2026.3.13 alignment)
  | 'batch'
  // Attach to running Chrome (Native Engine v2026.3.13)
  | 'attach';

export interface BrowserToolInput {
  action: BrowserAction;
  /** Batch actions (for action='batch') — Native Engine v2026.3.13 */
  actions?: BrowserToolInput[];
  /** Stop on first error in batch mode (default: true) */
  stopOnError?: boolean;
  /** Multiple selectors for click/fill/type (Native Engine v2026.3.13) */
  selectors?: string[];
  /** Browser profile name ('user', 'chrome-relay', or custom) */
  profile?: string;
  // Connection
  cdpUrl?: string;
  headless?: boolean;
  // Tab
  tabId?: string;
  // Navigation
  url?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  // Snapshot
  interactiveOnly?: boolean;
  includeHidden?: boolean;
  maxElements?: number;
  labels?: boolean;
  // Element
  ref?: number;
  role?: string;
  name?: string;
  query?: string;
  expectedText?: string;
  proofGoal?: string;
  persistWhenProven?: boolean;
  // Interaction
  text?: string;
  key?: string;
  modifiers?: string[];
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  clear?: boolean;
  // Fill
  fields?: Record<string, string>;
  submit?: boolean;
  // Select
  value?: string;
  label?: string;
  index?: number;
  // Scroll
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  toElement?: number;
  // Screenshot
  fullPage?: boolean;
  element?: number;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  outputPath?: string;
  // Cookies
  cookieName?: string;
  cookieValue?: string;
  cookieDomain?: string;
  // Headers
  headers?: Record<string, string>;
  offline?: boolean;
  // Device
  device?: string;
  viewport?: { width: number; height: number };
  // Geolocation
  latitude?: number;
  longitude?: number;
  // JS
  expression?: string;
  // Images
  limit?: number;
  visibleOnly?: boolean;
  // Console
  consoleAction?: 'list' | 'clear';
  consoleType?: string;
  // Browser dialog
  dialogAction?: 'list' | 'accept' | 'dismiss';
  dialogId?: string;
  promptText?: string;
  // Timeout
  timeout?: number;
  // Drag
  sourceRef?: number;
  targetRef?: number;
  // Upload
  files?: string[];
  // Storage
  storageData?: Record<string, string>;
  // Route Rules
  ruleId?: string;
  rulePattern?: string;
  ruleAction?: 'block' | 'mock' | 'redirect';
  ruleResponse?: { status?: number; body?: string; contentType?: string };
  ruleRedirectUrl?: string;
  // Timezone/Locale
  timezone?: string;
  locale?: string;
  // Download
  downloadPath?: string;
}

interface ExtractedPage {
  url: string;
  title: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  actions: string[];
  fields: string[];
  text: string;
  textLength: number;
}

interface BrowserImageInfo {
  index: number;
  src: string;
  currentSrc: string;
  alt: string;
  title: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  visible: boolean;
  loading: string;
}

interface AssertPage {
  url: string;
  title: string;
  text: string;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(normalizeString).map((item) => item.trim()).filter(Boolean)
    : [];
}

function normalizeExtractedPage(value: unknown): ExtractedPage {
  const page = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const links = Array.isArray(page.links)
    ? page.links
        .map((link) => {
          const record = typeof link === 'object' && link !== null
            ? link as Record<string, unknown>
            : {};
          return {
            text: normalizeString(record.text).trim(),
            href: normalizeString(record.href).trim(),
          };
        })
        .filter((link) => link.text || link.href)
    : [];

  const text = normalizeString(page.text);
  const textLength = typeof page.textLength === 'number' ? page.textLength : text.length;

  return {
    url: normalizeString(page.url),
    title: normalizeString(page.title),
    headings: normalizeStringArray(page.headings),
    links,
    actions: normalizeStringArray(page.actions),
    fields: normalizeStringArray(page.fields),
    text,
    textLength,
  };
}

function normalizeBrowserImages(value: unknown): BrowserImageInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    const image = typeof item === 'object' && item !== null
      ? item as Record<string, unknown>
      : {};
    const toNumber = (field: string): number => typeof image[field] === 'number' ? image[field] : 0;

    return {
      index: toNumber('index') || index,
      src: normalizeString(image.src),
      currentSrc: normalizeString(image.currentSrc),
      alt: normalizeString(image.alt),
      title: normalizeString(image.title),
      width: toNumber('width'),
      height: toNumber('height'),
      naturalWidth: toNumber('naturalWidth'),
      naturalHeight: toNumber('naturalHeight'),
      visible: typeof image.visible === 'boolean' ? image.visible : false,
      loading: normalizeString(image.loading),
    };
  }).filter((image) => image.src || image.currentSrc);
}

function normalizeAssertPage(value: unknown): AssertPage {
  const page = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};

  return {
    url: normalizeString(page.url),
    title: normalizeString(page.title),
    text: normalizeString(page.text),
  };
}

function findMatchingLines(text: string, query: string, limit: number): string[] {
  const terms = query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean);
  if (terms.length === 0) {
    return [];
  }

  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      const normalized = line.toLowerCase();
      return terms.every((term) => normalized.includes(term)) ||
        terms.some((term) => term.length > 3 && normalized.includes(term));
    })
    .slice(0, limit);
}

// ============================================================================
// Browser Tool
// ============================================================================

export class BrowserTool {
  private manager: BrowserManager;
  private screenshotDir: string;

  constructor() {
    this.manager = getBrowserManager();
    this.screenshotDir = path.join(os.tmpdir(), 'codebuddy-screenshots');
  }

  /**
   * Execute browser action
   */
  async execute(input: BrowserToolInput): Promise<ToolResult> {
    const { action } = input;

    logger.debug('Browser action', { action, input });

    try {
      switch (action) {
        // Lifecycle
        case 'launch':
          return this.launch(input);
        case 'connect':
          return this.connect(input);
        case 'close':
          return this.close();

        // Tabs
        case 'tabs':
          return this.getTabs();
        case 'new_tab':
          return this.newTab(input);
        case 'focus_tab':
          return this.focusTab(input);
        case 'close_tab':
          return this.closeTab(input);

        // Snapshot
        case 'snapshot':
          return this.takeSnapshot(input);
        case 'observe':
          return this.observe(input);
        case 'get_element':
          return this.getElement(input);
        case 'find_elements':
          return this.findElements(input);

        // Navigation
        case 'navigate':
          return this.navigate(input);
        case 'go_back':
          return this.goBack();
        case 'go_forward':
          return this.goForward();
        case 'reload':
          return this.reload();

        // Interaction
        case 'click':
          return this.click(input);
        case 'double_click':
          return this.doubleClick(input);
        case 'right_click':
          return this.rightClick(input);
        case 'type':
          return this.type(input);
        case 'fill':
          return this.fill(input);
        case 'select':
          return this.select(input);
        case 'press':
          return this.press(input);
        case 'hover':
          return this.hover(input);
        case 'scroll':
          return this.scroll(input);

        // Media
        case 'screenshot':
          return this.screenshot(input);
        case 'pdf':
          return this.pdf(input);

        // Cookies
        case 'get_cookies':
          return this.getCookies();
        case 'set_cookie':
          return this.setCookie(input);
        case 'clear_cookies':
          return this.clearCookies();

        // Network
        case 'set_headers':
          return this.setHeaders(input);
        case 'set_offline':
          return this.setOffline(input);

        // Device
        case 'emulate_device':
          return this.emulateDevice(input);
        case 'set_geolocation':
          return this.setGeolocation(input);

        // JS
        case 'evaluate':
          return this.evaluate(input);
        case 'get_content':
          return this.getContent();
        case 'extract':
          return this.extract(input);
        case 'assert_text':
          return this.assertText(input);
        case 'get_images':
          return this.getImages(input);
        case 'console':
          return this.consoleHistory(input);
        case 'dialog':
          return this.dialog(input);

        // Info
        case 'get_url':
          return this.getUrl();
        case 'get_title':
          return this.getTitle();

        // Drag & Drop
        case 'drag':
          return this.drag(input);

        // File Upload
        case 'upload_files':
          return this.uploadFiles(input);

        // Wait
        case 'wait_for_navigation':
          return this.waitForNavigation(input);

        // Storage
        case 'get_local_storage':
          return this.getLocalStorage();
        case 'set_local_storage':
          return this.setLocalStorage(input);
        case 'get_session_storage':
          return this.getSessionStorage();
        case 'set_session_storage':
          return this.setSessionStorage(input);

        // Route Rules
        case 'add_route_rule':
          return this.addRouteRule(input);
        case 'remove_route_rule':
          return this.removeRouteRule(input);
        case 'clear_route_rules':
          return this.clearRouteRules();

        // Timezone/Locale
        case 'set_timezone':
          return this.setTimezone(input);
        case 'set_locale':
          return this.setLocale(input);

        // Download
        case 'download':
          return this.download(input);

        // Batch execution (Native Engine v2026.3.13)
        case 'batch':
          return this.executeBatch(input);

        // Attach to running Chrome (Native Engine v2026.3.13)
        case 'attach':
          return this.attachToChrome(input);

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Browser action error', { action, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Execute a batch of browser actions (Native Engine v2026.3.13)
   */
  private async executeBatch(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.actions || !Array.isArray(input.actions) || input.actions.length === 0) {
      return { success: false, error: 'batch action requires actions[] array' };
    }

    const stopOnError = input.stopOnError !== false; // default true
    const results: Array<{ action: string; success: boolean; output?: string; error?: string }> = [];

    for (const subAction of input.actions) {
      // SSRF check for navigation actions in batch (Native Engine v2026.3.14)
      if (subAction.action === 'navigate' && subAction.url) {
        try {
          const { assertSafeUrl } = await import('../security/ssrf-guard.js');
          const check = await assertSafeUrl(subAction.url);
          if (!check.safe) {
            results.push({
              action: subAction.action,
              success: false,
              error: `SSRF blocked: ${check.reason || 'URL not allowed'}`,
            });
            if (stopOnError) break;
            continue;
          }
        } catch { /* SSRF guard unavailable, proceed */ }
      }

      const result = await this.execute(subAction);
      results.push({
        action: subAction.action,
        success: result.success,
        output: result.output,
        error: result.error,
      });

      if (!result.success && stopOnError) {
        break;
      }
    }

    const allSuccess = results.every(r => r.success);
    const output = results.map((r, i) =>
      `[${i + 1}/${input.actions!.length}] ${r.action}: ${r.success ? 'OK' : 'FAIL'} ${r.output || r.error || ''}`
    ).join('\n');

    return {
      success: allSuccess,
      output: `Batch: ${results.length}/${input.actions.length} actions executed\n${output}`,
      error: allSuccess ? undefined : 'One or more batch actions failed',
    };
  }

  /**
   * Attach to a running Chrome instance (Native Engine v2026.3.13)
   */
  private async attachToChrome(input: BrowserToolInput): Promise<ToolResult> {
    try {
      const { discoverChromeEndpoint } = await import('./chrome-discovery.js');
      const { getBuiltinProfile } = await import('./builtin-profiles.js');

      // Try discovery first
      const cdpUrl = discoverChromeEndpoint();
      if (cdpUrl) {
        return this.connect({ ...input, cdpUrl });
      }

      // Fallback to chrome-relay profile
      const relay = getBuiltinProfile('chrome-relay');
      if (relay?.userDataDir) {
        return this.launch({
          ...input,
          userDataDir: relay.userDataDir,
          headless: relay.headless ?? false,
        } as BrowserToolInput);
      }

      return { success: false, error: 'No Chrome instance found and chrome-relay profile unavailable' };
    } catch (error) {
      return { success: false, error: `Chrome attach failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  private async launch(_input: BrowserToolInput): Promise<ToolResult> {
    if (this.manager.isLaunched()) {
      return { success: true, output: 'Browser already launched' };
    }

    await this.manager.launch();

    return { success: true, output: 'Browser launched successfully' };
  }

  private async connect(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.cdpUrl) {
      return { success: false, error: 'CDP URL is required' };
    }

    await this.manager.connect(input.cdpUrl);

    return { success: true, output: `Connected to browser at ${input.cdpUrl}` };
  }

  private async close(): Promise<ToolResult> {
    await this.manager.close();
    return { success: true, output: 'Browser closed' };
  }

  // ============================================================================
  // Tabs
  // ============================================================================

  private async getTabs(): Promise<ToolResult> {
    const tabs = await this.manager.getTabs();

    const output = tabs
      .map(t => `${t.active ? '>' : ' '} [${t.id}] ${t.title} - ${t.url}`)
      .join('\n');

    return {
      success: true,
      output: `${tabs.length} tabs open:\n${output}`,
      data: { tabs },
    };
  }

  private async newTab(input: BrowserToolInput): Promise<ToolResult> {
    const tab = await this.manager.newTab(input.url);

    return {
      success: true,
      output: `New tab opened: ${tab.title} (${tab.url})`,
      data: { tab },
    };
  }

  private async focusTab(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.tabId) {
      return { success: false, error: 'Tab ID is required' };
    }

    await this.manager.focusTab(input.tabId);

    return { success: true, output: `Focused tab: ${input.tabId}` };
  }

  private async closeTab(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.tabId) {
      return { success: false, error: 'Tab ID is required' };
    }

    await this.manager.closeTab(input.tabId);

    return { success: true, output: `Closed tab: ${input.tabId}` };
  }

  // ============================================================================
  // Snapshot
  // ============================================================================

  private async takeSnapshot(input: BrowserToolInput): Promise<ToolResult> {
    const snapshot = await this.manager.takeSnapshot({
      interactiveOnly: input.interactiveOnly ?? true,
      includeHidden: input.includeHidden,
      maxElements: input.maxElements,
    });

    const textRepresentation = this.manager.toTextRepresentation(snapshot);

    return {
      success: true,
      output: textRepresentation,
      data: {
        snapshotId: snapshot.id,
        url: snapshot.url,
        title: snapshot.title,
        elementCount: snapshot.elements.length,
      },
    };
  }

  private async observe(input: BrowserToolInput): Promise<ToolResult> {
    const result = await this.takeSnapshot({
      ...input,
      interactiveOnly: input.interactiveOnly ?? false,
      maxElements: input.maxElements ?? 80,
    });

    if (!result.success) {
      return result;
    }

    return {
      ...result,
      output: `Observation snapshot\n${result.output ?? ''}`,
    };
  }

  private async getElement(input: BrowserToolInput): Promise<ToolResult> {
    if (input.ref === undefined) {
      return { success: false, error: 'Element ref is required' };
    }

    const element = this.manager.getElement(input.ref);
    if (!element) {
      return { success: false, error: `Element [${input.ref}] not found. Take a new snapshot.` };
    }

    return {
      success: true,
      output: `Element [${element.ref}]: ${element.role} - "${element.name}" at (${element.center.x}, ${element.center.y})`,
      data: element,
    };
  }

  private async findElements(input: BrowserToolInput): Promise<ToolResult> {
    const snapshot = this.manager.getCurrentSnapshot();
    if (!snapshot) {
      return { success: false, error: 'No valid snapshot. Take a snapshot first.' };
    }

    let elements = snapshot.elements;

    if (input.role) {
      elements = elements.filter(e => e.role.toLowerCase() === input.role!.toLowerCase());
    }

    if (input.name) {
      const nameLower = input.name.toLowerCase();
      elements = elements.filter(e =>
        e.name.toLowerCase().includes(nameLower) ||
        (e.text && e.text.toLowerCase().includes(nameLower))
      );
    }

    if (input.interactiveOnly) {
      elements = elements.filter(e => e.interactive);
    }

    const output = elements
      .slice(0, 20)
      .map(e => `[${e.ref}] ${e.role}: "${e.name || e.text || 'unnamed'}"`)
      .join('\n');

    return {
      success: true,
      output: `Found ${elements.length} elements:\n${output}`,
      data: { elements: elements.slice(0, 50) },
    };
  }

  // ============================================================================
  // Navigation
  // ============================================================================

  private async navigate(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.url) {
      return { success: false, error: 'URL is required' };
    }

    // SSRF guard for the network surface only. http/https can be steered at internal
    // services / cloud metadata, so they're validated (parity with batch-mode :474).
    // Local schemes (file://, about:, data:) are legitimate navigation targets and are
    // not a server-side request forgery, so they pass through unchanged.
    let scheme = '';
    try { scheme = new URL(input.url).protocol; } catch { /* leave to Playwright */ }
    if (scheme === 'http:' || scheme === 'https:') {
      try {
        const { assertSafeUrl } = await import('../security/ssrf-guard.js');
        const check = await assertSafeUrl(input.url);
        if (!check.safe) {
          return { success: false, error: `SSRF blocked: ${check.reason || 'URL not allowed'}` };
        }
      } catch { /* SSRF guard unavailable, proceed */ }
    }

    await this.manager.navigate({
      url: input.url,
      waitUntil: input.waitUntil,
      timeout: input.timeout,
    });

    const title = await this.manager.getTitle();

    return { success: true, output: `Navigated to: ${input.url}\nTitle: ${title}` };
  }

  private async goBack(): Promise<ToolResult> {
    await this.manager.goBack();
    return { success: true, output: 'Navigated back' };
  }

  private async goForward(): Promise<ToolResult> {
    await this.manager.goForward();
    return { success: true, output: 'Navigated forward' };
  }

  private async reload(): Promise<ToolResult> {
    await this.manager.reload();
    return { success: true, output: 'Page reloaded' };
  }

  // ============================================================================
  // Interactions
  // ============================================================================

  private async click(input: BrowserToolInput): Promise<ToolResult> {
    if (input.ref === undefined) {
      return { success: false, error: 'Element ref is required' };
    }

    await this.manager.click(input.ref, {
      button: input.button,
      clickCount: input.clickCount,
    });

    const element = this.manager.getElement(input.ref);
    return { success: true, output: `Clicked [${input.ref}] ${element?.name || ''}` };
  }

  private async doubleClick(input: BrowserToolInput): Promise<ToolResult> {
    if (input.ref === undefined) {
      return { success: false, error: 'Element ref is required' };
    }

    await this.manager.click(input.ref, { clickCount: 2 });

    return { success: true, output: `Double-clicked [${input.ref}]` };
  }

  private async rightClick(input: BrowserToolInput): Promise<ToolResult> {
    if (input.ref === undefined) {
      return { success: false, error: 'Element ref is required' };
    }

    await this.manager.click(input.ref, { button: 'right' });

    return { success: true, output: `Right-clicked [${input.ref}]` };
  }

  private async type(input: BrowserToolInput): Promise<ToolResult> {
    if (input.ref === undefined) {
      return { success: false, error: 'Element ref is required' };
    }
    if (!input.text) {
      return { success: false, error: 'Text is required' };
    }

    await this.manager.type(input.ref, input.text, { clear: input.clear });

    return { success: true, output: `Typed "${input.text.slice(0, 30)}${input.text.length > 30 ? '...' : ''}" into [${input.ref}]` };
  }

  private async fill(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.fields) {
      return { success: false, error: 'Fields object is required' };
    }

    // Convert string keys to numbers
    const fields: Record<number, string> = {};
    for (const [key, value] of Object.entries(input.fields)) {
      fields[parseInt(key, 10)] = value;
    }

    await this.manager.fill({ fields, submit: input.submit });

    return { success: true, output: `Filled ${Object.keys(fields).length} fields` };
  }

  private async select(input: BrowserToolInput): Promise<ToolResult> {
    if (input.ref === undefined) {
      return { success: false, error: 'Element ref is required' };
    }

    await this.manager.select({
      ref: input.ref,
      value: input.value,
      label: input.label,
      index: input.index,
    });

    return { success: true, output: `Selected option in [${input.ref}]` };
  }

  private async press(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'Key is required' };
    }

    await this.manager.press(input.key, input.modifiers);

    const modStr = input.modifiers?.join('+') || '';
    return { success: true, output: `Pressed ${modStr}${modStr ? '+' : ''}${input.key}` };
  }

  private async hover(input: BrowserToolInput): Promise<ToolResult> {
    if (input.ref === undefined) {
      return { success: false, error: 'Element ref is required' };
    }

    await this.manager.hover(input.ref);

    return { success: true, output: `Hovering over [${input.ref}]` };
  }

  private async scroll(input: BrowserToolInput): Promise<ToolResult> {
    await this.manager.scroll({
      direction: input.direction,
      amount: input.amount,
      toElement: input.toElement,
    });

    if (input.toElement !== undefined) {
      return { success: true, output: `Scrolled to element [${input.toElement}]` };
    }
    return { success: true, output: `Scrolled ${input.direction || 'down'} ${input.amount || 300}px` };
  }

  // ============================================================================
  // Media
  // ============================================================================

  private async screenshot(input: BrowserToolInput): Promise<ToolResult> {
    await fs.mkdir(this.screenshotDir, { recursive: true });

    const buffer = await this.manager.screenshot({
      fullPage: input.fullPage,
      element: input.element,
      format: input.format,
      quality: input.quality,
    });

    const filename = input.outputPath ||
      path.join(this.screenshotDir, `screenshot-${Date.now()}.${input.format || 'png'}`);

    await fs.writeFile(filename, buffer);

    return {
      success: true,
      output: `Screenshot saved: ${filename}`,
      data: { path: filename, size: buffer.length },
    };
  }

  private async pdf(input: BrowserToolInput): Promise<ToolResult> {
    await fs.mkdir(this.screenshotDir, { recursive: true });

    const buffer = await this.manager.pdf({});

    const filename = input.outputPath ||
      path.join(this.screenshotDir, `page-${Date.now()}.pdf`);

    await fs.writeFile(filename, buffer);

    return {
      success: true,
      output: `PDF saved: ${filename}`,
      data: { path: filename, size: buffer.length },
    };
  }

  // ============================================================================
  // Cookies
  // ============================================================================

  private async getCookies(): Promise<ToolResult> {
    const cookies = await this.manager.getCookies();

    const output = cookies
      .slice(0, 20)
      .map(c => `${c.name}: ${c.value.slice(0, 30)}${c.value.length > 30 ? '...' : ''}`)
      .join('\n');

    return {
      success: true,
      output: `${cookies.length} cookies:\n${output}`,
      data: { cookies },
    };
  }

  private async setCookie(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.cookieName || !input.cookieValue) {
      return { success: false, error: 'Cookie name and value are required' };
    }

    await this.manager.setCookies([{
      name: input.cookieName,
      value: input.cookieValue,
      domain: input.cookieDomain,
    }]);

    return { success: true, output: `Cookie set: ${input.cookieName}` };
  }

  private async clearCookies(): Promise<ToolResult> {
    await this.manager.clearCookies();
    return { success: true, output: 'Cookies cleared' };
  }

  // ============================================================================
  // Network
  // ============================================================================

  private async setHeaders(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.headers) {
      return { success: false, error: 'Headers object is required' };
    }

    await this.manager.setHeaders(input.headers);

    return { success: true, output: `Set ${Object.keys(input.headers).length} headers` };
  }

  private async setOffline(input: BrowserToolInput): Promise<ToolResult> {
    await this.manager.setOffline(input.offline ?? true);

    return { success: true, output: input.offline ? 'Offline mode enabled' : 'Online mode enabled' };
  }

  // ============================================================================
  // Device
  // ============================================================================

  private async emulateDevice(input: BrowserToolInput): Promise<ToolResult> {
    await this.manager.emulateDevice({
      name: input.device,
      viewport: input.viewport,
    });

    return { success: true, output: `Emulating device: ${input.device || `${input.viewport?.width}x${input.viewport?.height}`}` };
  }

  private async setGeolocation(input: BrowserToolInput): Promise<ToolResult> {
    if (input.latitude === undefined || input.longitude === undefined) {
      return { success: false, error: 'Latitude and longitude are required' };
    }

    await this.manager.setGeolocation({
      latitude: input.latitude,
      longitude: input.longitude,
    });

    return { success: true, output: `Geolocation set: ${input.latitude}, ${input.longitude}` };
  }

  // ============================================================================
  // JavaScript
  // ============================================================================

  private async evaluate(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.expression) {
      return { success: false, error: 'JavaScript expression is required' };
    }

    const result = await this.manager.evaluate({
      expression: input.expression,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      output: `Result: ${JSON.stringify(result.value, null, 2)}`,
      data: { result: result.value },
    };
  }

  private async getContent(): Promise<ToolResult> {
    const content = await this.manager.getContent();

    // Truncate for display
    const truncated = content.length > 5000
      ? content.slice(0, 5000) + '\n... (truncated)'
      : content;

    return {
      success: true,
      output: truncated,
      data: { length: content.length },
    };
  }

  private async dialog(input: BrowserToolInput): Promise<ToolResult> {
    const dialogAction = input.dialogAction ?? 'list';

    if (dialogAction === 'list') {
      const dialogs = this.manager.listPendingDialogs();
      if (dialogs.length === 0) {
        return {
          success: true,
          output: 'No pending browser dialogs.',
          data: { dialogs },
        };
      }

      return {
        success: true,
        output: dialogs
          .map((dialog) => {
            const defaultValue = dialog.defaultValue ? ` default="${dialog.defaultValue}"` : '';
            return `[${dialog.id ?? 'dialog'}] ${dialog.type}: ${dialog.message}${defaultValue}`;
          })
          .join('\n'),
        data: { dialogs },
      };
    }

    if (dialogAction !== 'accept' && dialogAction !== 'dismiss') {
      return { success: false, error: `Unknown dialog action: ${dialogAction}` };
    }

    const handled = await this.manager.handleDialog({
      dialogId: input.dialogId,
      accept: dialogAction === 'accept',
      promptText: input.promptText,
    });

    return {
      success: true,
      output: `${dialogAction === 'accept' ? 'Accepted' : 'Dismissed'} ${handled.type} dialog: ${handled.message}`,
      data: { dialog: handled },
    };
  }

  private async getImages(input: BrowserToolInput): Promise<ToolResult> {
    const limit = Math.max(1, Math.min(Number(input.limit) || 50, 200));
    const visibleOnly = input.visibleOnly === true;
    const result = await this.manager.evaluate({
      expression: `(() => {
        const limit = ${limit};
        const visibleOnly = ${visibleOnly ? 'true' : 'false'};
        const images = Array.from(document.images).map((img, index) => {
          const rect = img.getBoundingClientRect();
          const style = window.getComputedStyle(img);
          const visible = rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && Number(style.opacity || '1') > 0;
          return {
            index,
            src: img.src || img.getAttribute('src') || '',
            currentSrc: img.currentSrc || '',
            alt: img.alt || '',
            title: img.title || '',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            naturalWidth: img.naturalWidth || 0,
            naturalHeight: img.naturalHeight || 0,
            visible,
            loading: img.loading || '',
          };
        });
        return images
          .filter((img) => !visibleOnly || img.visible)
          .slice(0, limit);
      })()`,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const images = normalizeBrowserImages(result.value);
    const output = images.length > 0
      ? images.map((image) => {
          const label = image.alt || image.title || '(no alt)';
          const source = image.currentSrc || image.src;
          return `[${image.index}] ${label} ${image.width}x${image.height} -> ${source}`;
        }).join('\n')
      : 'No images found on the active browser page.';

    return {
      success: true,
      output,
      data: { images },
    };
  }

  private async consoleHistory(input: BrowserToolInput): Promise<ToolResult> {
    const consoleAction = input.consoleAction ?? 'list';

    if (consoleAction === 'clear') {
      this.manager.clearConsoleHistory();
      return {
        success: true,
        output: 'Browser console history cleared.',
        data: { entries: [] },
      };
    }

    if (consoleAction !== 'list') {
      return { success: false, error: `Unknown console action: ${consoleAction}` };
    }

    const entries = this.manager.getConsoleHistory(input.consoleType, input.limit);
    if (entries.length === 0) {
      return {
        success: true,
        output: 'No browser console entries.',
        data: { entries },
      };
    }

    return {
      success: true,
      output: entries.map((entry) => {
        const when = entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp);
        const location = entry.url ? ` ${entry.url}` : '';
        return `[${when}] ${entry.type}${location}: ${entry.text}`;
      }).join('\n'),
      data: { entries },
    };
  }

  private async extract(input: BrowserToolInput): Promise<ToolResult> {
    const result = await this.manager.evaluate({
      expression: `(() => {
        const text = (document.body?.innerText || '').replace(/\\s+\\n/g, '\\n').trim();
        const take = (value, max = 140) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
        const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
          .map((el) => take(el.textContent))
          .filter(Boolean)
          .slice(0, 20);
        const links = Array.from(document.querySelectorAll('a[href]'))
          .map((el) => ({ text: take(el.textContent || el.getAttribute('aria-label')), href: el.href }))
          .filter((link) => link.text || link.href)
          .slice(0, 30);
        const actions = Array.from(document.querySelectorAll('button,[role="button"],a[href],input,textarea,select'))
          .map((el) => take(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.id))
          .filter(Boolean)
          .slice(0, 30);
        const fields = Array.from(document.querySelectorAll('input,textarea,select'))
          .map((el) => take(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id))
          .filter(Boolean)
          .slice(0, 20);
        return {
          url: location.href,
          title: document.title,
          headings,
          links,
          actions,
          fields,
          text: text.slice(0, 12000),
          textLength: text.length,
        };
      })()`,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const extracted = normalizeExtractedPage(result.value);
    const query = (input.query || input.text || input.name || '').trim();
    const matches = query ? findMatchingLines(extracted.text, query, 12) : [];
    const textPreview = (matches.length > 0 ? matches : extracted.text.split(/\n+/).slice(0, 12))
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    const persistenceSuggestions = this.buildInternetProofPersistenceSuggestions(input, {
      url: extracted.url,
      title: extracted.title,
      query: query || undefined,
      headings: extracted.headings,
      matches,
      snippet: textPreview,
    });

    const output = [
      `Extracted: ${extracted.title || '(untitled)'}`,
      `URL: ${extracted.url}`,
      query ? `Query: ${query}` : undefined,
      extracted.headings.length ? `Headings:\n${extracted.headings.map((heading) => `- ${heading}`).join('\n')}` : undefined,
      extracted.actions.length ? `Actionable:\n${extracted.actions.map((action) => `- ${action}`).join('\n')}` : undefined,
      extracted.links.length ? `Links:\n${extracted.links.map((link) => `- ${link.text || link.href} -> ${link.href}`).join('\n')}` : undefined,
      textPreview ? `Text:\n${textPreview}` : undefined,
      extracted.textLength > extracted.text.length ? `Text truncated: ${extracted.text.length}/${extracted.textLength} chars` : undefined,
      this.formatPersistenceSuggestionOutput(persistenceSuggestions),
    ].filter(Boolean).join('\n\n');

    return {
      success: true,
      output,
      data: {
        ...extracted,
        query: query || undefined,
        matches,
        ...(persistenceSuggestions.length > 0 ? { persistenceSuggestions } : {}),
      },
    };
  }

  private async assertText(input: BrowserToolInput): Promise<ToolResult> {
    const expected = (input.expectedText || input.text || input.query || '').trim();
    if (!expected) {
      return { success: false, error: 'expectedText, text, or query is required' };
    }

    const result = await this.manager.evaluate({
      expression: `(() => ({
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim()
      }))()`,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const page = normalizeAssertPage(result.value);
    const haystack = `${page.title}\n${page.url}\n${page.text}`.toLowerCase();
    const needle = expected.toLowerCase();
    const passed = haystack.includes(needle);
    const index = haystack.indexOf(needle);
    const snippet = index >= 0
      ? page.text.slice(Math.max(0, index - 80), Math.min(page.text.length, index + expected.length + 160))
      : page.text.slice(0, 240);
    const persistenceSuggestions = this.buildInternetProofPersistenceSuggestions(input, {
      url: page.url,
      title: page.title,
      query: input.query,
      matches: passed ? [expected] : [],
      expectedText: expected,
      assertionPassed: passed,
      snippet,
    });

    return {
      success: passed,
      output: passed
        ? [
            `Assertion passed: page contains "${expected}"\n${snippet}`,
            this.formatPersistenceSuggestionOutput(persistenceSuggestions),
          ].filter(Boolean).join('\n\n')
        : `Assertion failed: page does not contain "${expected}"\nTitle: ${page.title}\nURL: ${page.url}\nPreview: ${snippet}`,
      error: passed ? undefined : `Expected text not found: ${expected}`,
      data: {
        expectedText: expected,
        passed,
        title: page.title,
        url: page.url,
        snippet,
        ...(persistenceSuggestions.length > 0 ? { persistenceSuggestions } : {}),
      },
    };
  }

  private buildInternetProofPersistenceSuggestions(
    input: BrowserToolInput,
    evidence: InternetProofEvidence,
  ): InternetProofPersistenceSuggestion[] {
    if (input.persistWhenProven !== true) {
      return [];
    }

    const goal = (
      input.proofGoal ||
      input.query ||
      input.expectedText ||
      evidence.title ||
      evidence.url ||
      input.url ||
      ''
    ).trim();
    if (!goal) {
      return [];
    }

    const plan = buildInternetProofPlan({
      goal,
      query: input.query || input.text || input.name,
      sourceUrl: evidence.url || input.url,
      expectedText: evidence.expectedText || input.expectedText,
      requiresBrowser: true,
      persistWhenProven: true,
    });

    return buildInternetProofPersistenceSuggestions({ plan, evidence });
  }

  private formatPersistenceSuggestionOutput(
    suggestions: InternetProofPersistenceSuggestion[],
  ): string | undefined {
    if (suggestions.length === 0) {
      return undefined;
    }
    const tools = suggestions.map((suggestion) => suggestion.tool).join(', ');
    return `Persistence suggestions available: ${tools}`;
  }

  // ============================================================================
  // Info
  // ============================================================================

  private async getUrl(): Promise<ToolResult> {
    const url = this.manager.getUrl();
    return { success: true, output: url };
  }

  private async getTitle(): Promise<ToolResult> {
    const title = await this.manager.getTitle();
    return { success: true, output: title };
  }

  // ============================================================================
  // Drag & Drop
  // ============================================================================

  private async drag(input: BrowserToolInput): Promise<ToolResult> {
    if (input.sourceRef === undefined || input.targetRef === undefined) {
      return { success: false, error: 'Source ref and target ref are required' };
    }

    await this.manager.drag({ sourceRef: input.sourceRef, targetRef: input.targetRef });

    return { success: true, output: `Dragged [${input.sourceRef}] to [${input.targetRef}]` };
  }

  // ============================================================================
  // File Upload
  // ============================================================================

  private async uploadFiles(input: BrowserToolInput): Promise<ToolResult> {
    if (input.ref === undefined) {
      return { success: false, error: 'Element ref is required' };
    }
    if (!input.files || input.files.length === 0) {
      return { success: false, error: 'Files array is required' };
    }

    await this.manager.uploadFiles({ ref: input.ref, files: input.files });

    return { success: true, output: `Uploaded ${input.files.length} file(s) to [${input.ref}]` };
  }

  // ============================================================================
  // Wait
  // ============================================================================

  private async waitForNavigation(input: BrowserToolInput): Promise<ToolResult> {
    await this.manager.waitForNavigation({ timeout: input.timeout });

    return { success: true, output: 'Navigation completed' };
  }

  // ============================================================================
  // Storage
  // ============================================================================

  private async getLocalStorage(): Promise<ToolResult> {
    const data = await this.manager.getLocalStorage();
    const entries = Object.entries(data);

    const output = entries.length === 0
      ? 'localStorage is empty'
      : entries.slice(0, 20).map(([k, v]) => `${k}: ${v.slice(0, 50)}${v.length > 50 ? '...' : ''}`).join('\n');

    return { success: true, output: `${entries.length} localStorage entries:\n${output}`, data: { storage: data } };
  }

  private async setLocalStorage(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.storageData) {
      return { success: false, error: 'Storage data object is required' };
    }

    await this.manager.setLocalStorage(input.storageData);

    return { success: true, output: `Set ${Object.keys(input.storageData).length} localStorage entries` };
  }

  private async getSessionStorage(): Promise<ToolResult> {
    const data = await this.manager.getSessionStorage();
    const entries = Object.entries(data);

    const output = entries.length === 0
      ? 'sessionStorage is empty'
      : entries.slice(0, 20).map(([k, v]) => `${k}: ${v.slice(0, 50)}${v.length > 50 ? '...' : ''}`).join('\n');

    return { success: true, output: `${entries.length} sessionStorage entries:\n${output}`, data: { storage: data } };
  }

  private async setSessionStorage(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.storageData) {
      return { success: false, error: 'Storage data object is required' };
    }

    await this.manager.setSessionStorage(input.storageData);

    return { success: true, output: `Set ${Object.keys(input.storageData).length} sessionStorage entries` };
  }

  // ============================================================================
  // Route Rules
  // ============================================================================

  private async addRouteRule(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.rulePattern) {
      return { success: false, error: 'Rule pattern is required' };
    }

    const action = (input.ruleAction || 'block') as 'block' | 'mock' | 'modify' | 'log';
    const rule: import('./types.js').RouteRule = {
      id: input.ruleId || `rule-${Date.now()}`,
      urlPattern: input.rulePattern,
      action,
      ...(input.ruleResponse ? {
        mockResponse: {
          status: input.ruleResponse.status || 200,
          body: input.ruleResponse.body,
          contentType: input.ruleResponse.contentType,
        },
      } : {}),
    };

    await this.manager.addRouteRule(rule);

    return { success: true, output: `Route rule added: ${rule.id} (${rule.action} ${rule.urlPattern})` };
  }

  private async removeRouteRule(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.ruleId) {
      return { success: false, error: 'Rule ID is required' };
    }

    await this.manager.removeRouteRule(input.ruleId);

    return { success: true, output: `Route rule removed: ${input.ruleId}` };
  }

  private async clearRouteRules(): Promise<ToolResult> {
    await this.manager.clearRouteRules();

    return { success: true, output: 'All route rules cleared' };
  }

  // ============================================================================
  // Timezone / Locale
  // ============================================================================

  private async setTimezone(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.timezone) {
      return { success: false, error: 'Timezone is required (e.g., America/New_York)' };
    }

    await this.manager.setTimezone(input.timezone);

    return { success: true, output: `Timezone set: ${input.timezone}` };
  }

  private async setLocale(input: BrowserToolInput): Promise<ToolResult> {
    if (!input.locale) {
      return { success: false, error: 'Locale is required (e.g., en-US)' };
    }

    await this.manager.setLocale(input.locale);

    return { success: true, output: `Locale set: ${input.locale}` };
  }

  // ============================================================================
  // Download
  // ============================================================================

  private async download(input: BrowserToolInput): Promise<ToolResult> {
    const result = await this.manager.downloadFile({
      ref: input.ref,
      timeout: input.timeout,
    });

    return {
      success: true,
      output: `Downloaded: ${result.suggestedFilename} → ${result.path}`,
      data: result,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let browserToolInstance: BrowserTool | null = null;

export function getBrowserTool(): BrowserTool {
  if (!browserToolInstance) {
    browserToolInstance = new BrowserTool();
  }
  return browserToolInstance;
}

export function resetBrowserTool(): void {
  browserToolInstance = null;
}

export default BrowserTool;
