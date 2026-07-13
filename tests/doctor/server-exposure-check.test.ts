import { describe, expect, it } from 'vitest';
import { checkServerExposureEnvironment } from '../../src/doctor/index.js';

describe('doctor server exposure check', () => {
  it('warns for environment-driven non-loopback no-auth configuration', () => {
    const check = checkServerExposureEnvironment({
      HOST: '0.0.0.0',
      AUTH_ENABLED: 'false',
      NODE_ENV: 'development',
    });

    expect(check).toMatchObject({
      name: 'Server network exposure',
      status: 'warn',
    });
    expect(check.message).toContain('SERVER_UNAUTHENTICATED_NETWORK_BIND');
  });

  it('reports loopback no-auth and authenticated network binds as controlled', () => {
    expect(
      checkServerExposureEnvironment({
        HOST: '127.0.0.1',
        AUTH_ENABLED: 'false',
        NODE_ENV: 'development',
      }).status,
    ).toBe('ok');

    expect(
      checkServerExposureEnvironment({
        HOST: '0.0.0.0',
        AUTH_ENABLED: 'true',
        NODE_ENV: 'development',
      }).status,
    ).toBe('ok');
  });

  it('matches the server production fail-closed auth rule', () => {
    expect(
      checkServerExposureEnvironment({
        HOST: '0.0.0.0',
        AUTH_ENABLED: 'false',
        NODE_ENV: 'production',
      }).status,
    ).toBe('ok');
  });
});
