/**
 * Network Route Interceptor
 *
 * Playwright page.route() wrapper for intercepting, mocking, blocking,
 * and modifying network requests. OpenClaw-inspired network control.
 */

import { logger } from '../utils/logger.js';
import type { RouteRule } from './types.js';

// Playwright types (dynamic import)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightRoute = any;

// ============================================================================
// Route Interceptor
// ============================================================================

export class RouteInterceptor {
  private rules: Map<string, RouteRule> = new Map();
  private handlers: Map<string, (route: PlaywrightRoute) => Promise<void>> = new Map();

  /**
   * Add a route interception rule
   */
  async addRule(page: Page, rule: RouteRule): Promise<void> {
    // Remove existing rule with same ID
    if (this.rules.has(rule.id)) {
      await this.removeRule(page, rule.id);
    }

    const handler = async (route: PlaywrightRoute) => {
      const url = route.request().url();

      switch (rule.action) {
        case 'block':
          logger.debug(`Route blocked: ${url}`);
          await route.abort('blockedbyclient');
          break;

        case 'mock':
          if (rule.mockResponse) {
            logger.debug(`Route mocked: ${url}`);
            await route.fulfill({
              status: rule.mockResponse.status,
              body: rule.mockResponse.body || '',
              contentType: rule.mockResponse.contentType || 'text/plain',
              headers: rule.mockResponse.headers,
            });
          } else {
            await route.continue();
          }
          break;

        case 'modify':
          if (rule.modifyHeaders) {
            const headers = {
              ...route.request().headers(),
              ...rule.modifyHeaders,
            };
            logger.debug(`Route headers modified: ${url}`);
            await route.continue({ headers });
          } else {
            await route.continue();
          }
          break;

        case 'log':
          logger.info(`Route logged: ${route.request().method()} ${url}`);
          await route.continue();
          break;

        default:
          await route.continue();
      }
    };

    await page.route(rule.urlPattern, handler);
    this.rules.set(rule.id, rule);
    this.handlers.set(rule.id, handler);

    logger.debug(`Route rule added: ${rule.id} (${rule.action} ${rule.urlPattern})`);
  }

  /**
   * Remove a route interception rule
   */
  async removeRule(page: Page, ruleId: string): Promise<void> {
    const rule = this.rules.get(ruleId);
    const handler = this.handlers.get(ruleId);

    if (rule && handler) {
      await page.unroute(rule.urlPattern, handler);
      this.rules.delete(ruleId);
      this.handlers.delete(ruleId);
      logger.debug(`Route rule removed: ${ruleId}`);
    }
  }

  /**
   * List active rules
   */
  listRules(): RouteRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Clear all rules
   */
  async clearRules(page: Page): Promise<void> {
    for (const [id, rule] of this.rules) {
      const handler = this.handlers.get(id);
      if (handler) {
        await page.unroute(rule.urlPattern, handler);
      }
    }
    this.rules.clear();
    this.handlers.clear();
    logger.debug('All route rules cleared');
  }
}
