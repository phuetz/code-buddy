import { resolveToolPath, getToolWorkingDirectory } from '../utils/tool-execution-context.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolResult } from '../types/index.js';

export interface DepInspectData {
  root: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  engines: Record<string, string>;
  totalDependencies: number;
  lockfile?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

async function assertRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root)) throw new Error('root must be an absolute path');
  const resolved = path.resolve(getToolWorkingDirectory(), root);
  if ([path.parse(resolved).root, '/etc', '/dev', '/proc', '/sys', '/run'].includes(resolved)) throw new Error(`Refusing unsafe root: ${resolved}`);
  const stat = await fs.lstat(resolveToolPath(resolved));
  if (!stat.isDirectory()) throw new Error(`root is not a directory: ${resolved}`);
  return resolved;
}

async function firstExisting(root: string, names: string[]): Promise<string | undefined> {
  for (const name of names) {
    try {
      await fs.access(resolveToolPath(path.join(root, name)));
      return name;
    } catch {
      // continue
    }
  }
  return undefined;
}

export class DepInspectTool {
  readonly name = 'dep_inspect';
  readonly description = 'Inspect package.json dependencies, scripts, engines, and local lockfile presence without network access.';

  async execute(input: unknown): Promise<ToolResult> {
    try {
      if (!isRecord(input)) return { success: false, error: 'Input must be an object' };
      if (typeof input.root !== 'string' || input.root.trim() === '') return { success: false, error: 'root must be a non-empty absolute path' };
      const root = await assertRoot(input.root);
      const packagePath = path.join(root, 'package.json');
      const pkg = JSON.parse(await fs.readFile(resolveToolPath(packagePath), 'utf8')) as Record<string, unknown>;
      const dependencies = stringRecord(pkg.dependencies);
      const devDependencies = stringRecord(pkg.devDependencies);
      const scripts = stringRecord(pkg.scripts);
      const engines = stringRecord(pkg.engines);
      const data: DepInspectData = {
        root,
        dependencies,
        devDependencies,
        scripts,
        engines,
        totalDependencies: Object.keys(dependencies).length + Object.keys(devDependencies).length,
        lockfile: await firstExisting(root, ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']),
      };
      return { success: true, output: `Found ${data.totalDependencies} dependencies and ${Object.keys(scripts).length} scripts`, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const DEP_INSPECT_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'dep_inspect',
    description: 'Inspect package.json dependencies, scripts, engines, and lockfile presence with no network access.',
    parameters: { type: 'object', properties: { root: { type: 'string', description: 'Absolute project root' } }, required: ['root'] },
  },
};
