import { describe, expect, it } from 'vitest';
import { buildFilteredSubprocessEnv, isSecretLikeEnv } from '../../src/utils/subprocess-env.js';

describe('subprocess env filtering', () => {
  it('keeps safe runtime variables and strips secret-like names', () => {
    const env = buildFilteredSubprocessEnv({
      sourceEnv: {
        PATH: '/usr/bin',
        HOME: '/home/patrice',
        OPENAI_API_KEY: 'sk-test-secret-that-must-not-leak',
        JWT_SECRET: 'x'.repeat(64),
        GIT_AUTHOR_NAME: 'Patrice',
      },
    });

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/patrice');
    expect(env.GIT_AUTHOR_NAME).toBe('Patrice');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.JWT_SECRET).toBeUndefined();
  });

  it('adds explicit non-secret env and sanitizes control characters', () => {
    const env = buildFilteredSubprocessEnv({
      sourceEnv: {},
      extraEnv: {
        VISION_DESC: 'hello\u0000world',
        API_KEY: 'should-not-pass',
      },
    });

    expect(env.VISION_DESC).toBe('helloworld');
    expect(env.API_KEY).toBeUndefined();
  });

  it('never permits Node startup injection through explicit allowlists or overrides', () => {
    const env = buildFilteredSubprocessEnv({
      sourceEnv: {
        NODE_OPTIONS: '--require /tmp/evil.js',
        NODE_PATH: '/tmp/evil-modules',
        node_options: '--import=/tmp/lowercase.mjs',
      },
      allowEnv: ['NODE_OPTIONS', 'NODE_PATH'],
      extraEnv: {
        NODE_OPTIONS: '--import=/tmp/evil.mjs',
        NODE_PATH: '/tmp/other-modules',
        node_path: '/tmp/lowercase-modules',
      },
    });
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.NODE_PATH).toBeUndefined();
    expect(env.node_options).toBeUndefined();
    expect(env.node_path).toBeUndefined();
  });

  it('does not treat AUTHOR or XAUTHORITY as auth secrets', () => {
    expect(isSecretLikeEnv('GIT_AUTHOR_NAME', 'Patrice')).toBe(false);
    expect(isSecretLikeEnv('XAUTHORITY', '/tmp/xauth')).toBe(false);
    expect(isSecretLikeEnv('OPENAI_API_KEY', 'value')).toBe(true);
  });
});
