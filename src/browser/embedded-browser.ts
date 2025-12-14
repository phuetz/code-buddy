/**
 * Embedded Browser for Terminal
 *
 * Provides browser capabilities within the terminal:
 * - Web page rendering (via sixel or text)
 * - Screenshot capture
 * - DOM element selection
 * - Interactive debugging
 *
 * Inspired by Cursor 2.0's embedded browser.
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import fs from 'fs-extra';
import * as os from 'os';

export interface BrowserConfig {
  headless: boolean;
  viewport: { width: number; height: number };
  userAgent?: string;
  timeout: number;
  screenshotDir: string;
  renderMode: 'sixel' | 'text' | 'none';
}

export interface PageInfo {
  url: string;
  title: string;
  html?: string;
  text?: string;
  screenshot?: string;
}

export interface DOMElement {
  selector: string;
  tagName: string;
  id?: string;
  className?: string;
  text?: string;
  attributes: Record<string, string>;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface BrowserSession {
  id: string;
  url: string;
  startTime: Date;
  pages: PageInfo[];
}

const DEFAULT_CONFIG: BrowserConfig = {
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30000,
  screenshotDir: path.join(os.tmpdir(), 'grok-screenshots'),
  renderMode: 'text',
};

/**
 * Embedded Browser Manager
 */
export class EmbeddedBrowser extends EventEmitter {
  private config: BrowserConfig;
  private process: ChildProcess | null = null;
  private sessions: Map<string, BrowserSession> = new Map();
  private sessionCounter: number = 0;
  private currentUrl: string = '';
  private pageContent: string = '';

  constructor(config: Partial<BrowserConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureScreenshotDir();
  }

  /**
   * Ensure screenshot directory exists
   */
  private async ensureScreenshotDir(): Promise<void> {
    await fs.ensureDir(this.config.screenshotDir);
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<PageInfo> {
    this.emit('navigate:start', { url });
    this.currentUrl = url;

    try {
      // Use curl to fetch the page
      const html = await this.fetchPage(url);
      const text = this.htmlToText(html);
      const title = this.extractTitle(html);

      const pageInfo: PageInfo = {
        url,
        title,
        html,
        text,
      };

      // Take screenshot if possible
      if (this.config.renderMode !== 'none') {
        try {
          pageInfo.screenshot = await this.takeScreenshot(url);
        } catch {
          // Screenshot failed, continue without it
        }
      }

      this.pageContent = html;
      this.emit('navigate:complete', { pageInfo });

      return pageInfo;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('navigate:error', { url, error: message });
      throw error;
    }
  }

  /**
   * Fetch page content using curl
   */
  private fetchPage(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const curl = spawn('curl', [
        '-s',
        '-L',
        '-A', this.config.userAgent || 'Mozilla/5.0 (compatible; GrokCLI/1.0)',
        '--max-time', String(this.config.timeout / 1000),
        url,
      ]);

      let output = '';
      let error = '';

      curl.stdout.on('data', (data) => {
        output += data.toString();
      });

      curl.stderr.on('data', (data) => {
        error += data.toString();
      });

      curl.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Failed to fetch page: ${error || `exit code ${code}`}`));
        }
      });

      curl.on('error', reject);
    });
  }

  /**
   * Take a screenshot of the current page
   */
  async takeScreenshot(url?: string): Promise<string> {
    const targetUrl = url || this.currentUrl;
    if (!targetUrl) {
      throw new Error('No URL to screenshot');
    }

    const filename = `screenshot-${Date.now()}.png`;
    const filepath = path.join(this.config.screenshotDir, filename);

    return new Promise((resolve, reject) => {
      // Try using wkhtmltoimage if available
      const wkhtmltoimage = spawn('wkhtmltoimage', [
        '--quiet',
        '--width', String(this.config.viewport.width),
        '--height', String(this.config.viewport.height),
        targetUrl,
        filepath,
      ]);

      wkhtmltoimage.on('close', (code) => {
        if (code === 0) {
          resolve(filepath);
        } else {
          // Fallback: try using cutycapt
          const cutycapt = spawn('cutycapt', [
            `--url=${targetUrl}`,
            `--out=${filepath}`,
            `--min-width=${this.config.viewport.width}`,
            `--min-height=${this.config.viewport.height}`,
          ]);

          cutycapt.on('close', (code2) => {
            if (code2 === 0) {
              resolve(filepath);
            } else {
              reject(new Error('Screenshot tools not available'));
            }
          });

          cutycapt.on('error', () => {
            reject(new Error('Screenshot tools not available'));
          });
        }
      });

      wkhtmltoimage.on('error', () => {
        reject(new Error('wkhtmltoimage not available'));
      });
    });
  }

  /**
   * Convert HTML to text
   */
  private htmlToText(html: string): string {
    // Remove script and style tags
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ');
    text = text.trim();

    return text;
  }

  /**
   * Extract title from HTML
   */
  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : 'Untitled';
  }

  /**
   * Select elements matching a CSS selector
   */
  selectElements(selector: string): DOMElement[] {
    if (!this.pageContent) {
      return [];
    }

    const elements: DOMElement[] = [];

    // Simple selector parsing (supports tag, class, id)
    const tagMatch = selector.match(/^(\w+)/);
    const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);
    const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);

    const tagName = tagMatch ? tagMatch[1] : null;
    const className = classMatch ? classMatch[1] : null;
    const id = idMatch ? idMatch[1] : null;

    // Find matching elements in HTML
    const tagRegex = tagName
      ? new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi')
      : /<(\w+)[^>]*>([\s\S]*?)<\/\1>/gi;

    let match;
    while ((match = tagRegex.exec(this.pageContent)) !== null) {
      const elementHtml = match[0];

      // Check class match
      if (className && !elementHtml.includes(`class="${className}"`) &&
          !elementHtml.includes(`class='${className}'`) &&
          !new RegExp(`class="[^"]*\\b${className}\\b[^"]*"`).test(elementHtml)) {
        continue;
      }

      // Check id match
      if (id && !elementHtml.includes(`id="${id}"`) && !elementHtml.includes(`id='${id}'`)) {
        continue;
      }

      // Extract attributes
      const attributes: Record<string, string> = {};
      const attrRegex = /(\w+)=["']([^"']+)["']/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(elementHtml)) !== null) {
        attributes[attrMatch[1]] = attrMatch[2];
      }

      elements.push({
        selector,
        tagName: tagName || match[1],
        id: attributes.id,
        className: attributes.class,
        text: this.htmlToText(match[2] || match[0]).slice(0, 100),
        attributes,
      });
    }

    return elements;
  }

  /**
   * Get text content of the page
   */
  getTextContent(): string {
    if (!this.pageContent) {
      return '';
    }
    return this.htmlToText(this.pageContent);
  }

  /**
   * Get links from the page
   */
  getLinks(): Array<{ href: string; text: string }> {
    if (!this.pageContent) {
      return [];
    }

    const links: Array<{ href: string; text: string }> = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;

    let match;
    while ((match = linkRegex.exec(this.pageContent)) !== null) {
      links.push({
        href: match[1],
        text: match[2].trim() || match[1],
      });
    }

    return links;
  }

  /**
   * Get forms from the page
   */
  getForms(): Array<{
    action: string;
    method: string;
    inputs: Array<{ name: string; type: string; value?: string }>;
  }> {
    if (!this.pageContent) {
      return [];
    }

    const forms: Array<{
      action: string;
      method: string;
      inputs: Array<{ name: string; type: string; value?: string }>;
    }> = [];

    const formRegex = /<form[^>]*>([\s\S]*?)<\/form>/gi;

    let match;
    while ((match = formRegex.exec(this.pageContent)) !== null) {
      const formHtml = match[0];
      const content = match[1];

      // Extract action and method
      const actionMatch = formHtml.match(/action=["']([^"']+)["']/i);
      const methodMatch = formHtml.match(/method=["']([^"']+)["']/i);

      // Extract inputs
      const inputs: Array<{ name: string; type: string; value?: string }> = [];
      const inputRegex = /<input[^>]+>/gi;

      let inputMatch;
      while ((inputMatch = inputRegex.exec(content)) !== null) {
        const inputHtml = inputMatch[0];
        const nameMatch = inputHtml.match(/name=["']([^"']+)["']/i);
        const typeMatch = inputHtml.match(/type=["']([^"']+)["']/i);
        const valueMatch = inputHtml.match(/value=["']([^"']+)["']/i);

        if (nameMatch) {
          inputs.push({
            name: nameMatch[1],
            type: typeMatch ? typeMatch[1] : 'text',
            value: valueMatch ? valueMatch[1] : undefined,
          });
        }
      }

      forms.push({
        action: actionMatch ? actionMatch[1] : '',
        method: methodMatch ? methodMatch[1].toUpperCase() : 'GET',
        inputs,
      });
    }

    return forms;
  }

  /**
   * Create a browser session
   */
  createSession(): BrowserSession {
    const session: BrowserSession = {
      id: `browser_${++this.sessionCounter}`,
      url: '',
      startTime: new Date(),
      pages: [],
    };

    this.sessions.set(session.id, session);
    this.emit('session:created', { sessionId: session.id });

    return session;
  }

  /**
   * Close a session
   */
  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.emit('session:closed', { sessionId });
  }

  /**
   * Render page in terminal (text mode)
   */
  renderInTerminal(): string {
    const text = this.getTextContent();
    const title = this.extractTitle(this.pageContent);
    const url = this.currentUrl;

    const width = process.stdout.columns || 80;
    const border = '═'.repeat(width - 2);

    const lines = [
      `╔${border}╗`,
      `║ ${title.slice(0, width - 4).padEnd(width - 4)} ║`,
      `║ ${url.slice(0, width - 4).padEnd(width - 4)} ║`,
      `╠${border}╣`,
    ];

    // Wrap text to terminal width
    const words = text.split(' ');
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length + word.length + 1 > width - 4) {
        lines.push(`║ ${currentLine.padEnd(width - 4)} ║`);
        currentLine = word;
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }

    if (currentLine) {
      lines.push(`║ ${currentLine.padEnd(width - 4)} ║`);
    }

    lines.push(`╚${border}╝`);

    return lines.join('\n');
  }

  /**
   * Format page info for display
   */
  formatPageInfo(pageInfo: PageInfo): string {
    const lines = [
      '┌─────────────────────────────────────────────────────────────┐',
      `│ Title: ${pageInfo.title.slice(0, 50).padEnd(52)}│`,
      `│ URL: ${pageInfo.url.slice(0, 54).padEnd(54)}│`,
      '├─────────────────────────────────────────────────────────────┤',
      `│ Content: ${(pageInfo.text?.slice(0, 47) || 'No content').padEnd(50)}│`,
      '└─────────────────────────────────────────────────────────────┘',
    ];

    if (pageInfo.screenshot) {
      lines.push(`Screenshot saved: ${pageInfo.screenshot}`);
    }

    return lines.join('\n');
  }

  /**
   * Get current URL
   */
  getCurrentUrl(): string {
    return this.currentUrl;
  }

  /**
   * Get page content
   */
  getPageContent(): string {
    return this.pageContent;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BrowserConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   */
  getConfig(): BrowserConfig {
    return { ...this.config };
  }

  /**
   * Cleanup
   */
  dispose(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.sessions.clear();
  }
}

// Singleton
let embeddedBrowserInstance: EmbeddedBrowser | null = null;

export function getEmbeddedBrowser(config?: Partial<BrowserConfig>): EmbeddedBrowser {
  if (!embeddedBrowserInstance) {
    embeddedBrowserInstance = new EmbeddedBrowser(config);
  }
  return embeddedBrowserInstance;
}

export function resetEmbeddedBrowser(): void {
  if (embeddedBrowserInstance) {
    embeddedBrowserInstance.dispose();
  }
  embeddedBrowserInstance = null;
}
