import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/utils/logger.js';
import {
  getSSRFGuard,
  resetSSRFGuard,
  SSRFGuard,
} from '../../src/security/ssrf-guard.js';

afterEach(() => {
  resetSSRFGuard();
  vi.restoreAllMocks();
});

describe('SSRFGuard synchronous boundary', () => {
  it('fails closed for a hostname and marks that DNS is required', () => {
    expect(new SSRFGuard().isSafeUrlSync('https://example.com/data')).toEqual({
      safe: false,
      requiresDns: true,
      reason: 'Hostname requires asynchronous DNS validation',
    });
  });

  it('accepts allowlisted hosts and public IPs but rejects private IPs', () => {
    const guard = new SSRFGuard({ allowedHosts: ['hooks.example'] });
    expect(guard.isSafeUrlSync('https://hooks.example/data').safe).toBe(true);
    expect(guard.isSafeUrlSync('https://93.184.216.34/data').safe).toBe(true);
    expect(guard.isSafeUrlSync('http://127.0.0.1/data').safe).toBe(false);
  });

  it('warns when a later singleton configuration would be ignored', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    getSSRFGuard({ allowedHosts: ['first.example'] });
    getSSRFGuard({ allowedHosts: ['second.example'] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignored configuration'));
  });
});
