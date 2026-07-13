import { readdir, stat } from 'fs/promises';
import { basename, join, resolve } from 'path';

const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.git', '.cache']);

export interface FileDiscoveryOptions {
  maxDirectories?: number;
  timeoutMs?: number;
  now?: () => number;
}

export async function findFileByName(
  fileName: string,
  roots: string[],
  options: FileDiscoveryOptions = {}
): Promise<string | null> {
  if (!fileName) return null;

  const maxDirectories = options.maxDirectories ?? 500;
  const timeoutMs = options.timeoutMs ?? 500;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const queue: string[] = [];

  for (const rawRoot of roots) {
    if (!rawRoot.trim()) continue;
    const root = resolve(rawRoot);
    if (EXCLUDED_DIRECTORIES.has(basename(root).toLowerCase())) continue;
    try {
      if ((await stat(root)).isDirectory()) queue.push(root);
    } catch {
      // Skip missing or inaccessible roots.
    }
  }

  const visited = new Set<string>();
  let queueIndex = 0;
  let scannedDirectories = 0;

  while (
    queueIndex < queue.length &&
    scannedDirectories < maxDirectories &&
    now() - startedAt < timeoutMs
  ) {
    const directory = queue[queueIndex++];
    if (visited.has(directory)) continue;
    visited.add(directory);
    scannedDirectories += 1;

    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (now() - startedAt >= timeoutMs) return null;
        const fullPath = join(directory, entry.name);
        if (entry.isFile() && entry.name === fileName) return fullPath;
        if (
          entry.isDirectory() &&
          !EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())
        ) {
          queue.push(fullPath);
        }
      }
    } catch {
      // Continue past directories that disappear or become inaccessible.
    }
  }

  return null;
}
