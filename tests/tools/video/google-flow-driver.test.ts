import path from 'path';

import { describe, expect, it, vi } from 'vitest';
import type { Download } from 'playwright';

import {
  attachToBrowser,
  assertLoopbackCdpUrl,
  FLOW_SELECTORS,
  FlowDriver,
  GOOGLE_FLOW_URL,
  type FlowPage,
} from '../../../src/tools/video/google-flow-driver.js';
import {
  assertCreditBudget,
  assertSufficientCreditBalance,
  estimateCreditCost,
} from '../../../scripts/trailers/run-flow-generation.js';

interface FakeElement {
  visible?: boolean;
  enabled?: boolean;
  text?: string;
  count?: number;
  source?: string | null;
  click?: () => void;
  fill?: (value: string) => void;
  files?: (files: string[]) => void;
}

class FakeLocator {
  constructor(private readonly element: FakeElement) {}

  first(): FakeLocator {
    return this;
  }

  async waitFor(): Promise<void> {
    if (!this.element.visible) throw new Error('not visible');
  }

  async isVisible(): Promise<boolean> {
    return this.element.visible ?? false;
  }

  async isEnabled(): Promise<boolean> {
    return this.element.enabled ?? true;
  }

  async click(): Promise<void> {
    this.element.click?.();
  }

  async fill(value: string): Promise<void> {
    this.element.fill?.(value);
  }

  async setInputFiles(files: string[]): Promise<void> {
    this.element.files?.(files);
  }

  async textContent(): Promise<string | null> {
    return this.element.text ?? null;
  }

  async count(): Promise<number> {
    return this.element.count ?? (this.element.visible ? 1 : 0);
  }

  async getAttribute(name: string): Promise<string | null> {
    return name === 'src' ? this.element.source ?? null : null;
  }
}

class FakeFlowPage implements FlowPage {
  readonly requestedSelectors: string[] = [];
  readonly elements = new Map<string, FakeElement>();
  currentUrl = GOOGLE_FLOW_URL;

  url(): string {
    return this.currentUrl;
  }

  locator(selector: string): FakeLocator {
    this.requestedSelectors.push(selector);
    return new FakeLocator(this.elements.get(selector) ?? {});
  }

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
  }

  async waitForTimeout(): Promise<void> {}

  async waitForEvent(): Promise<Download> {
    throw new Error('download not configured');
  }
}

function readyPage(): FakeFlowPage {
  const page = new FakeFlowPage();
  for (const selector of [
    FLOW_SELECTORS.appRoot,
    FLOW_SELECTORS.creditBalance,
    FLOW_SELECTORS.modelMenu,
    FLOW_SELECTORS.aspectMenu,
    FLOW_SELECTORS.ingredientsInput,
    FLOW_SELECTORS.promptInput,
    FLOW_SELECTORS.submitButton,
  ]) page.elements.set(selector, { visible: true, enabled: true });
  page.elements.set(FLOW_SELECTORS.creditBalance, { visible: true, text: '24 970 crédits' });
  page.elements.set(FLOW_SELECTORS.signIn, { visible: false });
  page.elements.set(FLOW_SELECTORS.errorBanner, { visible: false });
  page.elements.set(FLOW_SELECTORS.ingredientRemoveButton, { visible: false, count: 0 });
  page.elements.set(FLOW_SELECTORS.ingredientsPreview, { visible: false, count: 0 });
  page.elements.set(FLOW_SELECTORS.generationProgress, { visible: false, count: 0 });
  page.elements.set(FLOW_SELECTORS.resultReady, { visible: false, count: 0, source: null });
  return page;
}

describe('Google Flow CDP driver', () => {
  it('estimates Fast and Quality costs and rejects unsafe budgets', () => {
    expect(estimateCreditCost([{}, {}, {}], 'fast')).toBe(30);
    expect(estimateCreditCost([{}, {}, {}], 'quality')).toBe(300);
    expect(() => assertSufficientCreditBalance(29, 30)).toThrow(/insufficient/i);
    expect(() => assertCreditBudget(10, 10, 19)).toThrow(/max-credit/i);
    expect(() => assertCreditBudget(10, 10, 20)).not.toThrow();
  });

  it('restricts CDP attachment to credential-free loopback URLs', () => {
    expect(assertLoopbackCdpUrl('http://127.0.0.1:9222')).toBe('http://127.0.0.1:9222');
    expect(() => assertLoopbackCdpUrl('http://browser.internal:9222')).toThrow(/loopback/i);
    expect(() => assertLoopbackCdpUrl('http://user:secret@127.0.0.1:9222')).toThrow(/credentials/i);
  });

  it('attaches to an existing Flow tab and verifies the centralized selectors', async () => {
    const page = readyPage();
    const newPage = vi.fn(async () => page);
    const connector = vi.fn(async () => ({ contexts: () => [{ pages: () => [page], newPage }] }));

    const attached = await attachToBrowser({ connector, timeoutMs: 50 });

    expect(attached.driver).toBeInstanceOf(FlowDriver);
    expect(connector).toHaveBeenCalledWith('http://127.0.0.1:9222');
    expect(newPage).not.toHaveBeenCalled();
    expect(page.requestedSelectors).toEqual(expect.arrayContaining([
      FLOW_SELECTORS.appRoot,
      FLOW_SELECTORS.promptInput,
      FLOW_SELECTORS.creditBalance,
    ]));
    await expect(attached.driver.readCreditBalance()).resolves.toBe(24_970);
  });

  it('opens Flow when needed but never tries to handle a Google login', async () => {
    const blank = readyPage();
    blank.currentUrl = 'about:blank';
    const flow = readyPage();
    const newPage = vi.fn(async () => flow);
    await attachToBrowser({
      timeoutMs: 50,
      connector: async () => ({ contexts: () => [{ pages: () => [blank], newPage }] }),
    });
    expect(newPage).toHaveBeenCalledTimes(1);
    expect(flow.currentUrl).toBe(GOOGLE_FLOW_URL);

    const login = readyPage();
    login.currentUrl = 'https://accounts.google.com/signin';
    login.elements.set(FLOW_SELECTORS.signIn, { visible: true });
    await expect(attachToBrowser({
      timeoutMs: 50,
      connector: async () => ({ contexts: () => [{ pages: () => [], newPage: async () => login }] }),
    })).rejects.toThrow(/connecte-toi d'abord dans le navigateur/i);
  });

  it('maps atomic actions to the fake DOM without blind clicks', async () => {
    const page = readyPage();
    const selected: string[] = [];
    page.elements.set(FLOW_SELECTORS.modelMenu, { visible: true, click: () => selected.push('model-menu') });
    page.elements.set(FLOW_SELECTORS.modelOption['veo-3.1-fast'], {
      visible: true,
      click: () => selected.push('fast'),
    });
    page.elements.set(FLOW_SELECTORS.aspectMenu, { visible: true, click: () => selected.push('aspect-menu') });
    page.elements.set(FLOW_SELECTORS.aspectOption['9:16'], { visible: true, click: () => selected.push('9:16') });
    const preview = page.elements.get(FLOW_SELECTORS.ingredientsPreview)!;
    page.elements.set(FLOW_SELECTORS.ingredientsInput, {
      visible: true,
      files: (files) => {
        selected.push(...files.map((filename) => path.basename(filename)));
        preview.count = files.length;
        preview.visible = true;
      },
    });
    const result = page.elements.get(FLOW_SELECTORS.resultReady)!;
    page.elements.set(FLOW_SELECTORS.submitButton, {
      visible: true,
      click: () => {
        result.count = 1;
        result.visible = true;
        result.source = 'blob:new-result';
      },
    });
    const prompt = vi.fn();
    page.elements.set(FLOW_SELECTORS.promptInput, { visible: true, fill: prompt });
    const driver = new FlowDriver(page, { actionTimeoutMs: 50, generationTimeoutMs: 50, pollIntervalMs: 1 });

    await driver.setModel('veo-3.1-fast');
    await driver.setAspect('9:16');
    await driver.setIngredients(['/approved/hero.png']);
    await driver.submitPrompt('A safe cinematic move');

    expect(selected).toEqual(['model-menu', 'fast', 'aspect-menu', '9:16', 'hero.png']);
    expect(prompt).toHaveBeenCalledWith('A safe cinematic move');
    expect(page.requestedSelectors).toContain(FLOW_SELECTORS.resultReady);
  });
});
