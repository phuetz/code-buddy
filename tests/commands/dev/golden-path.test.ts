import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attemptPullRequest,
  buildConventionalCommitMessage,
  conventionalCommitNamedFiles,
  formatDevPlan,
  isConventionalCommitMessage,
  isLocalGitRemote,
  isMeaningfulPlan,
  isPlanOnlyPrompt,
  isShellWriteCommand,
  parseDevPlan,
  parseGitStatusPorcelain,
  readDevPlan,
  resolveRunObjective,
  stripGuardNoise,
  workflowExitCode,
  writeDevPlan,
} from '../../../src/commands/dev/golden-path.js';

const temps: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk18-golden-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('stripGuardNoise / isMeaningfulPlan', () => {
  it('rejects empty and guard-only output', () => {
    expect(isMeaningfulPlan('')).toBe(false);
    expect(isMeaningfulPlan('   ')).toBe(false);
    expect(
      isMeaningfulPlan(
        '[workflow-guard] This task has 5 distinct actions. Consider initialising a plan first: call the `plan` tool.',
      ),
    ).toBe(false);
    expect(stripGuardNoise('[workflow-guard] nope\n\n')).toBe('');
  });

  it('accepts a numbered implementation plan', () => {
    const plan = [
      '1. Edit src/add.js — return a + b instead of a - b',
      '2. Re-run npm test',
      '3. Leave ciGate red until fix-ci',
    ].join('\n');
    expect(isMeaningfulPlan(plan)).toBe(true);
  });
});

describe('PLAN.md persist / resume', () => {
  it('writes and re-reads the objective', () => {
    const cwd = tmpDir();
    const filePath = writeDevPlan(cwd, 'corrige le bug', '1. Fix add()\n2. Re-test');
    expect(filePath).toBe(path.join(cwd, 'PLAN.md'));
    const parsed = parseDevPlan(fs.readFileSync(filePath, 'utf8'));
    expect(parsed.objective).toBe('corrige le bug');
    const loaded = readDevPlan(cwd);
    expect(loaded?.objective).toBe('corrige le bug');
    expect(loaded?.body).toContain('Fix add()');
  });

  it('formatDevPlan always starts with a title and Objective line', () => {
    const md = formatDevPlan('corrige le bug', '1. step');
    expect(md).toMatch(/^# Plan\n\nObjective: corrige le bug\n/);
  });

  it('resolveRunObjective prefers CLI then PLAN.md and errors if neither', () => {
    const cwd = tmpDir();
    expect(resolveRunObjective('from-cli', cwd)).toEqual({ objective: 'from-cli', source: 'cli' });
    expect(() => resolveRunObjective(undefined, cwd)).toThrow(/PLAN\.md/);
    writeDevPlan(cwd, 'corrige le bug', '1. Fix add()');
    expect(resolveRunObjective(undefined, cwd)).toEqual({ objective: 'corrige le bug', source: 'plan' });
  });
});

describe('exit codes and plan-only detection', () => {
  it('fails closed on failed/cancelled workflows', () => {
    expect(workflowExitCode('completed')).toBe(0);
    expect(workflowExitCode('failed')).toBe(1);
    expect(workflowExitCode('cancelled')).toBe(1);
  });

  it('detects golden-path plan-only prompts', () => {
    expect(isPlanOnlyPrompt('Do NOT implement yet. Plan only.')).toBe(true);
    expect(isPlanOnlyPrompt('Start with PLAN only. List exactly what you will do.')).toBe(true);
    expect(isPlanOnlyPrompt('Implement the fix now')).toBe(false);
  });
});

describe('conventional commit', () => {
  it('builds a conventional subject', () => {
    const msg = buildConventionalCommitMessage('fix', 'corrige le bug');
    expect(isConventionalCommitMessage(msg)).toBe(true);
    expect(msg).toBe('fix: corrige le bug');
  });

  it('parses porcelain into named files and skips .codebuddy runtime', () => {
    expect(parseGitStatusPorcelain(' M src.js\n?? .codebuddy/\n')).toEqual(['src.js']);
    expect(parseGitStatusPorcelain('?? PLAN.md\n')).toEqual(['PLAN.md']);
  });

  it('commits named files and refuses git add -A by only adding listed paths', () => {
    const cwd = tmpDir();
    execFileSync('git', ['init', '-b', 'main'], { cwd, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'gk18@test'], { cwd, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'GK18'], { cwd, stdio: 'pipe' });
    fs.writeFileSync(path.join(cwd, 'src.js'), 'module.exports = 1\n');
    fs.mkdirSync(path.join(cwd, '.codebuddy', 'index'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.codebuddy', 'index', 'workspace.bin'), 'nope');
    execFileSync('git', ['add', 'src.js'], { cwd, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'chore: init'], { cwd, stdio: 'pipe' });
    fs.writeFileSync(path.join(cwd, 'src.js'), 'module.exports = 2\n');
    fs.writeFileSync(path.join(cwd, '.codebuddy', 'repoProfile.json'), '{}');

    const result = conventionalCommitNamedFiles(cwd, 'fix: corrige le bug');
    expect(result.committed, JSON.stringify(result)).toBe(true);
    expect(result.files).toEqual(['src.js']);
    const show = execFileSync('git', ['show', '--name-only', '--pretty=format:%s', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    });
    expect(show).toContain('fix: corrige le bug');
    expect(show).toContain('src.js');
    expect(show).not.toContain('repoProfile.json');
  });
});

describe('PR fail-closed vs local remote', () => {
  it('classifies remotes', () => {
    expect(isLocalGitRemote('/tmp/gk18-remote.git')).toBe(true);
    expect(isLocalGitRemote('file:///tmp/gk18-remote.git')).toBe(true);
    expect(isLocalGitRemote('https://github.com/phuetz/code-buddy.git')).toBe(false);
    expect(isLocalGitRemote('git@github.com:phuetz/code-buddy.git')).toBe(false);
  });

  it('prints title/body and does not claim a GitHub PR when gh fails on a github origin', () => {
    const cwd = tmpDir();
    execFileSync('git', ['init', '-b', 'main'], { cwd, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'gk18@test'], { cwd, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'GK18'], { cwd, stdio: 'pipe' });
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'a\n');
    execFileSync('git', ['add', 'a.txt'], { cwd, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'chore: init'], { cwd, stdio: 'pipe' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/toy.git'], { cwd, stdio: 'pipe' });

    const attempt = attemptPullRequest(cwd, 'fix: corrige le bug', '## Summary\n- bug', () => ({
      ok: false,
      output: 'gh: not authenticated (gk18 stub)',
    }));
    expect(attempt.created).toBe(false);
    expect(attempt.pushed).toBe(false);
    expect(attempt.title).toBe('fix: corrige le bug');
    expect(attempt.body).toContain('## Summary');
    expect(attempt.error).toMatch(/not authenticated/);
  });

  it('pushes to a local bare remote when gh is missing', () => {
    const cwd = tmpDir();
    const remote = path.join(cwd, 'remote.git');
    const work = path.join(cwd, 'work');
    fs.mkdirSync(work);
    execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
    execFileSync('git', ['init', '-b', 'main'], { cwd: work, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'gk18@test'], { cwd: work, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'GK18'], { cwd: work, stdio: 'pipe' });
    fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: work, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'chore: init'], { cwd: work, stdio: 'pipe' });
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: work, stdio: 'pipe' });

    const attempt = attemptPullRequest(work, 'fix: corrige le bug', 'body', () => ({
      ok: false,
      output: 'gh: not authenticated',
    }));
    expect(attempt.created).toBe(false);
    expect(attempt.pushed).toBe(true);
    const remoteHead = execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'], {
      encoding: 'utf8',
    }).trim();
    const workHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim();
    expect(remoteHead).toBe(workHead);
  });
});

describe('WritePolicy.strict: shell writes', () => {
  it('detects redirect/heredoc/tee writes and allows read-only commands', () => {
    expect(isShellWriteCommand('echo x > src/add.js')).toBe(true);
    expect(isShellWriteCommand('cat <<EOF > src/add.js\nEOF')).toBe(true);
    expect(isShellWriteCommand('tee src/add.js')).toBe(true);
    expect(isShellWriteCommand('npm test')).toBe(false);
    expect(isShellWriteCommand('git status --porcelain')).toBe(false);
  });
});
