import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoomDirectoryLock, RoomLockError } from '../../../src/fleet/rooms/room-lock.js';

interface LockFixture {
  version: 1;
  pid: number;
  hostname: string;
  token: string;
  acquiredAt: string;
}

describe('RoomDirectoryLock stale recovery', () => {
  const directories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  const fixture = (pid: number, token: string): LockFixture => ({
    version: 1,
    pid,
    hostname: os.hostname(),
    token,
    acquiredAt: new Date(0).toISOString(),
  });

  const setup = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'room-lock-race-'));
    directories.push(directory);
    const writerPath = path.join(directory, 'writer.lock');
    const recoveryPath = path.join(directory, 'writer.lock.recovery');
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    fs.writeFileSync(writerPath, JSON.stringify(fixture(deadPid, 'dead-holder')), { mode: 0o600 });
    return { directory, writerPath, recoveryPath };
  };

  it('fails closed without touching the writer when a recovery mutex remains', () => {
    const { directory, writerPath, recoveryPath } = setup();
    fs.writeFileSync(recoveryPath, JSON.stringify(fixture(process.pid, 'unfinished-recovery')), { mode: 0o600 });

    expect(() => RoomDirectoryLock.acquire(directory)).toThrow(RoomLockError);
    expect(JSON.parse(fs.readFileSync(writerPath, 'utf8')).token).toBe('dead-holder');
    expect(fs.existsSync(recoveryPath)).toBe(true);
  });

  it('re-reads the writer under the recovery mutex and never renames a replacement lock', () => {
    const { directory, writerPath, recoveryPath } = setup();
    const originalOpen = fs.openSync.bind(fs);
    vi.spyOn(fs, 'openSync').mockImplementation(((target: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      const descriptor = originalOpen(target, flags, mode);
      if (String(target) === recoveryPath && flags === 'wx') {
        fs.writeFileSync(writerPath, JSON.stringify(fixture(process.pid, 'replacement-holder')), { mode: 0o600 });
      }
      return descriptor;
    }) as typeof fs.openSync);

    expect(() => RoomDirectoryLock.acquire(directory)).toThrow(/already owned/);
    expect(JSON.parse(fs.readFileSync(writerPath, 'utf8')).token).toBe('replacement-holder');
    expect(fs.existsSync(recoveryPath)).toBe(false);
    expect(fs.readdirSync(directory).some((name) => name.startsWith('writer.lock.stale-'))).toBe(false);
  });
});
