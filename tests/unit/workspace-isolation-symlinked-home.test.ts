/**
 * WorkspaceIsolation under a symlinked $HOME (macOS-style `/var` → `/private/var`,
 * or any home reached through a link): the system whitelist AND the blocked
 * secret paths must both be matched in lexical and canonical form, so a
 * whitelisted `~/.codebuddy` can never let `~/.codebuddy/credentials.enc`
 * through in its canonical spelling.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type IsolationModule = typeof import('../../src/workspace/workspace-isolation.js');

describe('WorkspaceIsolation with a symlinked HOME', () => {
  const previousHome = process.env.HOME;
  // os.homedir() reads USERPROFILE on Windows, HOME elsewhere — redirect both.
  const previousUserProfile = process.env.USERPROFILE;
  let realHome: string;
  let linkHome: string;
  let mod: IsolationModule;

  beforeAll(async () => {
    realHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-iso-real-home-')));
    linkHome = path.join(fs.realpathSync(os.tmpdir()), `ws-iso-link-home-${process.pid}-${Date.now()}`);
    fs.symlinkSync(realHome, linkHome, 'dir');
    fs.mkdirSync(path.join(realHome, '.codebuddy'));
    fs.mkdirSync(path.join(realHome, '.ssh'));
    // BLOCKED_PATHS / SYSTEM_WHITELIST are computed from os.homedir() at import time.
    process.env.HOME = linkHome;
    process.env.USERPROFILE = linkHome;
    vi.resetModules();
    mod = await import('../../src/workspace/workspace-isolation.js');
  });

  afterAll(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    vi.resetModules();
    fs.rmSync(linkHome, { force: true });
    fs.rmSync(realHome, { recursive: true, force: true });
  });

  it('still blocks protected secrets in both their lexical and canonical spelling', () => {
    expect(os.homedir()).toBe(linkHome);
    const iso = new mod.WorkspaceIsolation({
      workspaceRoot: path.join(realHome, 'project'),
      logBlockedAccess: false,
    });
    for (const home of [linkHome, realHome]) {
      const credentials = iso.validatePath(path.join(home, '.codebuddy', 'credentials.enc'));
      expect(credentials.valid).toBe(false);
      expect(credentials.reason).toBe('blocked_path');
      const sshKey = iso.validatePath(path.join(home, '.ssh', 'id_ed25519'));
      expect(sshKey.valid).toBe(false);
      expect(sshKey.reason).toBe('blocked_path');
    }
  });

  it('keeps whitelisting benign config in both spellings', () => {
    const iso = new mod.WorkspaceIsolation({
      workspaceRoot: path.join(realHome, 'project'),
      logBlockedAccess: false,
    });
    for (const home of [linkHome, realHome]) {
      expect(iso.validatePath(path.join(home, '.codebuddy', 'settings.json')).valid).toBe(true);
    }
  });
});
