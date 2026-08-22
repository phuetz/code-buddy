import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as nodeFs from 'node:fs';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getFreeSpaceInfo,
  getFreeBytes,
  ensureFreeSpace,
  DiskSpaceError,
  DiskBudgetError,
  sweepOrphans,
  createManagedTempDir,
  disposeAllManagedTempDirs,
  DiskBudget,
  rotateIfLarge,
  boundedWriteFile,
  boundedAppendFile,
  resetDiskGuardForTests,
  DISK_GUARD_DEFAULTS,
} from '../../src/utils/disk-guard.js';

describe('disk-guard', () => {
  let sandbox: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'dg-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDiskGuardForTests();
    // restore any env vars the test touched
    delete process.env.CODEBUDDY_MIN_FREE_MB;
    delete process.env.CODEBUDDY_DISK_QUOTA_MB;
    delete process.env.CODEBUDDY_TEMP_MAX_AGE_MS;
    delete process.env.CODEBUDDY_LOG_MAX_MB;
    delete process.env.CODEBUDDY_LOG_MAX_FILES;
    Object.assign(process.env, savedEnv);
    try {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      /* best effort */
    }
  });

  describe('getFreeSpaceInfo / getFreeBytes', () => {
    it('reports real, sane free space for an existing path', () => {
      const info = getFreeSpaceInfo(sandbox);
      expect(info).not.toBeNull();
      expect(info!.freeBytes).toBeGreaterThan(0);
      expect(info!.totalBytes).toBeGreaterThanOrEqual(info!.freeBytes);
      expect(info!.freePercent).toBeGreaterThanOrEqual(0);
      expect(info!.freePercent).toBeLessThanOrEqual(100);
      // getFreeBytes mirrors getFreeSpaceInfo().freeBytes — but each is a live
      // read, so assert a positive number rather than exact equality (free space
      // can shift by a block between two statfs calls).
      expect(getFreeBytes(sandbox)).toBeGreaterThan(0);
    });

    it('returns null (never throws) when the path cannot be stat-fs’d', () => {
      // A non-existent path makes the real statfsSync throw ENOENT — exercises
      // the catch→null branch without mocking the node:fs namespace.
      const missing = join(sandbox, 'no-such-dir');
      expect(getFreeSpaceInfo(missing)).toBeNull();
      expect(getFreeBytes(missing)).toBeNull();
    });

    it('uses bavail (non-root available), not bfree', () => {
      const raw = nodeFs.statfsSync(sandbox);
      const bsize = Number(raw.bsize);
      const info = getFreeSpaceInfo(sandbox)!;
      expect(info.freeBytes).toBe(Number(raw.bavail) * bsize);
      // On filesystems with root-reserved blocks bavail < bfree; assert we did
      // NOT use bfree. (Skipped only on the rare fs where they coincide.)
      if (Number(raw.bavail) !== Number(raw.bfree)) {
        expect(info.freeBytes).not.toBe(Number(raw.bfree) * bsize);
      }
    });
  });

  describe('ensureFreeSpace', () => {
    it('does not throw when free space is ample', () => {
      expect(() => ensureFreeSpace(sandbox, 1)).not.toThrow();
    });

    it('throws DiskSpaceError below the threshold', () => {
      try {
        ensureFreeSpace(sandbox, Number.MAX_SAFE_INTEGER, { label: 'unit' });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(DiskSpaceError);
        const e = err as DiskSpaceError;
        expect(e.code).toBe('DISK_SPACE_LOW');
        expect(e.message).toContain('refusing to proceed');
        expect(e.message).toContain('unit');
        expect(e.context).toMatchObject({ path: sandbox, minBytes: Number.MAX_SAFE_INTEGER });
      }
    });

    it('honours CODEBUDDY_MIN_FREE_MB as the default threshold', () => {
      const freeMb = Math.floor(getFreeBytes(sandbox)! / (1024 * 1024));
      // A threshold just above real free space must trip the guard. Clamp to the
      // reader's max (1 TB) so the env value is accepted; on a >1 TB-free volume
      // the throw branch is skipped but the '0 never trips' branch still proves
      // the env var is read.
      const trip = Math.min(freeMb + 1, 1_000_000);
      process.env.CODEBUDDY_MIN_FREE_MB = String(trip);
      if (trip > freeMb) {
        expect(() => ensureFreeSpace(sandbox)).toThrow(DiskSpaceError);
      }
      process.env.CODEBUDDY_MIN_FREE_MB = '0';
      expect(() => ensureFreeSpace(sandbox)).not.toThrow();
    });

    it('is a no-op when statfs is unavailable (cannot guard → does not block)', () => {
      // Non-existent path → real statfsSync throws → getFreeSpaceInfo null → no-op.
      const missing = join(sandbox, 'no-such-dir');
      expect(() => ensureFreeSpace(missing, Number.MAX_SAFE_INTEGER)).not.toThrow();
    });
  });

  describe('sweepOrphans', () => {
    it('presence-mode removes every prefix match, leaves others', () => {
      mkdirSync(join(sandbox, 'orphan-a'));
      mkdirSync(join(sandbox, 'orphan-b'));
      mkdirSync(join(sandbox, 'keep-me'));
      const res = sweepOrphans(sandbox, 'orphan-', { maxAgeMs: 0 });
      expect(res.removed).toHaveLength(2);
      expect(existsSync(join(sandbox, 'orphan-a'))).toBe(false);
      expect(existsSync(join(sandbox, 'orphan-b'))).toBe(false);
      expect(existsSync(join(sandbox, 'keep-me'))).toBe(true);
    });

    it('age-mode skips fresh dirs (protects a concurrent peer)', () => {
      mkdirSync(join(sandbox, 'orphan-fresh'));
      const res = sweepOrphans(sandbox, 'orphan-', { maxAgeMs: 60_000 });
      expect(res.removed).toHaveLength(0);
      expect(res.skipped).toHaveLength(1);
      expect(existsSync(join(sandbox, 'orphan-fresh'))).toBe(true);
    });

    it('dryRun reports matches without deleting', () => {
      mkdirSync(join(sandbox, 'orphan-x'));
      const res = sweepOrphans(sandbox, 'orphan-', { maxAgeMs: 0, dryRun: true });
      expect(res.removed).toHaveLength(1);
      expect(existsSync(join(sandbox, 'orphan-x'))).toBe(true);
    });

    it('returns empty (no throw) when the root is unreadable', () => {
      const res = sweepOrphans(join(sandbox, 'does-not-exist'), 'x-');
      expect(res).toEqual({ removed: [], skipped: [] });
    });
  });

  describe('createManagedTempDir', () => {
    it('creates a real dir and dispose() removes it (idempotently)', async () => {
      const handle = await createManagedTempDir('cb-managed-', { parentDir: sandbox, minFreeBytes: 0 });
      expect(existsSync(handle.path)).toBe(true);
      expect(handle.path.startsWith(join(sandbox, 'cb-managed-'))).toBe(true);
      await handle.dispose();
      expect(existsSync(handle.path)).toBe(false);
      await expect(handle.dispose()).resolves.toBeUndefined(); // idempotent
    });

    it('preflights free space and refuses on low disk (no dir created)', async () => {
      const before = readdirSync(sandbox).length;
      await expect(
        createManagedTempDir('cb-managed-', { parentDir: sandbox, minFreeBytes: Number.MAX_SAFE_INTEGER }),
      ).rejects.toBeInstanceOf(DiskSpaceError);
      expect(readdirSync(sandbox).length).toBe(before); // mkdtemp never ran
    });

    it('disposeAllManagedTempDirs cleans every tracked dir', async () => {
      const a = await createManagedTempDir('cb-m-', { parentDir: sandbox, minFreeBytes: 0 });
      const b = await createManagedTempDir('cb-m-', { parentDir: sandbox, minFreeBytes: 0 });
      expect(existsSync(a.path)).toBe(true);
      expect(existsSync(b.path)).toBe(true);
      await disposeAllManagedTempDirs();
      expect(existsSync(a.path)).toBe(false);
      expect(existsSync(b.path)).toBe(false);
    });
  });

  describe('DiskBudget', () => {
    it('quota 0 is unlimited', () => {
      const b = new DiskBudget(0);
      expect(b.reserve(1_000_000).allowed).toBe(true);
      expect(b.remaining()).toBe(Infinity);
    });

    it('refuses a reservation that would exceed the quota', () => {
      const b = new DiskBudget(100);
      expect(b.reserve(60).allowed).toBe(true);
      b.record(60);
      expect(b.used()).toBe(60);
      expect(b.remaining()).toBe(40);
      expect(b.reserve(50).allowed).toBe(false);
      expect(b.reserve(40).allowed).toBe(true);
      b.release(60);
      expect(b.used()).toBe(0);
    });

    it('reads CODEBUDDY_DISK_QUOTA_MB for the default quota', () => {
      process.env.CODEBUDDY_DISK_QUOTA_MB = '1';
      const b = new DiskBudget();
      expect(b.remaining()).toBe(1 * 1024 * 1024);
    });
  });

  describe('rotateIfLarge', () => {
    const logPath = () => join(sandbox, 'audit.log');

    it('does nothing when the file is below the size limit', () => {
      writeFileSync(logPath(), 'small');
      expect(rotateIfLarge(logPath(), 1024)).toBe(false);
      expect(readFileSync(logPath(), 'utf8')).toBe('small');
    });

    it('rotates the current file to .1 when over the limit', () => {
      writeFileSync(logPath(), 'x'.repeat(2048));
      expect(rotateIfLarge(logPath(), 1024, 3)).toBe(true);
      expect(existsSync(logPath())).toBe(false);
      expect(readFileSync(join(sandbox, 'audit.1.log'), 'utf8')).toBe('x'.repeat(2048));
    });

    it('shifts generations and drops beyond maxFiles', () => {
      // gen 1
      writeFileSync(logPath(), 'a'.repeat(2048));
      rotateIfLarge(logPath(), 1024, 2); // a -> audit.1.log
      // gen 2
      writeFileSync(logPath(), 'b'.repeat(2048));
      rotateIfLarge(logPath(), 1024, 2); // b -> audit.1.log, a -> audit.2.log
      // gen 3 (maxFiles=2 → the oldest, audit.2.log, is dropped)
      writeFileSync(logPath(), 'c'.repeat(2048));
      rotateIfLarge(logPath(), 1024, 2);
      expect(readFileSync(join(sandbox, 'audit.1.log'), 'utf8')).toBe('c'.repeat(2048));
      expect(readFileSync(join(sandbox, 'audit.2.log'), 'utf8')).toBe('b'.repeat(2048));
      expect(existsSync(join(sandbox, 'audit.3.log'))).toBe(false);
    });

    it('returns false for a non-existent file', () => {
      expect(rotateIfLarge(join(sandbox, 'nope.log'), 1)).toBe(false);
    });
  });

  describe('boundedWriteFile / boundedAppendFile', () => {
    it('writes when space is ample', async () => {
      const p = join(sandbox, 'out.txt');
      await boundedWriteFile(p, 'hello', { minFreeBytes: 0 });
      expect(readFileSync(p, 'utf8')).toBe('hello');
    });

    it('throws DiskBudgetError before writing when the budget is exceeded', async () => {
      const p = join(sandbox, 'capped.txt');
      const budget = new DiskBudget(4); // 4 bytes
      await expect(
        boundedWriteFile(p, 'way too many bytes', { minFreeBytes: 0, budget }),
      ).rejects.toBeInstanceOf(DiskBudgetError);
      expect(existsSync(p)).toBe(false); // never touched disk
    });

    it('records budget usage on a successful bounded write', async () => {
      const p = join(sandbox, 'tracked.txt');
      const budget = new DiskBudget(1024);
      await boundedWriteFile(p, 'abcde', { minFreeBytes: 0, budget });
      expect(budget.used()).toBe(5);
    });

    it('rotates an oversized append target before appending', async () => {
      const p = join(sandbox, 'journal.jsonl');
      writeFileSync(p, 'y'.repeat(2048));
      await boundedAppendFile(p, 'new-line\n', { minFreeBytes: 0, rotate: { maxBytes: 1024, maxFiles: 3 } });
      expect(readFileSync(join(sandbox, 'journal.1.jsonl'), 'utf8')).toBe('y'.repeat(2048));
      expect(readFileSync(p, 'utf8')).toBe('new-line\n'); // fresh file after rotation
    });
  });

  describe('regression: 2026-06-17 ENOSPC scenario', () => {
    it('sweeps leaked orphan temp dirs, then refuses to proceed on low disk', () => {
      // Simulate prior crashed runs that leaked their temp dirs.
      mkdirSync(join(sandbox, 'cowork-pilot-aaaa'));
      mkdirSync(join(sandbox, 'cowork-pilot-bbbb'));
      const swept = sweepOrphans(sandbox, 'cowork-pilot-', { maxAgeMs: 0 });
      expect(swept.removed).toHaveLength(2);
      expect(readdirSync(sandbox).filter((n) => n.startsWith('cowork-pilot-'))).toHaveLength(0);

      // With the disk still critically low, the guard fails fast and loud
      // rather than corrupting a run halfway through.
      expect(() => ensureFreeSpace(sandbox, Number.MAX_SAFE_INTEGER, { label: 'launch' })).toThrow(
        /refusing to proceed/,
      );
    });
  });

  it('exposes the documented defaults', () => {
    expect(DISK_GUARD_DEFAULTS.minFreeMb).toBe(500);
    expect(DISK_GUARD_DEFAULTS.logMaxMb).toBe(10);
    expect(DISK_GUARD_DEFAULTS.logMaxFiles).toBe(5);
  });

  // Contract lock: the Cowork pilot is a standalone pure-JS package that can't
  // import this lib, so it carries a duplicated guard. Its free-space threshold
  // must not silently drift from disk-guard's default.
  it('pilot guard threshold stays in sync with DISK_GUARD_DEFAULTS.minFreeMb', () => {
    const pilotPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../cowork/pilot/pilot-core.mjs',
    );
    const src = readFileSync(pilotPath, 'utf8');
    expect(src).toContain(`freeMb < ${DISK_GUARD_DEFAULTS.minFreeMb}`);
  });
});
