import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('CLI credentials stay in the current run', () => {
  it('does not persist -k/-u during a real headless prompt without --save', () => {
    const qaRoot = path.join(repoRoot, '_qa', 'sans-grok', 'home');
    fs.mkdirSync(qaRoot, { recursive: true });
    const home = fs.realpathSync(fs.mkdtempSync(path.join(qaRoot, 'cli-no-save-')));
    const project = path.join(home, 'project');
    fs.mkdirSync(project);
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    for (const key of Object.keys(env)) {
      if (key.endsWith('_API_KEY') || [
        'CODEBUDDY_PROVIDER', 'CODEBUDDY_MODEL', 'CODEBUDDY_BASE_URL',
        'GROK_MODEL', 'GROK_BASE_URL', 'OLLAMA_HOST',
      ].includes(key)) delete env[key];
    }

    try {
      const result = spawnSync(process.execPath, [
        '--import', 'tsx', 'src/index.ts', '--directory', project,
        '-p', 'Réponds OK', '-k', 'cb-test-factice',
        '-u', 'http://127.0.0.1:1/v1', '-m', 'gpt-4o', '--output-format', 'json',
      ], { cwd: repoRoot, env, encoding: 'utf8', timeout: 30_000 });

      expect(result.error).toBeUndefined();
      expect(result.stdout + result.stderr).toContain('Connection error');
      expect(fs.existsSync(path.join(home, '.codebuddy', 'credentials.enc'))).toBe(false);
      expect(fs.existsSync(path.join(home, '.codebuddy', 'user-settings.json'))).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 40_000);
});
