import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { sanitizeEnvVars, BLOCKED_ENV_VARS, BLOCKED_ENV_PREFIXES } from '../../src/security/env-blocklist.js';

describe('env-blocklist', () => {
  describe('sanitizeEnvVars', () => {
    it('removes LD_PRELOAD but keeps PATH', () => {
      const result = sanitizeEnvVars({
        LD_PRELOAD: '/tmp/evil.so',
        PATH: '/usr/bin',
      });
      expect(result).not.toHaveProperty('LD_PRELOAD');
      expect(result).toHaveProperty('PATH', '/usr/bin');
    });

    it('removes GIT_AUTHOR_NAME (prefix match) but keeps HOME', () => {
      const result = sanitizeEnvVars({
        GIT_AUTHOR_NAME: 'attacker',
        HOME: '/home/user',
      });
      expect(result).not.toHaveProperty('GIT_AUTHOR_NAME');
      expect(result).toHaveProperty('HOME', '/home/user');
    });

    it('strips NODE_OPTIONS and NODE_PATH (arbitrary-code injection via --require/--import)', () => {
      const result = sanitizeEnvVars({
        NODE_OPTIONS: '--require /tmp/evil.js',
        NODE_PATH: '/tmp/evil-modules',
        PATH: '/usr/bin',
      });
      expect(result).not.toHaveProperty('NODE_OPTIONS');
      expect(result).not.toHaveProperty('NODE_PATH');
      expect(result).toHaveProperty('PATH', '/usr/bin');
    });

    it('lists NODE_OPTIONS/NODE_PATH in BLOCKED_ENV_VARS (regression guard)', () => {
      expect(BLOCKED_ENV_VARS.has('NODE_OPTIONS')).toBe(true);
      expect(BLOCKED_ENV_VARS.has('NODE_PATH')).toBe(true);
    });

    it('removes GLIBC_TUNABLES', () => {
      const result = sanitizeEnvVars({
        GLIBC_TUNABLES: 'glibc.malloc.check=2',
      });
      expect(result).not.toHaveProperty('GLIBC_TUNABLES');
    });

    it('removes _JAVA_OPTIONS and JAVA_TOOL_OPTIONS', () => {
      const result = sanitizeEnvVars({
        _JAVA_OPTIONS: '-Xmx512m',
        JAVA_TOOL_OPTIONS: '-javaagent:/tmp/evil.jar',
        LANG: 'en_US.UTF-8',
      });
      expect(result).not.toHaveProperty('_JAVA_OPTIONS');
      expect(result).not.toHaveProperty('JAVA_TOOL_OPTIONS');
      expect(result).toHaveProperty('LANG', 'en_US.UTF-8');
    });

    it('removes DYLD_INSERT_LIBRARIES', () => {
      const result = sanitizeEnvVars({
        DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      });
      expect(result).not.toHaveProperty('DYLD_INSERT_LIBRARIES');
    });

    it('removes NPM_CONFIG_REGISTRY (prefix match)', () => {
      const result = sanitizeEnvVars({
        NPM_CONFIG_REGISTRY: 'https://evil.example.com',
        NPM_CONFIG_CACHE: '/tmp/.npm',
        NODE_ENV: 'production',
      });
      expect(result).not.toHaveProperty('NPM_CONFIG_REGISTRY');
      expect(result).not.toHaveProperty('NPM_CONFIG_CACHE');
      expect(result).toHaveProperty('NODE_ENV', 'production');
    });

    it('returns empty object for empty env', () => {
      const result = sanitizeEnvVars({});
      expect(result).toEqual({});
    });

    it('does not remove safe vars (HOME, PATH, TERM, NODE_ENV)', () => {
      const env = {
        HOME: '/home/user',
        PATH: '/usr/local/bin:/usr/bin:/bin',
        TERM: 'xterm-256color',
        NODE_ENV: 'development',
      };
      const result = sanitizeEnvVars(env);
      expect(result).toEqual(env);
    });

    it('removes all build tool injection vars', () => {
      const result = sanitizeEnvVars({
        GRADLE_OPTS: '-Dorg.gradle.jvmargs=-Xmx2g',
        MAVEN_OPTS: '-Xmx1g',
        SBT_OPTS: '-Xmx512m',
        ANT_OPTS: '-Xmx256m',
      });
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('removes .NET injection vars', () => {
      const result = sanitizeEnvVars({
        DOTNET_STARTUP_HOOKS: '/tmp/evil.dll',
        DOTNET_SHARED_STORE: '/tmp/evil',
      });
      expect(result).not.toHaveProperty('DOTNET_STARTUP_HOOKS');
      expect(result).not.toHaveProperty('DOTNET_SHARED_STORE');
    });

    it('removes PYTHONBREAKPOINT', () => {
      const result = sanitizeEnvVars({
        PYTHONBREAKPOINT: 'evil_module.set_trace',
      });
      expect(result).not.toHaveProperty('PYTHONBREAKPOINT');
    });

    it('removes multiple GIT_ prefixed vars', () => {
      const result = sanitizeEnvVars({
        GIT_DIR: '/tmp/.git',
        GIT_WORK_TREE: '/tmp',
        GIT_SSH_COMMAND: 'evil-ssh',
      });
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('BLOCKED_ENV_VARS', () => {
    it('is a Set containing the expected exact matches', () => {
      expect(BLOCKED_ENV_VARS).toBeInstanceOf(Set);
      expect(BLOCKED_ENV_VARS.has('LD_PRELOAD')).toBe(true);
      expect(BLOCKED_ENV_VARS.has('_JAVA_OPTIONS')).toBe(true);
      expect(BLOCKED_ENV_VARS.has('DYLD_INSERT_LIBRARIES')).toBe(true);
      expect(BLOCKED_ENV_VARS.has('GLIBC_TUNABLES')).toBe(true);
    });
  });

  describe('BLOCKED_ENV_PREFIXES', () => {
    it('is an array containing GIT_ and NPM_CONFIG_', () => {
      expect(BLOCKED_ENV_PREFIXES).toContain('GIT_');
      expect(BLOCKED_ENV_PREFIXES).toContain('NPM_CONFIG_');
    });
  });
});
