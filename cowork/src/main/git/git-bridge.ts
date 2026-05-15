/**
 * GitBridge — Phase 3 step 2
 *
 * Light wrapper around the `git` CLI for the cowork GUI: status,
 * stage/unstage, diff, commit, branch info. Uses execFileSync with
 * array arguments (no shell interpolation).
 *
 * @module main/git/git-bridge
 */

import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { logWarn } from '../utils/logger';

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'unmerged'
  | 'unknown';

export interface GitFileEntry {
  path: string;
  oldPath?: string;
  indexStatus: GitFileStatus;
  workingStatus: GitFileStatus;
  staged: boolean;
}

export interface GitRepoStatus {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileEntry[];
  error?: string;
}

export interface GitDiffEntry {
  path: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  linesAdded: number;
  linesRemoved: number;
  excerpt: string;
}

export interface GitWorktreeEntry {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

function mapStatusCode(code: string): GitFileStatus {
  switch (code) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case '?':
      return 'untracked';
    case 'U':
      return 'unmerged';
    case ' ':
      return 'unknown';
    default:
      return 'unknown';
  }
}

function runGit(cwd: string, args: string[], opts: { timeout?: number } = {}): string {
  return execFileSync('git', args, {
    cwd,
    timeout: opts.timeout ?? 5000,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });
}

export class GitBridge {
  private countDiffLines(excerpt: string): { linesAdded: number; linesRemoved: number } {
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const line of excerpt.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) linesAdded += 1;
      if (line.startsWith('-')) linesRemoved += 1;
    }
    return { linesAdded, linesRemoved };
  }

  private parseWorktrees(raw: string): GitWorktreeEntry[] {
    const worktrees: GitWorktreeEntry[] = [];
    let current: Partial<GitWorktreeEntry> = {};

    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? '',
            head: current.head ?? '',
            bare: Boolean(current.bare),
            detached: Boolean(current.detached),
            locked: Boolean(current.locked),
            prunable: Boolean(current.prunable),
          });
        }
        current = { path: line.slice('worktree '.length) };
        continue;
      }
      if (line.startsWith('HEAD ')) {
        current.head = line.slice('HEAD '.length);
        continue;
      }
      if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
        continue;
      }
      if (line === 'bare') {
        current.bare = true;
        continue;
      }
      if (line === 'detached') {
        current.detached = true;
        continue;
      }
      if (line.startsWith('locked')) {
        current.locked = true;
        continue;
      }
      if (line.startsWith('prunable')) {
        current.prunable = true;
      }
    }

    if (current.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? '',
        head: current.head ?? '',
        bare: Boolean(current.bare),
        detached: Boolean(current.detached),
        locked: Boolean(current.locked),
        prunable: Boolean(current.prunable),
      });
    }

    return worktrees;
  }

  /** Resolve the top-level git directory for `cwd` (or null if not a repo). */
  getRepoRoot(cwd: string): string | null {
    try {
      return runGit(cwd, ['rev-parse', '--show-toplevel']).trim();
    } catch {
      return null;
    }
  }

  /** High-level status: branch, upstream, ahead/behind, changed files. */
  getStatus(cwd: string): GitRepoStatus {
    const root = this.getRepoRoot(cwd);
    if (!root) {
      return {
        isRepo: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        files: [],
      };
    }

    try {
      const raw = runGit(root, ['status', '--porcelain=v1', '--branch', '-z']);
      return this.parseStatus(raw, root);
    } catch (err) {
      logWarn('[GitBridge] getStatus failed:', (err as Error).message);
      return {
        isRepo: true,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        files: [],
        error: (err as Error).message,
      };
    }
  }

  private parseStatus(raw: string, _root: string): GitRepoStatus {
    const out: GitRepoStatus = {
      isRepo: true,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
    };

    // Porcelain v1 with -z uses NUL separators. First record is branch info
    // prefixed with "## ".
    const parts = raw.split('\0').filter((p) => p.length > 0);
    let i = 0;
    if (parts[0]?.startsWith('## ')) {
      const branchLine = parts[0].slice(3);
      // Examples:
      //   main...origin/main
      //   main...origin/main [ahead 2]
      //   HEAD (no branch)
      const branchMatch = branchLine.match(/^([^.\s]+)(?:\.\.\.([^\s]+))?(?:\s+\[(.+)\])?/);
      if (branchMatch) {
        out.branch = branchMatch[1];
        out.upstream = branchMatch[2] ?? null;
        const extra = branchMatch[3];
        if (extra) {
          const aheadM = extra.match(/ahead (\d+)/);
          const behindM = extra.match(/behind (\d+)/);
          if (aheadM) out.ahead = parseInt(aheadM[1], 10);
          if (behindM) out.behind = parseInt(behindM[1], 10);
        }
      }
      i++;
    }

    while (i < parts.length) {
      const record = parts[i];
      if (record.length < 3) {
        i++;
        continue;
      }
      const xy = record.slice(0, 2);
      const rest = record.slice(3);
      const X = xy[0];
      const Y = xy[1];

      // Renamed: record is `R  new` then the old name is the next NUL field.
      let fileName = rest;
      let oldName: string | undefined;
      if (X === 'R' || Y === 'R') {
        oldName = parts[i + 1];
        i += 2;
      } else {
        i++;
      }

      const indexStatus = X === '?' ? 'untracked' : mapStatusCode(X);
      const workingStatus = mapStatusCode(Y);
      out.files.push({
        path: fileName,
        oldPath: oldName,
        indexStatus,
        workingStatus,
        staged: X !== ' ' && X !== '?',
      });
    }

    return out;
  }

  /** Stage one or more files. */
  stage(cwd: string, files: string[]): { success: boolean; error?: string } {
    const root = this.getRepoRoot(cwd);
    if (!root) return { success: false, error: 'Not a git repository' };
    try {
      runGit(root, ['add', '--', ...files]);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Unstage one or more files (reset from index). */
  unstage(cwd: string, files: string[]): { success: boolean; error?: string } {
    const root = this.getRepoRoot(cwd);
    if (!root) return { success: false, error: 'Not a git repository' };
    try {
      runGit(root, ['reset', 'HEAD', '--', ...files]);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Get unified diff for a path. staged=true → index vs HEAD. */
  diff(cwd: string, file: string, staged: boolean): string {
    const root = this.getRepoRoot(cwd);
    if (!root) return '';
    try {
      const args = staged ? ['diff', '--cached', '--', file] : ['diff', '--', file];
      return runGit(root, args, { timeout: 8000 });
    } catch (err) {
      logWarn('[GitBridge] diff failed:', (err as Error).message);
      return '';
    }
  }

  /** Compare two committed revisions and return file-level diffs. */
  compareCommits(cwd: string, fromCommit: string, toCommit: string): GitDiffEntry[] {
    const root = this.getRepoRoot(cwd);
    if (!root || !fromCommit || !toCommit) return [];

    try {
      const raw = runGit(root, ['diff', '--name-status', '--find-renames', fromCommit, toCommit]);

      return raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const parts = line.split('\t');
          const status = parts[0] ?? '';
          const code = status[0];
          const action =
            code === 'A' ? 'create' : code === 'D' ? 'delete' : code === 'R' ? 'rename' : 'modify';
          const path = code === 'R' ? (parts[2] ?? parts[1] ?? '') : (parts[1] ?? '');
          let excerpt = '';

          try {
            excerpt = runGit(
              root,
              ['diff', '--find-renames', '--unified=3', fromCommit, toCommit, '--', path],
              { timeout: 8000 }
            );
            if (!excerpt.trim()) {
              excerpt = runGit(
                root,
                ['diff', '--find-renames', '--summary', fromCommit, toCommit, '--', path],
                { timeout: 8000 }
              );
            }
          } catch {
            excerpt = '';
          }

          const { linesAdded, linesRemoved } = this.countDiffLines(excerpt);
          return {
            path,
            action,
            linesAdded,
            linesRemoved,
            excerpt,
          } satisfies GitDiffEntry;
        });
    } catch (err) {
      logWarn('[GitBridge] compareCommits failed:', (err as Error).message);
      return [];
    }
  }

  listWorktrees(cwd: string): GitWorktreeEntry[] {
    const root = this.getRepoRoot(cwd);
    if (!root) return [];

    try {
      const raw = runGit(root, ['worktree', 'list', '--porcelain']);
      return this.parseWorktrees(raw);
    } catch (err) {
      logWarn('[GitBridge] listWorktrees failed:', (err as Error).message);
      return [];
    }
  }

  addWorktree(
    cwd: string,
    targetPath: string,
    branch?: string
  ): { success: boolean; error?: string; path?: string; branch?: string } {
    const root = this.getRepoRoot(cwd);
    if (!root) return { success: false, error: 'Not a git repository' };

    const resolvedPath = path.resolve(cwd, targetPath);
    if (fs.existsSync(resolvedPath)) {
      return { success: false, error: `Path already exists: ${resolvedPath}` };
    }

    const nextBranch = branch?.trim() || path.basename(resolvedPath);
    const args = ['worktree', 'add'];

    try {
      runGit(root, ['rev-parse', '--verify', nextBranch], { timeout: 3000 });
      args.push(resolvedPath, nextBranch);
    } catch {
      args.push('-b', nextBranch, resolvedPath);
    }

    try {
      runGit(root, args, { timeout: 10000 });
      return { success: true, path: resolvedPath, branch: nextBranch };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  removeWorktree(
    cwd: string,
    targetPath: string,
    force = false
  ): { success: boolean; error?: string } {
    const root = this.getRepoRoot(cwd);
    if (!root) return { success: false, error: 'Not a git repository' };

    const resolvedTarget = path.resolve(targetPath);
    const currentRoot = this.getRepoRoot(cwd);
    if (currentRoot && path.resolve(currentRoot) === resolvedTarget) {
      return { success: false, error: 'Cannot remove the current worktree' };
    }

    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(resolvedTarget);

    try {
      runGit(root, args, { timeout: 10000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  pruneWorktrees(cwd: string): { success: boolean; output?: string; error?: string } {
    const root = this.getRepoRoot(cwd);
    if (!root) return { success: false, error: 'Not a git repository' };

    try {
      const dryRun = runGit(root, ['worktree', 'prune', '--dry-run'], { timeout: 8000 });
      if (!dryRun.trim()) {
        return { success: true, output: 'No prunable worktrees found.' };
      }
      runGit(root, ['worktree', 'prune'], { timeout: 8000 });
      return { success: true, output: dryRun.trim() };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Create a commit from the currently staged files. */
  commit(
    cwd: string,
    message: string,
    opts: { amend?: boolean } = {}
  ): { success: boolean; error?: string; hash?: string } {
    const root = this.getRepoRoot(cwd);
    if (!root) return { success: false, error: 'Not a git repository' };
    if (!message || message.trim().length === 0) {
      return { success: false, error: 'Empty commit message' };
    }
    try {
      const args = ['commit', '-m', message];
      if (opts.amend) args.push('--amend');
      runGit(root, args, { timeout: 10000 });
      const hash = runGit(root, ['rev-parse', 'HEAD']).trim();
      return { success: true, hash };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** Suggest a commit message from the staged diff using a simple
   * heuristic (summary of changed files + primary verb). This keeps
   * the bridge independent from the LLM; the renderer can still call
   * the agent for an AI-generated message when needed. */
  suggestMessage(cwd: string): string | null {
    const status = this.getStatus(cwd);
    if (!status.isRepo) return null;
    const staged = status.files.filter((f) => f.staged);
    if (staged.length === 0) return null;

    const added = staged.filter((f) => f.indexStatus === 'added').length;
    const modified = staged.filter((f) => f.indexStatus === 'modified').length;
    const deleted = staged.filter((f) => f.indexStatus === 'deleted').length;
    const renamed = staged.filter((f) => f.indexStatus === 'renamed').length;

    const parts: string[] = [];
    if (added > 0) parts.push(`add ${added} file${added > 1 ? 's' : ''}`);
    if (modified > 0) parts.push(`update ${modified} file${modified > 1 ? 's' : ''}`);
    if (deleted > 0) parts.push(`remove ${deleted} file${deleted > 1 ? 's' : ''}`);
    if (renamed > 0) parts.push(`rename ${renamed} file${renamed > 1 ? 's' : ''}`);

    const firstFile = staged[0];
    const scope = path.basename(path.dirname(firstFile.path)) || 'repo';
    return `${parts.join(', ')} in ${scope}`;
  }

  /** List local branches. */
  listBranches(cwd: string): string[] {
    const root = this.getRepoRoot(cwd);
    if (!root) return [];
    try {
      const raw = runGit(root, ['branch', '--format=%(refname:short)']);
      return raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }
}

let instance: GitBridge | null = null;
export function getGitBridge(): GitBridge {
  if (!instance) instance = new GitBridge();
  return instance;
}
