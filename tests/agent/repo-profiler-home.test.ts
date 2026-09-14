import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoProfiler } from '../../src/agent/repo-profiler.js';
import { runCartography } from '../../src/agent/repo-profiling/cartography.js';
import { getWorkspaceIndexer } from '../../src/knowledge/workspace-indexer.js';

vi.mock('../../src/agent/repo-profiling/cartography.js', () => ({ runCartography: vi.fn() }));
vi.mock('../../src/knowledge/workspace-indexer.js', () => ({
  getWorkspaceIndexer: vi.fn(() => ({ initialize: vi.fn(async () => {}), startIndexing: vi.fn(async () => {}) })),
}));

describe('prompt startup in the personal directory', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-profile-home-'));
    vi.spyOn(os, 'homedir').mockReturnValue(root);
    vi.stubEnv('CODEBUDDY_HEADLESS', 'false');
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  it('does not scan personal subdirectories or initialize embeddings', async () => {
    fs.mkdirSync(path.join(root, 'AppData'));
    fs.writeFileSync(path.join(root, 'AppData', 'private.ts'), 'const privateFile = true;');
    const profile = await new RepoProfiler(root).getProfile();
    expect(profile.cartography).toBeUndefined();
    expect(runCartography).not.toHaveBeenCalled();
    expect(getWorkspaceIndexer).not.toHaveBeenCalled();
  });
  it('still profiles a project inside the home directory', async () => {
    const project = path.join(root, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'vitest' } }));
    const profile = await new RepoProfiler(project).getProfile({ backgroundIndexing: false });
    expect(profile.commands.test).toBe('npm run test');
    expect(runCartography).toHaveBeenCalledWith(project, undefined);
    expect(getWorkspaceIndexer).not.toHaveBeenCalled();
  });
});
