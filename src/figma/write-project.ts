import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { applyDesignSystem } from '../templates/design-system-apply.js';
import { FigmaImportError, type GeneratedFile } from './types.js';

const FORBIDDEN_ROOTS = new Set(['/etc', '/bin', '/sbin', '/usr', '/var', '/dev', '/proc', '/sys', '/run', '/boot']);

export function assertSafeOutDir(outDir: string): string {
  if (!path.isAbsolute(outDir)) {
    throw new FigmaImportError('outDir must be an absolute path');
  }
  const resolved = path.resolve(outDir);
  const parsed = path.parse(resolved);
  if (FORBIDDEN_ROOTS.has(resolved) || resolved === parsed.root) {
    throw new FigmaImportError(`Refusing to write into system path: ${resolved}`);
  }
  return resolved;
}

export async function writeGeneratedProject(
  outDir: string,
  files: GeneratedFile[],
  options: { designSystemId?: string } = {},
): Promise<string[]> {
  const root = assertSafeOutDir(outDir);
  const written: string[] = [];

  for (const file of files) {
    const absolute = path.resolve(root, file.relativePath);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new FigmaImportError(`Refusing to write outside outDir: ${file.relativePath}`);
    }
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, file.content, 'utf8');
    written.push(file.relativePath.split(path.sep).join('/'));
  }

  const designSystemId = options.designSystemId?.trim();
  if (designSystemId) {
    const applied = applyDesignSystem(root, designSystemId);
    written.push(...applied.files);
  }

  written.sort();
  return written;
}
