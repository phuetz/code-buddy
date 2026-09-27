import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { describe, expect, it } from 'vitest';
import { GitSummaryTool } from '../../src/tools/git-summary-tool.js';
const execFileAsync = promisify(execFile);
async function git(root: string, args: string[]) { await execFileAsync('git', ['-C', root, ...args]); }
describe('GitSummaryTool', () => {
  it('summarizes a real git repository without mutating it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'git-summary-tool-'));
    await git(root, ['init']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await git(root, ['config', 'user.name', 'Test User']);
    await fs.writeFile(path.join(root, 'tracked.txt'), 'hello\n');
    await git(root, ['add', 'tracked.txt']);
    await git(root, ['commit', '-m', 'initial commit']);
    await fs.writeFile(path.join(root, 'tracked.txt'), 'changed\n');
    await fs.writeFile(path.join(root, 'new.txt'), 'new\n');
    const result = await new GitSummaryTool().execute({ root });
    expect(result.success).toBe(true);
    const data = result.data as { isRepo: boolean; modified: number; untracked: number; lastCommit?: { subject: string } };
    expect(data.isRepo).toBe(true);
    expect(data.modified).toBe(1);
    expect(data.untracked).toBe(1);
    expect(data.lastCommit?.subject).toBe('initial commit');
  });
  it('returns failure when not a git repository', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'git-summary-tool-not-repo-'));
    const result = await new GitSummaryTool().execute({ root });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Not a git repository');
  });
});
