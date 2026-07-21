/** Operator-attached Google Flow browser driver. Never launches Chrome or handles login. */

import { mkdir } from 'fs/promises';
import path from 'path';

import {
  chromium,
  type Download,
} from 'playwright';

import { isLoopbackHost } from '../../security/dev-origins.js';

export const DEFAULT_FLOW_CDP_URL = 'http://127.0.0.1:9222';
export const GOOGLE_FLOW_URL = 'https://labs.google/fx/tools/flow';

/**
 * Google changes Flow's UI regularly. Keep every DOM dependency here so an
 * operator can update and re-run the selector-only dry run before spending.
 */
export const FLOW_SELECTORS = {
  appRoot: '[data-testid="flow-app"], flow-app, main',
  signIn: 'a[href*="accounts.google.com"], button:has-text("Sign in"), button:has-text("Se connecter")',
  errorBanner: '[role="alert"], [data-testid*="error"], [class*="error-banner"]',
  creditBalance: '[data-testid*="credit"], [aria-label*="credit" i], [class*="credit-balance"]',
  modelMenu: 'button[aria-label*="model" i], [data-testid="model-selector"] button',
  modelOption: {
    'veo-3.1-fast': '[role="option"]:has-text("Veo 3.1"):has-text("Fast"), [role="menuitem"]:has-text("Veo 3.1"):has-text("Fast")',
    'veo-3.1-quality': '[role="option"]:has-text("Veo 3.1"):has-text("Quality"), [role="menuitem"]:has-text("Veo 3.1"):has-text("Quality")',
  },
  aspectMenu: 'button[aria-label*="aspect" i], [data-testid="aspect-ratio-selector"] button',
  aspectOption: {
    '9:16': '[role="option"]:has-text("9:16"), [role="menuitem"]:has-text("9:16")',
    '16:9': '[role="option"]:has-text("16:9"), [role="menuitem"]:has-text("16:9")',
  },
  ingredientsInput: 'input[type="file"][accept*="image"], [data-testid="ingredients-upload"] input[type="file"]',
  ingredientsPreview: '[data-testid*="ingredient-preview"], [class*="ingredient-preview"]',
  ingredientRemoveButton: '[data-testid*="ingredient-preview"] button[aria-label*="remove" i], [class*="ingredient-preview"] button[aria-label*="remove" i]',
  promptInput: 'textarea[placeholder], [contenteditable="true"][role="textbox"], [data-testid="prompt-input"]',
  submitButton: 'button[aria-label*="generate" i], button:has-text("Generate"), button:has-text("Générer")',
  generationProgress: '[role="progressbar"], [data-testid*="generation-progress"], [class*="generating"]',
  resultReady: '[data-testid*="generation-result"] video, [data-testid*="generation-result"] img, main video',
  downloadButton: 'button[aria-label*="download" i], [data-testid*="download"] button',
} as const;

export type FlowModel = keyof typeof FLOW_SELECTORS.modelOption;
export type FlowAspect = keyof typeof FLOW_SELECTORS.aspectOption;

interface FlowLocator {
  waitFor(options: { state: 'visible'; timeout: number }): Promise<void>;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  isEnabled(options?: { timeout?: number }): Promise<boolean>;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  setInputFiles(files: string[], options?: { timeout?: number }): Promise<void>;
  textContent(options?: { timeout?: number }): Promise<string | null>;
  count(): Promise<number>;
  getAttribute(name: string, options?: { timeout?: number }): Promise<string | null>;
  first(): FlowLocator;
}

export interface FlowPage {
  url(): string;
  locator(selector: string): FlowLocator;
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForTimeout(milliseconds: number): Promise<void>;
  waitForEvent(event: 'download', options?: { timeout?: number }): Promise<Download>;
}

export interface FlowBrowserContext {
  pages(): FlowPage[];
  newPage(): Promise<FlowPage>;
}

export interface FlowBrowser {
  contexts(): FlowBrowserContext[];
}

export interface AttachToBrowserResult {
  browser: FlowBrowser;
  page: FlowPage;
  driver: FlowDriver;
}

export interface AttachToBrowserOptions {
  cdpUrl?: string;
  timeoutMs?: number;
  connector?: (cdpUrl: string) => Promise<FlowBrowser>;
}

export interface FlowDriverOptions {
  actionTimeoutMs?: number;
  generationTimeoutMs?: number;
  pollIntervalMs?: number;
}

const UI_ERROR = /(?:quota|not enough|insufficient|failed|failure|error|erreur|unable|impossible)/iu;

export class FlowDriver {
  private readonly actionTimeoutMs: number;
  private readonly generationTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly page: FlowPage, options: FlowDriverOptions = {}) {
    this.actionTimeoutMs = positiveTimeout(options.actionTimeoutMs, 15_000, 'action timeout');
    this.generationTimeoutMs = positiveTimeout(options.generationTimeoutMs, 12 * 60_000, 'generation timeout');
    this.pollIntervalMs = positiveTimeout(options.pollIntervalMs, 1_000, 'poll interval');
  }

  async verifyReady(): Promise<void> {
    await this.assertAuthenticated();
    await this.visible(FLOW_SELECTORS.appRoot, 'Flow application');
    await this.visible(FLOW_SELECTORS.promptInput, 'Flow prompt input');
    await this.visible(FLOW_SELECTORS.modelMenu, 'Flow model selector');
    await this.visible(FLOW_SELECTORS.aspectMenu, 'Flow aspect selector');
    await this.visible(FLOW_SELECTORS.ingredientsInput, 'Flow ingredients input');
    await this.visible(FLOW_SELECTORS.submitButton, 'Flow generate button');
    await this.visible(FLOW_SELECTORS.creditBalance, 'Flow credit balance');
    await this.throwIfUiError();
  }

  async assertAuthenticated(): Promise<void> {
    const currentUrl = this.page.url();
    const loginVisible = await this.page.locator(FLOW_SELECTORS.signIn).first().isVisible({ timeout: 500 }).catch(() => false);
    if (isGoogleLoginUrl(currentUrl) || loginVisible) {
      throw new Error('Google Flow is not authenticated: connecte-toi d\'abord dans le navigateur, puis relance le driver');
    }
  }

  async setModel(model: FlowModel): Promise<void> {
    await this.throwIfUiError();
    await this.safeClick(FLOW_SELECTORS.modelMenu, 'Flow model selector');
    await this.safeClick(FLOW_SELECTORS.modelOption[model], `Flow model ${model}`);
    await this.throwIfUiError();
  }

  async setAspect(aspect: FlowAspect): Promise<void> {
    await this.throwIfUiError();
    await this.safeClick(FLOW_SELECTORS.aspectMenu, 'Flow aspect selector');
    await this.safeClick(FLOW_SELECTORS.aspectOption[aspect], `Flow aspect ${aspect}`);
    await this.throwIfUiError();
  }

  async setIngredients(imagePaths: string[]): Promise<void> {
    if (imagePaths.length > 3) throw new Error('Google Flow accepts at most 3 ingredient images');
    if (!imagePaths.length) throw new Error('Google Flow generation requires at least one ingredient image');
    if (new Set(imagePaths).size !== imagePaths.length || imagePaths.some((filename) => !path.isAbsolute(filename))) {
      throw new Error('Flow ingredient paths must be unique absolute paths');
    }
    await this.throwIfUiError();
    const removeButtons = this.page.locator(FLOW_SELECTORS.ingredientRemoveButton);
    let existing = await removeButtons.count();
    while (existing > 0) {
      if (existing > 3) throw new Error('Flow displayed more than 3 existing ingredients; refusing ambiguous edits');
      const remove = await this.clickable(FLOW_SELECTORS.ingredientRemoveButton, 'Flow ingredient remove button');
      await remove.click({ timeout: this.actionTimeoutMs });
      await this.waitUntil(async () => (await removeButtons.count()) < existing, this.actionTimeoutMs,
        'Flow did not remove the previous ingredient');
      existing = await removeButtons.count();
    }
    const input = await this.visible(FLOW_SELECTORS.ingredientsInput, 'Flow ingredients input');
    await input.setInputFiles(imagePaths, { timeout: this.actionTimeoutMs });
    const previews = this.page.locator(FLOW_SELECTORS.ingredientsPreview);
    await this.waitUntil(async () => (await previews.count()) >= imagePaths.length, this.actionTimeoutMs,
      `Flow did not display ${imagePaths.length} ingredient preview(s)`);
    await this.throwIfUiError();
  }

  async submitPrompt(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt) throw new Error('Flow prompt must not be empty');
    await this.throwIfUiError();
    const result = this.page.locator(FLOW_SELECTORS.resultReady);
    const previousCount = await result.count();
    const previousSource = previousCount > 0 ? await result.first().getAttribute('src').catch(() => null) : null;
    const input = await this.visible(FLOW_SELECTORS.promptInput, 'Flow prompt input');
    await input.fill(prompt, { timeout: this.actionTimeoutMs });
    await this.safeClick(FLOW_SELECTORS.submitButton, 'Flow generate button');

    let sawProgress = false;
    await this.waitUntil(async () => {
      await this.throwIfUiError();
      const progress = this.page.locator(FLOW_SELECTORS.generationProgress).first();
      sawProgress ||= await progress.isVisible({ timeout: 250 }).catch(() => false);
      const currentCount = await result.count();
      if (currentCount === 0) return false;
      const currentSource = await result.first().getAttribute('src').catch(() => null);
      const progressVisible = await progress.isVisible({ timeout: 250 }).catch(() => false);
      const resultChanged = previousCount === 0 || currentCount > previousCount || currentSource !== previousSource;
      return !progressVisible && (sawProgress || resultChanged);
    }, this.generationTimeoutMs, `Google Flow generation timed out after ${this.generationTimeoutMs} ms`);
    await this.throwIfUiError();
  }

  async downloadResult(destPath: string): Promise<void> {
    if (!path.isAbsolute(destPath) || path.extname(destPath).toLowerCase() !== '.mp4') {
      throw new Error('Flow download destination must be an absolute .mp4 path');
    }
    await this.throwIfUiError();
    await this.visible(FLOW_SELECTORS.resultReady, 'completed Flow result');
    const button = await this.clickable(FLOW_SELECTORS.downloadButton, 'Flow download button');
    await mkdir(path.dirname(destPath), { recursive: true, mode: 0o700 });
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: this.actionTimeoutMs }),
      button.click({ timeout: this.actionTimeoutMs }),
    ]);
    const failure = await download.failure();
    if (failure) throw new Error(`Google Flow download failed: ${failure}`);
    await download.saveAs(destPath);
  }

  async readCreditBalance(): Promise<number> {
    await this.assertAuthenticated();
    await this.throwIfUiError();
    const balance = await this.visible(FLOW_SELECTORS.creditBalance, 'Flow credit balance');
    const text = (await balance.textContent({ timeout: this.actionTimeoutMs }))?.trim() ?? '';
    const match = /(\d[\d\s.,\u202f]*)\s*(?:AI\s+)?(?:credits?|crédits?)/iu.exec(text);
    if (!match?.[1]) throw new Error(`Could not parse Google Flow credit balance from ${JSON.stringify(text)}`);
    const digits = match[1].replace(/[^\d]/gu, '');
    const value = Number.parseInt(digits, 10);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Google Flow displayed an invalid credit balance');
    return value;
  }

  private async safeClick(selector: string, label: string): Promise<void> {
    const locator = await this.clickable(selector, label);
    await locator.click({ timeout: this.actionTimeoutMs });
  }

  private async visible(selector: string, label: string): Promise<FlowLocator> {
    const locator = this.page.locator(selector).first();
    try {
      await locator.waitFor({ state: 'visible', timeout: this.actionTimeoutMs });
      if (!await locator.isVisible({ timeout: 500 })) throw new Error('not visible');
      return locator;
    } catch (error) {
      await this.assertAuthenticated();
      throw new Error(`${label} is unavailable; update FLOW_SELECTORS if the Google UI changed: ${errorMessage(error)}`);
    }
  }

  private async clickable(selector: string, label: string): Promise<FlowLocator> {
    const locator = await this.visible(selector, label);
    if (!await locator.isEnabled({ timeout: 500 })) throw new Error(`${label} is disabled; refusing a blind click`);
    return locator;
  }

  private async throwIfUiError(): Promise<void> {
    const locator = this.page.locator(FLOW_SELECTORS.errorBanner).first();
    if (!await locator.isVisible({ timeout: 250 }).catch(() => false)) return;
    const text = (await locator.textContent({ timeout: 500 }).catch(() => null))?.trim() ?? '';
    if (UI_ERROR.test(text)) throw new Error(`Google Flow UI error: ${text || 'unknown generation failure'}`);
  }

  private async waitUntil(
    predicate: () => Promise<boolean>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await this.page.waitForTimeout(Math.min(this.pollIntervalMs, Math.max(1, deadline - Date.now())));
    }
    throw new Error(timeoutMessage);
  }
}

export async function attachToBrowser(options: AttachToBrowserOptions = {}): Promise<AttachToBrowserResult> {
  const cdpUrl = assertLoopbackCdpUrl(options.cdpUrl ?? DEFAULT_FLOW_CDP_URL);
  const timeoutMs = positiveTimeout(options.timeoutMs, 30_000, 'CDP timeout');
  let attached: FlowBrowser;
  try {
    attached = await (options.connector ?? ((url) => chromium.connectOverCDP(url)))(cdpUrl);
  } catch (error) {
    throw new Error(`Could not attach to operator Chrome at ${cdpUrl}: ${errorMessage(error)}`);
  }
  const context = attached.contexts()[0];
  if (!context) {
    throw new Error('The attached Chrome has no operator profile context; launch Chrome with the connected profile first');
  }
  const page = context.pages().find((candidate) => isFlowUrl(candidate.url())) ?? await openFlowTab(context, timeoutMs);
  const driver = new FlowDriver(page, { actionTimeoutMs: timeoutMs });
  await driver.assertAuthenticated();
  await driver.verifyReady();
  return {
    browser: attached,
    page,
    driver,
  };
}

export function assertLoopbackCdpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid CDP URL: ${rawUrl}`);
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isLoopbackHost(parsed.hostname)) {
    throw new Error('Google Flow CDP attachment is restricted to an operator-controlled loopback browser');
  }
  if (parsed.username || parsed.password) throw new Error('CDP URL must not contain credentials');
  return parsed.toString().replace(/\/$/u, '');
}

async function openFlowTab(context: FlowBrowserContext, timeoutMs: number): Promise<FlowPage> {
  const page = await context.newPage();
  await page.goto(GOOGLE_FLOW_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  return page;
}

function isFlowUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.hostname === 'labs.google' && /(?:^|\/)flow(?:\/|$)/u.test(url.pathname);
  } catch {
    return false;
  }
}

function isGoogleLoginUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname;
    return hostname === 'accounts.google.com' || hostname.endsWith('.accounts.google.com');
  } catch {
    return false;
  }
}

function positiveTimeout(value: number | undefined, fallback: number, label: string): number {
  const timeout = value ?? fallback;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error(`${label} must be positive`);
  return timeout;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
