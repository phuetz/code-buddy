/**
 * Real-git tests must not depend on the host git configuration: a throwaway
 * profile has no user.name/user.email, and an operator config may sign commits
 * or set hooks. `useHermeticGit()` points git at an empty temp global config
 * (no system config) and, unless `identity: false`, provides a QA identity.
 * Every variable is restored after each test.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';

const KEYS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const;

export function useHermeticGit(options: { identity?: boolean } = {}): void {
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
  let dir = '';

  beforeEach(() => {
    for (const key of KEYS) saved[key] = process.env[key];
    dir = mkdtempSync(path.join(os.tmpdir(), 'hermetic-git-'));
    const globalConfig = path.join(dir, 'gitconfig');
    // useConfigOnly: never guess an identity from the host name, so "no identity" is deterministic.
    writeFileSync(globalConfig, '[user]\n\tuseConfigOnly = true\n[init]\n\tdefaultBranch = main\n');
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const) delete process.env[key];
    if (options.identity !== false) {
      process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Cowork QA';
      process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'cowork-qa@example.invalid';
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });
}
