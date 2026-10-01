import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFilteredEnv } from '../../src/tools/bash/command-validator.js';
import { ShellEnvPolicy } from '../../src/security/shell-env-policy.js';
import { sanitizeEnvVars } from '../../src/security/env-blocklist.js';

afterEach(() => vi.unstubAllEnvs());

describe('toolchain locations in the filtered bash environment', () => {
  it.each(['RUSTUP_HOME', 'CARGO_HOME', 'GOPATH', 'GOROOT', 'JAVA_HOME', 'JDK_HOME', 'NVM_DIR',
    'FNM_DIR', 'VOLTA_HOME', 'PNPM_HOME', 'BUN_INSTALL', 'CONDA_DEFAULT_ENV', 'PYENV_ROOT'])(
    'preserves %s through both policy modes and native sanitization', name => {
      vi.stubEnv(name, '/toolchains/custom');
      for (const inherit of ['all', 'core'] as const) {
        const env = new ShellEnvPolicy({ inherit }).buildEnv(getFilteredEnv());
        expect(sanitizeEnvVars(env as Record<string, string>)[name]).toBe('/toolchains/custom');
      }
    },
  );

  it('continues to reject secrets, injection variables and arbitrary toolchain prefixes', () => {
    for (const name of ['RUSTUP_TOKEN', 'CARGO_REGISTRY_TOKEN', 'GOPRIVATE', 'JAVA_TOOL_OPTIONS',
      'NVM_AUTH', 'NODE_OPTIONS', 'PYTHONPATH', 'LD_PRELOAD', 'LMR_SHIM_LOG']) {
      vi.stubEnv(name, 'must-not-pass');
      expect(getFilteredEnv()[name]).toBeUndefined();
    }
    vi.stubEnv('CARGO_HOME', 'sk-' + 'a'.repeat(30));
    expect(getFilteredEnv().CARGO_HOME).toBeUndefined();
    vi.stubEnv('RUSTUP_HOME', '/toolchains/\ncustom');
    expect(getFilteredEnv().RUSTUP_HOME).toBe('/toolchains/custom');
    expect(new ShellEnvPolicy({ exclude: ['RUSTUP_HOME'] }).buildEnv(getFilteredEnv()).RUSTUP_HOME)
      .toBeUndefined();
  });
});
