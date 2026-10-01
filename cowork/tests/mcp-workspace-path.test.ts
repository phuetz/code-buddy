import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveContainedPath, readContainedFile } from '../src/main/mcp/workspace-path.js';

describe('workspace-path', () => {
  let tmpBase: string;
  let workspaceDir: string;
  let secretDir: string;

  beforeEach(() => {
    tmpBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-mcp-test-')));
    workspaceDir = path.join(tmpBase, 'projet');
    secretDir = path.join(tmpBase, 'projet-secret');

    fs.mkdirSync(workspaceDir);
    fs.mkdirSync(secretDir);

    fs.writeFileSync(path.join(workspaceDir, 'a.txt'), 'hello from a');
    fs.writeFileSync(path.join(secretDir, 'cle.txt'), 'super secret');
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('rejects absolute paths', () => {
    expect(() => resolveContainedPath(workspaceDir, '/etc/passwd')).toThrow(/Absolute paths not allowed/);
  });

  it('allows valid contained file reading', async () => {
    const content = await readContainedFile(workspaceDir, 'a.txt');
    expect(content).toBe('hello from a');
  });

  it('rejects path traversal to sibling with same prefix', async () => {
    // This replicates the vulnerability
    // In old logic: workspaceDir = /.../projet, filePath = ../projet-secret/cle.txt
    // path.resolve(workspaceDir, filePath) -> /.../projet-secret/cle.txt
    // /.../projet-secret/cle.txt startsWith /.../projet == TRUE
    expect(() => resolveContainedPath(workspaceDir, '../projet-secret/cle.txt')).toThrow(/Path traversal detected/);

    await expect(readContainedFile(workspaceDir, '../projet-secret/cle.txt')).rejects.toThrow(/Path traversal detected/);
  });

  it.skipIf(process.platform === 'win32')('rejects symlink pointing outside workspace', async () => {
    const symlinkPath = path.join(workspaceDir, 'lien');
    fs.symlinkSync(secretDir, symlinkPath, 'dir');

    expect(() => resolveContainedPath(workspaceDir, 'lien/cle.txt')).toThrow(/Path traversal detected/);
    await expect(readContainedFile(workspaceDir, 'lien/cle.txt')).rejects.toThrow(/Path traversal detected/);
  });
});
