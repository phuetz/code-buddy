import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/utils/logger.js';
import {
  getWorkspace,
  resolveWorkspaceConfigPath,
} from '../../src/workspace/workspace-config.js';
import { canonical, makeGitRepo, makeTempRoot, writeWorkspaceConfig } from './helpers.js';

const roots: string[] = [];
const originalWorkspaceEnv = process.env.CODEBUDDY_WORKSPACE;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWorkspaceEnv === undefined) delete process.env.CODEBUDDY_WORKSPACE;
  else process.env.CODEBUDDY_WORKSPACE = originalWorkspaceEnv;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('workspace configuration', () => {
  it('prefers the current project config over the user config', () => {
    const root = makeTempRoot();
    roots.push(root);
    const project = makeGitRepo(root, 'project');
    const projectRepo = makeGitRepo(root, 'project-repo');
    const userRepo = makeGitRepo(root, 'user-repo');
    const home = path.join(root, 'home');
    const projectConfig = path.join(project, '.codebuddy', 'workspace.json');
    writeWorkspaceConfig(projectConfig, [{ name: 'project', path: projectRepo }]);
    writeWorkspaceConfig(path.join(home, '.codebuddy', 'workspace.json'), [{ name: 'user', path: userRepo }]);

    expect(resolveWorkspaceConfigPath({ cwd: project, homeDir: home })).toBe(projectConfig);
    process.env.CODEBUDDY_WORKSPACE = 'true';
    expect(getWorkspace({ cwd: project, homeDir: home })?.repos.map((repo) => repo.name)).toEqual(['project']);
  });

  it('ignores invalid entries, warns, and normalizes valid paths with realpath', () => {
    const root = makeTempRoot();
    roots.push(root);
    const project = makeGitRepo(root, 'project');
    const validRepo = makeGitRepo(root, 'valid');
    const repoLink = path.join(root, 'valid-link');
    fs.symlinkSync(validRepo, repoLink, 'dir');
    const nonGit = path.join(root, 'not-git');
    fs.mkdirSync(nonGit);
    writeWorkspaceConfig(path.join(project, '.codebuddy', 'workspace.json'), [
      { name: 'missing', path: path.join(root, 'missing') },
      { name: 'plain', path: nonGit },
      { name: 'valid', path: repoLink },
    ]);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    process.env.CODEBUDDY_WORKSPACE = 'true';

    const workspace = getWorkspace({ cwd: project, homeDir: path.join(root, 'home') });

    expect(workspace?.repos).toEqual([{ name: 'valid', path: canonical(validRepo) }]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('returns null when the exact environment opt-in is absent', () => {
    const root = makeTempRoot();
    roots.push(root);
    const project = makeGitRepo(root, 'project');
    const repo = makeGitRepo(root, 'repo');
    writeWorkspaceConfig(path.join(project, '.codebuddy', 'workspace.json'), [{ name: 'repo', path: repo }]);
    delete process.env.CODEBUDDY_WORKSPACE;

    expect(getWorkspace({ cwd: project, homeDir: path.join(root, 'home') })).toBeNull();
  });

  it('never throws for malformed JSON', () => {
    const root = makeTempRoot();
    roots.push(root);
    const project = makeGitRepo(root, 'project');
    const configPath = path.join(project, '.codebuddy', 'workspace.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{not-json', 'utf8');
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    process.env.CODEBUDDY_WORKSPACE = 'true';

    expect(() => getWorkspace({ cwd: project, homeDir: path.join(root, 'home') })).not.toThrow();
    expect(getWorkspace({ cwd: project, homeDir: path.join(root, 'home') })).toBeNull();
  });
});
