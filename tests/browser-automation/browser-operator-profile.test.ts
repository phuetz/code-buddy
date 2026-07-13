import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  acquirePersistentBrowserOperatorProfileLock,
  BROWSER_OPERATOR_PROFILE_LOCK,
  BROWSER_OPERATOR_PROFILE_MARKER,
  resolvePersistentBrowserOperatorProfile,
} from '../../src/browser-automation/browser-operator-executor.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Browser Operator persistent profile', () => {
  it('creates a private dedicated profile that survives runtime restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browser-operator-profile-'));
    directories.push(root);
    const profile = join(root, 'profile');

    expect(resolvePersistentBrowserOperatorProfile(profile)).toBe(profile);
    expect(resolvePersistentBrowserOperatorProfile(profile)).toBe(profile);
    const mode = (await lstat(profile)).mode & 0o777;
    expect(mode).toBe(0o700);
    const markerPath = join(profile, BROWSER_OPERATOR_PROFILE_MARKER);
    expect(JSON.parse(await readFile(markerPath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      owner: 'code-buddy-browser-operator',
    });
    if (process.platform !== 'win32') {
      expect((await lstat(markerPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses to adopt a non-empty unmarked Chrome profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browser-operator-personal-profile-'));
    directories.push(root);
    const profile = join(root, 'profile');
    await mkdir(profile);
    await writeFile(join(profile, 'Local State'), '{"browser":"personal"}');

    expect(() => resolvePersistentBrowserOperatorProfile(profile)).toThrow(/non-empty.*ownership marker/i);
  });

  it('accepts browser state only after Code Buddy marked the dedicated directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browser-operator-owned-profile-'));
    directories.push(root);
    const profile = join(root, 'profile');
    resolvePersistentBrowserOperatorProfile(profile);
    await mkdir(join(profile, 'Default'));
    await writeFile(join(profile, 'Default', 'Cookies'), 'persisted sign-in');

    expect(resolvePersistentBrowserOperatorProfile(profile)).toBe(profile);
  });

  it('refuses a symlink profile instead of exposing another browser profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browser-operator-profile-link-'));
    directories.push(root);
    const target = join(root, 'target');
    const link = join(root, 'profile');
    await mkdir(target);
    await symlink(target, link);

    expect(() => resolvePersistentBrowserOperatorProfile(link)).toThrow(/real directory/i);
  });

  it('holds one cross-process lease and releases it without deleting another owner lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browser-operator-profile-lock-'));
    directories.push(root);
    const profile = resolvePersistentBrowserOperatorProfile(join(root, 'profile'));
    const first = acquirePersistentBrowserOperatorProfileLock(profile);

    expect(() => acquirePersistentBrowserOperatorProfileLock(profile)).toThrow(/already in use/i);
    expect((await lstat(join(profile, BROWSER_OPERATOR_PROFILE_LOCK))).isFile()).toBe(true);

    first.release();
    const second = acquirePersistentBrowserOperatorProfileLock(profile);
    expect(second.token).not.toBe(first.token);
    second.release();
  });

  it('recovers a stale lock whose recorded process is no longer alive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browser-operator-stale-lock-'));
    directories.push(root);
    const profile = resolvePersistentBrowserOperatorProfile(join(root, 'profile'));
    const stale = acquirePersistentBrowserOperatorProfileLock(profile, {
      pid: 999_999_999,
    });
    const recovered = acquirePersistentBrowserOperatorProfileLock(profile, {
      isProcessAlive: () => false,
    });

    expect(recovered.token).not.toBe(stale.token);
    expect(() => stale.release()).toThrow(/another process/i);
    recovered.release();
  });
});
