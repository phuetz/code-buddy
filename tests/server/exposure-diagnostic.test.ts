import { describe, expect, it } from 'vitest';
import {
  diagnoseServerExposure,
  UNAUTHENTICATED_NETWORK_BIND_CODE,
} from '../../src/server/exposure-diagnostic.js';

describe('server exposure diagnostic', () => {
  it.each(['127.0.0.1', '127.42.0.9', 'localhost', 'api.localhost', '::1', '[::1]'])(
    'accepts unauthenticated loopback bind %s',
    (host) => {
      const diagnostic = diagnoseServerExposure({ host, authEnabled: false });

      expect(diagnostic).toMatchObject({
        code: null,
        status: 'ok',
        loopback: true,
        networkExposed: false,
        unsafe: false,
      });
    },
  );

  it.each(['0.0.0.0', '::', '192.168.1.50', '100.98.18.76', 'example.com'])(
    'detects unauthenticated non-loopback bind %s',
    (host) => {
      const diagnostic = diagnoseServerExposure({ host, authEnabled: false });

      expect(diagnostic).toMatchObject({
        code: UNAUTHENTICATED_NETWORK_BIND_CODE,
        status: 'warn',
        host,
        loopback: false,
        networkExposed: true,
        unsafe: true,
      });
      expect(diagnostic.message).toContain('CORS does not protect');
      expect(diagnostic.message).toContain('--host 127.0.0.1 --no-auth');
      expect(diagnostic.message).toContain('Fleet/A2A');
      expect(diagnostic.message).toContain('JWT_SECRET');
    },
  );

  it('keeps an authenticated Fleet/A2A network bind supported', () => {
    expect(
      diagnoseServerExposure({ host: '0.0.0.0', authEnabled: true }),
    ).toMatchObject({
      code: null,
      status: 'ok',
      networkExposed: true,
      unsafe: false,
    });
  });
});
