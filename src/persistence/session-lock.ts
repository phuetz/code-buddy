/**
 * Session Write Locks (Enterprise-grade)
 *
 * PID-based file locks with stale detection for session files.
 * Prevents concurrent writes to the same session from multiple processes.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface LockInfo {
  pid: number;
  timestamp: number;
  hostname: string;
}

const LOCK_STALE_MS = 60_000; // 1 minute — consider lock stale after this

/**
 * Check if a process is still alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}

/**
 * Session file lock manager.
 * Uses .lock files alongside session files with PID-based ownership.
 */
export class SessionLock {
  private lockPath: string;
  private acquired = false;
  private cleanupHandler: (() => void) | null = null;

  constructor(sessionFilePath: string) {
    this.lockPath = sessionFilePath + '.lock';
  }

  /**
   * Attempt to acquire the lock.
   * Returns true if acquired, false if another live process holds it.
   */
  acquire(): boolean {
    if (this.acquired) return true;

    // Check existing lock
    if (fs.existsSync(this.lockPath)) {
      try {
        const raw = fs.readFileSync(this.lockPath, 'utf-8');
        const info: LockInfo = JSON.parse(raw);

        // Same process already holds it
        if (info.pid === process.pid) {
          this.acquired = true;
          return true;
        }

        // Check if lock is stale (process dead or timeout)
        const isStale = !isProcessAlive(info.pid) ||
          (Date.now() - info.timestamp > LOCK_STALE_MS);

        if (!isStale) {
          logger.debug(`Session lock held by PID ${info.pid}`, { lockPath: this.lockPath });
          return false;
        }

        // Stale lock — clean up
        logger.debug(`Cleaning stale session lock from PID ${info.pid}`, { lockPath: this.lockPath });
        fs.unlinkSync(this.lockPath);
      } catch {
        // Corrupt lock file — remove it
        try { fs.unlinkSync(this.lockPath); } catch { /* ignore */ }
      }
    }

    // Write new lock
    try {
      const lockDir = path.dirname(this.lockPath);
      if (!fs.existsSync(lockDir)) {
        fs.mkdirSync(lockDir, { recursive: true });
      }

      const info: LockInfo = {
        pid: process.pid,
        timestamp: Date.now(),
        hostname: os.hostname(),
      };

      // Use wx flag for atomic create — fails if file already exists
      fs.writeFileSync(this.lockPath, JSON.stringify(info), { flag: 'wx' });
      this.acquired = true;

      // Cleanup on process exit
      const cleanup = () => this.release();
      this.cleanupHandler = cleanup;
      process.once('exit', cleanup);
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);

      return true;
    } catch (error) {
      // Race condition — another process created the file between our check and write
      logger.debug('Failed to acquire session lock (race)', { error });
      return false;
    }
  }

  /**
   * Release the lock.
   */
  release(): void {
    if (!this.acquired) return;

    try {
      if (fs.existsSync(this.lockPath)) {
        const raw = fs.readFileSync(this.lockPath, 'utf-8');
        const info: LockInfo = JSON.parse(raw);

        // Only delete if we own it
        if (info.pid === process.pid) {
          fs.unlinkSync(this.lockPath);
        }
      }
    } catch {
      // Best effort
    }

    this.acquired = false;
    this.removeProcessCleanupHandlers();
  }

  private removeProcessCleanupHandlers(): void {
    if (!this.cleanupHandler) return;
    process.removeListener('exit', this.cleanupHandler);
    process.removeListener('SIGINT', this.cleanupHandler);
    process.removeListener('SIGTERM', this.cleanupHandler);
    this.cleanupHandler = null;
  }

  /**
   * Check if the lock is currently held (by any process).
   */
  isLocked(): boolean {
    if (!fs.existsSync(this.lockPath)) return false;

    try {
      const raw = fs.readFileSync(this.lockPath, 'utf-8');
      const info: LockInfo = JSON.parse(raw);
      return isProcessAlive(info.pid);
    } catch {
      return false;
    }
  }

  /**
   * Get info about the current lock holder.
   */
  getLockHolder(): LockInfo | null {
    if (!fs.existsSync(this.lockPath)) return null;

    try {
      const raw = fs.readFileSync(this.lockPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

/**
 * The file lock accepts a second holder with its own PID, so it does not
 * order sections of one process, and the first release unlinked the lock
 * file under the others. Each path gets one in-process queue here; the file
 * lock still guards against other processes. A section entered from inside a
 * running section on the same path (same async chain) re-enters it without
 * waiting; a continuation that outlives its section waits like any caller.
 */
interface HeldSection { key: string; active: boolean }
const heldSections = new AsyncLocalStorage<readonly HeldSection[]>();
const inProcessTails = new Map<string, Promise<void>>();

/**
 * Execute a function with a session lock held.
 * Sections on one path run one at a time in this process; another process
 * holding the lock makes this throw.
 */
export async function withSessionLock<T>(
  sessionFilePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(sessionFilePath);
  const held = heldSections.getStore() ?? [];
  if (held.some((section) => section.key === key && section.active)) return fn();

  const previous = inProcessTails.get(key) ?? Promise.resolve();
  let endTurn!: () => void;
  const turn = new Promise<void>((resolve) => { endTurn = resolve; });
  const tail = previous.then(() => turn);
  inProcessTails.set(key, tail);
  await previous;
  const section: HeldSection = { key, active: true };
  try {
    const lock = new SessionLock(sessionFilePath);
    if (!lock.acquire()) {
      const holder = lock.getLockHolder();
      throw new Error(
        `Session file is locked by PID ${holder?.pid ?? 'unknown'}. ` +
        `If this is stale, delete ${sessionFilePath}.lock`
      );
    }
    try {
      return await heldSections.run([...held, section], fn);
    } finally {
      lock.release();
    }
  } finally {
    section.active = false;
    endTurn();
    if (inProcessTails.get(key) === tail) inProcessTails.delete(key);
  }
}
