import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeGitRepo, makeTempRoot, writeWorkspaceConfig } from './helpers.js';

const originalCwd = process.cwd();
const originalWorkspaceEnv = process.env.CODEBUDDY_WORKSPACE;
const root = makeTempRoot();

afterAll(() => {
  process.chdir(originalCwd);
  if (originalWorkspaceEnv === undefined) delete process.env.CODEBUDDY_WORKSPACE;
  else process.env.CODEBUDDY_WORKSPACE = originalWorkspaceEnv;
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('conditional workspace tool exposure', () => {
  it('keeps tools absent without opt-in and exposes them only with a valid workspace', async () => {
    const project = makeGitRepo(root, 'project');
    const external = makeGitRepo(root, 'external');
    writeWorkspaceConfig(path.join(project, '.codebuddy', 'workspace.json'), [
      { name: 'external', path: external },
    ]);
    process.chdir(project);
    delete process.env.CODEBUDDY_WORKSPACE;
    const { initializeToolRegistry } = await import('../../src/codebuddy/tools.js');
    const { getToolRegistry } = await import('../../src/tools/registry.js');
    initializeToolRegistry();

    const disabled = getToolRegistry().getEnabledTools().map((tool) => tool.function.name);
    expect(disabled).not.toContain('workspace_search');
    expect(disabled).not.toContain('workspace_read');

    process.env.CODEBUDDY_WORKSPACE = 'true';
    const enabled = getToolRegistry().getEnabledTools().map((tool) => tool.function.name);
    expect(enabled).toContain('workspace_search');
    expect(enabled).toContain('workspace_read');
  });
});
