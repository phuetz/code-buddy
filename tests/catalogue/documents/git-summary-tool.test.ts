import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { GitSummaryTool } from '../../../src/tools/git-summary-tool';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cb-test-git-summary-'));
  vi.stubEnv('HOME', tmpDir);
  vi.stubEnv('CODEBUDDY_HOME', tmpDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

test('git_summary tool reads git status correctly', async () => {
  // init repo
  execSync('git init -b main', { cwd: tmpDir });
  
  // add a file
  const file1Path = path.join(tmpDir, 'file1.txt');
  await fs.promises.writeFile(file1Path, 'test content 1', 'utf8');
  execSync('git add file1.txt', { cwd: tmpDir });
  
  // commit
  execSync('git config user.email "test@example.com"', { cwd: tmpDir });
  execSync('git config user.name "Test User"', { cwd: tmpDir });
  execSync('git commit -m "initial commit"', { cwd: tmpDir });
  
  // add untracked file
  const file2Path = path.join(tmpDir, 'file2.txt');
  await fs.promises.writeFile(file2Path, 'test content 2', 'utf8');
  
  const tool = new GitSummaryTool();
  const result = await tool.execute({ root: tmpDir });
  
  expect(result.success).toBe(true);
  console.log('[git_summary]', result.output);

  const data = (result as { data: { isRepo: boolean; branch: string; untracked: number; staged: number } }).data;
  expect(data.isRepo).toBe(true);
  expect(data.branch).toBe('main');
  expect(data.untracked).toBe(1);
  expect(data.staged).toBe(0);
  expect(String(result.output)).toContain('Git main: 0 modified, 0 staged, 1 untracked');
});
