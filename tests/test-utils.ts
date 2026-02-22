/**
 * Cross-platform test utilities
 * Provides helpers for writing tests that work on both Unix and Windows
 */
import * as os from 'os';
import * as path from 'path';

export const isWindows = process.platform === 'win32';

/**
 * Creates a platform-appropriate absolute path for testing.
 * On Windows, '/test/project' becomes something like 'C:\\test\\project'
 * which is what path.resolve('/test/project') actually returns.
 */
export function testPath(...segments: string[]): string {
  return path.resolve(path.join('/', ...segments));
}

/**
 * Returns a platform-appropriate tmp directory path for testing.
 */
export function testTmpDir(suffix = ''): string {
  return path.join(os.tmpdir(), suffix);
}

/**
 * Normalizes a path for comparison (handles / vs \ and drive letters).
 */
export function normalizePath(p: string): string {
  return path.normalize(p);
}

/**
 * Returns a platform-appropriate "blocked" path for security tests.
 * On Unix: /etc/passwd, on Windows: C:\Windows\System32\config\SAM
 */
export function blockedPath(): string {
  return isWindows ? 'C:\\Windows\\System32\\config\\SAM' : '/etc/passwd';
}

/**
 * Skips a test on Windows with a reason.
 */
export const describeUnixOnly = isWindows ? describe.skip : describe;
export const itUnixOnly = isWindows ? it.skip : it;
export const describeWindowsOnly = isWindows ? describe : describe.skip;
export const itWindowsOnly = isWindows ? it : it.skip;
