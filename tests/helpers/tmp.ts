/**
 * Teardown helpers for temp directories.
 *
 * On Windows a directory whose files were written moments ago (fire-and-forget
 * persistence, a just-killed child, AV/indexer scans) can still hold open
 * handles: `rm` then fails with ENOTEMPTY/EBUSY/EPERM where POSIX succeeds.
 *
 * `maxRetries` alone does not cover a late writer: Node's recursive removal
 * walks the children ONCE, then only retries the final `rmdir`, so a file
 * created after that walk fails every retry (tool-handler-filter.test.ts on
 * Windows CI, 2026-09-24, with maxRetries 10). `removeTestDir` repeats the
 * whole removal, then throws with the entries still present: a handle that
 * never closes stays a visible failure. `removeTmpDir` does the same passes
 * but only logs — for tests where a leftover temp dir is not the subject.
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

/** Codes a later full pass can clear: a handle closing, a file re-created after the walk. */
const RETRYABLE_RM_CODES = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);
/** One pass stays short so all passes fit well inside a 10 s hook timeout. */
const PASS_RM_OPTIONS = { recursive: true, force: true, maxRetries: 3, retryDelay: 50 } as const;
const PASS_DELAYS_MS = [50, 100, 200, 400, 800] as const;

type RmSync = (target: string, options: fs.RmOptions) => void;
type RmAsync = (target: string, options: fs.RmOptions) => Promise<void>;

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : undefined;
}

function leftovers(target: string, limit = 10): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const abs = path.join(dir, entry.name);
      out.push(path.relative(target, abs) + (entry.isDirectory() ? path.sep : ''));
      if (entry.isDirectory()) walk(abs);
    }
  };
  walk(target);
  return out;
}

function removalError(target: string, err: unknown, passes: number): Error {
  const code = errorCode(err) ?? (err instanceof Error ? err.message : String(err));
  const present = leftovers(target);
  return new Error(
    `[tests] temp dir not removed after ${passes} full pass(es): ${target} (${code}); ` +
      `still present: ${present.length ? present.join(', ') : '(nothing listed)'}. ` +
      'Close or await what still holds it (database, watcher, stream, child cwd, late writer).',
    { cause: err },
  );
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Remove a test temp dir; repeat the whole removal on transient errors, then throw. */
export function removeTestDir(target: string | undefined | null, rm: RmSync = fs.rmSync): void {
  if (!target) return;
  for (let pass = 0; ; pass += 1) {
    try {
      rm(target, PASS_RM_OPTIONS);
      return;
    } catch (err) {
      const code = errorCode(err);
      if (!code || !RETRYABLE_RM_CODES.has(code) || pass >= PASS_DELAYS_MS.length) {
        throw removalError(target, err, pass + 1);
      }
      sleepSync(PASS_DELAYS_MS[pass]);
    }
  }
}

export async function removeTestDirAsync(
  target: string | undefined | null,
  rm: RmAsync = (dir, options) => fs.promises.rm(dir, options),
): Promise<void> {
  if (!target) return;
  for (let pass = 0; ; pass += 1) {
    try {
      await rm(target, PASS_RM_OPTIONS);
      return;
    } catch (err) {
      const code = errorCode(err);
      if (!code || !RETRYABLE_RM_CODES.has(code) || pass >= PASS_DELAYS_MS.length) {
        throw removalError(target, err, pass + 1);
      }
      await new Promise((resolve) => setTimeout(resolve, PASS_DELAYS_MS[pass]));
    }
  }
}

export function removeTmpDir(target: string | undefined | null): void {
  try {
    removeTestDir(target);
  } catch (err) {
    console.error(`[tests] temp dir cleanup skipped for ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function removeTmpDirAsync(target: string | undefined | null): Promise<void> {
  try {
    await removeTestDirAsync(target);
  } catch (err) {
    console.error(`[tests] temp dir cleanup skipped for ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
