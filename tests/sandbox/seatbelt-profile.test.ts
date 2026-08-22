/**
 * Seatbelt (macOS sandbox-exec) profile generation.
 *
 * Pure-function coverage: the profile must be runnable on Darwin (reads
 * allowed, exec/fork allowed), confine writes to the CANONICAL writable roots
 * (macOS `/var` → `/private/var`, `/tmp` → `/private/tmp`), and keep the
 * protected metadata directories read-only inside a writable workspace.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  generateSeatbeltProfile,
  seatbeltProbeConfig,
  seatbeltUnreadablePaths,
  type OSSandboxConfig,
} from '../../src/sandbox/os-sandbox';

function config(overrides: Partial<OSSandboxConfig>): OSSandboxConfig {
  return {
    workDir: process.cwd(),
    readOnlyPaths: [],
    readWritePaths: [],
    allowNetwork: false,
    allowSubprocess: true,
    env: {},
    timeout: 1000,
    limits: {},
    allowedDomains: [],
    excludedCommands: [],
    allowUnsandboxed: false,
    ...overrides,
  };
}

// SBPL profiles are consumed by macOS sandbox-exec and embed POSIX paths
// (`/tmp`, `<root>/.git`); the generator is never used on Windows, where the
// `C:\…` forms would be meaningless. Pure-function coverage runs on POSIX hosts.
describe.skipIf(process.platform === 'win32')('generateSeatbeltProfile', () => {
  let realRoot: string;
  let linkRoot: string;

  beforeAll(() => {
    realRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-real-')));
    linkRoot = path.join(fs.realpathSync(os.tmpdir()), `seatbelt-link-${process.pid}-${Date.now()}`);
    fs.symlinkSync(realRoot, linkRoot, 'dir');
    fs.mkdirSync(path.join(realRoot, '.git'));
  });

  afterAll(() => {
    fs.rmSync(linkRoot, { force: true });
    fs.rmSync(realRoot, { recursive: true, force: true });
  });

  it('is closed by default but lets a Darwin process start (reads + exec + fork)', () => {
    const profile = generateSeatbeltProfile(config({}));
    expect(profile.startsWith('(version 1)')).toBe(true);
    expect(profile).toContain('(deny default)');
    expect(profile).toContain('(allow file-read*)');
    expect(profile).toContain('(allow process-exec)');
    expect(profile).toContain('(allow process-fork)');
    expect(profile).toContain('(allow sysctl-read)');
    expect(profile).not.toContain('(allow network*)');
    expect(profile).not.toContain('(deny process-fork)');
  });

  it('grants writes on both the lexical and the canonical form of a symlinked workspace', () => {
    const profile = generateSeatbeltProfile(config({ workDir: linkRoot }));
    expect(profile).toContain(`(subpath "${linkRoot}")`);
    expect(profile).toContain(`(subpath "${realRoot}")`);
    // scratch space stays writable
    expect(profile).toContain(`(allow file-write* (subpath "/tmp"))`);
  });

  it('carves protected read-only metadata out of a writable root and re-denies it explicitly', () => {
    const profile = generateSeatbeltProfile(
      config({
        workDir: linkRoot,
        readWritePaths: [linkRoot],
        readOnlyPaths: ['/usr', `${linkRoot}/.git`],
      })
    );
    const gitReal = `${realRoot}/.git`;
    expect(profile).toContain(
      `(allow file-write* (require-all (subpath "${realRoot}") (require-not (subpath "${gitReal}")) (require-not (literal "${gitReal}"))))`
    );
    expect(profile).toContain(`(deny file-write* (subpath "${gitReal}"))`);
    expect(profile).toContain(`(deny file-write* (subpath "${linkRoot}/.git"))`);
    // an unrelated read-only system path never becomes a write grant
    expect(profile).not.toContain('(allow file-write* (subpath "/usr"))');
  });

  it('denies credential reads in both spellings even though reads are otherwise open', () => {
    const profile = generateSeatbeltProfile(config({}));
    const allowIndex = profile.indexOf('(allow file-read*)');
    for (const secret of seatbeltUnreadablePaths()) {
      const denyLine = `(deny file-read* file-write* (subpath "${secret}"))`;
      expect(profile).toContain(denyLine);
      expect(profile).toContain(`(deny file-read* file-write* (literal "${secret}"))`);
      // later rules win in SBPL: the deny must follow the broad allow
      expect(profile.indexOf(denyLine)).toBeGreaterThan(allowIndex);
    }
    // the list is home-relative (so a symlinked $HOME gets both spellings via seatbeltPathForms)
    expect(seatbeltUnreadablePaths(linkRoot)).toContain(path.join(linkRoot, '.ssh'));
    expect(seatbeltUnreadablePaths(linkRoot)).toContain(path.join(linkRoot, '.codebuddy', 'credentials.enc'));
  });

  it('protects a not-yet-created .git under the canonical form of a symlinked root', () => {
    const missingGit = `${linkRoot}/sub/.git`; // linkRoot/sub does not exist
    const profile = generateSeatbeltProfile(
      config({ workDir: linkRoot, readWritePaths: [linkRoot], readOnlyPaths: [missingGit] })
    );
    expect(profile).toContain(`(deny file-write* (subpath "${realRoot}/sub/.git"))`);
    expect(profile).toContain(`(require-not (subpath "${realRoot}/sub/.git"))`);
  });

  it('probes with a representative workspace-write profile (carve-outs + denies present)', () => {
    const probe = seatbeltProbeConfig();
    const profile = generateSeatbeltProfile(probe);
    const scratch = fs.realpathSync(os.tmpdir());
    expect(profile).toContain('(require-all (subpath');
    expect(profile).toContain(`(require-not (subpath "${scratch}/.git"))`);
    expect(profile).toContain(`(deny file-write* (subpath "${scratch}/.git"))`);
    expect(profile).toContain('(deny file-read* file-write* (subpath');
    expect(profile).not.toContain('(allow file-write* (subpath "/usr"))');
  });

  it('opens the network and denies forking only when asked', () => {
    const profile = generateSeatbeltProfile(config({ allowNetwork: true, allowSubprocess: false }));
    expect(profile).toContain('(allow network*)');
    expect(profile).toContain('(deny process-fork)');
  });
});
