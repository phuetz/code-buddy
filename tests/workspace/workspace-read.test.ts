import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceReadTool } from '../../src/tools/workspace-tools.js';
import { asWorkspace, makeGitRepo, makeTempRoot } from './helpers.js';

const roots: string[] = [];
const originalMaxFile = process.env.CODEBUDDY_WORKSPACE_MAX_FILE_KB;

afterEach(() => {
  if (originalMaxFile === undefined) delete process.env.CODEBUDDY_WORKSPACE_MAX_FILE_KB;
  else process.env.CODEBUDDY_WORKSPACE_MAX_FILE_KB = originalMaxFile;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function fixture(): { root: string; repo: string; tool: WorkspaceReadTool } {
  const root = makeTempRoot();
  roots.push(root);
  const repo = makeGitRepo(root, 'repo');
  const workspace = asWorkspace(path.join(root, 'workspace.json'), [{ name: 'repo', path: repo }]);
  return { root, repo, tool: new WorkspaceReadTool({ workspaceProvider: () => workspace }) };
}

describe('workspace_read', () => {
  it('reads a file with offset and limit', async () => {
    const { repo, tool } = fixture();
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'zero\none\ntwo\n');

    const result = await tool.execute({ repo: 'repo', path: 'notes.txt', offset: 1, limit: 2 });

    expect(result.success).toBe(true);
    expect(result.output).toBe('2: one\n3: two');
  });

  it('refuses ../ traversal', async () => {
    const { tool } = fixture();
    const result = await tool.execute({ repo: 'repo', path: '../outside.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('safe repository-relative path');
  });

  it('refuses a real symlink that points outside the repository', async () => {
    const { root, repo, tool } = fixture();
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'secret');
    fs.symlinkSync(outside, path.join(repo, 'outside-link.txt'));

    const result = await tool.execute({ repo: 'repo', path: 'outside-link.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('symlink outside');
  });

  it('refuses files over CODEBUDDY_WORKSPACE_MAX_FILE_KB', async () => {
    const { repo, tool } = fixture();
    process.env.CODEBUDDY_WORKSPACE_MAX_FILE_KB = '1';
    fs.writeFileSync(path.join(repo, 'large.txt'), 'x'.repeat(1025));

    const result = await tool.execute({ repo: 'repo', path: 'large.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('1KB size limit');
  });

  it('refuses an unknown repository', async () => {
    const { tool } = fixture();
    const result = await tool.execute({ repo: 'unknown', path: 'file.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown workspace repository');
  });
});
