import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Windows resolves os.homedir() from USERPROFILE, never from HOME. The flag
// exercises that contract on Linux, where homedir() follows HOME.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const homedir = () =>
    process.env.CI_PORTABLE_WIN32_HOME === '1' ? process.env.USERPROFILE! : actual.homedir();
  return { ...actual, homedir, default: { ...actual, homedir } };
});

import { createShadowCommand } from '../../src/commands/shadow.js';
import { ShadowWorkspace } from '../../src/speculative/shadow-workspace.js';
import { canonicalPath } from '../setup/platform-fixtures.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function createRepo(testRoot: string): string {
  const repo = path.join(testRoot, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'gk29-shadow@example.test');
  git(repo, 'config', 'user.name', 'GK29 Shadow');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'committed-v1\n');
  git(repo, 'add', 'tracked.txt');
  git(repo, 'commit', '-m', 'initial');
  return repo;
}

describe('buddy shadow list/clean', () => {
  let testRoot: string;
  let repo: string;
  let shadowBase: string;
  let previousHome: string | undefined;
  let previousUserProfile: string | undefined;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gk29-shadow-'));
    repo = createRepo(testRoot);
    shadowBase = path.join(testRoot, 'home', '.codebuddy', 'shadow');
    previousHome = process.env.HOME;
    previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = path.join(testRoot, 'home');
    // The CLI resolves its store from os.homedir(): HOME alone leaves the real
    // user store in play on Windows, where homedir() reads USERPROFILE.
    process.env.USERPROFILE = path.join(testRoot, 'home');
    process.env.CODEBUDDY_SHADOW_CMD = 'node -e "process.exit(0)"';
    delete process.env.CODEBUDDY_SHADOW_WORKSPACE;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    delete process.env.CODEBUDDY_SHADOW_CMD;
    delete process.env.CODEBUDDY_SHADOW_WORKSPACE;
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('exposes list and clean beside status and run', () => {
    const names = createShadowCommand().commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(['status', 'run', 'list', 'clean']));
  });

  it('lists a created ghost worktree and clean removes it without touching the real repo', async () => {
    const workspace = new ShadowWorkspace(repo, undefined, shadowBase);
    const before = execFileSync('sha256sum', [path.join(repo, 'tracked.txt')], { encoding: 'utf8' });
    const result = await workspace.runSpeculative([{ path: 'tracked.txt', content: 'ghost-only\n' }]);
    expect(result.ok).toBe(true);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    await createShadowCommand().parseAsync(['node', 'shadow', 'list', '-d', repo]);
    const listed = logs.join('\n');
    expect(listed).toMatch(/shadow/i);
    // list prints the origin recorded from git's toplevel, always canonical.
    expect(listed).toContain(canonicalPath(repo));

    logs.length = 0;
    await createShadowCommand().parseAsync(['node', 'shadow', 'clean', '-d', repo]);
    const cleaned = logs.join('\n');
    expect(cleaned.toLowerCase()).toMatch(/removed|cleaned|deleted/);

    const status = await workspace.getStatus();
    expect(status.exists).toBe(false);
    expect(execFileSync('sha256sum', [path.join(repo, 'tracked.txt')], { encoding: 'utf8' })).toBe(before);
    expect(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8')).toBe('committed-v1\n');
  });
});
