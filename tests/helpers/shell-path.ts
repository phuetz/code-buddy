/**
 * Compare a path printed by the bash tool's shell with a Node path.
 *
 * On Windows the tool runs commands through Git Bash, whose `pwd` prints the
 * MSYS spelling (`/tmp/x`, `/c/Users/x`) — `fs.realpathSync` on that string
 * resolves `/tmp` on the process drive and throws ENOENT. `shellPathToNative`
 * converts the MSYS form back with `cygpath -w` (shipped with Git Bash), and
 * `canonical` uses the native realpath so 8.3 short names (`RUNNER~1`) and
 * long names compare equal. Both are identity functions on POSIX hosts.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

export function shellPathToNative(shellPath: string): string {
  const trimmed = shellPath.trim();
  if (process.platform !== 'win32' || !trimmed.startsWith('/')) return trimmed;
  try {
    return execFileSync('bash', ['-c', 'cygpath -w "$1"', '_', trimmed], { encoding: 'utf8' }).trim();
  } catch {
    return trimmed;
  }
}

export function canonical(target: string): string {
  return fs.realpathSync.native(target);
}

/** `pwd` output from the tool, canonicalised for an equality check against a Node path. */
export function canonicalShellPath(shellPath: string): string {
  return canonical(shellPathToNative(shellPath));
}
