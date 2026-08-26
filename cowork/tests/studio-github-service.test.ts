/**
 * GithubService — real git in a temp dir, `gh`/`which` intercepted (G3).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GithubService, sanitizeRepoName } from '../src/main/studio/github-service.js';

const realExec = promisify(execFile);

type ExecFn = typeof realExec;

/** Intercept only `which/where gh` and `gh …`; delegate `git …` to real git. */
function fakeExec(ghAvailable: boolean): ExecFn {
  return (async (cmd: string, args: readonly string[] = [], opts?: unknown) => {
    if (cmd === 'which' || cmd === 'where') {
      if (args[0] === 'gh') {
        if (ghAvailable) return { stdout: '/usr/bin/gh\n', stderr: '' };
        throw new Error('gh not found');
      }
      return realExec(cmd, args as string[], opts as never);
    }
    if (cmd === 'gh') {
      if (args[0] === 'auth') return { stdout: 'Logged in to github.com\n', stderr: '' };
      if (args[0] === 'repo' && args[1] === 'create') {
        const name = args[2];
        return { stdout: `Created repository user/${name}\nhttps://github.com/user/${name}\n`, stderr: '' };
      }
      throw new Error(`unexpected gh args: ${args.join(' ')}`);
    }
    return realExec(cmd, args as string[], opts as never);
  }) as ExecFn;
}

async function tmpProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-gh-'));
  await writeFile(path.join(root, 'index.html'), '<h1>hi</h1>');
  return root;
}

describe('sanitizeRepoName', () => {
  it('strips invalid characters and collapses dashes', () => {
    expect(sanitizeRepoName('My Cool App!!')).toBe('My-Cool-App');
    expect(sanitizeRepoName('  spaces  ')).toBe('spaces');
    expect(sanitizeRepoName('')).toBe('app-studio-project');
  });
});

describe('GithubService.push', () => {
  it('initialises git, commits, and pushes via gh when available', async () => {
    const root = await tmpProject();
    const service = new GithubService(fakeExec(true));

    const result = await service.push({ root, name: 'demo-app' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mode).toBe('pushed');
    expect(result.data.url).toBe('https://github.com/user/demo-app');
    // Real git ran: .git and .gitignore exist.
    await expect(stat(path.join(root, '.git'))).resolves.toBeDefined();
    await expect(stat(path.join(root, '.gitignore'))).resolves.toBeDefined();
  });

  it('falls back to manual instructions when gh is unavailable', async () => {
    const root = await tmpProject();
    const service = new GithubService(fakeExec(false));

    const result = await service.push({ root, name: 'no-gh' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mode).toBe('manual');
    expect(result.data.instructions?.some((line) => line.includes('gh repo create'))).toBe(true);
  });

  it('rejects an invalid root', async () => {
    const service = new GithubService(fakeExec(true));
    const result = await service.push({ root: '' });
    expect(result).toEqual({ ok: false, error: 'Invalid project root' });
  });
});
