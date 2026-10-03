import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Creation stays within its physical base, with or without diff review. */
export function assertCreationWithinBase(filePath: string, baseDirectory: string): void {
  const base = fs.realpathSync(baseDirectory);
  let ancestor = path.dirname(filePath);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const realParent = fs.realpathSync(ancestor);
  const relative = path.relative(base, realParent);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Creation parent resolves outside the base directory');
  }
}

/** Publish complete content atomically without replacing any existing entry.
 * A hard link is exclusive even for dangling symlinks; failure never leaves a
 * partial destination for the review rollback to delete or overwrite.
 */
export function createFileExclusive(filePath: string, content: string, encoding: BufferEncoding = 'utf8', validate?: () => void): { dev: number; ino: number } {
  validate?.();
  const temporary = path.join(path.dirname(filePath), `.cb-create-${randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content, encoding);
    const identity = fs.fstatSync(fd);
    validate?.();
    fs.linkSync(temporary, filePath);
    return { dev: identity.dev, ino: identity.ino };
  } finally {
    try { fs.closeSync(fd); } finally { fs.unlinkSync(temporary); }
  }
}
