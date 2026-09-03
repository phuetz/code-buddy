import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { readStdinIfPiped } from '../../../src/commands/dev/golden-path.js';

const repoRoot = process.cwd();
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('readStdinIfPiped', () => {
  it('returns null on a TTY', async () => {
    const stdin = Readable.from([]) as unknown as NodeJS.ReadStream;
    (stdin as { isTTY?: boolean }).isTTY = true;
    await expect(readStdinIfPiped(stdin, 50)).resolves.toBeNull();
  });

  it('returns null when a pipe delivers no byte before the timeout', async () => {
    const stdin = new Readable({ read() { /* never push */ } }) as unknown as NodeJS.ReadStream;
    (stdin as { isTTY?: boolean }).isTTY = false;
    const started = Date.now();
    const result = await readStdinIfPiped(stdin, 80);
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('returns piped bytes when they arrive', async () => {
    const stdin = Readable.from(['CI failed: ciGate is red\n']) as unknown as NodeJS.ReadStream;
    (stdin as { isTTY?: boolean }).isTTY = false;
    await expect(readStdinIfPiped(stdin, 200)).resolves.toContain('ciGate is red');
  });
});

describe('buddy dev fix-ci stdin', () => {
  it('exits 1 quickly when stdin is an open pipe with no data (does not hang)', async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, '.gk18-fixci-'));
    roots.push(root);
    const cwd = path.join(root, 'toy');
    const home = path.join(root, 'home');
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"toy","private":true}\n');

    const started = Date.now();
    const result = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        tsxCli,
        path.join(repoRoot, 'src', 'index.ts'),
        'dev',
        'fix-ci',
      ], {
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
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ exitCode: null, stdout, stderr: `${stderr}\nTIMED_OUT` });
      }, 8000);
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('exit', (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr });
      });
    });

    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode, text).toBe(1);
    expect(text).toMatch(/--log|stdin/i);
    expect(Date.now() - started, text).toBeLessThan(6000);
    expect(text).not.toMatch(/TIMED_OUT/);
  });
});
