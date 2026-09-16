/**
 * GK21 — a non-loopback CODEBUDDY_BROWSER_DEV_ORIGINS entry is rejected loudly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isDevOriginAllowed, listDevOrigins, resetDevOrigins } from '../../src/security/dev-origins.js';
import { logger } from '../../src/utils/logger.js';

const ENV_KEY = 'CODEBUDDY_BROWSER_DEV_ORIGINS';

describe('GK21 CODEBUDDY_BROWSER_DEV_ORIGINS loud reject', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
    resetDevOrigins();
    vi.restoreAllMocks();
  });

  it('warns when a non-loopback origin is listed and never registers it', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    process.env[ENV_KEY] = 'http://localhost:5173, http://192.168.1.20:3000, https://example.com';
    resetDevOrigins();

    expect(isDevOriginAllowed('http://localhost:5173/')).toBe(true);
    expect(isDevOriginAllowed('http://192.168.1.20:3000/')).toBe(false);
    expect(isDevOriginAllowed('https://example.com/')).toBe(false);
    expect(listDevOrigins()).toEqual(['http://localhost:5173']);

    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('CODEBUDDY_BROWSER_DEV_ORIGINS') && m.includes('192.168.1.20'))).toBe(
      true,
    );
    expect(messages.some((m) => m.includes('CODEBUDDY_BROWSER_DEV_ORIGINS') && m.includes('example.com'))).toBe(true);
    expect(messages.some((m) => /rejected/i.test(m))).toBe(true);
  });
});
