import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

export interface WorkspaceRepo {
  name: string;
  path: string;
  description?: string;
}

export interface Workspace {
  configPath: string;
  repos: WorkspaceRepo[];
}

export interface WorkspaceConfigOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface WorkspaceEntryInspection {
  name: string;
  path: string;
  description?: string;
  valid: boolean;
  normalizedPath?: string;
  reason?: string;
}

export interface WorkspaceConfigInspection {
  configPath: string | null;
  entries: WorkspaceEntryInspection[];
  error?: string;
}

interface RawWorkspaceConfig {
  repos: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Canonical spelling of a path, shared by every comparison in this module and
 * by the workspace tools (`fs.promises.realpath`). The native realpath also
 * expands Windows 8.3 short names (`RUNNER~1` → `runneradmin`), which the pure
 * JS `fs.realpathSync` keeps — mixing the two made a project root never match
 * git's `--show-toplevel` and every repo look like a symlink escape.
 */
function canonicalPath(target: string): string {
  return fs.realpathSync.native(target);
}

function isGitRepositoryRoot(candidate: string): boolean {
  try {
    const topLevel = execFileSync(
      'git',
      ['-C', candidate, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return canonicalPath(topLevel) === candidate;
  } catch {
    return false;
  }
}

function findGitRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      try {
        const canonical = canonicalPath(current);
        if (isGitRepositoryRoot(canonical)) return canonical;
      } catch {
        // Ignore an unreadable marker and continue looking at parent directories.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveWorkspaceConfigPath(
  options: WorkspaceConfigOptions & { forWrite?: boolean } = {},
): string | null {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const repoRoot = findGitRoot(cwd);
  const projectConfig = repoRoot
    ? path.join(repoRoot, '.codebuddy', 'workspace.json')
    : null;
  const userConfig = path.join(homeDir, '.codebuddy', 'workspace.json');

  if (projectConfig && fs.existsSync(projectConfig)) return projectConfig;
  if (fs.existsSync(userConfig)) return userConfig;
  if (options.forWrite && projectConfig) return projectConfig;
  return null;
}

function parseWorkspaceConfig(configPath: string): RawWorkspaceConfig {
  const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!isRecord(parsed) || !Array.isArray(parsed.repos)) {
    throw new Error('workspace.json must contain a repos array');
  }
  return { repos: parsed.repos };
}

function inspectEntry(rawValue: unknown, index: number, configPath: string): WorkspaceEntryInspection {
  if (!isRecord(rawValue)) {
    return { name: `entry-${index + 1}`, path: '', valid: false, reason: 'entry must be an object' };
  }
  const raw = rawValue;
  const fallbackName = typeof raw.name === 'string' ? raw.name : `entry-${index + 1}`;
  const fallbackPath = typeof raw.path === 'string' ? raw.path : '';

  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    return { name: fallbackName, path: fallbackPath, valid: false, reason: 'name must be a non-empty string' };
  }
  if (typeof raw.path !== 'string' || raw.path.trim() === '') {
    return { name: raw.name.trim(), path: fallbackPath, valid: false, reason: 'path must be a non-empty string' };
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    return { name: raw.name.trim(), path: raw.path, valid: false, reason: 'description must be a string' };
  }

  const requestedPath = path.isAbsolute(raw.path)
    ? path.resolve(raw.path)
    : path.resolve(path.dirname(configPath), raw.path);
  if (!fs.existsSync(requestedPath)) {
    return { name: raw.name.trim(), path: raw.path, valid: false, reason: 'path does not exist' };
  }

  let normalizedPath: string;
  try {
    normalizedPath = canonicalPath(requestedPath);
    if (!fs.statSync(normalizedPath).isDirectory()) {
      return { name: raw.name.trim(), path: raw.path, valid: false, reason: 'path is not a directory' };
    }
  } catch (error) {
    return {
      name: raw.name.trim(),
      path: raw.path,
      valid: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (!isGitRepositoryRoot(normalizedPath)) {
    return { name: raw.name.trim(), path: raw.path, valid: false, reason: 'path is not a git repository' };
  }

  return {
    name: raw.name.trim(),
    path: raw.path,
    ...(raw.description !== undefined ? { description: raw.description } : {}),
    valid: true,
    normalizedPath,
  };
}

export function validateWorkspaceRepo(
  repo: WorkspaceRepo,
  configPath: string,
): WorkspaceEntryInspection {
  return inspectEntry(repo, 0, configPath);
}

export function inspectWorkspaceConfig(options: WorkspaceConfigOptions = {}): WorkspaceConfigInspection {
  const configPath = resolveWorkspaceConfigPath(options);
  if (!configPath) return { configPath: null, entries: [] };

  try {
    const raw = parseWorkspaceConfig(configPath);
    const entries = raw.repos.map((entry, index) => inspectEntry(entry, index, configPath));
    const seenNames = new Set<string>();
    for (const entry of entries) {
      if (!entry.valid) continue;
      if (seenNames.has(entry.name)) {
        entry.valid = false;
        entry.reason = 'duplicate repo name';
        delete entry.normalizedPath;
      } else {
        seenNames.add(entry.name);
      }
    }
    return { configPath, entries };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { configPath, entries: [], error: message };
  }
}

export function getWorkspace(options: WorkspaceConfigOptions = {}): Workspace | null {
  const env = options.env ?? process.env;
  if (env.CODEBUDDY_WORKSPACE !== 'true') return null;

  const inspection = inspectWorkspaceConfig(options);
  if (!inspection.configPath) return null;
  if (inspection.error) {
    logger.warn(`Ignoring invalid workspace config: ${inspection.configPath}`, { error: inspection.error });
    return null;
  }

  const repos: WorkspaceRepo[] = [];
  for (const entry of inspection.entries) {
    if (!entry.valid || !entry.normalizedPath) {
      logger.warn(`Ignoring invalid workspace repo: ${entry.name}`, {
        path: entry.path,
        reason: entry.reason ?? 'unknown validation error',
      });
      continue;
    }
    repos.push({
      name: entry.name,
      path: entry.normalizedPath,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
    });
  }

  return repos.length > 0 ? { configPath: inspection.configPath, repos } : null;
}

export function readWorkspaceConfigForEdit(configPath: string): { repos: WorkspaceRepo[] } {
  if (!fs.existsSync(configPath)) return { repos: [] };
  const raw = parseWorkspaceConfig(configPath);
  const repos = raw.repos.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.path !== 'string') {
      throw new Error(`workspace repo entry ${index + 1} must contain string name and path fields`);
    }
    if (entry.description !== undefined && typeof entry.description !== 'string') {
      throw new Error(`workspace repo entry ${index + 1} has a non-string description`);
    }
    return {
      name: entry.name,
      path: entry.path,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
    };
  });
  return { repos };
}

export function writeWorkspaceConfig(configPath: string, repos: WorkspaceRepo[]): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({ repos }, null, 2)}\n`, 'utf8');
}
