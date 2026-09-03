import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const roots: string[] = [];

function runDev(args: string[], cwd: string, home: string): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, path.join(repoRoot, 'src', 'index.ts'), ...args], {
      cwd,
      env: {
        ...process.env,
        CODEBUDDY_DISABLE_MCP: 'true',
        HOME: home,
        USERPROFILE: home,
        LOG_LEVEL: 'error',
        NO_COLOR: '1',
        CODEBUDDY_PROVIDER: 'grok',
        GROK_API_KEY: 'gk18-unused',
        GROK_BASE_URL: 'http://127.0.0.1:1/v1',
        GROK_MODEL: 'gk18-unused',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ exitCode: null, stdout, stderr: `${stderr}\nTIMED_OUT` });
    }, 20000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('buddy dev run resume', () => {
  it('exits 1 without contacting a provider when no objective and no PLAN.md', async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, '.gk18-run-'));
    roots.push(root);
    const cwd = path.join(root, 'toy');
    const home = path.join(root, 'home');
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"toy","private":true}\n');

    const result = await runDev(['dev', 'run'], cwd, home);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode, text).toBe(1);
    expect(text).toMatch(/PLAN\.md/);
    expect(text).not.toMatch(/missing required argument/);
  });
});
