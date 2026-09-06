import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const roots: string[] = [];

function runDev(args: string[], cwd: string, home: string, extraPath?: string): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, path.join(repoRoot, 'src', 'index.ts'), ...args], {
      cwd,
      env: {
        ...process.env,
        PATH: extraPath ? `${extraPath}:${process.env.PATH ?? ''}` : process.env.PATH,
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

function initRepo(work: string, origin: string): void {
  fs.mkdirSync(work, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: work, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'gk18@test'], { cwd: work, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'GK18'], { cwd: work, stdio: 'pipe' });
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: work, stdio: 'pipe' });
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fix: corrige le bug'], { cwd: work, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: work, stdio: 'pipe' });
}

describe('buddy dev pr fail-closed', () => {
  it('prints title/body and exits 1 when gh is not authenticated on a GitHub origin', async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, '.gk18-pr-'));
    roots.push(root);
    const work = path.join(root, 'work');
    const home = path.join(root, 'home');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "gh: not authenticated" >&2\nexit 1\n', { mode: 0o755 });
    initRepo(work, 'https://github.com/example/toy.git');

    const result = await runDev(['dev', 'pr'], work, home, bin);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode, text).toBe(1);
    expect(text).toMatch(/Title:/);
    expect(text).toMatch(/## Summary|corrige le bug/i);
    expect(text).toMatch(/PR not created|not authenticated/i);
    expect(text).not.toMatch(/Issue #.*resolved successfully/i);
  });

  it('pushes to a local bare remote when gh fails', async () => {
    const root = fs.mkdtempSync(path.join(repoRoot, '.gk18-pr-'));
    roots.push(root);
    const work = path.join(root, 'work');
    const home = path.join(root, 'home');
    const bin = path.join(root, 'bin');
    const remote = path.join(root, 'remote.git');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "gh: not authenticated" >&2\nexit 1\n', { mode: 0o755 });
    execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
    initRepo(work, remote);

    const result = await runDev(['dev', 'pr'], work, home, bin);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode, text).toBe(0);
    expect(text).toMatch(/Title:/);
    expect(text).toMatch(/Pushed to local origin/i);
    const remoteHead = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'], {
      encoding: 'utf8',
    }).trim();
    const workHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim();
    expect(remoteHead).toBe(workHead);
  });
});
