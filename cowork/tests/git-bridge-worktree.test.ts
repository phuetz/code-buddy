import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitBridge } from '../src/main/git/git-bridge';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const tmpDirs: string[] = [];
const normalizePath = (value: string) => value.replace(/\\/g, '/');

describe('GitBridge worktrees', () => {
  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates, lists, and removes a worktree', () => {
    const sandbox = mkdtempSync(path.join(os.tmpdir(), 'cowork-git-worktree-'));
    const repo = path.join(sandbox, 'repo');
    const worktree = path.join(sandbox, 'feature-auth');
    tmpDirs.push(sandbox);

    mkdirSync(repo, { recursive: true });
    git(repo, ['init']);
    git(repo, ['config', 'user.name', 'Cowork Tests']);
    git(repo, ['config', 'user.email', 'cowork-tests@example.com']);
    writeFileSync(path.join(repo, 'README.md'), 'base\n', 'utf8');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-m', 'initial']);

    const bridge = new GitBridge();
    const addResult = bridge.addWorktree(repo, worktree, 'feature/auth');
    expect(addResult.success).toBe(true);
    expect(addResult.path).toBe(path.resolve(worktree));
    expect(addResult.branch).toBe('feature/auth');

    const worktrees = bridge.listWorktrees(repo);
    expect(worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: normalizePath(path.resolve(repo)) }),
        expect.objectContaining({
          path: normalizePath(path.resolve(worktree)),
          branch: 'feature/auth',
        }),
      ])
    );

    const removeResult = bridge.removeWorktree(repo, worktree);
    expect(removeResult).toEqual({ success: true });
    expect(bridge.listWorktrees(repo)).toHaveLength(1);
  });

  it('refuses to remove the current worktree', () => {
    const sandbox = mkdtempSync(path.join(os.tmpdir(), 'cowork-git-worktree-'));
    const repo = path.join(sandbox, 'repo');
    tmpDirs.push(sandbox);

    mkdirSync(repo, { recursive: true });
    git(repo, ['init']);
    git(repo, ['config', 'user.name', 'Cowork Tests']);
    git(repo, ['config', 'user.email', 'cowork-tests@example.com']);
    writeFileSync(path.join(repo, 'README.md'), 'base\n', 'utf8');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-m', 'initial']);

    const bridge = new GitBridge();
    const removeResult = bridge.removeWorktree(repo, repo);
    expect(removeResult.success).toBe(false);
    expect(removeResult.error).toContain('Cannot remove the current worktree');
  });

  it('keeps worktree prune no-op output visible', () => {
    const sandbox = mkdtempSync(path.join(os.tmpdir(), 'cowork-git-worktree-'));
    const repo = path.join(sandbox, 'repo');
    tmpDirs.push(sandbox);

    mkdirSync(repo, { recursive: true });
    git(repo, ['init']);
    git(repo, ['config', 'user.name', 'Cowork Tests']);
    git(repo, ['config', 'user.email', 'cowork-tests@example.com']);
    writeFileSync(path.join(repo, 'README.md'), 'base\n', 'utf8');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-m', 'initial']);

    const bridge = new GitBridge();
    const result = bridge.pruneWorktrees(repo);

    expect(result).toEqual({ success: true, output: 'No prunable worktrees found.' });
  });
});
