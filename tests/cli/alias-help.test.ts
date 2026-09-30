import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('routes sessions --help to the saved-session commands, including via the thin entry', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-alias-help-'));
  try {
    for (const entry of ['src/index.ts', 'src/cli-boot.ts']) {
      const child = spawnSync(process.execPath, [
        path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve(entry),
        'sessions', '--help',
      ], {
        cwd: home,
        env: {
          PATH: process.env.PATH, HOME: home, USERPROFILE: home,
          CODEBUDDY_HOME: path.join(home, '.codebuddy'),
          GROK_HOME: path.join(home, '.codebuddy'),
          CODEBUDDY_REPO_PROFILE_READONLY: 'true', NO_COLOR: '1',
        },
        encoding: 'utf8', timeout: 30_000,
      });
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toContain('Usage: buddy session|sessions');
      expect(child.stdout).toContain('list|ls');
      expect(child.stdout).toContain('resume');
      expect(child.stdout).not.toContain('Getting started');
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}, 70_000);
