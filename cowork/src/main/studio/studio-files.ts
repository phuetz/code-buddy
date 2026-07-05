import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface StudioFileResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface StudioTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: StudioTreeNode[];
}

const IGNORED_NAMES = new Set(['node_modules', '.git', 'dist', 'build', '.next']);

function fail<T>(error: string): StudioFileResult<T> {
  return { ok: false, error };
}

function ok<T>(data: T): StudioFileResult<T> {
  return { ok: true, data };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function safeJoin(root: string, relPath: string): string | null {
  if (!root || relPath.includes('\0')) return null;
  if (path.isAbsolute(relPath)) return null;
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, relPath || '.');
  const relative = path.relative(normalizedRoot, target);
  if (relative === '') return target;
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

async function buildTree(root: string, absoluteDir: string, relDir = ''): Promise<StudioTreeNode[]> {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const nodes: StudioTreeNode[] = [];
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const relPath = toPosix(path.join(relDir, entry.name));
    const absolutePath = safeJoin(root, relPath);
    if (!absolutePath) continue;
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: relPath, type: 'directory', children: await buildTree(root, absolutePath, relPath) });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: relPath, type: 'file' });
    }
  }
  return nodes.sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name));
}

export async function readProjectFile(root: string, relPath: string): Promise<StudioFileResult<string>> {
  try {
    const target = safeJoin(root, relPath);
    if (!target) return fail('Invalid path');
    return ok(await fs.readFile(target, 'utf8'));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function writeProjectFile(root: string, relPath: string, content: string): Promise<StudioFileResult<{ path: string }>> {
  try {
    const target = safeJoin(root, relPath);
    if (!target) return fail('Invalid path');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    return ok({ path: relPath });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function listProjectTree(root: string): Promise<StudioFileResult<StudioTreeNode[]>> {
  try {
    const target = safeJoin(root, '.');
    if (!target) return fail('Invalid root');
    return ok(await buildTree(target, target));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function createFile(root: string, relPath: string): Promise<StudioFileResult<{ path: string }>> {
  try {
    const target = safeJoin(root, relPath);
    if (!target) return fail('Invalid path');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '', { flag: 'wx' });
    return ok({ path: relPath });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function renameEntry(root: string, from: string, to: string): Promise<StudioFileResult<{ from: string; to: string }>> {
  try {
    const source = safeJoin(root, from);
    const target = safeJoin(root, to);
    if (!source || !target) return fail('Invalid path');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
    return ok({ from, to });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function deleteEntry(root: string, relPath: string): Promise<StudioFileResult<{ path: string }>> {
  try {
    const target = safeJoin(root, relPath);
    if (!target || target === path.resolve(root)) return fail('Invalid path');
    await fs.rm(target, { recursive: true, force: true });
    return ok({ path: relPath });
  } catch (error) {
    return fail(errorMessage(error));
  }
}
