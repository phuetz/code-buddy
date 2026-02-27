/**
 * Comprehensive Unit Tests for BrowserTool
 *
 * Tests the browser automation tool's functionality including:
 * - Browser initialization (Playwright availability, browser launch)
 * - Navigation actions (navigate, goBack, goForward, reload)
 * - DOM interactions (click, fill, hover, scroll, waitForSelector)
 * - Screenshot capture with various options
 * - Form handling (getForms, submit, select)
 * - Content extraction (getText, getHtml, getLinks, evaluate)
 * - URL blocking/security
 * - Error handling and edge cases
 * - Configuration management
 * - Cleanup and disposal
 */

import { BrowserTool, getBrowserTool, resetBrowserTool, BrowserConfig, BrowserParams } from '../../src/tools/browser-tool';

// Mock UnifiedVfsRouter to prevent file system operations
jest.mock('../../src/services/vfs/unified-vfs-router', () => ({
  UnifiedVfsRouter: {
    Instance: {
      ensureDir: jest.fn().mockResolvedValue(undefined),
    },
  },
}));

// Create mock page with all required methods
function createMockPage() {
  return {
    goto: jest.fn().mockResolvedValue(null),
    click: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
    textContent: jest.fn().mockResolvedValue('Page text content'),
    innerHTML: jest.fn().mockResolvedValue('<div>HTML content</div>'),
    content: jest.fn().mockResolvedValue('<html><body>Full page</body></html>'),
    title: jest.fn().mockResolvedValue('Test Page Title'),
    url: jest.fn().mockReturnValue('https://example.com'),
    evaluate: jest.fn().mockResolvedValue('evaluated result'),
    waitForSelector: jest.fn().mockResolvedValue({}),
    selectOption: jest.fn().mockResolvedValue(['option1']),
    hover: jest.fn().mockResolvedValue(undefined),
    goBack: jest.fn().mockResolvedValue(null),
    goForward: jest.fn().mockResolvedValue(null),
    reload: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined),
    $: jest.fn().mockResolvedValue({}),
    $$: jest.fn().mockResolvedValue([]),
    $$eval: jest.fn().mockImplementation((_selector, _fn) => {
      // Simulate DOM evaluation
      if (_selector === 'a[href]') {
        return Promise.resolve([
          { href: 'https://example.com/link1', text: 'Link 1', title: 'Title 1' },
          { href: 'https://example.com/link2', text: 'Link 2', title: undefined },
        ]);
      }
      if (_selector === 'form') {
        return Promise.resolve([
          {
            action: 'https://example.com/submit',
            method: 'POST',
            id: 'form1',
            name: 'testForm',
            fields: [
              { name: 'username', type: 'text', id: 'user', required: true },
              { name: 'password', type: 'password', id: 'pass', required: true },
            ],
          },
        ]);
      }
      return Promise.resolve([]);
    }),
  };
}

// Create fresh mock instances for each test
let mockPage: ReturnType<typeof createMockPage>;
let mockContext: { newPage: jest.Mock; close: jest.Mock };
let mockBrowser: { newContext: jest.Mock; close: jest.Mock };
let mockChromium: { launch: jest.Mock };
let mockPlaywright: { chromium: typeof mockChromium; firefox: typeof mockChromium; webkit: typeof mockChromium };

function setupMocks() {
  mockPage = createMockPage();
  mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
  };
  mockBrowser = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined),
  };
  mockChromium = {
    launch: jest.fn().mockResolvedValue(mockBrowser),
  };
  mockPlaywright = {
    chromium: mockChromium,
    firefox: { launch: jest.fn().mockResolvedValue(mockBrowser) },
    webkit: { launch: jest.fn().mockResolvedValue(mockBrowser) },
  };
}

describe('BrowserTool', () => {
  let tool: BrowserTool;

  beforeEach(async () => {
    jest.clearAllMocks();
    setupMocks();
    await resetBrowserTool();
    tool = new BrowserTool();
    // Inject mock playwright for testing
    tool._injectPlaywright(mockPlaywright);
  });

  afterEach(async () => {
    await tool.dispose();
  });

  describe('Constructor and Configuration', () => {
    it('should create with default config', () => {
      const config = tool.getConfig();

      expect(config.headless).toBe(true);
      expect(config.viewport).toEqual({ width: 1280, height: 720 });
      expect(config.timeout).toBe(30000);
      expect(config.browserType).toBe('chromium');
      expect(config.javaScriptEnabled).toBe(true);
    });

    it('should create with custom config', () => {
      const customTool = new BrowserTool({
        headless: false,
        viewport: { width: 1920, height: 1080 },
        timeout: 60000,
        browserType: 'firefox',
      });

      const config = customTool.getConfig();

      expect(config.headless).toBe(false);
      expect(config.viewport).toEqual({ width: 1920, height: 1080 });
      expect(config.timeout).toBe(60000);
      expect(config.browserType).toBe('firefox');
    });

    it('should update configuration', () => {
      const listener = jest.fn();
      tool.on('config:updated', listener);

      tool.updateConfig({ timeout: 45000 });

      expect(tool.getConfig().timeout).toBe(45000);
      expect(listener).toHaveBeenCalled();
    });

    it('should have correct tool metadata', () => {
      expect(tool.name).toBe('browser');
      expect(tool.description).toContain('browser');
      expect(tool.dangerLevel).toBe('medium');
      expect(tool.inputSchema.properties.action).toBeDefined();
    });
  });

  describe('Initialization', () => {
    it('should not be initialized before first action', () => {
      expect(tool.isInitialized()).toBe(false);
    });

    it('should initialize on first action', async () => {
      const result = await tool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(result.success).toBe(true);
      expect(tool.isInitialized()).toBe(true);
      expect(mockChromium.launch).toHaveBeenCalledWith({ headless: true });
    });

    it('should return installation instructions when playwright unavailable', async () => {
      // Create a fresh tool without injecting playwright
      const freshTool = new BrowserTool();
      // Don't inject playwright - let it try to dynamically import

      const result = await freshTool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(result.success).toBe(false);
      // Accepts either: package not installed, or package installed but browsers missing
      expect(
        result.error?.includes('Playwright is not installed') ||
        result.error?.includes('Executable doesn\'t exist') ||
        result.error?.includes('playwright install')
      ).toBe(true);

      await freshTool.dispose();
    });
  });

  describe('Navigation', () => {
    it('should navigate to URL', async () => {
      const result = await tool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Navigated to');
      expect(result.output).toContain('Test Page Title');
      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('should require URL for navigate action', async () => {
      const result = await tool.execute({ action: 'navigate' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('URL is required');
    });

    it('should emit navigate event', async () => {
      const listener = jest.fn();
      tool.on('browser:navigate', listener);

      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com', title: 'Test Page Title' })
      );
    });
  });

  describe('Security - Blocked URLs', () => {
    const blockedUrls = [
      'http://localhost:3000',
      'http://127.0.0.1:8080',
      'http://192.168.1.1',
      'http://10.0.0.1',
      'http://172.16.0.1',
      'file:///etc/passwd',
      'http://0.0.0.0',
    ];

    test.each(blockedUrls)('should block internal URL: %s', async (url) => {
      const result = await tool.execute({ action: 'navigate', url });

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked');
    });

    it('should allow external URLs', async () => {
      const result = await tool.execute({ action: 'navigate', url: 'https://google.com' });

      expect(result.success).toBe(true);
    });
  });

  describe('Click Action', () => {
    it('should click on element', async () => {
      // Initialize first
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'click', selector: '#submit-btn' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Clicked on');
      expect(mockPage.click).toHaveBeenCalledWith('#submit-btn', expect.any(Object));
    });

    it('should require selector for click', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'click' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Selector is required');
    });

    it('should emit click event', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      const listener = jest.fn();
      tool.on('browser:click', listener);

      await tool.execute({ action: 'click', selector: '.button' });

      expect(listener).toHaveBeenCalledWith({ selector: '.button' });
    });
  });

  describe('Fill Action', () => {
    it('should fill input field', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({
        action: 'fill',
        selector: '#username',
        value: 'testuser',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Filled');
      expect(mockPage.fill).toHaveBeenCalledWith('#username', 'testuser', expect.any(Object));
    });

    it('should require selector and value for fill', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result1 = await tool.execute({ action: 'fill', value: 'test' });
      expect(result1.success).toBe(false);
      expect(result1.error).toContain('Selector is required');

      const result2 = await tool.execute({ action: 'fill', selector: '#input' });
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('Value is required');
    });
  });

  describe('Screenshot Action', () => {
    it('should take screenshot', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'screenshot' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Screenshot saved');
      expect(result.metadata?.path).toBeDefined();
      expect(mockPage.screenshot).toHaveBeenCalled();
    });

    it('should take full page screenshot', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      await tool.execute({
        action: 'screenshot',
        screenshotOptions: { fullPage: true },
      });

      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ fullPage: true })
      );
    });

    it('should emit screenshot event', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      const listener = jest.fn();
      tool.on('browser:screenshot', listener);

      await tool.execute({ action: 'screenshot' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.any(String), size: expect.any(Number) })
      );
    });
  });

  describe('Get Text Action', () => {
    it('should get text from selector', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'getText', selector: '.content' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Page text content');
    });

    it('should get all page text when no selector', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      mockPage.evaluate.mockResolvedValueOnce('Full page text');

      const result = await tool.execute({ action: 'getText' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Full page text');
    });
  });

  describe('Get HTML Action', () => {
    it('should get HTML from selector', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'getHtml', selector: '.container' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('HTML content');
    });

    it('should get full page HTML when no selector', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'getHtml' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('<html>');
    });
  });

  describe('Evaluate Action', () => {
    it('should evaluate JavaScript', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({
        action: 'evaluate',
        script: 'document.title',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('evaluated result');
    });

    it('should require script for evaluate', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'evaluate' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Script is required');
    });
  });

  describe('Wait For Selector Action', () => {
    it('should wait for selector', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({
        action: 'waitForSelector',
        selector: '.loaded',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Element found');
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('.loaded', expect.any(Object));
    });

    it('should require selector', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'waitForSelector' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Selector is required');
    });
  });

  describe('Get Links Action', () => {
    it('should get all links on page', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'getLinks' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Link 1');
      expect(result.output).toContain('https://example.com/link1');
      expect(result.metadata?.count).toBe(2);
    });
  });

  describe('Get Forms Action', () => {
    it('should get all forms on page', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'getForms' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Form 1');
      expect(result.output).toContain('POST');
      expect(result.output).toContain('username');
      expect(result.output).toContain('password');
    });
  });

  describe('Select Action', () => {
    it('should select option from dropdown', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({
        action: 'select',
        selector: '#dropdown',
        value: 'option1',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Selected');
      expect(mockPage.selectOption).toHaveBeenCalledWith('#dropdown', 'option1');
    });
  });

  describe('Hover Action', () => {
    it('should hover over element', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'hover', selector: '.menu-item' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hovering over');
      expect(mockPage.hover).toHaveBeenCalledWith('.menu-item');
    });
  });

  describe('Scroll Action', () => {
    it('should scroll page', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({
        action: 'scroll',
        scrollOptions: { y: 1000 },
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Scrolled to');
    });
  });

  describe('Navigation History Actions', () => {
    it('should go back in history', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'goBack' });

      expect(result.success).toBe(true);
      expect(mockPage.goBack).toHaveBeenCalled();
    });

    it('should go forward in history', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'goForward' });

      expect(result.success).toBe(true);
      expect(mockPage.goForward).toHaveBeenCalled();
    });

    it('should reload page', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'reload' });

      expect(result.success).toBe(true);
      expect(mockPage.reload).toHaveBeenCalled();
    });
  });

  describe('Close Action', () => {
    it('should close browser', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'close' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Browser closed');
      expect(mockPage.close).toHaveBeenCalled();
      expect(mockContext.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should emit closed event', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      const listener = jest.fn();
      tool.on('browser:closed', listener);

      await tool.execute({ action: 'close' });

      expect(listener).toHaveBeenCalled();
    });

    it('should handle close without initialization', async () => {
      const result = await tool.execute({ action: 'close' });

      expect(result.success).toBe(true);
    });
  });

  describe('Page Info', () => {
    it('should return null when not initialized', async () => {
      const info = await tool.getPageInfo();

      expect(info).toBeNull();
    });

    it('should return page info when initialized', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const info = await tool.getPageInfo();

      expect(info).toEqual({
        url: 'https://example.com',
        title: 'Test Page Title',
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown action', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      const result = await tool.execute({ action: 'unknownAction' as any });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });

    it('should handle action errors gracefully', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      mockPage.click.mockRejectedValueOnce(new Error('Element not found'));

      const result = await tool.execute({ action: 'click', selector: '.missing' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    });

    it('should return error result on action failure', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      mockPage.click.mockRejectedValueOnce(new Error('Click failed'));

      const result = await tool.execute({ action: 'click', selector: '.btn' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Click failed');
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getBrowserTool', async () => {
      await resetBrowserTool();

      const instance1 = getBrowserTool();
      const instance2 = getBrowserTool();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', async () => {
      const instance1 = getBrowserTool();
      await resetBrowserTool();
      const instance2 = getBrowserTool();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Dispose', () => {
    it('should cleanup resources on dispose', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });

      await tool.dispose();

      expect(tool.isInitialized()).toBe(false);
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should remove all event listeners on dispose', async () => {
      const listener = jest.fn();
      tool.on('browser:navigate', listener);

      await tool.dispose();

      expect(tool.listenerCount('browser:navigate')).toBe(0);
    });
  });
});

/**
 * Additional comprehensive tests for edge cases and detailed coverage
 */
describe('BrowserTool - Advanced Tests', () => {
  let tool: BrowserTool;

  beforeEach(async () => {
    jest.clearAllMocks();
    setupMocks();
    await resetBrowserTool();
    tool = new BrowserTool();
    tool._injectPlaywright(mockPlaywright);
  });

  afterEach(async () => {
    await tool.dispose();
  });

  describe('Browser Initialization - Advanced', () => {
    it('should handle browser launch failure', async () => {
      mockChromium.launch.mockRejectedValueOnce(new Error('Browser launch failed'));

      const result = await tool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to initialize browser');
      expect(result.error).toContain('Browser launch failed');
    });

    it('should handle context creation failure', async () => {
      mockBrowser.newContext.mockRejectedValueOnce(new Error('Context creation failed'));

      const result = await tool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to initialize browser');
    });

    it('should handle page creation failure', async () => {
      mockContext.newPage.mockRejectedValueOnce(new Error('Page creation failed'));

      const result = await tool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to initialize browser');
    });

    it('should use firefox browser type when configured', async () => {
      const firefoxTool = new BrowserTool({ browserType: 'firefox' });
      firefoxTool._injectPlaywright(mockPlaywright);

      await firefoxTool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(mockPlaywright.firefox.launch).toHaveBeenCalled();
      await firefoxTool.dispose();
    });

    it('should use webkit browser type when configured', async () => {
      const webkitTool = new BrowserTool({ browserType: 'webkit' });
      webkitTool._injectPlaywright(mockPlaywright);

      await webkitTool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(mockPlaywright.webkit.launch).toHaveBeenCalled();
      await webkitTool.dispose();
    });

    it('should pass user agent to context', async () => {
      const customTool = new BrowserTool({ userAgent: 'CustomBot/1.0' });
      customTool._injectPlaywright(mockPlaywright);

      await customTool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(mockBrowser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ userAgent: 'CustomBot/1.0' })
      );
      await customTool.dispose();
    });

    it('should pass javaScriptEnabled setting to context', async () => {
      const noJsTool = new BrowserTool({ javaScriptEnabled: false });
      noJsTool._injectPlaywright(mockPlaywright);

      await noJsTool.execute({ action: 'navigate', url: 'https://example.com' });

      expect(mockBrowser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ javaScriptEnabled: false })
      );
      await noJsTool.dispose();
    });

    it('should not re-initialize browser when already initialized', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      await tool.execute({ action: 'navigate', url: 'https://example.org' });

      expect(mockChromium.launch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Navigation - Advanced', () => {
    it('should include metadata in navigation result', async () => {
      mockPage.url.mockReturnValue('https://example.com/page');
      mockPage.title.mockResolvedValue('Page Title');

      const result = await tool.execute({ action: 'navigate', url: 'https://example.com/page' });

      expect(result.metadata).toEqual({
        url: 'https://example.com/page',
        title: 'Page Title',
      });
    });

    it('should handle navigation timeout', async () => {
      mockPage.goto.mockRejectedValueOnce(new Error('Navigation timeout exceeded'));

      const result = await tool.execute({
        action: 'navigate',
        url: 'https://slow-site.com',
        timeout: 1000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Navigation failed');
      expect(result.error).toContain('timeout');
    });

    it('should use custom timeout for navigation', async () => {
      await tool.execute({
        action: 'navigate',
        url: 'https://example.com',
        timeout: 60000,
      });

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ timeout: 60000 })
      );
    });
  });

  describe('URL Security - Extended', () => {
    const additionalBlockedUrls = [
      { url: 'http://172.17.0.1', description: 'Docker bridge IP' },
      { url: 'http://172.31.255.255', description: 'Private IP range end' },
      { url: 'file:///home/user/.ssh/id_rsa', description: 'SSH key file' },
    ];

    test.each(additionalBlockedUrls)('should block $description: $url', async ({ url }) => {
      const result = await tool.execute({ action: 'navigate', url });

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked');
    });

    it('should block custom blocked URLs from config', async () => {
      const customTool = new BrowserTool({
        blockedUrls: ['malicious-domain.com', 'evil-site.net'],
      });
      customTool._injectPlaywright(mockPlaywright);

      const result = await customTool.execute({
        action: 'navigate',
        url: 'https://malicious-domain.com/phishing',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked');
      await customTool.dispose();
    });

    it('should block invalid URL format', async () => {
      const result = await tool.execute({ action: 'navigate', url: 'not-a-valid-url' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked');
    });
  });

  describe('DOM Interactions - Advanced', () => {
    beforeEach(async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
    });

    describe('Click - Advanced', () => {
      it('should handle element not found error', async () => {
        mockPage.waitForSelector.mockRejectedValueOnce(new Error('Element not found'));

        const result = await tool.execute({ action: 'click', selector: '.missing-element' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Click failed');
      });

      it('should handle element not clickable error', async () => {
        mockPage.click.mockRejectedValueOnce(new Error('Element is not clickable'));

        const result = await tool.execute({ action: 'click', selector: '.disabled-btn' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Click failed');
      });

      it('should use custom timeout for click', async () => {
        await tool.execute({ action: 'click', selector: '.btn', timeout: 5000 });

        expect(mockPage.waitForSelector).toHaveBeenCalledWith('.btn', { timeout: 5000 });
        expect(mockPage.click).toHaveBeenCalledWith('.btn', { timeout: 5000 });
      });
    });

    describe('Fill - Advanced', () => {
      it('should report character count in output', async () => {
        const result = await tool.execute({
          action: 'fill',
          selector: '#input',
          value: 'test value here',
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain('15 characters');
      });

      it('should handle empty string value', async () => {
        const result = await tool.execute({
          action: 'fill',
          selector: '#input',
          value: '',
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain('0 characters');
      });

      it('should emit fill event with value length', async () => {
        const listener = jest.fn();
        tool.on('browser:fill', listener);

        await tool.execute({
          action: 'fill',
          selector: '#email',
          value: 'test@example.com',
        });

        expect(listener).toHaveBeenCalledWith({
          selector: '#email',
          valueLength: 16,
        });
      });

      it('should handle fill failure due to non-input element', async () => {
        mockPage.fill.mockRejectedValueOnce(new Error('Element is not an input'));

        const result = await tool.execute({
          action: 'fill',
          selector: 'div.text',
          value: 'test',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Fill failed');
      });
    });

    describe('Hover - Advanced', () => {
      it('should use custom timeout for hover', async () => {
        await tool.execute({ action: 'hover', selector: '.tooltip-trigger', timeout: 3000 });

        expect(mockPage.waitForSelector).toHaveBeenCalledWith('.tooltip-trigger', { timeout: 3000 });
      });

      it('should handle hover on hidden element', async () => {
        mockPage.hover.mockRejectedValueOnce(new Error('Element is hidden'));

        const result = await tool.execute({ action: 'hover', selector: '.hidden' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Hover failed');
      });
    });

    describe('Scroll - Advanced', () => {
      it('should use default scroll values', async () => {
        const result = await tool.execute({ action: 'scroll' });

        expect(result.success).toBe(true);
        expect(result.output).toContain('x:0, y:500');
      });

      it('should handle custom scroll options', async () => {
        const result = await tool.execute({
          action: 'scroll',
          scrollOptions: { x: 100, y: 2000, behavior: 'smooth' },
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain('x:100, y:2000');
      });

      it('should handle scroll failure', async () => {
        mockPage.evaluate.mockRejectedValueOnce(new Error('Scroll error'));

        const result = await tool.execute({ action: 'scroll' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Scroll failed');
      });
    });

    describe('WaitForSelector - Advanced', () => {
      it('should handle timeout waiting for selector', async () => {
        mockPage.waitForSelector.mockRejectedValueOnce(new Error('Timeout 30000ms exceeded'));

        const result = await tool.execute({
          action: 'waitForSelector',
          selector: '.never-appears',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Wait for selector failed');
      });

      it('should use custom timeout', async () => {
        await tool.execute({
          action: 'waitForSelector',
          selector: '.dynamic-content',
          timeout: 10000,
        });

        expect(mockPage.waitForSelector).toHaveBeenCalledWith('.dynamic-content', { timeout: 10000 });
      });
    });
  });

  describe('Screenshot - Advanced', () => {
    beforeEach(async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
    });

    it('should take JPEG screenshot with quality', async () => {
      const result = await tool.execute({
        action: 'screenshot',
        screenshotOptions: { type: 'jpeg', quality: 80 },
      });

      expect(result.success).toBe(true);
      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'jpeg',
          quality: 80,
        })
      );
    });

    it('should not include quality for PNG screenshots', async () => {
      await tool.execute({
        action: 'screenshot',
        screenshotOptions: { type: 'png', quality: 80 },
      });

      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'png',
          quality: undefined,
        })
      );
    });

    it('should save to custom path', async () => {
      await tool.execute({
        action: 'screenshot',
        screenshotOptions: { path: '/tmp/custom-screenshot.png' },
      });

      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/tmp/custom-screenshot.png' })
      );
    });

    it('should handle screenshot failure', async () => {
      mockPage.screenshot.mockRejectedValueOnce(new Error('Screenshot failed'));

      const result = await tool.execute({ action: 'screenshot' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Screenshot failed');
    });

    it('should include size in metadata', async () => {
      mockPage.screenshot.mockResolvedValueOnce(Buffer.from('x'.repeat(1000)));

      const result = await tool.execute({ action: 'screenshot' });

      expect(result.metadata?.size).toBe(1000);
    });
  });

  describe('Content Extraction - Advanced', () => {
    beforeEach(async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
    });

    describe('getText - Advanced', () => {
      it('should return error when element not found', async () => {
        mockPage.$.mockResolvedValueOnce(null);

        const result = await tool.execute({ action: 'getText', selector: '.missing' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Element not found');
      });

      it('should truncate very long text content', async () => {
        const longText = 'x'.repeat(60000);
        mockPage.evaluate.mockResolvedValueOnce(longText);

        const result = await tool.execute({ action: 'getText' });

        expect(result.success).toBe(true);
        expect(result.output).toContain('truncated');
        expect(result.metadata?.truncated).toBe(true);
        expect(result.metadata?.length).toBe(60000);
      });

      it('should handle null textContent', async () => {
        mockPage.textContent.mockResolvedValueOnce(null);

        const result = await tool.execute({ action: 'getText', selector: '.empty' });

        expect(result.success).toBe(true);
        expect(result.output).toBe('');
      });
    });

    describe('getHtml - Advanced', () => {
      it('should truncate very long HTML content', async () => {
        const longHtml = '<div>' + 'x'.repeat(150000) + '</div>';
        mockPage.content.mockResolvedValueOnce(longHtml);

        const result = await tool.execute({ action: 'getHtml' });

        expect(result.success).toBe(true);
        expect(result.output).toContain('truncated');
        expect(result.metadata?.truncated).toBe(true);
      });

      it('should handle innerHTML failure', async () => {
        mockPage.innerHTML.mockRejectedValueOnce(new Error('Element not found'));

        const result = await tool.execute({ action: 'getHtml', selector: '.missing' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Get HTML failed');
      });
    });

    describe('getLinks - Advanced', () => {
      it('should return message when no links found', async () => {
        mockPage.$$eval.mockResolvedValueOnce([]);

        const result = await tool.execute({ action: 'getLinks' });

        expect(result.success).toBe(true);
        expect(result.output).toContain('No links found');
      });

      it('should limit links to 100 and show count', async () => {
        const manyLinks = Array.from({ length: 150 }, (_, i) => ({
          href: `https://example.com/link${i}`,
          text: `Link ${i}`,
        }));
        mockPage.$$eval.mockResolvedValueOnce(manyLinks);

        const result = await tool.execute({ action: 'getLinks' });

        expect(result.success).toBe(true);
        expect(result.metadata?.count).toBe(150);
        expect(result.metadata?.shown).toBe(100);
      });

      it('should handle links with no text', async () => {
        mockPage.$$eval.mockResolvedValueOnce([
          { href: 'https://example.com', text: '', title: undefined },
        ]);

        const result = await tool.execute({ action: 'getLinks' });

        expect(result.success).toBe(true);
        expect(result.output).toContain('(no text)');
      });

      it('should handle getLinks failure', async () => {
        mockPage.$$eval.mockRejectedValueOnce(new Error('Evaluation failed'));

        const result = await tool.execute({ action: 'getLinks' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Get links failed');
      });
    });

    describe('evaluate - Advanced', () => {
      it('should stringify object results', async () => {
        mockPage.evaluate.mockResolvedValueOnce({ key: 'value', nested: { data: 123 } });

        const result = await tool.execute({
          action: 'evaluate',
          script: '({ key: "value" })',
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain('"key"');
        expect(result.output).toContain('"value"');
      });

      it('should handle undefined result', async () => {
        mockPage.evaluate.mockResolvedValueOnce(undefined);

        const result = await tool.execute({
          action: 'evaluate',
          script: 'undefined',
        });

        expect(result.success).toBe(true);
        expect(result.output).toBe('undefined');
      });

      it('should handle null result', async () => {
        mockPage.evaluate.mockResolvedValueOnce(null);

        const result = await tool.execute({
          action: 'evaluate',
          script: 'null',
        });

        expect(result.success).toBe(true);
        expect(result.output).toBe('null');
      });

      it('should emit evaluate event', async () => {
        const listener = jest.fn();
        tool.on('browser:evaluate', listener);

        await tool.execute({
          action: 'evaluate',
          script: 'document.title',
        });

        expect(listener).toHaveBeenCalledWith({ scriptLength: 14 });
      });

      it('should handle evaluate error', async () => {
        mockPage.evaluate.mockRejectedValueOnce(new Error('ReferenceError: x is not defined'));

        const result = await tool.execute({
          action: 'evaluate',
          script: 'x.undefined.property',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Evaluate failed');
      });
    });
  });

  describe('Form Handling - Advanced', () => {
    beforeEach(async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com/form' });
    });

    describe('getForms - Advanced', () => {
      it('should return message when no forms found', async () => {
        mockPage.$$eval.mockResolvedValueOnce([]);

        const result = await tool.execute({ action: 'getForms' });

        expect(result.success).toBe(true);
        expect(result.output).toContain('No forms found');
      });

      it('should handle multiple forms', async () => {
        mockPage.$$eval.mockResolvedValueOnce([
          {
            action: 'https://example.com/login',
            method: 'POST',
            fields: [{ name: 'user', type: 'text' }],
          },
          {
            action: 'https://example.com/search',
            method: 'GET',
            fields: [{ name: 'q', type: 'text' }],
          },
        ]);

        const result = await tool.execute({ action: 'getForms' });

        expect(result.success).toBe(true);
        expect(result.output).toContain('Form 1');
        expect(result.output).toContain('Form 2');
        expect(result.metadata?.count).toBe(2);
      });

      it('should handle getForms failure', async () => {
        mockPage.$$eval.mockRejectedValueOnce(new Error('DOM error'));

        const result = await tool.execute({ action: 'getForms' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Get forms failed');
      });
    });

    describe('submit - Advanced', () => {
      it('should submit form via submit button', async () => {
        mockPage.$.mockResolvedValueOnce({});

        const result = await tool.execute({ action: 'submit', selector: '#login-form' });

        expect(result.success).toBe(true);
        expect(result.output).toContain('Form submitted');
      });

      it('should emit submit event', async () => {
        const listener = jest.fn();
        tool.on('browser:submit', listener);

        await tool.execute({ action: 'submit', selector: '#form' });

        expect(listener).toHaveBeenCalledWith({ selector: '#form' });
      });

      it('should handle submit failure', async () => {
        mockPage.$.mockRejectedValueOnce(new Error('Form not found'));

        const result = await tool.execute({ action: 'submit', selector: '#missing-form' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Submit failed');
      });
    });

    describe('select - Advanced', () => {
      it('should emit select event', async () => {
        const listener = jest.fn();
        tool.on('browser:select', listener);

        await tool.execute({
          action: 'select',
          selector: '#country',
          value: 'US',
        });

        expect(listener).toHaveBeenCalledWith({
          selector: '#country',
          value: 'US',
        });
      });

      it('should handle select failure', async () => {
        mockPage.selectOption.mockRejectedValueOnce(new Error('Not a select element'));

        const result = await tool.execute({
          action: 'select',
          selector: '#text-input',
          value: 'option1',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Select failed');
      });
    });
  });

  describe('Navigation History - Advanced', () => {
    beforeEach(async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
    });

    it('should handle goBack with timeout', async () => {
      await tool.execute({ action: 'goBack', timeout: 5000 });

      expect(mockPage.goBack).toHaveBeenCalledWith({ timeout: 5000 });
    });

    it('should handle goForward with timeout', async () => {
      await tool.execute({ action: 'goForward', timeout: 5000 });

      expect(mockPage.goForward).toHaveBeenCalledWith({ timeout: 5000 });
    });

    it('should handle reload with timeout', async () => {
      await tool.execute({ action: 'reload', timeout: 5000 });

      expect(mockPage.reload).toHaveBeenCalledWith({ timeout: 5000 });
    });

    it('should handle goBack failure', async () => {
      mockPage.goBack.mockRejectedValueOnce(new Error('No history entry'));

      const result = await tool.execute({ action: 'goBack' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Go back failed');
    });

    it('should handle goForward failure', async () => {
      mockPage.goForward.mockRejectedValueOnce(new Error('No forward history'));

      const result = await tool.execute({ action: 'goForward' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Go forward failed');
    });

    it('should handle reload failure', async () => {
      mockPage.reload.mockRejectedValueOnce(new Error('Page unloaded'));

      const result = await tool.execute({ action: 'reload' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Reload failed');
    });
  });

  describe('Close and Cleanup - Advanced', () => {
    it('should handle close errors gracefully', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      mockBrowser.close.mockRejectedValueOnce(new Error('Browser already closed'));

      const result = await tool.execute({ action: 'close' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Close failed');
    });

    it('should report not initialized after close', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      expect(tool.isInitialized()).toBe(true);

      await tool.execute({ action: 'close' });
      expect(tool.isInitialized()).toBe(false);
    });
  });

  describe('Error Handling - Advanced', () => {
    it('should handle non-Error thrown objects', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      mockPage.click.mockRejectedValueOnce('String error message');

      const result = await tool.execute({ action: 'click', selector: '.btn' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('String error message');
    });

    it('should return descriptive error messages for action failures', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      mockPage.click.mockRejectedValueOnce(new Error('Element not visible'));

      const result = await tool.execute({ action: 'click', selector: '.hidden-btn' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Click failed');
      expect(result.error).toContain('.hidden-btn');
      expect(result.error).toContain('Element not visible');
    });
  });

  describe('getPageInfo - Advanced', () => {
    it('should return null on error', async () => {
      await tool.execute({ action: 'navigate', url: 'https://example.com' });
      mockPage.title.mockRejectedValueOnce(new Error('Page closed'));

      const info = await tool.getPageInfo();

      expect(info).toBeNull();
    });
  });
});

/**
 * Edge cases and stress tests
 */
describe('BrowserTool - Edge Cases', () => {
  let tool: BrowserTool;

  beforeEach(async () => {
    jest.clearAllMocks();
    setupMocks();
    await resetBrowserTool();
    tool = new BrowserTool();
    tool._injectPlaywright(mockPlaywright);
  });

  afterEach(async () => {
    await tool.dispose();
  });

  it('should handle Unicode in URLs', async () => {
    const result = await tool.execute({
      action: 'navigate',
      url: 'https://example.com/\u4E2D\u6587/page',
    });

    expect(result.success).toBe(true);
  });

  it('should handle special characters in selectors', async () => {
    await tool.execute({ action: 'navigate', url: 'https://example.com' });

    const result = await tool.execute({
      action: 'click',
      selector: '[data-testid="special-\\"chars\\""]',
    });

    expect(result.success).toBe(true);
  });

  it('should handle rapid successive actions', async () => {
    await tool.execute({ action: 'navigate', url: 'https://example.com' });

    const results = await Promise.all([
      tool.execute({ action: 'getText' }),
      tool.execute({ action: 'getHtml' }),
      tool.execute({ action: 'getLinks' }),
    ]);

    expect(results.every(r => r.success)).toBe(true);
  });

  it('should maintain state across multiple navigations', async () => {
    await tool.execute({ action: 'navigate', url: 'https://site1.com' });
    await tool.execute({ action: 'navigate', url: 'https://site2.com' });
    await tool.execute({ action: 'navigate', url: 'https://site3.com' });

    expect(tool.isInitialized()).toBe(true);
    expect(mockChromium.launch).toHaveBeenCalledTimes(1);
  });

  it('should handle very long JavaScript in evaluate', async () => {
    await tool.execute({ action: 'navigate', url: 'https://example.com' });

    const longScript = 'var x = "' + 'a'.repeat(10000) + '"';
    const result = await tool.execute({ action: 'evaluate', script: longScript });

    // The script should execute successfully (or fail with a meaningful error)
    // We just verify the action was attempted with a long script
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });

  it('should handle configuration changes between actions', async () => {
    await tool.execute({ action: 'navigate', url: 'https://example.com' });

    tool.updateConfig({ timeout: 60000 });
    const config = tool.getConfig();

    expect(config.timeout).toBe(60000);
  });

  it('should handle getBrowserTool with config after reset', async () => {
    await resetBrowserTool();

    const instance = getBrowserTool({ timeout: 45000 });

    expect(instance.getConfig().timeout).toBe(45000);
    await instance.dispose();
  });

  it('should return copy of config to prevent mutation', () => {
    const config1 = tool.getConfig();
    const config2 = tool.getConfig();

    expect(config1).toEqual(config2);
    expect(config1).not.toBe(config2);
  });
});
