/**
 * Workspace boundary for writes issued by an agent the MCP server constructed.
 * Relative targets resolve against the server workspace, not the process cwd.
 */
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

function resolveExisting(target: string): string {
  const absolute = path.resolve(target);
  const missing: string[] = [];
  let current = absolute;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.push(path.basename(current));
    current = parent;
  }
  let real = current;
  try {
    real = realpathSync(current);
  } catch {
    real = current;
  }
  return missing.length === 0 ? real : path.join(real, ...missing.reverse());
}

export function pathIsInsideWorkspace(root: string, target: string): boolean {
  const relative = path.relative(resolveExisting(root), resolveExisting(target));
  if (relative === '') return true;
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return false;
  if (path.isAbsolute(relative)) return false;
  return true;
}

/** True when `raw` stays inside `root` after resolution (absolute or relative). */
export function isConfinedTarget(root: string, raw: string): boolean {
  return pathIsInsideWorkspace(root, path.resolve(root, raw));
}
