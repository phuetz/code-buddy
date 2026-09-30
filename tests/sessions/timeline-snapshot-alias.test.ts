import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const gitExec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync: gitExec }));

import { listWorkingTreeFiles } from '../../src/sessions/timeline-snapshot.js';

describe('timeline snapshot alias', () => {
  let base: string;
  let repo: string;
  let alias: string;

  beforeAll(() => {
    if (process.platform === 'win32') return;
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-snapshot-alias-'));
    repo = path.join(base, 'repo');
    alias = path.join(base, 'alias');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'tracked\n');
    fs.writeFileSync(path.join(repo, 'ignored.txt'), 'ignored\n');
    fs.symlinkSync(repo, alias, 'dir');
  });

  afterAll(() => {
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  it('uses the Git file list when cwd is an alias of the Git root', (ctx) => {
    if (process.platform === 'win32') ctx.skip();
    gitExec.mockImplementation((_command: string, args: string[]) => {
      if (args.includes('--show-toplevel')) return `${repo}\n`;
      if (args.includes('ls-files')) return '.gitignore\0tracked.txt\0';
      throw new Error('unexpected git command');
    });

    const files = listWorkingTreeFiles(alias);
    expect(files).toContain('.gitignore');
    expect(files).toContain('tracked.txt');
    expect(files).not.toContain('ignored.txt');
    expect(gitExec).toHaveBeenCalledWith(
      'git',
      ['-C', alias, 'ls-files', '-co', '--exclude-standard', '-z'],
      expect.any(Object),
    );
  });
});
