import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fdInside } from '../../src/security/consolidated-audit.js';

// macOS has no /proc and its temporary directory is an alias (/var → /private/var).
// Both are reproduced here on any POSIX host: a missing proc directory, and a
// root reached through a symlink.
const itPosix = process.platform === 'win32' ? it.skip : it;
const dirs: string[] = [];
const fds: number[] = [];

afterEach(() => {
  for (const fd of fds.splice(0)) closeSync(fd);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function aliasedProfile(): { alias: string; file: string; other: string } {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'fd-inside-')));
  dirs.push(base);
  const real = path.join(base, 'private', 'profile');
  mkdirSync(real, { recursive: true });
  const alias = path.join(base, 'alias-profile');
  symlinkSync(real, alias);
  writeFileSync(path.join(real, 'config.toml'), 'x = 1\n');
  writeFileSync(path.join(real, 'other.toml'), 'y = 2\n');
  return { alias, file: path.join(alias, 'config.toml'), other: path.join(alias, 'other.toml') };
}

describe('fdInside without /proc (macOS, BSD)', () => {
  const noProc = path.join(tmpdir(), 'no-such-proc-fd-dir');

  itPosix('accepts the expected file under a root reached through an alias', () => {
    const { alias, file } = aliasedProfile();
    const fd = openSync(file, 'r');
    fds.push(fd);
    expect(fdInside(fd, [alias], file, noProc)).toBe(true);
  });

  itPosix('refuses when the open descriptor is not the file it claims to be', () => {
    const { alias, file, other } = aliasedProfile();
    const fd = openSync(other, 'r');
    fds.push(fd);
    expect(fdInside(fd, [alias], file, noProc)).toBe(false);
  });

  itPosix('refuses a file outside the roots', () => {
    const { file } = aliasedProfile();
    const elsewhere = realpathSync(mkdtempSync(path.join(tmpdir(), 'fd-inside-elsewhere-')));
    dirs.push(elsewhere);
    const fd = openSync(file, 'r');
    fds.push(fd);
    expect(fdInside(fd, [elsewhere], file, noProc)).toBe(false);
  });
});

describe('fdInside with /proc (Linux)', () => {
  const itLinux = process.platform === 'linux' ? it : it.skip;

  itLinux('accepts a file under an aliased root', () => {
    const { alias, file } = aliasedProfile();
    const fd = openSync(file, 'r');
    fds.push(fd);
    expect(fdInside(fd, [alias], file)).toBe(true);
  });
});
