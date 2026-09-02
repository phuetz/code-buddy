import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { exportSkill } from '../../src/skills/skill-exchange.js';

const repoRoot = process.cwd();
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('skills exchange install CLI lifecycle', () => {
  it('returns after installing a trusted package', () => {
    const root = fs.mkdtempSync(path.join(repoRoot, '.r17-exchange-cli-'));
    roots.push(root);
    const home = path.join(root, 'home');
    const source = path.join(root, '.codebuddy', 'skills', 'authored-lifecycle-demo');
    const registry = path.join(root, 'registry');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), [
      '---',
      'name: authored-lifecycle-demo',
      'description: Exchange lifecycle test skill.',
      'version: 1.0.0',
      '---',
      '',
      '# Lifecycle demo',
      '',
    ].join('\n'), 'utf8');

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousExchange = process.env.CODEBUDDY_SKILL_EXCHANGE;
    const previousCwd = process.cwd();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.CODEBUDDY_SKILL_EXCHANGE = 'true';
    process.chdir(root);
    const manifest = exportSkill('authored-lifecycle-demo', registry);
    const packageDir = path.join(registry, 'authored-lifecycle-demo');

    try {
      const result = spawnSync(process.execPath, [
        tsxCli,
        path.join(repoRoot, 'src', 'index.ts'),
        'skills',
        'exchange',
        'install',
        packageDir,
        '--trust',
        '--json',
      ], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          CODEBUDDY_DISABLE_MCP: 'true',
          LOG_LEVEL: 'error',
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
        windowsHide: true,
      });

      expect(manifest.name).toBe('authored-lifecycle-demo');
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ name: 'imported-authored-lifecycle-demo' });
    } finally {
      process.chdir(previousCwd);
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      if (previousExchange === undefined) delete process.env.CODEBUDDY_SKILL_EXCHANGE;
      else process.env.CODEBUDDY_SKILL_EXCHANGE = previousExchange;
    }
  });
});
