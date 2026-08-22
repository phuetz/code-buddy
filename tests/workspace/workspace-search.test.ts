import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceSearchTool } from '../../src/tools/workspace-tools.js';
import { asWorkspace, makeGitRepo, makeTempRoot } from './helpers.js';

const roots: string[] = [];
const originalTimeout = process.env.CODEBUDDY_WORKSPACE_TIMEOUT_MS;

afterEach(() => {
  if (originalTimeout === undefined) delete process.env.CODEBUDDY_WORKSPACE_TIMEOUT_MS;
  else process.env.CODEBUDDY_WORKSPACE_TIMEOUT_MS = originalTimeout;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function fixture(): { tool: WorkspaceSearchTool; first: string; second: string } {
  const root = makeTempRoot();
  roots.push(root);
  const first = makeGitRepo(root, 'first');
  const second = makeGitRepo(root, 'second');
  fs.writeFileSync(path.join(first, 'alpha.ts'), 'export const alpha = "ecosystem-marker";\n');
  fs.writeFileSync(path.join(second, 'beta.ts'), 'export const beta = "ecosystem-marker";\n');
  const workspace = asWorkspace(path.join(root, 'workspace.json'), [
    { name: 'first', path: first },
    { name: 'second', path: second },
  ]);
  return {
    first,
    second,
    tool: new WorkspaceSearchTool({ workspaceProvider: () => workspace }),
  };
}

describe('workspace_search', () => {
  it('searches two real git repositories and prefixes both results', async () => {
    const { tool } = fixture();
    const result = await tool.execute({ query: 'ecosystem-marker' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('first:alpha.ts:1:');
    expect(result.output).toContain('second:beta.ts:1:');
  });

  it('filters by repository name', async () => {
    const { tool } = fixture();
    const result = await tool.execute({ query: 'ecosystem-marker', repos: ['second'] });

    expect(result.success).toBe(true);
    expect(result.output).not.toContain('first:');
    expect(result.output).toContain('second:beta.ts:1:');
  });

  it('enforces the aggregated max_results bound', async () => {
    const { tool, first, second } = fixture();
    fs.writeFileSync(path.join(first, 'extra.ts'), 'ecosystem-marker\n');
    fs.writeFileSync(path.join(second, 'extra.ts'), 'ecosystem-marker\n');

    const result = await tool.execute({ query: 'ecosystem-marker', max_results: 1 });

    expect(result.success).toBe(true);
    expect(result.output?.split('\n')).toHaveLength(1);
  });

  it('applies a global timeout to a slow repository search', async () => {
    const root = makeTempRoot();
    roots.push(root);
    const repo = makeGitRepo(root, 'slow');
    const workspace = asWorkspace(path.join(root, 'workspace.json'), [{ name: 'slow', path: repo }]);
    process.env.CODEBUDDY_WORKSPACE_TIMEOUT_MS = '10';
    const tool = new WorkspaceSearchTool({
      workspaceProvider: () => workspace,
      searchRepo: async () => await new Promise((resolve) => setTimeout(() => resolve([]), 100)),
    });

    const result = await tool.execute({ query: 'needle' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out after 10ms');
  });

  it('refuses traversal queries and matches outside canonical repo roots', async () => {
    const { tool } = fixture();
    const traversal = await tool.execute({ query: '../secret' });
    expect(traversal.success).toBe(false);
    expect(traversal.error).toContain('traversal');

    const root = makeTempRoot();
    roots.push(root);
    const repo = makeGitRepo(root, 'secure');
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'needle');
    const workspace = asWorkspace(path.join(root, 'workspace.json'), [{ name: 'secure', path: repo }]);
    const escapingTool = new WorkspaceSearchTool({
      workspaceProvider: () => workspace,
      searchRepo: async () => [{ file: outside, line: 1, column: 0, text: 'needle', match: 'needle' }],
    });

    const escaped = await escapingTool.execute({ query: 'needle' });
    expect(escaped.success).toBe(false);
    expect(escaped.error).toContain('escaped repository root');
  });
});
