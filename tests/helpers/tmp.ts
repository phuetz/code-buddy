/**
 * Teardown helpers for temp directories.
 *
 * On Windows a directory whose files were written moments ago (fire-and-forget
 * persistence, a just-killed child, AV/indexer scans) can still hold open
 * handles: `rm` then fails with ENOTEMPTY/EBUSY/EPERM where POSIX succeeds.
 * `removeTmpDir` retries briefly and NEVER throws — a leftover temp dir must
 * not fail the test that already proved its point; the skipped cleanup is
 * logged so a real leak stays visible.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const TMP_RM_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;

/**
 * Unique temp directory with the canonical (realpath) spelling.
 *
 * `os.tmpdir()` is a symlink on macOS (`/var` → `/private/var`). Session cwd
 * stores that realpath, so tests must create and compare the same path.
 * Prefer a caller-supplied `baseDir` (e.g. the repo `tmp/` folder) when the
 * directory will be used as a bash cwd: Linux bubblewrap mounts a tmpfs on
 * `/tmp` and would hide a workspace created under `os.tmpdir()`.
 */
export function makeTmpDir(prefix: string, baseDir: string = os.tmpdir()): string {
  fs.mkdirSync(baseDir, { recursive: true });
  const created = fs.mkdtempSync(path.join(baseDir, prefix));
  return fs.realpathSync.native(created);
}

/**
 * Parent for scratch directories that must live inside the repository (tsconfig
 * and node_modules lookup, or a bash cwd hidden by bubblewrap's /tmp tmpfs).
 *
 * It is the gitignored `tmp/` folder, never the repository root: a dot-dir
 * created at the root shows up in `git status` for every test running
 * concurrently in another worker (catalogue-routes-http-b.test.ts saw a
 * sibling's `.gk18-pr-*` on Windows CI, 2026-09-24), and stays there for good
 * when a Windows cleanup is skipped.
 */
export function repoScratchRoot(repoRoot: string): string {
  const base = path.join(repoRoot, 'tmp');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function removeTmpDir(target: string | undefined | null): void {
  if (!target) return;
  try {
    fs.rmSync(target, TMP_RM_OPTIONS);
  } catch (err) {
    console.error(`[tests] temp dir cleanup skipped for ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function removeTmpDirAsync(target: string | undefined | null): Promise<void> {
  if (!target) return;
  try {
    await fs.promises.rm(target, TMP_RM_OPTIONS);
  } catch (err) {
    console.error(`[tests] temp dir cleanup skipped for ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
