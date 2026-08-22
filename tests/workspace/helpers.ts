import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Workspace } from '../../src/workspace/workspace-config.js';

export function makeTempRoot(prefix = 'codebuddy-workspace-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Canonical path spelling used by the workspace layer (`fs.realpathSync.native`
 * / `fs.promises.realpath`). On Windows it also expands 8.3 short names
 * (`RUNNER~1` → `runneradmin`), which the JS `fs.realpathSync` does not.
 */
export function canonical(target: string): string {
  return fs.realpathSync.native(target);
}

export function makeGitRepo(parent: string, name: string): string {
  const repo = path.join(parent, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  return canonical(repo);
}

export function writeWorkspaceConfig(
  configPath: string,
  repos: Array<{ name: string; path: string; description?: string }>,
): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ repos }, null, 2), 'utf8');
}

export function asWorkspace(configPath: string, repos: Array<{ name: string; path: string }>): Workspace {
  return { configPath, repos };
}
