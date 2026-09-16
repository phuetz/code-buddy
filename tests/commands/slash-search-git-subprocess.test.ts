/**
 * Recette slash 2026-09-14 — real ripgrep/git processes on the same fixture as
 * the PTY campaign (one commit + an uncommitted `// QA_CHANGE` line).
 *
 * - /search reported "No matches" because ripgrep, spawned without a path and
 *   with a non-TTY stdin, searched stdin instead of the project.
 * - /scan-todos never answered: same ripgrep call through `exec`, whose stdin
 *   pipe never closes, so the scan waited forever.
 * - /conflicts scan blamed git for every scan: the ESM module called an
 *   undefined `require`, and the catch-all reported "git not available".
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSearch } from '../../src/commands/handlers/extra-handlers.js';
import { handleConflicts } from '../../src/commands/handlers/conflicts-handler.js';
import { CommentWatcher } from '../../src/tools/comment-watcher.js';

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: os.devnull, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };

function git(cwd: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', ['-c', 'user.name=Code Buddy QA', '-c', 'user.email=qa@example.invalid', ...args], {
    cwd, env: gitEnv, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function mustGit(cwd: string, ...args: string[]): void {
  const result = git(cwd, ...args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

function createFixture(root: string): string {
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'invoice.js'), 'export function total(price, quantity) { return price * quantity; }\n// TODO: add a zero quantity test\n');
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'slash-qa-fixture', type: 'module' }));
  mustGit(project, 'init', '-q');
  mustGit(project, 'add', '.');
  mustGit(project, 'commit', '-qm', 'fixture');
  fs.appendFileSync(path.join(project, 'invoice.js'), '// QA_CHANGE: pending local change\n');
  return project;
}

describe('slash commands against real ripgrep/git processes', () => {
  let root: string;
  let project: string;
  const savedCeiling = process.env.GIT_CEILING_DIRECTORIES;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-slash-real-'));
    // Never let git discover a repository above the temporary fixture.
    process.env.GIT_CEILING_DIRECTORIES = root;
    project = createFixture(root);
    vi.spyOn(process, 'cwd').mockReturnValue(project);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = savedCeiling;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('/search finds the uncommitted marker present in the working tree', async () => {
    const result = await handleSearch(['QA_CHANGE']);

    expect(result.entry?.content).toContain('Search results for "QA_CHANGE"');
    expect(result.entry?.content).toContain('invoice.js:3:// QA_CHANGE: pending local change');
  });

  it('/search still reports a genuine absence as no match', async () => {
    const result = await handleSearch([['ABSENT', 'MARKER', 'zz'].join('_')]);

    expect(result.entry?.content).toContain('No matches found for');
  });

  it('/conflicts scan does not use CommonJS require, which is undefined in the ESM build', () => {
    // Vitest provides `require`, so the runtime tests below cannot see this
    // failure; the published ESM `dist` threw and reported "git not available".
    const source = fs.readFileSync(new URL('../../src/tools/merge-conflict-tool.ts', import.meta.url), 'utf-8');
    expect(source).not.toMatch(/(^|[^.\w])require\(/m);
  });

  it('/conflicts scan distinguishes a valid repository without conflicts from a git failure', async () => {
    const result = await handleConflicts(['scan']);

    expect(result.entry?.content).toBe('No files with merge conflicts found.');
  });

  it('/conflicts scan explains when the directory is not a git work tree', async () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    vi.mocked(process.cwd).mockReturnValue(outside);

    const result = await handleConflicts(['scan']);

    expect(result.entry?.content).toMatch(/^Unable to scan for conflicts: .*not a git repository/i);
  });

  it('/conflicts scan lists a real merge conflict with its marker count', async () => {
    mustGit(project, 'checkout', '-q', '--', 'invoice.js');
    const base = git(project, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
    mustGit(project, 'checkout', '-q', '-b', 'theirs');
    fs.writeFileSync(path.join(project, 'invoice.js'), 'export const side = "theirs";\n');
    mustGit(project, 'commit', '-qam', 'theirs');
    mustGit(project, 'checkout', '-q', base);
    fs.writeFileSync(path.join(project, 'invoice.js'), 'export const side = "ours";\n');
    mustGit(project, 'commit', '-qam', 'ours');
    expect(git(project, 'merge', 'theirs').status).not.toBe(0);

    const result = await handleConflicts(['scan']);

    expect(result.entry?.content).toContain('Files with merge conflicts:');
    expect(result.entry?.content).toContain('invoice.js: 1 conflict(s)');
  });

  it('/scan-todos completes with ripgrep and finds AI-directed comments with absolute paths', async () => {
    fs.appendFileSync(path.join(project, 'invoice.js'), '// AI: handle a zero quantity\n');

    const watcher = new CommentWatcher(project);
    const comments = await watcher.scanProject();

    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      file: path.join(project, 'invoice.js'),
      line: 4,
      content: 'handle a zero quantity',
    });
    expect(watcher.formatComments()).toContain('invoice.js');
  }, 15_000);

  it('/scan-todos answers honestly when only plain TODO comments exist', async () => {
    const watcher = new CommentWatcher(project);

    await expect(watcher.scanProject()).resolves.toEqual([]);
    expect(watcher.formatComments()).toContain('No AI-directed comments found');
  }, 15_000);
});
