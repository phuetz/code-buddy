import * as path from 'node:path';

/**
 * Checks if a child path is within a parent path.
 */
export function isPathWithin(child: string, parent: string): boolean {
  if (!child || !parent) return false;
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  if (resolvedChild === resolvedParent) return true;
  const relative = path.relative(resolvedParent, resolvedChild);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
