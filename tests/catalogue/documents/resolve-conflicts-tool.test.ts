import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ResolveConflictsExecuteTool } from '../../../src/tools/registry/merge-conflict-tools';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cb-test-conflict-'));
  vi.stubEnv('HOME', tmpDir);
  vi.stubEnv('CODEBUDDY_HOME', tmpDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

test('resolve_conflicts tool resolves a git merge conflict', async () => {
  // 1. init repo
  execSync('git init -b main', { cwd: tmpDir });
  execSync('git config user.email "test@example.com"', { cwd: tmpDir });
  execSync('git config user.name "Test User"', { cwd: tmpDir });

  // 2. Base commit
  const conflictFilePath = path.join(tmpDir, 'file.txt');
  await fs.promises.writeFile(conflictFilePath, 'Base\n', 'utf8');
  execSync('git add file.txt', { cwd: tmpDir });
  execSync('git commit -m "base"', { cwd: tmpDir });
  
  // 3. Branch feature
  execSync('git checkout -b feature', { cwd: tmpDir });
  await fs.promises.writeFile(conflictFilePath, 'Base\nFeature\n', 'utf8');
  execSync('git add file.txt', { cwd: tmpDir });
  execSync('git commit -m "feature"', { cwd: tmpDir });
  
  // 4. Branch main (make divergent)
  execSync('git checkout main', { cwd: tmpDir });
  await fs.promises.writeFile(conflictFilePath, 'Base\nMain\n', 'utf8');
  execSync('git add file.txt', { cwd: tmpDir });
  execSync('git commit -m "main"', { cwd: tmpDir });
  
  // 5. Merge feature into main (conflict)
  expect(() => execSync('git merge feature', { cwd: tmpDir })).toThrow();
  
  // verify conflict is present
  const conflictedContent = await fs.promises.readFile(conflictFilePath, 'utf8');
  expect(conflictedContent).toContain('<<<<<<< HEAD');
  
  // spy on process.cwd to return tmpDir securely
  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  
  try {
    const tool = new ResolveConflictsExecuteTool();
    const result = await tool.execute({
      file_path: 'file.txt',
      strategy: 'ours'
    });
    
    expect(result.success).toBe(true);
    
    // 7. verify conflict is resolved (using 'ours' which is main's version)
    const resolvedContent = await fs.promises.readFile(conflictFilePath, 'utf8');
    expect(resolvedContent).not.toContain('<<<<<<< HEAD');
    expect(resolvedContent).toContain('Main');
    expect(resolvedContent).not.toContain('Feature');
  } finally {
    cwdSpy.mockRestore();
  }
});
