/**
 * Tests for RouteInterceptor
 *
 * Verifies:
 * - addRule registers a route handler on the page
 * - removeRule unregisters the handler and removes the rule
 * - listRules returns all active rules
 * - clearRules removes all rules and unroutes them
 * - Adding a rule with a duplicate ID replaces the existing rule
 * - Handler behavior for each action type (block, mock, modify, log)
 */

import { RouteInterceptor } from '../../src/browser-automation/route-interceptor.js';
import type { RouteRule } from '../../src/browser-automation/types.js';

// Mock the logger to suppress output during tests
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

/**
 * Creates a mock Playwright page object with route/unroute as jest.fn()
 */
function createMockPage() {
  return {
    route: jest.fn().mockResolvedValue(undefined),
    unroute: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a mock Playwright route object with request(), abort(), fulfill(), continue()
 */
function createMockRoute(url = 'https://example.com/api/data', method = 'GET', headers: Record<string, string> = {}) {
  return {
    request: jest.fn().mockReturnValue({
      url: jest.fn().mockReturnValue(url),
      method: jest.fn().mockReturnValue(method),
      headers: jest.fn().mockReturnValue(headers),
    }),
    abort: jest.fn().mockResolvedValue(undefined),
    fulfill: jest.fn().mockResolvedValue(undefined),
    continue: jest.fn().mockResolvedValue(undefined),
  };
}

describe('RouteInterceptor', () => {
  let interceptor: RouteInterceptor;
  let mockPage: ReturnType<typeof createMockPage>;

  beforeEach(() => {
    interceptor = new RouteInterceptor();
    mockPage = createMockPage();
  });

  // ==========================================================================
  // addRule
  // ==========================================================================

  describe('addRule', () => {
    it('should register a route handler on the page', async () => {
      const rule: RouteRule = {
        id: 'block-ads',
        urlPattern: '**/ads/**',
        action: 'block',
      };

      await interceptor.addRule(mockPage, rule);

      expect(mockPage.route).toHaveBeenCalledTimes(1);
      expect(mockPage.route).toHaveBeenCalledWith('**/ads/**', expect.any(Function));
    });

    it('should store the rule so it appears in listRules', async () => {
      const rule: RouteRule = {
        id: 'block-ads',
        urlPattern: '**/ads/**',
        action: 'block',
      };

      await interceptor.addRule(mockPage, rule);

      const rules = interceptor.listRules();
      expect(rules).toHaveLength(1);
      expect(rules[0]).toEqual(rule);
    });

    it('should replace an existing rule with the same ID', async () => {
      const rule1: RouteRule = {
        id: 'intercept-api',
        urlPattern: '**/api/v1/**',
        action: 'block',
      };
      const rule2: RouteRule = {
        id: 'intercept-api',
        urlPattern: '**/api/v2/**',
        action: 'mock',
        mockResponse: { status: 200, body: '{"ok":true}', contentType: 'application/json' },
      };

      await interceptor.addRule(mockPage, rule1);
      await interceptor.addRule(mockPage, rule2);

      // Should have unrouted the first rule then routed the second
      expect(mockPage.unroute).toHaveBeenCalledTimes(1);
      expect(mockPage.unroute).toHaveBeenCalledWith('**/api/v1/**', expect.any(Function));
      expect(mockPage.route).toHaveBeenCalledTimes(2);

      const rules = interceptor.listRules();
      expect(rules).toHaveLength(1);
      expect(rules[0]).toEqual(rule2);
    });

    it('should handle adding multiple rules with different IDs', async () => {
      const rule1: RouteRule = { id: 'r1', urlPattern: '**/a', action: 'block' };
      const rule2: RouteRule = { id: 'r2', urlPattern: '**/b', action: 'log' };
      const rule3: RouteRule = { id: 'r3', urlPattern: '**/c', action: 'mock', mockResponse: { status: 204 } };

      await interceptor.addRule(mockPage, rule1);
      await interceptor.addRule(mockPage, rule2);
      await interceptor.addRule(mockPage, rule3);

      expect(mockPage.route).toHaveBeenCalledTimes(3);
      expect(interceptor.listRules()).toHaveLength(3);
    });
  });

  // ==========================================================================
  // removeRule
  // ==========================================================================

  describe('removeRule', () => {
    it('should unroute the handler and remove the rule', async () => {
      const rule: RouteRule = {
        id: 'block-ads',
        urlPattern: '**/ads/**',
        action: 'block',
      };

      await interceptor.addRule(mockPage, rule);
      await interceptor.removeRule(mockPage, 'block-ads');

      expect(mockPage.unroute).toHaveBeenCalledTimes(1);
      expect(mockPage.unroute).toHaveBeenCalledWith('**/ads/**', expect.any(Function));
      expect(interceptor.listRules()).toHaveLength(0);
    });

    it('should do nothing when removing a non-existent rule ID', async () => {
      await interceptor.removeRule(mockPage, 'non-existent');

      expect(mockPage.unroute).not.toHaveBeenCalled();
      expect(interceptor.listRules()).toHaveLength(0);
    });

    it('should only remove the specified rule, leaving others intact', async () => {
      const rule1: RouteRule = { id: 'r1', urlPattern: '**/a', action: 'block' };
      const rule2: RouteRule = { id: 'r2', urlPattern: '**/b', action: 'log' };

      await interceptor.addRule(mockPage, rule1);
      await interceptor.addRule(mockPage, rule2);
      await interceptor.removeRule(mockPage, 'r1');

      expect(interceptor.listRules()).toHaveLength(1);
      expect(interceptor.listRules()[0].id).toBe('r2');
    });
  });

  // ==========================================================================
  // listRules
  // ==========================================================================

  describe('listRules', () => {
    it('should return an empty array when no rules are added', () => {
      expect(interceptor.listRules()).toEqual([]);
    });

    it('should return all active rules', async () => {
      const rule1: RouteRule = { id: 'r1', urlPattern: '**/a', action: 'block' };
      const rule2: RouteRule = { id: 'r2', urlPattern: '**/b', action: 'log' };

      await interceptor.addRule(mockPage, rule1);
      await interceptor.addRule(mockPage, rule2);

      const rules = interceptor.listRules();
      expect(rules).toHaveLength(2);
      expect(rules).toEqual(expect.arrayContaining([rule1, rule2]));
    });

    it('should reflect removals', async () => {
      const rule: RouteRule = { id: 'r1', urlPattern: '**/a', action: 'block' };

      await interceptor.addRule(mockPage, rule);
      expect(interceptor.listRules()).toHaveLength(1);

      await interceptor.removeRule(mockPage, 'r1');
      expect(interceptor.listRules()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // clearRules
  // ==========================================================================

  describe('clearRules', () => {
    it('should remove all rules and unroute each handler', async () => {
      const rule1: RouteRule = { id: 'r1', urlPattern: '**/a', action: 'block' };
      const rule2: RouteRule = { id: 'r2', urlPattern: '**/b', action: 'mock', mockResponse: { status: 200 } };
      const rule3: RouteRule = { id: 'r3', urlPattern: '**/c', action: 'log' };

      await interceptor.addRule(mockPage, rule1);
      await interceptor.addRule(mockPage, rule2);
      await interceptor.addRule(mockPage, rule3);

      await interceptor.clearRules(mockPage);

      expect(mockPage.unroute).toHaveBeenCalledTimes(3);
      expect(mockPage.unroute).toHaveBeenCalledWith('**/a', expect.any(Function));
      expect(mockPage.unroute).toHaveBeenCalledWith('**/b', expect.any(Function));
      expect(mockPage.unroute).toHaveBeenCalledWith('**/c', expect.any(Function));
      expect(interceptor.listRules()).toHaveLength(0);
    });

    it('should be safe to call when no rules exist', async () => {
      await interceptor.clearRules(mockPage);

      expect(mockPage.unroute).not.toHaveBeenCalled();
      expect(interceptor.listRules()).toHaveLength(0);
    });

    it('should allow adding new rules after clearing', async () => {
      const rule1: RouteRule = { id: 'r1', urlPattern: '**/a', action: 'block' };
      const rule2: RouteRule = { id: 'r2', urlPattern: '**/b', action: 'log' };

      await interceptor.addRule(mockPage, rule1);
      await interceptor.clearRules(mockPage);

      await interceptor.addRule(mockPage, rule2);

      expect(interceptor.listRules()).toHaveLength(1);
      expect(interceptor.listRules()[0].id).toBe('r2');
    });
  });

  // ==========================================================================
  // Handler behavior for each action type
  // ==========================================================================

  describe('action: block', () => {
    it('should abort the route with blockedbyclient', async () => {
      const rule: RouteRule = {
        id: 'block-rule',
        urlPattern: '**/blocked/**',
        action: 'block',
      };

      await interceptor.addRule(mockPage, rule);

      // Extract the handler that was passed to page.route
      const handler = mockPage.route.mock.calls[0][1];
      const mockRoute = createMockRoute('https://example.com/blocked/resource');

      await handler(mockRoute);

      expect(mockRoute.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(mockRoute.fulfill).not.toHaveBeenCalled();
      expect(mockRoute.continue).not.toHaveBeenCalled();
    });
  });

  describe('action: mock', () => {
    it('should fulfill with the mock response when mockResponse is provided', async () => {
      const rule: RouteRule = {
        id: 'mock-rule',
        urlPattern: '**/api/**',
        action: 'mock',
        mockResponse: {
          status: 200,
          body: '{"data":"mocked"}',
          contentType: 'application/json',
          headers: { 'X-Mocked': 'true' },
        },
      };

      await interceptor.addRule(mockPage, rule);

      const handler = mockPage.route.mock.calls[0][1];
      const mockRoute = createMockRoute('https://example.com/api/data');

      await handler(mockRoute);

      expect(mockRoute.fulfill).toHaveBeenCalledWith({
        status: 200,
        body: '{"data":"mocked"}',
        contentType: 'application/json',
        headers: { 'X-Mocked': 'true' },
      });
      expect(mockRoute.abort).not.toHaveBeenCalled();
      expect(mockRoute.continue).not.toHaveBeenCalled();
    });

    it('should use defaults for optional mockResponse fields', async () => {
      const rule: RouteRule = {
        id: 'mock-minimal',
        urlPattern: '**/api/**',
        action: 'mock',
        mockResponse: {
          status: 204,
        },
      };

      await interceptor.addRule(mockPage, rule);

      const handler = mockPage.route.mock.calls[0][1];
      const mockRoute = createMockRoute('https://example.com/api/data');

      await handler(mockRoute);

      expect(mockRoute.fulfill).toHaveBeenCalledWith({
        status: 204,
        body: '',
        contentType: 'text/plain',
        headers: undefined,
      });
    });

    it('should continue the route when mockResponse is not provided', async () => {
      const rule: RouteRule = {
        id: 'mock-no-response',
        urlPattern: '**/api/**',
        action: 'mock',
      };

      await interceptor.addRule(mockPage, rule);

      const handler = mockPage.route.mock.calls[0][1];
      const mockRoute = createMockRoute('https://example.com/api/data');

      await handler(mockRoute);

      expect(mockRoute.continue).toHaveBeenCalled();
      expect(mockRoute.fulfill).not.toHaveBeenCalled();
      expect(mockRoute.abort).not.toHaveBeenCalled();
    });
  });

  describe('action: modify', () => {
    it('should merge modifyHeaders with existing request headers and continue', async () => {
      const rule: RouteRule = {
        id: 'modify-rule',
        urlPattern: '**/api/**',
        action: 'modify',
        modifyHeaders: {
          'Authorization': 'Bearer test-token',
          'X-Custom': 'custom-value',
        },
      };

      await interceptor.addRule(mockPage, rule);

      const handler = mockPage.route.mock.calls[0][1];
      const existingHeaders = { 'Content-Type': 'application/json', 'Accept': '*/*' };
      const mockRoute = createMockRoute('https://example.com/api/data', 'GET', existingHeaders);

      await handler(mockRoute);

      expect(mockRoute.continue).toHaveBeenCalledWith({
        headers: {
          'Content-Type': 'application/json',
          'Accept': '*/*',
          'Authorization': 'Bearer test-token',
          'X-Custom': 'custom-value',
        },
      });
      expect(mockRoute.abort).not.toHaveBeenCalled();
      expect(mockRoute.fulfill).not.toHaveBeenCalled();
    });

    it('should override existing headers with the same key', async () => {
      const rule: RouteRule = {
        id: 'modify-override',
        urlPattern: '**/api/**',
        action: 'modify',
        modifyHeaders: {
          'Content-Type': 'text/plain',
        },
      };

      await interceptor.addRule(mockPage, rule);

      const handler = mockPage.route.mock.calls[0][1];
      const existingHeaders = { 'Content-Type': 'application/json' };
      const mockRoute = createMockRoute('https://example.com/api/data', 'GET', existingHeaders);

      await handler(mockRoute);

      expect(mockRoute.continue).toHaveBeenCalledWith({
        headers: {
          'Content-Type': 'text/plain',
        },
      });
    });

    it('should continue without modification when modifyHeaders is not provided', async () => {
      const rule: RouteRule = {
        id: 'modify-no-headers',
        urlPattern: '**/api/**',
        action: 'modify',
      };

      await interceptor.addRule(mockPage, rule);

      const handler = mockPage.route.mock.calls[0][1];
      const mockRoute = createMockRoute('https://example.com/api/data');

      await handler(mockRoute);

      expect(mockRoute.continue).toHaveBeenCalledWith();
      expect(mockRoute.abort).not.toHaveBeenCalled();
      expect(mockRoute.fulfill).not.toHaveBeenCalled();
    });
  });

  describe('action: log', () => {
    it('should log the request method and URL and continue', async () => {
      const rule: RouteRule = {
        id: 'log-rule',
        urlPattern: '**/*',
        action: 'log',
      };

      await interceptor.addRule(mockPage, rule);

      const handler = mockPage.route.mock.calls[0][1];
      const mockRoute = createMockRoute('https://example.com/page', 'POST');

      await handler(mockRoute);

      expect(mockRoute.continue).toHaveBeenCalled();
      expect(mockRoute.abort).not.toHaveBeenCalled();
      expect(mockRoute.fulfill).not.toHaveBeenCalled();
    });
  });
});
