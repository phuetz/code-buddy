import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ShadowWorkspace,
  type SpawnFn,
} from '../../src/speculative/shadow-workspace.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function createRepo(testRoot: string): string {
  const repo = path.join(testRoot, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'shadow@example.test');
  git(repo, 'config', 'user.name', 'Shadow Test');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'committed-v1\n');
  git(repo, 'add', 'tracked.txt');
  git(repo, 'commit', '-m', 'initial');
  return repo;
}

describe('ShadowWorkspace', () => {
  let testRoot: string;
  let repo: string;
  let shadowBase: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-shadow-'));
    repo = createRepo(testRoot);
    shadowBase = path.join(testRoot, 'shadow-store');
    process.env.CODEBUDDY_SHADOW_CMD = 'sh -c "exit 0"';
    delete process.env.CODEBUDDY_SHADOW_TIMEOUT_MS;
    delete process.env.CODEBUDDY_SHADOW_WORKSPACE;
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_SHADOW_CMD;
    delete process.env.CODEBUDDY_SHADOW_TIMEOUT_MS;
    delete process.env.CODEBUDDY_SHADOW_WORKSPACE;
    vi.restoreAllMocks();
    vi.doUnmock('../../src/speculative/shadow-workspace.js');
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('creates lazily, writes proposals, and resyncs to the repository HEAD before each run', async () => {
    fs.mkdirSync(path.join(repo, 'node_modules'));
    fs.writeFileSync(path.join(repo, 'node_modules/dependency.txt'), 'shared dependency');
    const workspace = new ShadowWorkspace(repo, undefined, shadowBase);
    expect(fs.existsSync(shadowBase)).toBe(false);

    const first = await workspace.runSpeculative([
      { path: 'tracked.txt', content: 'speculative-v1\n' },
      { path: 'src/new.ts', content: 'export const shadow = true;\n' },
    ]);

    expect(first.ok).toBe(true);
    const status = await workspace.getStatus();
    expect(status.exists).toBe(true);
    expect(status.shadowPath).not.toBeNull();
    const shadowPath = status.shadowPath as string;
    expect(fs.readFileSync(path.join(shadowPath, 'tracked.txt'), 'utf8')).toBe('speculative-v1\n');
    expect(fs.readFileSync(path.join(shadowPath, 'src/new.ts'), 'utf8')).toBe('export const shadow = true;\n');
    expect(fs.lstatSync(path.join(shadowPath, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(shadowPath, 'node_modules/dependency.txt'), 'utf8')).toBe('shared dependency');

    fs.writeFileSync(path.join(shadowPath, 'left-by-first-run.tmp'), 'stale');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'committed-v2\n');
    git(repo, 'add', 'tracked.txt');
    git(repo, 'commit', '-m', 'update head');

    const second = await workspace.runSpeculative([
      { path: 'second.txt', content: 'second proposal\n' },
    ]);

    expect(second.ok).toBe(true);
    expect(fs.readFileSync(path.join(shadowPath, 'tracked.txt'), 'utf8')).toBe('committed-v2\n');
    expect(fs.readFileSync(path.join(shadowPath, 'second.txt'), 'utf8')).toBe('second proposal\n');
    expect(fs.existsSync(path.join(shadowPath, 'src/new.ts'))).toBe(false);
    expect(fs.existsSync(path.join(shadowPath, 'left-by-first-run.tmp'))).toBe(false);
  });

  it('reports success and failure from the configured command with its output tail', async () => {
    const workspace = new ShadowWorkspace(repo, undefined, shadowBase);
    process.env.CODEBUDDY_SHADOW_CMD = 'sh -c "printf success-marker; exit 0"';
    const passed = await workspace.runSpeculative([{ path: 'tracked.txt', content: 'passing\n' }]);

    expect(passed).toMatchObject({ ok: true, exitCode: 0, unavailable: false });
    expect(passed.stdoutTail).toContain('success-marker');

    process.env.CODEBUDDY_SHADOW_CMD = 'sh -c "printf failure-marker; exit 1"';
    const failed = await workspace.runSpeculative([{ path: 'tracked.txt', content: 'failing\n' }]);

    expect(failed).toMatchObject({ ok: false, exitCode: 1, unavailable: false });
    expect(failed.stdoutTail).toContain('failure-marker');
    expect(failed.stdoutTail.length).toBeLessThanOrEqual(4_000);
  });

  it('auto-detects and executes the package typecheck script when no command is configured', async () => {
    delete process.env.CODEBUDDY_SHADOW_CMD;
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
      scripts: { typecheck: 'node -e "process.stdout.write(\'auto-typecheck\')"' },
    }));
    git(repo, 'add', 'package.json');
    git(repo, 'commit', '-m', 'add typecheck');
    const workspace = new ShadowWorkspace(repo, undefined, shadowBase);

    const status = await workspace.getStatus();
    const result = await workspace.runSpeculative([{ path: 'tracked.txt', content: 'auto\n' }]);

    expect(status.command).toBe('npm run typecheck');
    expect(result.ok).toBe(true);
    expect(result.stdoutTail).toContain('auto-typecheck');
  });

  it('validates staged changes, deletions, and untracked files for the diagnostic run', async () => {
    fs.rmSync(path.join(repo, 'tracked.txt'));
    git(repo, 'add', 'tracked.txt');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'diagnostic-untracked\n');
    process.env.CODEBUDDY_SHADOW_CMD = 'sh -c "test ! -e tracked.txt && grep diagnostic-untracked untracked.txt"';
    const workspace = new ShadowWorkspace(repo, undefined, shadowBase);

    const result = await workspace.runWorkingTree();

    expect(result.ok).toBe(true);
    expect(result.unavailable).toBe(false);
    expect(result.stdoutTail).toContain('diagnostic-untracked');
  });

  it('fails validation with a timeout annotation when the command runs too long', async () => {
    process.env.CODEBUDDY_SHADOW_CMD = 'sh -c "printf before-sleep; sleep 2"';
    process.env.CODEBUDDY_SHADOW_TIMEOUT_MS = '200';
    const workspace = new ShadowWorkspace(repo, undefined, shadowBase);

    const result = await workspace.runSpeculative([{ path: 'tracked.txt', content: 'timeout\n' }]);

    expect(result).toMatchObject({ ok: false, unavailable: false, timedOut: true });
    expect(result.stdoutTail).toContain('before-sleep');
    expect(result.stdoutTail).toMatch(/timed out after 200ms/);
  });

  it('fails open without throwing when the requested directory is not a git repository', async () => {
    const plainDirectory = path.join(testRoot, 'not-git');
    fs.mkdirSync(plainDirectory);
    const workspace = new ShadowWorkspace(plainDirectory, undefined, shadowBase);

    await expect(workspace.runSpeculative([{ path: 'file.ts', content: 'content\n' }])).resolves.toMatchObject({
      ok: false,
      unavailable: true,
      exitCode: null,
    });
  });

  it('does not spawn again for an identical proposal that already passed', async () => {
    const spawnSpy = vi.fn<SpawnFn>((command, args, options) => spawn(command, args, options));
    const workspace = new ShadowWorkspace(repo, spawnSpy, shadowBase);
    const proposal = [{ path: 'tracked.txt', content: 'cached\n' }];

    const first = await workspace.runSpeculative(proposal);
    const spawnCount = spawnSpy.mock.calls.length;
    const second = await workspace.runSpeculative(proposal);

    expect(first.ok).toBe(true);
    expect(spawnCount).toBeGreaterThan(0);
    expect(second).toMatchObject({ ok: true, cached: true, durationMs: 0 });
    expect(spawnSpy).toHaveBeenCalledTimes(spawnCount);
  });
});

describe('shadow write-gate opt-in', () => {
  afterEach(() => {
    delete process.env.CODEBUDDY_SHADOW_WORKSPACE;
    delete process.env.CODEBUDDY_DIFF_REVIEW;
    vi.doUnmock('../../src/speculative/shadow-workspace.js');
    vi.resetModules();
  });

  it('does not instantiate a shadow workspace when the env variable is absent or false', async () => {
    delete process.env.CODEBUDDY_SHADOW_WORKSPACE;
    delete process.env.CODEBUDDY_DIFF_REVIEW;
    const getShadowWorkspace = vi.fn();
    vi.resetModules();
    vi.doMock('../../src/speculative/shadow-workspace.js', () => ({ getShadowWorkspace }));
    const { maybeReviewGatedWrite } = await import('../../src/tools/review-gate-helper.js');

    const request = {
      baseDirectory: process.cwd(),
      resolvedPath: path.join(process.cwd(), 'unwritten.ts'),
      displayPath: 'unwritten.ts',
      newContent: 'never written\n',
      intent: 'prove strict opt-in',
      originLabel: 'test',
    };
    const absentResult = await maybeReviewGatedWrite(request);
    process.env.CODEBUDDY_SHADOW_WORKSPACE = 'false';
    const falseResult = await maybeReviewGatedWrite(request);

    expect(absentResult).toEqual({ gated: false });
    expect(falseResult).toEqual({ gated: false });
    expect(getShadowWorkspace).not.toHaveBeenCalled();
  });

  it('returns a structured blocking error for a completed validation failure', async () => {
    process.env.CODEBUDDY_SHADOW_WORKSPACE = 'true';
    delete process.env.CODEBUDDY_DIFF_REVIEW;
    vi.resetModules();
    vi.doMock('../../src/speculative/shadow-workspace.js', () => ({
      getShadowWorkspace: () => ({
        runSpeculative: async () => ({
          ok: false,
          exitCode: 1,
          stdoutTail: 'targeted test failed',
          durationMs: 12,
          unavailable: false,
        }),
      }),
    }));
    const { maybeReviewGatedWrite } = await import('../../src/tools/review-gate-helper.js');

    const result = await maybeReviewGatedWrite({
      baseDirectory: process.cwd(),
      resolvedPath: path.join(process.cwd(), 'blocked.ts'),
      displayPath: 'blocked.ts',
      newContent: 'invalid proposal\n',
      intent: 'prove validation blocking',
      originLabel: 'test',
    });

    expect(result).toEqual({
      gated: true,
      ok: false,
      error: 'shadow validation failed — nothing applied\ntargeted test failed',
    });
  });

  it('fails open when the shadow module crashes unexpectedly', async () => {
    process.env.CODEBUDDY_SHADOW_WORKSPACE = 'true';
    delete process.env.CODEBUDDY_DIFF_REVIEW;
    vi.resetModules();
    vi.doMock('../../src/speculative/shadow-workspace.js', () => ({
      getShadowWorkspace: () => {
        throw new Error('simulated infrastructure fault');
      },
    }));
    const { maybeReviewGatedWrite } = await import('../../src/tools/review-gate-helper.js');

    const result = await maybeReviewGatedWrite({
      baseDirectory: process.cwd(),
      resolvedPath: path.join(process.cwd(), 'allowed.ts'),
      displayPath: 'allowed.ts',
      newContent: 'allowed after fault\n',
      intent: 'prove infrastructure fail-open',
      originLabel: 'test',
    });

    expect(result).toEqual({ gated: false });
  });
});
