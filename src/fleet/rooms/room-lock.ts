/**
 * Fleet rooms — exclusive single-writer lock for one ledger directory.
 *
 * Two `buddy server` processes commonly share one HOME. Without a lock both
 * would hand out the same `seq` and one compaction would erase the other's
 * appends. The lock is a `writer.lock` file created with `O_CREAT|O_EXCL`
 * holding `{ pid, hostname, token }`.
 *
 * Recovery is deliberately narrow: a lock is reclaimed only when it names THIS
 * host and a pid that no longer exists (`ESRCH`). A live pid (even a reused
 * one), another host, `EPERM` or an unreadable/corrupt lock file all fail
 * closed with {@link RoomLockError}; the operator removes the file by hand.
 *
 * @module fleet/rooms/room-lock
 */

import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const LOCK_FILE = 'writer.lock';
const RECOVERY_LOCK_FILE = 'writer.lock.recovery';

export class RoomLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomLockError';
  }
}

interface LockContent {
  version: 1;
  pid: number;
  hostname: string;
  token: string;
  acquiredAt: string;
}

function readLock(lockPath: string): LockContent | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Partial<LockContent>;
    if (parsed.version === 1 && Number.isSafeInteger(parsed.pid) && (parsed.pid as number) > 0 &&
        typeof parsed.hostname === 'string' && typeof parsed.token === 'string') {
      return parsed as LockContent;
    }
  } catch {
    // unreadable or corrupt: caller fails closed
  }
  return undefined;
}

function pidIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

export class RoomDirectoryLock {
  readonly lockPath: string;
  private readonly recoveryLockPath: string;
  private readonly token = randomBytes(16).toString('hex');
  private released = false;

  private constructor(directory: string) {
    this.lockPath = path.join(directory, LOCK_FILE);
    this.recoveryLockPath = path.join(directory, RECOVERY_LOCK_FILE);
  }

  /** Acquire the lock or throw {@link RoomLockError}. */
  static acquire(directory: string): RoomDirectoryLock {
    const lock = new RoomDirectoryLock(directory);
    if (fs.existsSync(lock.recoveryLockPath)) {
      throw new RoomLockError(
        `room ledger recovery lock ${lock.recoveryLockPath} remains; refusing automatic recovery (remove it manually only if no server uses this directory)`,
      );
    }
    if (lock.tryCreate()) return lock;
    if (!lock.tryCreateRecoveryMutex()) {
      throw new RoomLockError(
        `room ledger recovery lock ${lock.recoveryLockPath} is already held; refusing concurrent recovery`,
      );
    }
    try {
      // Re-read only after winning the recovery mutex. Another contender may
      // have replaced the stale writer between our first O_EXCL failure and
      // this point; that replacement must never be renamed.
      const holder = readLock(lock.lockPath);
      if (!holder) {
        throw new RoomLockError(
          `room ledger lock ${lock.lockPath} is unreadable; refusing to share the ledger (remove it only if no server uses this directory)`,
        );
      }
      if (holder.hostname !== os.hostname() || holder.pid === process.pid || !pidIsGone(holder.pid)) {
        throw new RoomLockError(
          `room ledger ${directory} is already owned by pid ${holder.pid} on ${holder.hostname}`,
        );
      }
      const stale = `${lock.lockPath}.stale-${holder.pid}-${Date.now()}`;
      try {
        fs.renameSync(lock.lockPath, stale);
      } catch (error) {
        throw new RoomLockError(`could not reclaim stale room ledger lock: ${(error as Error).message}`);
      }
      if (!lock.tryCreate()) {
        throw new RoomLockError(`room ledger ${directory} was claimed by another process during recovery`);
      }
      return lock;
    } finally {
      lock.releaseRecoveryMutex();
    }
  }

  private tryCreateRecoveryMutex(): boolean {
    let fd: number;
    try {
      fd = fs.openSync(this.recoveryLockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw new RoomLockError(`could not create room ledger recovery lock: ${(error as Error).message}`);
    }
    try {
      fs.writeSync(fd, JSON.stringify({
        version: 1,
        pid: process.pid,
        hostname: os.hostname(),
        token: this.token,
        acquiredAt: new Date().toISOString(),
      } satisfies LockContent));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  }

  private releaseRecoveryMutex(): void {
    if (readLock(this.recoveryLockPath)?.token !== this.token) return;
    try {
      fs.unlinkSync(this.recoveryLockPath);
    } catch {
      // A residue deliberately fails future recovery closed and requires an
      // operator to confirm that no server is active before removing it.
    }
  }

  private tryCreate(): boolean {
    let fd: number;
    try {
      fd = fs.openSync(this.lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw new RoomLockError(`could not create room ledger lock: ${(error as Error).message}`);
    }
    try {
      const content: LockContent = {
        version: 1,
        pid: process.pid,
        hostname: os.hostname(),
        token: this.token,
        acquiredAt: new Date().toISOString(),
      };
      fs.writeSync(fd, JSON.stringify(content));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  }

  /** True while the lock file on disk still carries this holder's token. */
  isHeld(): boolean {
    if (this.released) return false;
    return readLock(this.lockPath)?.token === this.token;
  }

  /** Release once; never removes a lock that another holder now owns. */
  release(): void {
    if (this.released) return;
    this.released = true;
    if (readLock(this.lockPath)?.token === this.token) {
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        // already gone
      }
    }
  }
}
