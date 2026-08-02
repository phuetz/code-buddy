/**
 * Security characterization for `getFilteredEnv` (BashTool child-process env).
 *
 * Child processes spawned by BashTool must NOT inherit credentials. The filter
 * (src/tools/bash/command-validator.ts) enforces three rules; this test locks
 * them in so a future change can't silently start leaking secrets:
 *   1. allowlist — only SAFE_ENV_VARS names pass (e.g. PATH/HOME), arbitrary or
 *      sensitive names (e.g. GROK_API_KEY, AWS_SECRET) are dropped;
 *   2. secret-value scan — even an allowlisted var is dropped if its VALUE looks
 *      like a secret (sk-…, ghp_…, AKIA…, JWT, 64-hex, PEM private key);
 *   3. control-char sanitization — control chars are stripped from values.
 *
 * Purely additive (no production code touched). process.env is snapshotted and
 * restored around each case.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFilteredEnv } from '../../src/tools/bash/command-validator.js';

let snapshot: NodeJS.ProcessEnv;
beforeEach(() => {
  snapshot = { ...process.env };
});
afterEach(() => {
  // restore exactly
  for (const k of Object.keys(process.env)) if (!(k in snapshot)) delete process.env[k];
  Object.assign(process.env, snapshot);
});

describe('getFilteredEnv — allowlist', () => {
  it('passes safe vars and drops non-allowlisted / sensitive names', () => {
    process.env.PATH = '/usr/bin:/bin';
    process.env.GROK_API_KEY = 'should-not-pass';
    process.env.AWS_SECRET_ACCESS_KEY = 'nope';
    process.env.SOME_RANDOM_APP_VAR = 'nope';

    const env = getFilteredEnv();

    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.GROK_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.SOME_RANDOM_APP_VAR).toBeUndefined();
  });

  it('drops NODE_OPTIONS and NODE_PATH even when inherited', () => {
    process.env.NODE_OPTIONS = '--require /tmp/evil.js';
    process.env.NODE_PATH = '/tmp/evil-modules';

    const env = getFilteredEnv();

    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.NODE_PATH).toBeUndefined();
  });
});

describe('getFilteredEnv — secret-value scan (even allowlisted names)', () => {
  it('drops an allowlisted var whose value looks like a secret', () => {
    // GIT_AUTHOR_NAME is allowlisted by NAME, but a secret-looking VALUE is dropped.
    process.env.GIT_AUTHOR_NAME = 'sk-' + 'a'.repeat(32); // OpenAI-style key shape
    const env = getFilteredEnv();
    expect(env.GIT_AUTHOR_NAME).toBeUndefined();
  });

  it('keeps an allowlisted var with a normal value', () => {
    process.env.GIT_AUTHOR_NAME = 'Patrice';
    const env = getFilteredEnv();
    expect(env.GIT_AUTHOR_NAME).toBe('Patrice');
  });
});

describe('getFilteredEnv — control-char sanitization', () => {
  it('strips control characters from allowlisted values', () => {
    process.env.LANG = `en_US.UTF-8${String.fromCharCode(7)}${String.fromCharCode(0)}`;
    const env = getFilteredEnv();
    expect(env.LANG).toBe('en_US.UTF-8');
  });
});
