/**
 * Browser Automation Tool using Playwright
 *
 * Provides real browser automation capabilities for rendering pages,
 * interacting with elements, and taking screenshots/PDFs.
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright-core';
import { logger } from '../../utils/logger.js';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface BrowserConfig {
  headless?: boolean;
  timeout?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  proxy?: { server: string; username?: string; password?: string };
}

export interface BrowserAction {
  type: string;
  selector?: string;
  value?: string;
  timestamp: number;
}

export interface BrowserTab {
  id: string;
  url: string;
  active: boolean;
}

// ============================================================================
// BrowserTool
// ============================================================================

export class BrowserTool {
  private static instance: BrowserTool | null = null;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private activePageId: string | null = null;
  
  private config: BrowserConfig = {};
  private actions: BrowserAction[] = [];
  private consoleMessages: string[] = [];
  private tabCounter = 0;
  private isLaunching = false;

  private constructor() {}

  static getInstance(): BrowserTool {
    if (!BrowserTool.instance) {
      BrowserTool.instance = new BrowserTool();
    }
    return BrowserTool.instance;
  }

  static async resetInstance(): Promise<void> {
    if (BrowserTool.instance) {
      await BrowserTool.instance.close();
    }
    BrowserTool.instance = null;
  }

  async launch(config?: BrowserConfig): Promise<void> {
    if (this.browser || this.isLaunching) {
      logger.debug('Browser already launched or launching');
      return;
    }

    this.isLaunching = true;
    this.config = {
      headless: true,
      ...config
    };

    try {
      this.browser = await chromium.launch({
        headless: this.config.headless,
        proxy: this.config.proxy,
      });

      this.context = await this.browser.newContext({
        viewport: this.config.viewport || { width: 1280, height: 800 },
        userAgent: this.config.userAgent,
      });

      this.actions = [];
      this.consoleMessages = [];
      this.pages.clear();
      this.tabCounter = 0;

      // Create initial tab
      await this.newTab('about:blank');

      logger.debug('Browser launched successfully', { config: this.config });
    } catch (error) {
      logger.error('Failed to launch browser', { error });
      throw new Error(`Browser launch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isLaunching = false;
    }
  }

  async navigate(url: string): Promise<void> {
    const page = this.getActivePage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: this.config.timeout || 30000 });
      this.recordAction('navigate', undefined, url);
      logger.debug('Navigated to', { url });
    } catch (error) {
       logger.error('Navigation failed', { url, error });
       throw new Error(`Failed to navigate to ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async click(selector: string): Promise<void> {
    const page = this.getActivePage();
    try {
      await page.click(selector, { timeout: this.config.timeout || 10000 });
      this.recordAction('click', selector);
    } catch (error) {
      throw new Error(`Failed to click selector ${selector}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async type(selector: string, text: string): Promise<void> {
    const page = this.getActivePage();
    try {
      await page.fill(selector, text, { timeout: this.config.timeout || 10000 });
      this.recordAction('type', selector, text);
    } catch (error) {
       throw new Error(`Failed to type in selector ${selector}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async press(key: string): Promise<void> {
    const page = this.getActivePage();
    try {
      await page.keyboard.press(key);
      this.recordAction('press', undefined, key);
    } catch (error) {
       throw new Error(`Failed to press key ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async hover(selector: string): Promise<void> {
    const page = this.getActivePage();
    try {
      await page.hover(selector, { timeout: this.config.timeout || 10000 });
      this.recordAction('hover', selector);
    } catch (error) {
        throw new Error(`Failed to hover selector ${selector}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async drag(fromSelector: string, toSelector: string): Promise<void> {
     const page = this.getActivePage();
     try {
       await page.dragAndDrop(fromSelector, toSelector, { timeout: this.config.timeout || 10000 });
       this.recordAction('drag', fromSelector, toSelector);
     } catch (error) {
         throw new Error(`Failed to drag from ${fromSelector} to ${toSelector}: ${error instanceof Error ? error.message : String(error)}`);
     }
  }

  async screenshot(options?: { path?: string; fullPage?: boolean }): Promise<string> {
    const page = this.getActivePage();
    const screenshotPath = options?.path || path.join(process.cwd(), `.codebuddy/screenshots/screenshot-${Date.now()}.png`);
    
    try {
      await page.screenshot({ path: screenshotPath, fullPage: options?.fullPage });
      this.recordAction('screenshot', undefined, screenshotPath);
      return screenshotPath;
    } catch (error) {
       throw new Error(`Failed to take screenshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async pdf(options?: { path?: string }): Promise<string> {
    const page = this.getActivePage();
    const pdfPath = options?.path || path.join(process.cwd(), `.codebuddy/screenshots/page-${Date.now()}.pdf`);
    
    try {
      await page.pdf({ path: pdfPath });
      this.recordAction('pdf', undefined, pdfPath);
      return pdfPath;
    } catch (error) {
       throw new Error(`Failed to generate PDF: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getConsole(): string[] {
    this.ensureLaunched();
    return [...this.consoleMessages];
  }

  getTabs(): BrowserTab[] {
    this.ensureLaunched();
    const tabs: BrowserTab[] = [];
    for (const [id, page] of this.pages.entries()) {
      tabs.push({
        id,
        url: page.url(),
        active: id === this.activePageId
      });
    }
    return tabs;
  }

  async newTab(url?: string): Promise<BrowserTab> {
    this.ensureLaunched();
    const page = await this.context!.newPage();
    const tabId = this.generateTabId();
    
    // Setup console listener
    page.on('console', msg => {
      this.consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    });

    this.pages.set(tabId, page);
    this.activePageId = tabId;

    if (url && url !== 'about:blank') {
      await this.navigate(url);
    }

    this.recordAction('newTab', undefined, url || 'about:blank');
    
    return {
      id: tabId,
      url: page.url(),
      active: true
    };
  }

  async closeTab(tabId: string): Promise<void> {
    this.ensureLaunched();
    const page = this.pages.get(tabId);
    
    if (!page) {
      throw new Error(`Tab ${tabId} not found`);
    }

    await page.close();
    this.pages.delete(tabId);

    if (this.activePageId === tabId) {
      // Find another tab to make active
      const remainingTabs = Array.from(this.pages.keys());
      this.activePageId = remainingTabs.length > 0 ? remainingTabs[0] : null;
    }

    this.recordAction('closeTab', undefined, tabId);
  }

  switchTab(tabId: string): void {
    this.ensureLaunched();
    if (!this.pages.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }

    this.activePageId = tabId;
    this.recordAction('switchTab', undefined, tabId);
  }

  async evaluate<T>(script: string): Promise<T> {
    const page = this.getActivePage();
    try {
      const result = await page.evaluate(script);
      this.recordAction('evaluate', undefined, script);
      return result as T;
    } catch (error) {
       throw new Error(`Failed to evaluate script: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async getHtml(): Promise<string> {
      const page = this.getActivePage();
      return await page.content();
  }

  getActions(): BrowserAction[] {
    return [...this.actions];
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    
    this.pages.clear();
    this.activePageId = null;
    this.actions = [];
    this.consoleMessages = [];
    this.tabCounter = 0;
    
    logger.debug('Browser closed');
  }

  isLaunched(): boolean {
    return this.browser !== null;
  }

  private ensureLaunched(): void {
    if (!this.browser || !this.context) {
      throw new Error('Browser not launched. Call launch() first.');
    }
  }

  private getActivePage(): Page {
    this.ensureLaunched();
    if (!this.activePageId) {
       throw new Error('No active tab found.');
    }
    const page = this.pages.get(this.activePageId);
    if (!page) {
       throw new Error(`Active tab ${this.activePageId} is missing page instance.`);
    }
    return page;
  }

  private recordAction(type: string, selector?: string, value?: string): void {
    this.actions.push({
      type,
      selector,
      value,
      timestamp: Date.now(),
    });
  }

  private generateTabId(): string {
    this.tabCounter++;
    return `tab-${this.tabCounter}`;
  }
}
