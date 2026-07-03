/**
 * Dev-origin registry — the loopback-only invariant is the security property:
 * whatever a caller tries, only localhost/127.x/::1 origins can ever become
 * browsable, so the registry can never open the browser onto cloud metadata,
 * LAN hosts, or public sites.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  isDevOriginAllowed,
  isLoopbackHost,
  listDevOrigins,
  registerDevOrigin,
  resetDevOrigins,
  unregisterDevOrigin,
} from '../../src/security/dev-origins.js';

const ENV_KEY = 'CODEBUDDY_BROWSER_DEV_ORIGINS';

describe('dev-origins registry', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
    resetDevOrigins();
  });

  it('registers loopback origins and answers per exact origin', () => {
    const reg = registerDevOrigin('http://127.0.0.1:5173');
    expect(reg.ok).toBe(true);
    expect(isDevOriginAllowed('http://127.0.0.1:5173/app/route?x=1')).toBe(true);
    // Same host, other port → different origin → denied.
    expect(isDevOriginAllowed('http://127.0.0.1:5174/')).toBe(false);
    // Different loopback spelling is a different origin (no alias magic).
    expect(isDevOriginAllowed('http://localhost:5173/')).toBe(false);
  });

  it('rejects every non-loopback registration attempt', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.10:5173',
      'http://10.0.0.2:3000',
      'https://example.com',
      'http://127.0.0.1.evil.tld:5173',
      'file:///etc/passwd',
      'not a url',
    ]) {
      const reg = registerDevOrigin(url);
      expect(reg.ok, `should reject ${url}`).toBe(false);
      expect(isDevOriginAllowed(url)).toBe(false);
    }
    expect(listDevOrigins()).toHaveLength(0);
  });

  it('unregister closes the door again', () => {
    registerDevOrigin('http://localhost:3000');
    expect(isDevOriginAllowed('http://localhost:3000/')).toBe(true);
    unregisterDevOrigin('http://localhost:3000');
    expect(isDevOriginAllowed('http://localhost:3000/')).toBe(false);
  });

  it('seeds from CODEBUDDY_BROWSER_DEV_ORIGINS, dropping non-loopback entries', () => {
    process.env[ENV_KEY] = 'http://localhost:8080, http://192.168.0.5:80, http://[::1]:9000';
    resetDevOrigins();
    expect(isDevOriginAllowed('http://localhost:8080/index.html')).toBe(true);
    expect(isDevOriginAllowed('http://[::1]:9000/')).toBe(true);
    expect(isDevOriginAllowed('http://192.168.0.5/')).toBe(false);
    expect(listDevOrigins()).toHaveLength(2);
  });

  it('isLoopbackHost covers the loopback family and nothing else', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('app.localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.255.255.254')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('128.0.0.1')).toBe(false);
    expect(isLoopbackHost('127.0.0.256')).toBe(false);
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isLoopbackHost('169.254.169.254')).toBe(false);
  });
});
