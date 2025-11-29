/**
 * Tests for Embedded Browser
 */

import { EmbeddedBrowser, getEmbeddedBrowser, resetEmbeddedBrowser } from '../src/browser/embedded-browser';

describe('EmbeddedBrowser', () => {
  let browser: EmbeddedBrowser;

  beforeEach(() => {
    resetEmbeddedBrowser();
    browser = new EmbeddedBrowser({
      renderMode: 'text',
      timeout: 5000,
    });
  });

  afterEach(() => {
    browser.dispose();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const defaultBrowser = new EmbeddedBrowser();
      expect(defaultBrowser).toBeDefined();
      const config = defaultBrowser.getConfig();
      expect(config.headless).toBe(true);
      expect(config.renderMode).toBe('text');
      defaultBrowser.dispose();
    });

    it('should accept custom config', () => {
      const config = browser.getConfig();
      expect(config.timeout).toBe(5000);
      expect(config.renderMode).toBe('text');
    });

    it('should set default viewport', () => {
      const config = browser.getConfig();
      expect(config.viewport.width).toBe(1280);
      expect(config.viewport.height).toBe(720);
    });
  });

  describe('htmlToText', () => {
    it('should handle empty content', () => {
      const text = browser.getTextContent();
      expect(text).toBe('');
    });
  });

  describe('selectElements', () => {
    it('should return empty array when no content', () => {
      const elements = browser.selectElements('div');
      expect(elements).toEqual([]);
    });
  });

  describe('getLinks', () => {
    it('should return empty array when no content', () => {
      const links = browser.getLinks();
      expect(links).toEqual([]);
    });
  });

  describe('getForms', () => {
    it('should return empty array when no content', () => {
      const forms = browser.getForms();
      expect(forms).toEqual([]);
    });
  });

  describe('session management', () => {
    it('should create session', () => {
      const session = browser.createSession();

      expect(session.id).toBeDefined();
      expect(session.id).toMatch(/^browser_/);
      expect(session.pages).toEqual([]);
      expect(session.startTime).toBeInstanceOf(Date);
    });

    it('should create multiple sessions', () => {
      const session1 = browser.createSession();
      const session2 = browser.createSession();

      expect(session1.id).not.toBe(session2.id);
    });

    it('should close session', () => {
      const session = browser.createSession();
      browser.closeSession(session.id);
      // No error thrown
    });
  });

  describe('formatPageInfo', () => {
    it('should format page info correctly', () => {
      const pageInfo = {
        url: 'https://example.com',
        title: 'Example Page',
        text: 'Hello World',
      };

      const formatted = browser.formatPageInfo(pageInfo);

      expect(formatted).toContain('Example Page');
      expect(formatted).toContain('https://example.com');
      expect(formatted).toContain('Hello World');
    });

    it('should handle missing content', () => {
      const pageInfo = {
        url: 'https://test.com',
        title: 'Test',
      };

      const formatted = browser.formatPageInfo(pageInfo);

      expect(formatted).toContain('No content');
    });

    it('should show screenshot path if available', () => {
      const pageInfo = {
        url: 'https://example.com',
        title: 'Test',
        screenshot: '/tmp/screenshot.png',
      };

      const formatted = browser.formatPageInfo(pageInfo);

      expect(formatted).toContain('Screenshot saved');
      expect(formatted).toContain('/tmp/screenshot.png');
    });
  });

  describe('renderInTerminal', () => {
    it('should render empty page gracefully', () => {
      const rendered = browser.renderInTerminal();

      expect(rendered).toContain('Untitled');
      expect(rendered).toContain('╔');
      expect(rendered).toContain('╚');
    });
  });

  describe('getCurrentUrl', () => {
    it('should return empty string initially', () => {
      expect(browser.getCurrentUrl()).toBe('');
    });
  });

  describe('getPageContent', () => {
    it('should return empty string initially', () => {
      expect(browser.getPageContent()).toBe('');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      browser.updateConfig({ timeout: 10000, renderMode: 'none' });

      const config = browser.getConfig();
      expect(config.timeout).toBe(10000);
      expect(config.renderMode).toBe('none');
    });

    it('should preserve unmodified config values', () => {
      const originalConfig = browser.getConfig();
      browser.updateConfig({ timeout: 20000 });

      const newConfig = browser.getConfig();
      expect(newConfig.viewport).toEqual(originalConfig.viewport);
      expect(newConfig.headless).toBe(originalConfig.headless);
    });
  });

  describe('events', () => {
    it('should emit session:created event', (done) => {
      browser.on('session:created', (data) => {
        expect(data.sessionId).toBeDefined();
        done();
      });

      browser.createSession();
    });

    it('should emit session:closed event', (done) => {
      browser.on('session:closed', (data) => {
        expect(data.sessionId).toBeDefined();
        done();
      });

      const session = browser.createSession();
      browser.closeSession(session.id);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      resetEmbeddedBrowser();
      const instance1 = getEmbeddedBrowser();
      const instance2 = getEmbeddedBrowser();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getEmbeddedBrowser();
      resetEmbeddedBrowser();
      const instance2 = getEmbeddedBrowser();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', () => {
      const session = browser.createSession();
      browser.dispose();
      // Sessions should be cleared
    });
  });
});
