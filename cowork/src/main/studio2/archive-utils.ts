import archiver from 'archiver';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';

export type Studio2Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): Studio2Result<T> {
  return { ok: true, data };
}

export function fail<T>(error: string): Studio2Result<T> {
  return { ok: false, error };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBreakingOut(relative: string): boolean {
  return relative === '..' || relative.startsWith('..' + path.sep);
}

export function safeResolve(root: string, relPath = '.'): string | null {
  if (!root || root.includes('\0') || relPath.includes('\0')) return null;
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, relPath || '.');
  const relative = path.relative(normalizedRoot, target);
  if (relative === '') return target;
  if (isBreakingOut(relative) || path.isAbsolute(relative)) return null;
  return target;
}

export function isInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === '' || (!isBreakingOut(relative) && !path.isAbsolute(relative));
}

export async function zipDirectory(sourceDir: string, outputZip: string): Promise<void> {
  await fs.mkdir(path.dirname(outputZip), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputZip);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize().catch(reject);
  });
}
