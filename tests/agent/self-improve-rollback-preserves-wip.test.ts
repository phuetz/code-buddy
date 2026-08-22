import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgenticCodingCell } from '../../src/agent/autonomous/agentic-coding-runner.js';
import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

const execFileAsync = promisify(execFile);

describe('self-improvement rollback preserves pre-existing WIP', () => {
  let tempRoot: string;
  let repo: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cb-self-improve-wip-'));
    repo = path.join(tempRoot, 'repo');
    await mkdir(repo, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    // Windows git defaults to core.autocrlf=true, which would rewrite the
    // restored files with CRLF and break the byte-exact assertions below.
    await execFileAsync('git', ['config', 'core.autocrlf', 'false'], { cwd: repo });
    await writeFile(path.join(repo, 'README.md'), 'initial readme\n', 'utf8');
    await writeFile(path.join(repo, 'notes.txt'), 'committed notes\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md', 'notes.txt'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('restores tracked modifications and untracked files after a failed sandbox run', async () => {
    await writeFile(path.join(repo, 'notes.txt'), 'Patrice tracked WIP\n', 'utf8');
    await writeFile(path.join(repo, 'scratch.txt'), 'Patrice untracked WIP\n', 'utf8');
    const taskFile = path.join(tempRoot, 'task.json');
    await writeFile(taskFile, JSON.stringify({
      repo,
      task: 'Improve the README safely',
      allowedPaths: ['README.md', 'notes.txt', 'scratch.txt'],
      verification: ['node -e "process.exit(1)"'],
      riskLevel: 'low',
      edits: [{
        type: 'replace_text',
        path: 'README.md',
        find: 'initial readme',
        replace: 'sandbox readme',
      }],
    }, null, 2), 'utf8');

    vi.spyOn(process, 'cwd').mockReturnValue(repo);
    vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation').mockResolvedValue({
      confirmed: true,
    });
    vi.spyOn(CodeBuddyClient.prototype, 'chat').mockRejectedValue(new Error('Mock LLM error'));

    const report = await runAgenticCodingCell({
      taskFile,
      applyEdits: true,
      runVerification: true,
      runId: 'preserve-wip',
    });

    expect(report.status).toBe('blocked');
    await expect(readFile(path.join(repo, 'README.md'), 'utf8')).resolves.toBe('initial readme\n');
    await expect(readFile(path.join(repo, 'notes.txt'), 'utf8')).resolves.toBe('Patrice tracked WIP\n');
    await expect(readFile(path.join(repo, 'scratch.txt'), 'utf8')).resolves.toBe('Patrice untracked WIP\n');

    const { stdout: status } = await execFileAsync(
      'git',
      ['status', '--short', '--untracked-files=all'],
      { cwd: repo },
    );
    expect(status).toContain(' M notes.txt');
    expect(status).toContain('?? scratch.txt');
    const { stdout: branches } = await execFileAsync('git', ['branch', '--list'], { cwd: repo });
    expect(branches).not.toContain('tmp-self-improve-preserve-wip');
    const { stdout: stashes } = await execFileAsync('git', ['stash', 'list'], { cwd: repo });
    expect(stashes.trim()).toBe('');
  });
});
