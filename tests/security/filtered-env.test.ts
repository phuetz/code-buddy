import { describe, it, expect, afterEach } from 'vitest';

import { SAFE_ENV_VARS } from '../../src/tools/bash/security-patterns.js';
import { getFilteredEnv } from '../../src/tools/bash/command-validator.js';

/**
 * Regression guard for the sandbox env allowlist. NODE_OPTIONS supports
 * --require/--import (arbitrary JS at startup) and NODE_PATH hijacks module
 * resolution — neither may reach a spawned node/npm/npx subprocess.
 */
describe('SAFE_ENV_VARS — dangerous vars excluded', () => {
  it('does NOT allow NODE_OPTIONS or NODE_PATH', () => {
    expect(SAFE_ENV_VARS.has('NODE_OPTIONS')).toBe(false);
    expect(SAFE_ENV_VARS.has('NODE_PATH')).toBe(false);
  });

  it('still allows benign vars', () => {
    expect(SAFE_ENV_VARS.has('PATH')).toBe(true);
    expect(SAFE_ENV_VARS.has('HOME')).toBe(true);
    expect(SAFE_ENV_VARS.has('NODE_ENV')).toBe(true);
  });
});

describe('getFilteredEnv — strips injection vectors', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('drops NODE_OPTIONS / NODE_PATH even when present in process.env', () => {
    process.env.NODE_OPTIONS = '--require /tmp/evil.js';
    process.env.NODE_PATH = '/tmp/evil-modules';
    const filtered = getFilteredEnv();
    expect(filtered).not.toHaveProperty('NODE_OPTIONS');
    expect(filtered).not.toHaveProperty('NODE_PATH');
  });
});
