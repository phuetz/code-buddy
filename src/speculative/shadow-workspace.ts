/**
 * Persistent speculative git worktree used to validate proposed writes before
 * they reach the user's working tree.
 *
 * @module speculative/shadow-workspace
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_TAIL_LENGTH = 4_000;
const CAPTURE_LENGTH = OUTPUT_TAIL_LENGTH * 4;

export interface ShadowFile {
  path: string;
  /** Full resulting content. `null` represents a deletion. */
  content: string | null;
}

export interface ShadowResult {
  ok: boolean;
  exitCode: number | null;
  stdoutTail: string;
  durationMs: number;
  /** Setup/auto-detection failure: callers must fail open. */
  unavailable: boolean;
  timedOut?: boolean;
  cached?: boolean;
}

export interface ShadowStatus {
  enabled: boolean;
  repoPath: string;
  repoRoot: string | null;
  shadowPath: string | null;
  exists: boolean;
  available: boolean;
  command: string | null;
  timeoutMs: number;
  detail?: string;
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

function defaultSpawn(command: string, args: string[], options: SpawnOptions): ChildProcess {
  return spawn(command, args, options);
}

function parseTimeout(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.CODEBUDDY_SHADOW_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_TIMEOUT_MS;
}

function appendCapture(current: string, chunk: string, limit: number): string {
  const combined = current + chunk;
  return combined.length > limit ? combined.slice(-limit) : combined;
}

function outputTail(stdout: string, stderr: string): string {
  return [stdout, stderr].filter(Boolean).join('\n').slice(-OUTPUT_TAIL_LENGTH);
}

function hashPath(repoRoot: string): string {
  return createHash('sha256').update(repoRoot).digest('hex');
}

function validationCacheKey(files: ShadowFile[]): string {
  return files
    .map((file) => {
      const normalizedPath = file.path.split(path.sep).join('/');
      const digest = file.content === null
        ? 'deleted'
        : createHash('sha256').update(file.content).digest('hex');
      return `${normalizedPath}:${digest}`;
    })
    .sort()
    .join('|');
}

/**
 * One instance is intended to live for the process session. It serializes
 * runs because all proposals for a repository share the same worktree.
 */
export class ShadowWorkspace {
  private readonly requestedRepoPath: string;
  private readonly spawnFn: SpawnFn;
  private readonly shadowBaseDirectory: string;
  private readonly cache = new Map<string, ShadowResult>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    repoPath: string = process.cwd(),
    spawnFn: SpawnFn = defaultSpawn,
    shadowBaseDirectory: string = path.join(homedir(), '.codebuddy', 'shadow'),
  ) {
    this.requestedRepoPath = path.resolve(repoPath);
    this.spawnFn = spawnFn;
    this.shadowBaseDirectory = shadowBaseDirectory;
  }

  async getStatus(env: NodeJS.ProcessEnv = process.env): Promise<ShadowStatus> {
    const timeoutMs = parseTimeout(env);
    const repo = await this.resolveRepoRoot(timeoutMs);
    if (!repo.ok) {
      return {
        enabled: env.CODEBUDDY_SHADOW_WORKSPACE === 'true',
        repoPath: this.requestedRepoPath,
        repoRoot: null,
        shadowPath: null,
        exists: false,
        available: false,
        command: null,
        timeoutMs,
        detail: repo.detail,
      };
    }

    const command = await this.resolveValidationCommand(repo.root, env);
    const shadowPath = this.shadowPathFor(repo.root);
    return {
      enabled: env.CODEBUDDY_SHADOW_WORKSPACE === 'true',
      repoPath: this.requestedRepoPath,
      repoRoot: repo.root,
      shadowPath,
      exists: await this.isWorktree(shadowPath),
      available: command !== null,
      command,
      timeoutMs,
      ...(command === null ? { detail: 'no validation command detected' } : {}),
    };
  }

  async runSpeculative(files: ShadowFile[]): Promise<ShadowResult> {
    const cacheKey = validationCacheKey(files);
    const run = this.queue.then(() => this.runSerialized(files, cacheKey));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Validate all tracked modifications and untracked files in the current working tree. */
  async runWorkingTree(): Promise<ShadowResult> {
    const startedAt = Date.now();
    const timeoutMs = parseTimeout(process.env);
    const repo = await this.resolveRepoRoot(timeoutMs);
    if (!repo.ok) return this.unavailable(repo.detail, startedAt);

    const tracked = await this.runProcess(
      'git',
      ['-C', repo.root, 'diff', '--name-only', '--no-renames', '-z', 'HEAD', '--'],
      { cwd: repo.root },
      timeoutMs,
      Number.POSITIVE_INFINITY,
    );
    if (tracked.exitCode !== 0 || tracked.timedOut || tracked.error) {
      return this.unavailable(
        `unable to list tracked working tree changes: ${outputTail(tracked.stdout, tracked.stderr) || tracked.error || 'git failed'}`,
        startedAt,
      );
    }
    const untracked = await this.runProcess(
      'git',
      ['-C', repo.root, 'ls-files', '-o', '--exclude-standard', '-z'],
      { cwd: repo.root },
      timeoutMs,
      Number.POSITIVE_INFINITY,
    );
    if (untracked.exitCode !== 0 || untracked.timedOut || untracked.error) {
      return this.unavailable(
        `unable to list untracked working tree changes: ${outputTail(untracked.stdout, untracked.stderr) || untracked.error || 'git failed'}`,
        startedAt,
      );
    }

    const changedPaths = [...new Set(
      [...tracked.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean),
    )];
    const files: ShadowFile[] = [];
    try {
      for (const relativePath of changedPaths) {
        const absolutePath = path.join(repo.root, relativePath);
        try {
          files.push({ path: relativePath, content: await fs.readFile(absolutePath, 'utf8') });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') files.push({ path: relativePath, content: null });
          else throw error;
        }
      }
    } catch (error) {
      return this.unavailable(`unable to read working tree changes: ${String(error)}`, startedAt);
    }
    return this.runSpeculative(files);
  }

  private async runSerialized(files: ShadowFile[], cacheKey: string): Promise<ShadowResult> {
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, durationMs: 0, cached: true };

    const startedAt = Date.now();
    const timeoutMs = parseTimeout(process.env);
    const repo = await this.resolveRepoRoot(timeoutMs);
    if (!repo.ok) return this.unavailable(repo.detail, startedAt);

    const command = await this.resolveValidationCommand(repo.root, process.env);
    if (command === null) {
      return this.unavailable('no validation command detected; shadow validation is inactive', startedAt);
    }

    const head = await this.runProcess(
      'git',
      ['-C', repo.root, 'rev-parse', 'HEAD'],
      { cwd: repo.root },
      timeoutMs,
    );
    if (head.exitCode !== 0 || head.timedOut || head.error) {
      return this.unavailable(
        `unable to resolve repository HEAD: ${outputTail(head.stdout, head.stderr) || head.error || 'git failed'}`,
        startedAt,
      );
    }

    const headSha = head.stdout.trim();
    const shadowPath = this.shadowPathFor(repo.root);
    const setup = await this.prepareWorktree(repo.root, shadowPath, headSha, timeoutMs);
    if (!setup.ok) return this.unavailable(setup.detail, startedAt);

    try {
      for (const file of files) await this.applyProposedFile(shadowPath, file);
      await this.linkNodeModules(repo.root, shadowPath);
    } catch (error) {
      return this.unavailable(
        `unable to stage proposed files in the shadow: ${error instanceof Error ? error.message : String(error)}`,
        startedAt,
      );
    }

    const shell = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'sh';
    const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
    const validation = await this.runProcess(
      shell,
      shellArgs,
      { cwd: shadowPath, detached: process.platform !== 'win32' },
      timeoutMs,
    );
    if (validation.error) {
      return this.unavailable(`unable to start shadow validator: ${validation.error}`, startedAt);
    }
    const timedOutMessage = validation.timedOut
      ? `shadow validation timed out after ${timeoutMs}ms`
      : '';
    const tail = outputTail(validation.stdout, [validation.stderr, timedOutMessage].filter(Boolean).join('\n'));
    const result: ShadowResult = {
      ok: validation.exitCode === 0 && !validation.timedOut && !validation.error,
      exitCode: validation.exitCode,
      stdoutTail: tail,
      durationMs: Date.now() - startedAt,
      unavailable: false,
      ...(validation.timedOut ? { timedOut: true } : {}),
    };
    if (result.ok) this.cache.set(cacheKey, result);
    return result;
  }

  private async resolveRepoRoot(timeoutMs: number): Promise<{ ok: true; root: string } | { ok: false; detail: string }> {
    const result = await this.runProcess(
      'git',
      ['-C', this.requestedRepoPath, 'rev-parse', '--show-toplevel'],
      { cwd: this.requestedRepoPath },
      timeoutMs,
    );
    if (result.exitCode !== 0 || result.timedOut || result.error) {
      return {
        ok: false,
        detail: `git repository unavailable: ${outputTail(result.stdout, result.stderr) || result.error || 'git failed'}`,
      };
    }
    const root = result.stdout.trim();
    return root ? { ok: true, root: path.resolve(root) } : { ok: false, detail: 'git returned an empty repository root' };
  }

  private async resolveValidationCommand(repoRoot: string, env: NodeJS.ProcessEnv): Promise<string | null> {
    const configured = env.CODEBUDDY_SHADOW_CMD?.trim();
    if (configured) return configured;

    try {
      const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
        scripts?: Record<string, unknown>;
      };
      if (typeof packageJson.scripts?.typecheck === 'string') return 'npm run typecheck';
    } catch {
      // Missing/invalid package.json falls through to the tsconfig probe.
    }

    try {
      await fs.access(path.join(repoRoot, 'tsconfig.json'));
      return 'npx tsc --noEmit';
    } catch {
      return null;
    }
  }

  private shadowPathFor(repoRoot: string): string {
    return path.join(this.shadowBaseDirectory, hashPath(repoRoot));
  }

  private async prepareWorktree(
    repoRoot: string,
    shadowPath: string,
    headSha: string,
    timeoutMs: number,
  ): Promise<{ ok: true } | { ok: false; detail: string }> {
    if (!(await this.isWorktree(shadowPath))) {
      try {
        await fs.mkdir(this.shadowBaseDirectory, { recursive: true });
        await fs.rm(shadowPath, { recursive: true, force: true });
      } catch (error) {
        return { ok: false, detail: `unable to prepare shadow directory: ${String(error)}` };
      }
      const prune = await this.runProcess('git', ['-C', repoRoot, 'worktree', 'prune'], { cwd: repoRoot }, timeoutMs);
      if (prune.exitCode !== 0 || prune.timedOut || prune.error) {
        return { ok: false, detail: `unable to prune stale shadow metadata: ${outputTail(prune.stdout, prune.stderr) || prune.error || 'git failed'}` };
      }
      const add = await this.runProcess(
        'git',
        ['-C', repoRoot, 'worktree', 'add', '--detach', shadowPath, headSha],
        { cwd: repoRoot },
        timeoutMs,
      );
      if (add.exitCode !== 0 || add.timedOut || add.error) {
        return { ok: false, detail: `unable to create shadow worktree: ${outputTail(add.stdout, add.stderr) || add.error || 'git failed'}` };
      }
    }

    const checkout = await this.runProcess(
      'git',
      ['-C', shadowPath, 'checkout', '--detach', '--force', headSha],
      { cwd: shadowPath },
      timeoutMs,
    );
    if (checkout.exitCode !== 0 || checkout.timedOut || checkout.error) {
      return { ok: false, detail: `unable to resync shadow worktree: ${outputTail(checkout.stdout, checkout.stderr) || checkout.error || 'git failed'}` };
    }
    const clean = await this.runProcess(
      'git',
      ['-C', shadowPath, 'clean', '-ffdx'],
      { cwd: shadowPath },
      timeoutMs,
    );
    if (clean.exitCode !== 0 || clean.timedOut || clean.error) {
      return { ok: false, detail: `unable to clean shadow worktree: ${outputTail(clean.stdout, clean.stderr) || clean.error || 'git failed'}` };
    }
    return { ok: true };
  }

  private async isWorktree(shadowPath: string): Promise<boolean> {
    try {
      await fs.lstat(path.join(shadowPath, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  private async applyProposedFile(shadowRoot: string, file: ShadowFile): Promise<void> {
    if (path.isAbsolute(file.path)) throw new Error(`absolute path is not allowed: ${file.path}`);
    const target = path.resolve(shadowRoot, file.path);
    const relative = path.relative(shadowRoot, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`path escapes the shadow workspace: ${file.path}`);
    }

    const parentParts = path.dirname(relative).split(path.sep).filter((part) => part !== '.');
    let cursor = shadowRoot;
    for (const part of parentParts) {
      cursor = path.join(cursor, part);
      try {
        const stat = await fs.lstat(cursor);
        if (stat.isSymbolicLink()) throw new Error(`parent path is a symbolic link: ${file.path}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    if (file.content === null) {
      await fs.rm(target, { recursive: true, force: true });
      return;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      if ((await fs.lstat(target)).isSymbolicLink()) await fs.rm(target, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.writeFile(target, file.content, 'utf8');
  }

  private async linkNodeModules(repoRoot: string, shadowPath: string): Promise<void> {
    const source = path.join(repoRoot, 'node_modules');
    try {
      if (!(await fs.lstat(source)).isDirectory()) return;
    } catch {
      return;
    }
    const target = path.join(shadowPath, 'node_modules');
    await fs.rm(target, { recursive: true, force: true });
    await fs.symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  }

  private unavailable(detail: string, startedAt: number): ShadowResult {
    logger.warn('Shadow workspace unavailable; validation will fail open', { detail });
    return {
      ok: false,
      exitCode: null,
      stdoutTail: detail.slice(-OUTPUT_TAIL_LENGTH),
      durationMs: Date.now() - startedAt,
      unavailable: true,
    };
  }

  private runProcess(
    command: string,
    args: string[],
    options: SpawnOptions,
    timeoutMs: number,
    captureLimit: number = CAPTURE_LENGTH,
  ): Promise<ProcessResult> {
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawnFn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, error: String(error) });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout = appendCapture(stdout, chunk.toString(), captureLimit);
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr = appendCapture(stderr, chunk.toString(), captureLimit);
      });

      const finish = (result: ProcessResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid && options.detached && process.platform !== 'win32') {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        } else {
          child.kill('SIGKILL');
        }
        finish({ exitCode: null, stdout, stderr, timedOut: true });
      }, timeoutMs);
      timer.unref();

      child.once('error', (error) => {
        finish({ exitCode: null, stdout, stderr, timedOut, error: error.message });
      });
      child.once('close', (code) => {
        finish({ exitCode: code, stdout, stderr, timedOut });
      });
    });
  }
}

const sessionWorkspaces = new Map<string, ShadowWorkspace>();

export function getShadowWorkspace(repoPath: string): ShadowWorkspace {
  const key = path.resolve(repoPath);
  let workspace = sessionWorkspaces.get(key);
  if (!workspace) {
    workspace = new ShadowWorkspace(key);
    sessionWorkspaces.set(key, workspace);
  }
  return workspace;
}
