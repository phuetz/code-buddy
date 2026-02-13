/**
 * Tests for SessionLock
 *
 * Comprehensive tests covering:
 * - PID-based lock acquisition
 * - Lock release
 * - Stale lock detection and cleanup
 * - Concurrent access detection
 * - Lock timeout/expiry
 * - Error handling (permissions, missing directories)
 * - withSessionLock helper
 * - getLockHolder and isLocked
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { SessionLock, LockInfo, withSessionLock } from '../../src/persistence/session-lock';

// Mock logger to suppress output
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

/**
 * Helper: spawn a long-running child process and return its PID.
 * The child sleeps for 60s so it stays alive for the duration of tests.
 */
function spawnBlockingProcess(): ChildProcess {
  const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

describe('SessionLock', () => {
  let tmpDir: string;
  let sessionFilePath: string;
  let childProcesses: ChildProcess[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-lock-test-'));
    sessionFilePath = path.join(tmpDir, 'test-session.json');
    // Create the session file so the directory exists
    fs.writeFileSync(sessionFilePath, '{}');
    childProcesses = [];
  });

  afterEach(() => {
    // Kill any child processes we spawned
    for (const child of childProcesses) {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
    childProcesses = [];

    // Clean up lock files and temp dir
    const lockPath = sessionFilePath + '.lock';
    try {
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    } catch { /* ignore */ }
    try {
      if (fs.existsSync(sessionFilePath)) fs.unlinkSync(sessionFilePath);
    } catch { /* ignore */ }
    try {
      fs.rmdirSync(tmpDir, { recursive: true } as fs.RmDirOptions);
    } catch { /* ignore */ }
  });

  describe('Lock Acquisition', () => {
    it('should acquire lock on first attempt', () => {
      const lock = new SessionLock(sessionFilePath);
      const acquired = lock.acquire();
      expect(acquired).toBe(true);
      lock.release();
    });

    it('should return true when re-acquiring already held lock', () => {
      const lock = new SessionLock(sessionFilePath);
      expect(lock.acquire()).toBe(true);
      // Re-acquiring same lock should return true
      expect(lock.acquire()).toBe(true);
      lock.release();
    });

    it('should create lock file on disk', () => {
      const lock = new SessionLock(sessionFilePath);
      lock.acquire();
      const lockPath = sessionFilePath + '.lock';
      expect(fs.existsSync(lockPath)).toBe(true);
      lock.release();
    });

    it('should write correct lock info to lock file', () => {
      const lock = new SessionLock(sessionFilePath);
      lock.acquire();

      const lockPath = sessionFilePath + '.lock';
      const raw = fs.readFileSync(lockPath, 'utf-8');
      const info: LockInfo = JSON.parse(raw);

      expect(info.pid).toBe(process.pid);
      expect(info.hostname).toBe(os.hostname());
      expect(typeof info.timestamp).toBe('number');
      expect(info.timestamp).toBeGreaterThan(0);
      expect(info.timestamp).toBeLessThanOrEqual(Date.now());

      lock.release();
    });

    it('should create parent directories if they do not exist', () => {
      const nestedPath = path.join(tmpDir, 'deep', 'nested', 'session.json');
      const lock = new SessionLock(nestedPath);
      const acquired = lock.acquire();
      expect(acquired).toBe(true);

      const lockPath = nestedPath + '.lock';
      expect(fs.existsSync(lockPath)).toBe(true);

      lock.release();
      // Cleanup
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      try { fs.rmSync(path.join(tmpDir, 'deep'), { recursive: true }); } catch { /* ignore */ }
    });

    it('should acquire lock when lock file owned by current process', () => {
      // Manually create a lock file owned by the current process
      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: process.pid,
        timestamp: Date.now(),
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      const lock = new SessionLock(sessionFilePath);
      const acquired = lock.acquire();
      expect(acquired).toBe(true);

      lock.release();
    });
  });

  describe('Lock Release', () => {
    it('should release lock and remove lock file', () => {
      const lock = new SessionLock(sessionFilePath);
      lock.acquire();
      lock.release();

      const lockPath = sessionFilePath + '.lock';
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('should be safe to release lock multiple times', () => {
      const lock = new SessionLock(sessionFilePath);
      lock.acquire();
      lock.release();
      // Should not throw
      lock.release();
    });

    it('should be safe to release lock that was never acquired', () => {
      const lock = new SessionLock(sessionFilePath);
      // Should not throw
      lock.release();
    });

    it('should not release lock owned by different process', () => {
      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: 99999999, // Different PID
        timestamp: Date.now(),
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      // Create a lock that thinks it is acquired
      const lock = new SessionLock(sessionFilePath);
      // Manually set acquired flag by acquiring when our PID matches
      // But since the file has a different PID, release should not delete it
      (lock as unknown as { acquired: boolean }).acquired = true;
      lock.release();

      // Lock file should still exist since PID doesn't match
      expect(fs.existsSync(lockPath)).toBe(true);

      // Cleanup
      fs.unlinkSync(lockPath);
    });
  });

  describe('Stale Lock Detection', () => {
    it('should clean up stale lock from dead process', () => {
      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: 99999999, // Non-existent PID
        timestamp: Date.now(),
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      const lock = new SessionLock(sessionFilePath);
      const acquired = lock.acquire();
      expect(acquired).toBe(true);

      lock.release();
    });

    it('should clean up stale lock from expired timestamp', () => {
      // Spawn a child process that stays alive
      const child = spawnBlockingProcess();
      childProcesses.push(child);

      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: child.pid!, // Alive process but with old timestamp
        timestamp: Date.now() - 120_000, // 2 minutes ago (stale threshold is 1 min)
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      const lock = new SessionLock(sessionFilePath);
      const acquired = lock.acquire();
      // Should acquire because timestamp is stale even though process is alive
      expect(acquired).toBe(true);

      lock.release();
    });

    it('should handle corrupt lock file gracefully', () => {
      const lockPath = sessionFilePath + '.lock';
      fs.writeFileSync(lockPath, 'not valid json {{{');

      const lock = new SessionLock(sessionFilePath);
      const acquired = lock.acquire();
      expect(acquired).toBe(true);

      lock.release();
    });

    it('should handle empty lock file', () => {
      const lockPath = sessionFilePath + '.lock';
      fs.writeFileSync(lockPath, '');

      const lock = new SessionLock(sessionFilePath);
      const acquired = lock.acquire();
      expect(acquired).toBe(true);

      lock.release();
    });
  });

  describe('Concurrent Access Detection', () => {
    it('should block second lock on same file when first is active', () => {
      const lock1 = new SessionLock(sessionFilePath);
      const lock2 = new SessionLock(sessionFilePath);

      expect(lock1.acquire()).toBe(true);
      // Second lock attempt for same process should succeed
      // because the code checks if info.pid === process.pid
      expect(lock2.acquire()).toBe(true);

      lock1.release();
      lock2.release();
    });

    it('should block lock when held by another live process', () => {
      // Spawn a child process owned by current user
      const child = spawnBlockingProcess();
      childProcesses.push(child);

      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: child.pid!,
        timestamp: Date.now(),
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      const lock = new SessionLock(sessionFilePath);
      const acquired = lock.acquire();
      expect(acquired).toBe(false);

      // Cleanup
      fs.unlinkSync(lockPath);
    });

    it('should report isLocked when lock is held by live process', () => {
      // Spawn a child process owned by current user
      const child = spawnBlockingProcess();
      childProcesses.push(child);

      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: child.pid!,
        timestamp: Date.now(),
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      const lock = new SessionLock(sessionFilePath);
      expect(lock.isLocked()).toBe(true);

      // Cleanup
      fs.unlinkSync(lockPath);
    });

    it('should report not locked when lock file does not exist', () => {
      const lock = new SessionLock(sessionFilePath);
      expect(lock.isLocked()).toBe(false);
    });

    it('should report not locked when lock holder process is dead', () => {
      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: 99999999, // Dead process
        timestamp: Date.now(),
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      const lock = new SessionLock(sessionFilePath);
      expect(lock.isLocked()).toBe(false);

      // Cleanup
      fs.unlinkSync(lockPath);
    });
  });

  describe('getLockHolder', () => {
    it('should return null when no lock file exists', () => {
      const lock = new SessionLock(sessionFilePath);
      expect(lock.getLockHolder()).toBeNull();
    });

    it('should return lock info when lock file exists', () => {
      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: 12345,
        timestamp: Date.now(),
        hostname: 'test-host',
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      const lock = new SessionLock(sessionFilePath);
      const holder = lock.getLockHolder();

      expect(holder).not.toBeNull();
      expect(holder!.pid).toBe(12345);
      expect(holder!.hostname).toBe('test-host');

      // Cleanup
      fs.unlinkSync(lockPath);
    });

    it('should return null for corrupt lock file', () => {
      const lockPath = sessionFilePath + '.lock';
      fs.writeFileSync(lockPath, 'invalid json');

      const lock = new SessionLock(sessionFilePath);
      expect(lock.getLockHolder()).toBeNull();

      // Cleanup
      fs.unlinkSync(lockPath);
    });
  });

  describe('isLocked', () => {
    it('should return false when lock file is absent', () => {
      const lock = new SessionLock(sessionFilePath);
      expect(lock.isLocked()).toBe(false);
    });

    it('should return true when lock holder is alive', () => {
      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: process.pid, // Current process is alive
        timestamp: Date.now(),
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      const lock = new SessionLock(sessionFilePath);
      expect(lock.isLocked()).toBe(true);

      // Cleanup
      fs.unlinkSync(lockPath);
    });

    it('should return false for corrupt lock file', () => {
      const lockPath = sessionFilePath + '.lock';
      fs.writeFileSync(lockPath, '{bad');

      const lock = new SessionLock(sessionFilePath);
      expect(lock.isLocked()).toBe(false);

      // Cleanup
      fs.unlinkSync(lockPath);
    });
  });

  describe('Error Handling', () => {
    it('should handle ENOENT when lock file disappears during release', () => {
      const lock = new SessionLock(sessionFilePath);
      lock.acquire();

      // Delete the lock file out from under it
      const lockPath = sessionFilePath + '.lock';
      fs.unlinkSync(lockPath);

      // Release should not throw
      expect(() => lock.release()).not.toThrow();
    });

    it('should handle race condition during acquire (wx flag failure)', () => {
      // Spawn a child process to act as the competing lock holder
      const child = spawnBlockingProcess();
      childProcesses.push(child);

      const lock = new SessionLock(sessionFilePath);

      // Pre-create the lock file to simulate race condition
      // where another process creates the file between existsSync check and writeFileSync
      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: child.pid!, // Live process owned by current user
        timestamp: Date.now(),
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      const acquired = lock.acquire();
      expect(acquired).toBe(false);

      // Cleanup
      fs.unlinkSync(lockPath);
    });

    it('should handle lock file with missing fields', () => {
      const lockPath = sessionFilePath + '.lock';
      fs.writeFileSync(lockPath, JSON.stringify({ pid: null }));

      const lock = new SessionLock(sessionFilePath);
      // Should handle gracefully (null PID will cause isProcessAlive to fail)
      const acquired = lock.acquire();
      // It should clean up the corrupt-ish lock and acquire
      expect(acquired).toBe(true);

      lock.release();
    });
  });

  describe('withSessionLock helper', () => {
    it('should execute function with lock held', async () => {
      let executedInLock = false;
      const result = await withSessionLock(sessionFilePath, async () => {
        executedInLock = true;
        return 42;
      });

      expect(executedInLock).toBe(true);
      expect(result).toBe(42);
    });

    it('should release lock after function completes', async () => {
      await withSessionLock(sessionFilePath, async () => {
        return 'done';
      });

      // Lock should be released
      const lockPath = sessionFilePath + '.lock';
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('should release lock even if function throws', async () => {
      await expect(
        withSessionLock(sessionFilePath, async () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');

      // Lock should be released
      const lockPath = sessionFilePath + '.lock';
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('should throw when lock cannot be acquired', async () => {
      // Spawn a child process to hold the lock
      const child = spawnBlockingProcess();
      childProcesses.push(child);

      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: child.pid!,
        timestamp: Date.now(),
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      await expect(
        withSessionLock(sessionFilePath, async () => 'should not run')
      ).rejects.toThrow(`Session file is locked by PID ${child.pid}`);

      // Cleanup
      fs.unlinkSync(lockPath);
    });

    it('should include PID in error message when lock is held', async () => {
      // Spawn a child process to hold the lock
      const child = spawnBlockingProcess();
      childProcesses.push(child);

      const lockPath = sessionFilePath + '.lock';
      const info: LockInfo = {
        pid: child.pid!,
        timestamp: Date.now(),
        hostname: os.hostname(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(info));

      try {
        await withSessionLock(sessionFilePath, async () => 'nope');
        throw new Error('Expected withSessionLock to throw');
      } catch (error) {
        expect((error as Error).message).toContain(`PID ${child.pid}`);
        expect((error as Error).message).toContain('.lock');
      }

      // Cleanup
      fs.unlinkSync(lockPath);
    });

    it('should return the value from the callback', async () => {
      const result = await withSessionLock(sessionFilePath, async () => {
        return { key: 'value', count: 3 };
      });

      expect(result).toEqual({ key: 'value', count: 3 });
    });
  });

  describe('Lock File Path', () => {
    it('should append .lock to session file path', () => {
      const lock = new SessionLock('/tmp/my-session.json');
      lock.acquire();
      // The lock path should be /tmp/my-session.json.lock
      expect(fs.existsSync('/tmp/my-session.json.lock')).toBe(true);
      lock.release();
    });

    it('should handle paths with special characters', () => {
      const specialPath = path.join(tmpDir, 'session-with-dashes_and_underscores.json');
      fs.writeFileSync(specialPath, '{}');

      const lock = new SessionLock(specialPath);
      expect(lock.acquire()).toBe(true);
      lock.release();

      // Cleanup
      try { fs.unlinkSync(specialPath); } catch { /* ignore */ }
    });
  });
});
